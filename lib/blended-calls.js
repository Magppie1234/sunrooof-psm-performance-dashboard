const CallMetrics = require('../call-metrics');

// Match the mode at call start, never the agent's mode when the report is read.
// History must come from account-scoped, timestamped provider agent events.
function instant(value, date) {
  let text = String(value || '').trim();
  if (/^\d{2}:\d{2}:\d{2}$/.test(text)) text = date + 'T' + text;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(text))
    text = text.replace(' ', 'T') + '+05:30';
  return Date.parse(text);
}

function summarize(calls, history, date) {
  const available = history?.ok === true && Array.isArray(history.events);
  const through = available ? instant(history.through, date) : NaN;
  const timelines = new Map(), rows = new Map();
  for (const event of available ? history.events : []) {
    const at = instant(event.at, date), agent = String(event.agentId || '');
    if (!agent || !Number.isFinite(at) || at > through) continue;
    let mode = String(event.mode || '').trim().toLowerCase();
    if (!['manual','inbound','progressive','preview','predictive','blended','digital','chat','digital/chat'].includes(mode)) mode = '';
    if (/^(logout|logoff)$/i.test(event.action || '')) mode = '';
    if (!timelines.has(agent)) timelines.set(agent, new Map());
    const timeline = timelines.get(agent);
    // Conflicting modes at one timestamp cannot establish a mode.
    timeline.set(at, timeline.has(at) && timeline.get(at) !== mode ? '' : mode);
  }
  for (const [agent, timeline] of timelines)
    timelines.set(agent, [...timeline].sort((a,b) => a[0]-b[0]));
  for (const call of CallMetrics.group(calls)) {
    const agentId = String(call.agentId || '');
    if (!agentId) continue;
    if (!rows.has(agentId)) rows.set(agentId, {agentId, calls:0, connected:0, talk:0, knownCalls:0, unknownCalls:0});
    const row = rows.get(agentId), at = instant(call.start, date);
    let mode = '';
    if (Number.isFinite(at) && at <= through) {
      const timeline = timelines.get(agentId) || [];
      let left=0, right=timeline.length;
      while(left<right) { const middle=Math.floor((left+right)/2); if(timeline[middle][0]<=at)left=middle+1;else right=middle; }
      mode = left ? timeline[left-1][1] : '';
    }
    if (!mode) { row.unknownCalls++; continue; }
    row.knownCalls++;
    if (mode !== 'blended') continue;
    row.calls++;
    row.connected += Number(call.connected);
    row.talk += call.talk;
  }
  return {available:available && Number.isFinite(through),
    rows:[...rows.values()].map(row => ({...row, complete:available && Number.isFinite(through) && row.unknownCalls === 0}))};
}

module.exports = {summarize};
