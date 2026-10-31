const CallMetrics = require('../call-metrics');
// Serverless proxy: fetches Ozonetel CloudAgent "Agent State Summary" for one day
// and returns normalised rows. The API key never reaches the browser.
const hub=require('../lib/integration-client.cjs');
const readLoginStatus=require('../lib/login-status').createReader({query:hub.query,observe:hub.observe});
async function oz(method,path,body) {
  try { return await hub.query(path,body); }
  catch { return {http:503,j:{status:'error',message:'Shared report temporarily unavailable; saved records are retained.'}}; }
}
async function callSummary(body) {
  const r=await oz('POST','/ca_reports/summaryReport',body);
  return new Response(JSON.stringify(r.j),{status:r.http||503,headers:{'Content-Type':'application/json'}});
}

// ---- Call records (CDR): one day per request, max 2 requests/min, last 15 days only.
const liveCache = { stateAt: 0, stateMap: {} };
const cdrCache = new Map(); // date -> { at, calls }
const savedCallCache = new Map();
async function savedCalls(date) {
  const hit = savedCallCache.get(date);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) { hub.observe(hit.calls.integration); return hit.calls; }
  const month = date.slice(0, 7);
  const r = await fetch(`https://sunrooof-agent-calls-20260923.vercel.app/api/calls?month=${month}&date=none`);
  if (!r.ok) throw new Error('Saved call records unavailable');
  const data = CallMetrics.parseJson(await r.text());
  if (!Array.isArray(data.records)) throw new Error('Saved call records incomplete');
  const calls = data.records.filter(c => c['Call Date'] === date).map(c => ({
    AgentID: c['Agent ID'], AgentName: c.Agent, StartTime: c['Start Time'],
    TalkTime: c['Talk Time'], Status: c.Status, Type: c['Call Type'],
    CallID: CallMetrics.callId(c), UCID: CallMetrics.attemptId(c), CallDate: date,
  }));
  calls.integration={complete:true,stale:true,pending:true,sampledAt:Date.parse(data.sharedIntegration?.oldestSampleAt||data.updatedAt||'')/1000||0};
  hub.observe(calls.integration);savedCallCache.set(date, {at: Date.now(), calls});
  return calls;
}
async function fetchCalls(date, now) {
  const isToday = date === now.date;
  const hit = cdrCache.get(date);
  if (hit && Date.now() - hit.at < (isToday ? 35 : 300) * 1000) { hub.observe(hit.calls.integration); return hit.calls; }
  const r = await oz('GET', '/ca_reports/fetchCDRDetails', { userName: process.env.OZONETEL_USERNAME,
    fromDate: `${date} 00:00:00`, toDate: isToday ? `${date} ${now.time}` : `${date} 23:59:59` });
  if (String(r.j.status).toLowerCase() === 'success') {
    const calls = Array.isArray(r.j.details) ? r.j.details : [];
    calls.integration=r.j.integration; cdrCache.set(date, { at: (r.j.integration?.sampledAt||Date.now()/1000)*1000, calls });
    return calls;
  }
  if (/no data/i.test(String(r.j.message))) { cdrCache.set(date, { at: Date.now(), calls: [] }); return []; }
  if (hit) { hub.observe(hit.calls.integration); return hit.calls; } // rate limited or a blip: keep showing the last good pull
  throw new Error('Call records: ' + (typeof r.j.message === 'string' ? r.j.message : 'HTTP ' + r.http));
}


function callList(calls, agent) {
  return calls
    .filter((c) => !agent || c.AgentID === agent || c.AgentName === agent)
    .map((c) => ({
      agentId: c.AgentID || c.AgentName || '', agentName: c.AgentName || c.AgentID || '',
      callId: CallMetrics.callId(c), ucid: CallMetrics.attemptId(c),
      start: c.StartTime, end: c.EndTime, mode: String(c.Type || ''), number: c.CallerID || c.E164 || '', agentPhone: c.DialedNumber || '',
      campaign: c.CampaignName || '', skill: c.Skill || '', status: c.Status || '', disposition: c.Disposition || '',
      talk: toSec(c.TalkTime), ring: toSec(c.CustomerRingTime), duration: toSec(c.Duration),
      wrapup: toSec(c.WrapupDuration), hold: toSec(c.HoldDuration), hangupBy: c.HangupBy || '',
      customerStatus: c.CustomerDialStatus || '', recording: c.CallAudio || '',
    }))
    .sort((a, b) => String(b.start).localeCompare(String(a.start)));
}

const reportCalls = require('../lib/report-calls').createReportCallReader({ fetchCalls, savedCalls });

function timeSlots(calls) {
  const periods = [[10, 12], [12, 14], [14, 16], [16, 19]];
  const agents = new Map();
  for (const c of CallMetrics.group(calls)) {
    const id = c.agentId;
    const time = String(c.start || '').slice(-8);
    if (!id || !/^\d{2}:\d{2}:\d{2}$/.test(time)) continue;
    const hour = Number(time.slice(0, 2));
    const slot = periods.findIndex(([start, end]) => hour >= start && hour < end);
    if (slot < 0) continue;
    if (!agents.has(id)) agents.set(id, {agentId: id, agentName: c.agentName || id,
      slots: periods.map(() => ({calls: 0, connected: 0, talk: 0, boards: {}}))});
    const cell = agents.get(id).slots[slot];
    const talk = c.talk;
    const mode = String(c.mode || '').toLowerCase();
    const board = mode === 'progressive' ? 'Progressive' : mode === 'manual' ? 'Manual' : mode === 'inbound' ? 'Inbound' : 'Other';
    const connected = c.connected ? 1 : 0;
    cell.calls++;
    cell.connected += connected;
    cell.talk += talk;
    const component = cell.boards[board] || (cell.boards[board] = {calls: 0, connected: 0, talk: 0});
    component.calls++;
    component.connected += connected;
    component.talk += talk;
  }
  return [...agents.values()];
}

function callCounts(calls) {
  const groups = new Map();
  for (const c of CallMetrics.group(calls)) {
    const agentId = c.agentId;
    if (!agentId) continue;
    const mode = String(c.mode || 'Unknown');
    const key = JSON.stringify([agentId, mode]);
    const row = groups.get(key) || {agentId, agentName: c.agentName || agentId, mode, calls: 0, connected: 0};
    row.calls++;
    if (c.connected) row.connected++;
    groups.set(key, row);
  }
  return [...groups.values()];
}


async function liveData(date, now) {
  const calls = await fetchCalls(date, now);
  const rows = {}, names = {};
  let unassigned = 0, unassignedMissed = 0;
  for (const c of CallMetrics.group(calls)) {
    if (!c.agentId) { unassigned++; if (!c.connected) unassignedMissed++; continue; }
    const id = c.agentId; names[id] = c.agentName || id;
    const mode = String(c.mode || 'Unknown');
    const k = id + '|' + mode;
    const r = rows[k] || (rows[k] = { agentId: id, agentName: names[id], mode, calls: 0, connected: 0, talk: 0, wrapup: 0, lastCall: '' });
    r.calls++;
    if (c.connected) r.connected++;
    r.talk += c.talk; r.wrapup += c.wrapup;
    if (c.lastStart > r.lastCall) r.lastCall = c.lastStart;
  }
  const login = await readLoginStatus(names, String(process.env.OZONETEL_AGENT_IDS || '').split(',').map(x=>x.trim()).filter(Boolean));
  let modeHistory;
  try { modeHistory = await hub.modeHistory(date); } catch { modeHistory = null; }
  const blended = require('../lib/blended-calls').summarize(calls, modeHistory, date);
  return { rows: Object.values(rows), ...login, blended, slots: timeSlots(calls), unassigned, unassignedMissed, totalCalls: CallMetrics.group(calls).length };
}


const cache = new Map(); // date -> {at, payload}  (API allows only 5 calls/min)
const TTL_MS = 60 * 1000;
const intervalCache = new Map();
const intervalPending = new Map();
const reportIntervals = [
  {label: '10 AM–12 PM', start: '10:00:00', end: '11:59:59', seconds: 7200},
  {label: '12–2 PM', start: '12:00:00', end: '13:59:59', seconds: 7200},
  {label: '2–4 PM', start: '14:00:00', end: '15:59:59', seconds: 7200},
  {label: '4–7 PM', start: '16:00:00', end: '18:59:59', seconds: 10800},
];


const toSec = (t) => {
  if (t == null || t === '') return 0;
  if (typeof t === 'number') return t;
  const p = String(t).trim().split(':').map(Number);
  if (p.some(isNaN)) return 0;
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p.length === 2 ? p[0] * 60 + p[1] : p[0];
};


function istNow() {
  const d = new Date(Date.now() + 5.5 * 3600 * 1000);
  const iso = d.toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 19) };
}


function pick(o, ...keys) {
  for (const k of keys) if (o[k] != null && o[k] !== '') return o[k];
  return undefined;
}


function normalise(raw) {
  let list = [raw.details, raw.data, raw.message, raw].find(Array.isArray);
  if (!list) list = [raw.details, raw.data, raw.message].find((x) => x && typeof x === 'object' && (x.AgentName || x.ModeType));
  if (!Array.isArray(list)) list = list ? [list] : [];
  return list.map((r) => ({
    agentId: String(pick(r, 'AgentUniqueID', 'agentId', 'AgentID', 'AgentIncrID') ?? ''),
    agentName: String(pick(r, 'AgentName', 'agentName') ?? ''),
    mode: String(pick(r, 'ModeType', 'modeType') ?? 'Unknown'),
    login: toSec(pick(r, 'TotalLoginDuration', 'loginDuration')),
    talk: toSec(pick(r, 'TotalDialTime', 'talkDuration')),
    idle: toSec(pick(r, 'TotalIdleTime', 'readyDuration')),
    pause: toSec(pick(r, 'TotalPauseTime', 'pauseDuration')),
    busy: toSec(r.TotalBusyTime),
    wrapup: toSec(r.TotalWrapupTime),
  }));
}

async function intervalSummary(date) {
  const hit = intervalCache.get(date);
  if (hit?.payload && Date.now() - hit.at < 60 * 60 * 1000) return hit.payload;
  if (intervalPending.has(date)) return intervalPending.get(date);
  const pending = (async () => {
    const slots = hit?.slots ? [...hit.slots] : [];
    for (const [index, period] of reportIntervals.entries()) {
      if (slots[index]) continue;
      const body = {userName: process.env.OZONETEL_USERNAME,
        fromDate: `${date} ${period.start}`, toDate: `${date} ${period.end}`};
      if (process.env.OZONETEL_MODE_TYPES) body.modeType = process.env.OZONETEL_MODE_TYPES;
      if (process.env.OZONETEL_AGENT_IDS) body.agentId = process.env.OZONETEL_AGENT_IDS;
      const response = await callSummary(body);
      const text = await response.text();
      let raw; try { raw = JSON.parse(text); } catch { raw = {status: 'error', message: text.slice(0, 300)}; }
      const status = String(raw.status || '').toLowerCase();
      let rows;
      if (['error', 'fail', 'false'].includes(status)) {
        const message = typeof raw.message === 'string' ? raw.message : 'Shared report is pending';
        if (!/no data/i.test(message)) throw new Error(`${period.label}: ${message}`);
        rows = [];
      } else rows = normalise(raw);
      slots[index] = {...period, rows};
      intervalCache.set(date, {at: Date.now(), slots});
    }
    const payload = {ok: true, date, fetchedAt: new Date().toISOString(), slots};
    intervalCache.set(date, {at: Date.now(), slots, payload});
    return payload;
  })();
  intervalPending.set(date, pending);
  try { return await pending; } finally { intervalPending.delete(date); }
}


// Figures from the 18 Sep 2026 report, used for ?demo=1 or when no key is configured.
function demoRows() {
  const A = [
    ['SRF123', 'pinki', ['0:00:09', 0, 55.6], ['0:00:15', 0, 100], ['9:52:59', 0, 60.1]],
    ['SRF189', 'Aparna', ['0:00:10', 0, 0], ['8:08:37', '0:37:48', 72.9], null],
    ['SRF225', 'Elveen', ['0:00:05', 0, 0], ['5:19:19', '0:01:42', 99.4], null],
    ['SRF457', 'Vanshika', ['0:00:10', 0, 20], ['8:13:59', '0:24:18', 68.7], ['0:00:37', '0:00:33', 10.8]],
    ['SRF675', 'Mansi', null, ['7:10:42', '0:42:13', 75.1], null],
    ['SRF678', 'Anubhav Singh', ['0:00:02', 0, 50], ['5:16:59', '0:15:54', 91.6], ['1:20:24', '0:22:48', 21.1]],
    ['SRF879', 'Pallavi', ['1:27:34', '0:01:59', 75.1], ['4:55:55', '0:06:52', 88.7], ['2:36:09', '0:46:03', 13.2]],
    ['SRF897', 'Shivalee', ['1:05:50', 0, 99.6], ['7:24:38', '0:46:08', 65.8], null],
    ['SRF956', 'Avesh', ['0:00:02', 0, 0], ['5:33:12', '0:01:06', 79.1], ['2:04:28', '0:26:00', 10.4]],
    ['SRF980', 'Anchal', ['0:01:51', 0, 3.6], ['6:41:47', '0:01:10', 92.4], ['1:55:54', '0:52:45', 26.2]],
  ];
  const modes = ['Inbound', 'Manual', 'Progressive'];
  const rows = [];
  for (const [id, name, ...m] of A) m.forEach((v, i) => {
    if (!v) return;
    const login = toSec(v[0]);
    rows.push({ agentId: id, agentName: name, mode: modes[i], login, talk: toSec(v[1]),
      idle: Math.round((login * v[2]) / 100), pause: 0, busy: 0, wrapup: 0 });
  });
  return rows;
}


module.exports = async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const now = istNow();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('date') || '') ? url.searchParams.get('date') : now.date;
  const key = hub.configured(), user = process.env.OZONETEL_USERNAME;
  const demo = url.searchParams.get('demo') === '1';
  if(!demo && (!key || !user)) return res.status(503).json({ok:false,error:'Shared reporting is not configured.'});


  res.setHeader('Cache-Control', 'no-store');
  if (date > now.date) return res.status(400).json({ ok: false, error: 'Date is in the future.' });

  if (url.searchParams.get('view') === 'slot-summary') {
    if (demo) return res.status(502).json({ok: false, error: 'Interval state summaries require Ozonetel credentials.'});
    if (date === now.date) return res.status(200).json({ok: true, date, pending: true, slots: []});
    try {
      const payload = await intervalSummary(date);
      res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400, stale-if-error=86400');
      return res.status(200).json(payload);
    } catch (e) {
      const error = String(e.message || e);
      if (/max limit|rate limit/i.test(error)) res.setHeader('Retry-After', '65');
      return res.status(/max limit|rate limit/i.test(error) ? 429 : 502).json({ok: false, error});
    }
  }

  if (url.searchParams.get('view') === 'slots') {
    try {
      const calls = await reportCalls(date, now, demo);
      return res.status(200).json({ok: true, date, fetchedAt: new Date().toISOString(), rows: timeSlots(calls)});
    } catch (e) {
      return res.status(502).json({ok: false, error: String(e.message || e)});
    }
  }

  if (url.searchParams.get('view') === 'call-counts') {
    try {
      const calls = await reportCalls(date, now, demo);
      res.setHeader('Cache-Control', !calls.length || calls.archiveFallback ? 'no-store' : date < now.date
        ? 'public, s-maxage=3600, stale-while-revalidate=86400, stale-if-error=86400'
        : 'public, s-maxage=35, stale-while-revalidate=120, stale-if-error=300');
      return res.status(200).json({ok: true, date, rows: callCounts(calls), slots: timeSlots(calls),
        ...(calls.archiveFallback ? {archiveFallback: true, warning: 'Showing saved call records while Ozonetel is unavailable; this recent archive may be incomplete.'} : {})});
    } catch (e) {
      return res.status(502).json({ok: false, error: String(e.message || e)});
    }
  }

  if (demo) {
    return res.status(200).json({ ok: true, demo: true, date: '2026-09-18', fetchedAt: new Date().toISOString(), rows: demoRows(),
      note: !key || !user ? 'Shared reporting is not configured.' : 'Demo mode.' });
  }


  if (url.searchParams.get('view') === 'calls') {
    try {
      const agent = url.searchParams.get('agent') || '';
      const calls = await reportCalls(date, now);
      const rows = callList(calls, agent);
      return res.status(200).json({ ok: true, date, agent, fetchedAt: new Date((cdrCache.get(date) || {}).at || Date.now()).toISOString(), calls: rows,
        ...(calls.archiveFallback ? {archiveFallback: true, warning: 'Saved call records may be incomplete; retry when Ozonetel is available.'} : {}) });
    } catch (e) {
      return res.status(502).json({ ok: false, error: String(e.message || e) });
    }
  }


  if (url.searchParams.get('view') === 'live') {
    try {
      const d = await liveData(date, now);
      const cdrAt = (cdrCache.get(date) || {}).at || Date.now();
      const stale = Date.now() - cdrAt > 90 * 1000;
      res.setHeader('Cache-Control', 'public, s-maxage=35, stale-while-revalidate=120, stale-if-error=300');
      return res.status(200).json({ ok: true, live: true, date, fetchedAt: new Date(cdrAt).toISOString(), ...d,
        ...(stale ? {stale: true, warning: 'Call records are temporarily delayed; showing the last successful update.'} : {}) });
    } catch (e) {
      return res.status(502).json({ ok: false, error: String(e.message || e) });
    }
  }


  const hit = cache.get(date);
  const pastDayCache = date < now.date ? 'public, s-maxage=3600, stale-while-revalidate=86400, stale-if-error=86400' : null;
  if (hit && Date.now() - hit.at < TTL_MS && url.searchParams.get('raw') !== '1') {
    if (pastDayCache) res.setHeader('Cache-Control', pastDayCache);
    return res.status(200).json(hit.payload);
  }


  const body = {
    userName: user,
    fromDate: `${date} 00:00:00`,
    toDate: date === now.date ? `${date} ${now.time}` : `${date} 23:59:59`,
  };
  if (process.env.OZONETEL_MODE_TYPES) body.modeType = process.env.OZONETEL_MODE_TYPES;
  if (process.env.OZONETEL_AGENT_IDS) body.agentId = process.env.OZONETEL_AGENT_IDS;


  try {
    const r = await callSummary(body);
    const text = await r.text();
    let raw; try { raw = JSON.parse(text); } catch { raw = { status: 'error', message: text.slice(0, 300) }; }
    const status = String(raw.status || '').toLowerCase();
    if (!r.ok || !['success','true'].includes(status)) {
      const msg = typeof raw.message === 'string' ? raw.message : 'Shared report is pending';
      if (/no data/i.test(msg)) {
        const payload = { ok: true, date, fetchedAt: new Date().toISOString(), rows: [] };
        cache.set(date, { at: Date.now(), payload });
        if (pastDayCache) res.setHeader('Cache-Control', pastDayCache);
        return res.status(200).json(payload);
      }
      if (hit) return res.status(200).json({ ...hit.payload, stale: true, warning: msg });
      return res.status(502).json({ ok: false, error: msg });
    }
    hub.observe(raw.integration);
    const payload = { ok: true, date, fetchedAt: new Date((raw.integration?.sampledAt||Date.now()/1000)*1000).toISOString(), rows: normalise(raw), integration:raw.integration };
    cache.set(date, { at: Date.now(), payload });
    if (pastDayCache && url.searchParams.get('raw') !== '1') res.setHeader('Cache-Control', pastDayCache);
    return res.status(200).json(url.searchParams.get('raw') === '1' ? {...payload, raw} : payload);
  } catch (e) {
    if (hit) return res.status(200).json({ ...hit.payload, stale: true, warning: String(e.message || e) });
    return res.status(502).json({ ok: false, error: 'Shared report temporarily unavailable. Saved records are retained.' });
  }
};

module.exports=hub.wrap(module.exports);
