(function () {
  const baseModes = ['Inbound', 'Manual', 'Progressive'];
  const fields = ['login', 'talk', 'idle', 'pause', 'wrapup', 'busy'];
  const zero = () => Object.fromEntries(fields.map(field => [field, 0]));
  const add = (target, source) => fields.forEach(field => { target[field] += Number(source?.[field]) || 0; });
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
  const hms = value => {
    const seconds = Math.max(0, Math.round(value || 0));
    return `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds % 3600 / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  };
  const pct = (part, whole) => whole ? `${(part / whole * 100).toFixed(1)}%` : '0.0%';
  const cssMode = mode => ({Inbound: 'inb', Manual: 'man', Progressive: 'prog'})[mode] || 'oth';
  const loginClass = value => value >= 90 ? 'lp-grn' : value >= 70 ? 'lp-yel' : 'lp-red';
  const modeName = value => {
    const name = String(value || 'Unknown').trim();
    return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  };

  function mount({element, endpoint}) {
    let selectedIds = null;
    let last = null;
    let requestId = 0;
    let retryTimer = null;
    let retryCount = 0;
    element.innerHTML = '<div class="interval-head"><div><h2>Productivity by time slot</h2><p>Full agent and component summaries for every time slot, shown together.</p></div><div class="interval-filter"><button type="button" class="interval-filter-btn" aria-expanded="false">Agents: all ▾</button><div class="interval-panel" hidden><div class="interval-actions"><button type="button" data-action="all">Select all</button><button type="button" data-action="none">Clear</button></div><div class="interval-options"></div></div></div></div><div class="interval-status">Loading time-slot summaries…</div><div class="interval-panels"></div>';
    const status = element.querySelector('.interval-status');
    const panels = element.querySelector('.interval-panels');
    const filter = element.querySelector('.interval-filter');
    const button = element.querySelector('.interval-filter-btn');
    const panel = element.querySelector('.interval-panel');
    const options = element.querySelector('.interval-options');

    button.onclick = () => {
      panel.hidden = !panel.hidden;
      button.setAttribute('aria-expanded', String(!panel.hidden));
    };
    document.addEventListener('click', event => {
      if (!filter.contains(event.target)) {
        panel.hidden = true;
        button.setAttribute('aria-expanded', 'false');
      }
    });
    panel.addEventListener('click', event => {
      const action = event.target.dataset.action;
      if (!action || !last) return;
      selectedIds = action === 'all' ? null : new Set();
      render();
    });
    options.addEventListener('change', event => {
      const id = event.target.dataset.id;
      if (!id || !last) return;
      if (!selectedIds) selectedIds = new Set(last.agents.map(agent => agent.id));
      event.target.checked ? selectedIds.add(id) : selectedIds.delete(id);
      if (last.agents.every(agent => selectedIds.has(agent.id))) selectedIds = null;
      render();
    });
    status.addEventListener('click', event => {
      if (event.target.dataset.action === 'retry' && last) setSelection([last.date], true);
    });

    function renderSlot(slot, agents, modes) {
      const byAgent = new Map(agents.map(agent => [agent.id, {id: agent.id, name: agent.name, modes: {}, total: zero()}]));
      for (const row of slot.rows) {
        const agent = byAgent.get(row.agentId);
        if (!agent) continue;
        const mode = modeName(row.mode);
        const metrics = agent.modes[mode] || (agent.modes[mode] = zero());
        add(metrics, row);
        add(agent.total, row);
      }
      const grand = zero();
      const modeTotals = Object.fromEntries(modes.map(mode => [mode, zero()]));
      for (const agent of byAgent.values()) {
        add(grand, agent.total);
        for (const mode of modes) add(modeTotals[mode], agent.modes[mode]);
      }
      const benchmark = slot.seconds;
      const averageLogin = agents.length ? [...byAgent.values()].reduce((sum, agent) => sum + agent.total.login / benchmark * 100, 0) / agents.length : 0;
      const totalGap = [...byAgent.values()].reduce((sum, agent) => sum + Math.max(0, benchmark - agent.total.login), 0);
      const cards = [
        ['Total Agents', agents.length], ['Total Login', hms(grand.login)], ['Avg Login %', `${averageLogin.toFixed(1)}%`],
        ['Total Talk Time', hms(grand.talk)], ['Overall Prod %', pct(grand.talk, grand.login)], ['Total Gap', hms(totalGap)],
      ];
      const metricCells = (metrics, mode) => {
        const c = cssMode(mode);
        return `<td class="b-${c}">${hms(metrics?.login)}</td><td class="b-${c}">${hms(metrics?.talk)}</td><td class="b-${c}">${pct(metrics?.talk, metrics?.login)}</td><td class="b-${c}">${pct(metrics?.idle, metrics?.login)}</td>`;
      };
      let table = `<div class="scroll"><table><thead><tr><th class="h" rowspan="2">Agent ID</th><th class="h" rowspan="2">Agent Name</th>${modes.map((mode, index) => `<th class="c-${cssMode(mode)}" colspan="4">Component ${index + 1} — ${escape(mode)}</th>`).join('')}<th class="c-tot" colspan="4">Slot Total</th></tr><tr>${modes.map(mode => ['Login', 'Talk Time', 'Prod %', 'Idle %'].map(label => `<th class="c-${cssMode(mode)}">${label}</th>`).join('')).join('')}<th class="c-tot">Total Login</th><th class="c-tot">Login %</th><th class="c-tot">Prod %</th><th class="c-tot">Gap vs ${hms(benchmark)}</th></tr></thead><tbody>`;
      for (const agent of byAgent.values()) {
        const loginPercent = agent.total.login / benchmark * 100;
        table += `<tr><td class="id">${escape(agent.id)}</td><td class="interval-name">${escape(agent.name)}</td>${modes.map(mode => metricCells(agent.modes[mode], mode)).join('')}<td class="b-tot bold">${hms(agent.total.login)}</td><td class="b-tot bold ${loginClass(loginPercent)}">${loginPercent.toFixed(1)}%</td><td class="b-tot">${pct(agent.total.talk, agent.total.login)}</td><td class="b-tot gap">${hms(Math.max(0, benchmark - agent.total.login))}</td></tr>`;
      }
      table += `<tr class="grand"><td colspan="2" style="text-align:left">GRAND TOTAL (${agents.length} ${agents.length === 1 ? 'agent' : 'agents'})</td>${modes.map(mode => metricCells(modeTotals[mode], mode)).join('')}<td>${hms(grand.login)}</td><td>${averageLogin.toFixed(1)}%</td><td>${pct(grand.talk, grand.login)}</td><td class="gap">${hms(totalGap)}</td></tr></tbody></table></div>`;

      let summary = '<div class="sec"><h3>Mode Type Summary</h3><div class="scroll"><table><thead><tr>' +
        ['Mode Type', 'Login', 'Login Share', 'Talk Time', 'Prod %', 'Idle', 'Idle %', 'Wrap-up', 'Break'].map(label => `<th class="h">${label}</th>`).join('') + '</tr></thead><tbody>';
      for (const mode of modes) {
        const item = modeTotals[mode];
        summary += `<tr><td class="mode c-${cssMode(mode)}">${escape(mode)}</td><td>${hms(item.login)}</td><td>${pct(item.login, grand.login)}</td><td>${hms(item.talk)}</td><td>${pct(item.talk, item.login)}</td><td>${hms(item.idle)}</td><td>${pct(item.idle, item.login)}</td><td>${hms(item.wrapup)}</td><td>${hms(item.pause)}</td></tr>`;
      }
      summary += `<tr class="grand"><td style="text-align:left">Total</td><td>${hms(grand.login)}</td><td>${pct(grand.login, grand.login)}</td><td>${hms(grand.talk)}</td><td>${pct(grand.talk, grand.login)}</td><td>${hms(grand.idle)}</td><td>${pct(grand.idle, grand.login)}</td><td>${hms(grand.wrapup)}</td><td>${hms(grand.pause)}</td></tr></tbody></table></div></div>`;
      return `<article class="interval-card"><h3>${escape(slot.label)}</h3><div class="interval-kpis">${cards.map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join('')}</div>${table}${summary}</article>`;
    }

    function render() {
      if (!last) return;
      const agents = last.agents.filter(agent => !selectedIds || selectedIds.has(agent.id));
      button.textContent = `Agents: ${selectedIds ? `${agents.length} of ${last.agents.length}` : 'all'} ▾`;
      options.innerHTML = last.agents.map(agent => `<label><input type="checkbox" data-id="${escape(agent.id)}"${!selectedIds || selectedIds.has(agent.id) ? ' checked' : ''}>${escape(agent.name)}<small>${escape(agent.id)}</small></label>`).join('');
      if (last.pending) {
        status.textContent = 'State summaries for today are available after the day closes.';
        panels.innerHTML = '';
        return;
      }
      status.textContent = `${last.date} · All four time slots are shown below. Login %, gap, and totals use each slot’s duration. Ozonetel can report login longer than a slot, so Login % may exceed 100%.`;
      if (!agents.length) { panels.innerHTML = '<div class="msg">Select at least one agent to see the time-slot reports.</div>'; return; }
      const otherModes = [...new Set(last.slots.flatMap(slot => slot.rows.map(row => modeName(row.mode))))].filter(mode => !baseModes.includes(mode)).sort();
      const modes = [...baseModes, ...otherModes];
      panels.innerHTML = last.slots.map(slot => renderSlot(slot, agents, modes)).join('');
    }

    async function setSelection(dates, force = false) {
      const date = dates.at(-1);
      if (!date) return;
      if (!force && last?.date === date) return;
      if (!force) retryCount = 0;
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      const current = ++requestId;
      status.textContent = 'Loading time-slot summaries…';
      panels.innerHTML = '';
      try {
        const response = await fetch(`${endpoint}?view=slot-summary&date=${encodeURIComponent(date)}`);
        const data = await response.json();
        if (!response.ok || !data.ok){const e=Error(data.message || data.error || 'Could not load time-slot summaries');e.pending=!!data.pending;throw e;}
        if (!data.pending && (!Array.isArray(data.slots) || data.slots.length !== 4)) throw Error('Time-slot summary is incomplete');
        if (current !== requestId) return;
        const names = new Map();
        for (const slot of data.slots) for (const row of slot.rows) if (row.agentId && !names.has(row.agentId)) names.set(row.agentId, row.agentName || row.agentId);
        last = {...data, agents: [...names].map(([id, name]) => ({id, name})).sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, {numeric: true}))};
        retryCount = 0;
        render();
      } catch (error) {
        if (current !== requestId) return;
        last = {date, agents: []};
        if (error.pending || /max limit|rate limit/i.test(error.message) && retryCount < 2) {
          retryCount++;
          status.textContent = error.pending?'Collecting time-slot reports. Retrying automatically…':'Ozonetel is temporarily rate-limited. Retrying the time-slot reports automatically…';
          retryTimer = setTimeout(() => {
            if (requestId === current && !document.hidden) setSelection([date], true);
          }, error.pending?Math.min(120000,30000*Math.pow(2,Math.min(retryCount-1,2))):65000);
        } else status.innerHTML = `Time-slot summaries are unavailable: ${escape(error.message)} <button type="button" data-action="retry">Retry</button>`;
      }
    }
    return {setSelection};
  }

  const style = document.createElement('style');
  style.textContent = `#slot-summary{background:#fff;border:1px solid var(--line);border-radius:9px;margin:22px 0;padding:18px}#slot-summary .interval-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap}#slot-summary h2{margin:0;color:var(--navy);font-size:18px}#slot-summary .interval-head p,#slot-summary .interval-status{color:var(--muted);font-size:12px;margin:5px 0 12px}#slot-summary .interval-card{border:1px solid var(--line);border-radius:7px;overflow:hidden;margin:18px 0;background:#fff}#slot-summary .interval-card>h3{margin:0;background:var(--navy);color:#fff;padding:10px 14px;font-size:15px}#slot-summary .interval-kpis{display:grid;grid-template-columns:repeat(6,1fr);border-bottom:1px solid var(--line)}#slot-summary .interval-kpis>div{border-right:1px solid var(--line);text-align:center}#slot-summary .interval-kpis>div:last-child{border-right:0}#slot-summary .interval-kpis span{display:block;border-bottom:1px solid var(--line);font-size:11px;padding:5px}#slot-summary .interval-kpis strong{display:block;font-size:16px;padding:7px}#slot-summary .interval-card .scroll table{min-width:1300px}#slot-summary .interval-name{text-align:left}#slot-summary .sec{margin:16px}#slot-summary .sec table{min-width:850px}#slot-summary .interval-filter{position:relative}#slot-summary .interval-filter-btn{border:1px solid var(--line);border-radius:6px;background:#fff;padding:7px 10px;cursor:pointer;font:inherit;min-width:170px;text-align:left}#slot-summary .interval-panel{position:absolute;z-index:30;right:0;top:calc(100% + 4px);width:260px;max-height:320px;overflow:auto;background:#fff;border:1px solid var(--line);border-radius:7px;box-shadow:0 8px 24px #1f2a4433;padding:9px}#slot-summary .interval-panel[hidden]{display:none}#slot-summary .interval-actions{display:flex;gap:8px;padding-bottom:7px;border-bottom:1px solid var(--line)}#slot-summary .interval-actions button{border:0;background:none;color:var(--man);text-decoration:underline;cursor:pointer;font:inherit}#slot-summary .interval-options label{display:flex;align-items:center;gap:7px;padding:5px 1px;cursor:pointer}#slot-summary .interval-options small{margin-left:auto;color:var(--muted)}#slot-summary .interval-status button{border:1px solid var(--line);border-radius:5px;background:#fff;padding:4px 8px;cursor:pointer}@media(max-width:900px){#slot-summary .interval-kpis{grid-template-columns:repeat(3,1fr)}}@media(max-width:520px){#slot-summary .interval-kpis{grid-template-columns:repeat(2,1fr)}}`;
  document.head.appendChild(style);
  window.SlotSummary = {mount};
})();
