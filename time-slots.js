(function () {
  const labels = ['10 AM–12 PM', '12–2 PM', '2–4 PM', '4–7 PM'];
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[char]));
  const blank = () => ({calls: 0, connected: 0, talk: 0});
  const add = (to, from) => { to.calls += from.calls; to.connected += from.connected; to.talk += from.talk; };
  const duration = value => {
    value = Math.round(value);
    return `${Math.floor(value / 3600)}:${String(Math.floor(value % 3600 / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
  };

  function mount({element, endpoint}) {
    let requestId = 0, selectedIds = null, last = null;
    const cache = new Map();
    element.innerHTML = '<div class="slot-head"><div><h2>Agent activity by time slot</h2><p class="slot-note">Components show where each agent handled calls in the slot: Manual, Progressive, or Inbound. No calls does not confirm the agent’s login component.</p></div><div class="slot-filter"><button type="button" class="slot-filter-btn" aria-expanded="false">Agents ▾</button><div class="slot-panel" hidden><div class="slot-actions"><button type="button" data-action="all">Select all</button><button type="button" data-action="none">Clear</button></div><div class="slot-options"></div></div></div></div><div class="slot-body" role="status">Loading time slots…</div>';
    const body = element.querySelector('.slot-body');
    const filter = element.querySelector('.slot-filter');
    const button = element.querySelector('.slot-filter-btn');
    const panel = element.querySelector('.slot-panel');
    const options = element.querySelector('.slot-options');
    button.onclick = () => { panel.hidden = !panel.hidden; button.setAttribute('aria-expanded', String(!panel.hidden)); };
    document.addEventListener('click', event => { if (!filter.contains(event.target)) { panel.hidden = true; button.setAttribute('aria-expanded', 'false'); } });
    panel.addEventListener('click', event => {
      const action = event.target.dataset.action;
      if (!action || !last) return;
      selectedIds = new Set(action === 'all' ? last.ids : []);
      render();
    });
    options.addEventListener('change', event => {
      const id = event.target.dataset.id;
      if (!id || !last) return;
      event.target.checked ? selectedIds.add(id) : selectedIds.delete(id);
      render();
    });

    function render() {
      if (!last) return;
      const {date, names, values, ids} = last;
      const shown = ids.filter(id => selectedIds.has(id));
      button.textContent = shown.length === 1 ? `${names.get(shown[0])} ▾` : `Agents: ${shown.length} of ${ids.length} ▾`;
      options.innerHTML = ids.map(id => `<label><input type="checkbox" data-id="${escape(id)}"${selectedIds.has(id) ? ' checked' : ''}>${escape(names.get(id))}<small>${escape(id)}</small></label>`).join('');
      const totals = labels.map(blank);
      const metricCells = slots => slots.map(slot => `<td>${slot.calls}</td><td>${slot.connected}</td><td>${duration(slot.talk)}</td>`).join('');
      const lines = shown.flatMap(id => {
        const slots = values.get(id)?.slots || labels.map(blank);
        slots.forEach((slot, i) => add(totals[i], slot));
        const order = ['Manual', 'Progressive', 'Inbound', 'Other'];
        const components = [...new Set(slots.flatMap(slot => Object.keys(slot.boards || {})))].sort((a, b) =>
          (order.indexOf(a) < 0 ? order.length : order.indexOf(a)) - (order.indexOf(b) < 0 ? order.length : order.indexOf(b)) || a.localeCompare(b));
        if (!components.length) components.push(null);
        return components.map((component, index) => {
          const sum = blank();
          const cells = slots.map(slot => {
            const metric = component && slot.boards?.[component];
            if (metric) add(sum, metric);
            return `<td class="slot-boards">${metric ? escape(component) : '—'}</td><td>${metric?.calls || 0}</td><td>${metric?.connected || 0}</td><td>${duration(metric?.talk || 0)}</td>`;
          }).join('');
          const agentCells = index ? '' : `<td class="slot-id" rowspan="${components.length}">${escape(id)}</td><td class="slot-name" rowspan="${components.length}">${escape(names.get(id))}</td>`;
          return `<tr>${agentCells}${cells}${metricCells([sum])}</tr>`;
        });
      });
      const grand = blank(); totals.forEach(slot => add(grand, slot));
      body.innerHTML = `<div class="slot-scroll"><table><thead><tr><th rowspan="2">Agent ID</th><th rowspan="2">Agent name</th>${labels.map(label => `<th colspan="4">${label}</th>`).join('')}<th colspan="3">10 AM–7 PM total</th></tr><tr>${labels.map(() => '<th>Component</th><th>Calls</th><th>Connected</th><th>Talk time</th>').join('')}<th>Calls</th><th>Connected</th><th>Talk time</th></tr></thead><tbody>${lines.join('') || '<tr><td colspan="21">Choose an agent to see activity.</td></tr>'}<tr class="slot-total"><td colspan="2">TOTAL (${shown.length} ${shown.length === 1 ? 'agent' : 'agents'})</td>${totals.map(slot => `<td>—</td><td>${slot.calls}</td><td>${slot.connected}</td><td>${duration(slot.talk)}</td>`).join('')}${metricCells([grand])}</tr></tbody></table></div><p class="slot-note">${escape(date)} · Calls outside 10 AM–7 PM are excluded.</p>`;
      body.setAttribute('role', 'region');
    }

    async function setSelection(dates, agents, liveRows) {
      const current = ++requestId;
      const date = dates.at(-1);
      body.textContent = 'Loading time slots…';
      try {
        let saved = Array.isArray(liveRows) ? {at: Date.now(), rows: liveRows} : cache.get(date);
        if (!saved || Date.now() - saved.at > 30000) {
          const response = await fetch(`${endpoint}?view=slots&date=${encodeURIComponent(date)}`);
          const data = await response.json();
          if (!response.ok || !data.ok) throw Error(data.error || 'Could not load call records');
          if (!Array.isArray(data.rows) || data.rows.some(row => !Array.isArray(row.slots) || row.slots.length !== labels.length)) throw Error('Time slot response is incomplete');
          saved = {at: Date.now(), rows: data.rows};
          cache.set(date, saved);
        }
        if (current !== requestId) return;
        const values = new Map(saved.rows.map(row => [row.agentId, row]));
        const names = new Map(agents.map(agent => [agent.id, agent.name]));
        for (const row of saved.rows) if (!names.has(row.agentId)) names.set(row.agentId, row.agentName || row.agentId);
        const ids = [...names.keys()].sort((a, b) => String(names.get(a)).localeCompare(String(names.get(b))) || String(a).localeCompare(String(b)));
        if (selectedIds === null) selectedIds = new Set(ids.length ? [ids[0]] : []);
        last = {date, names, values, ids};
        render();
      } catch (error) {
        if (current !== requestId) return;
        body.textContent = `Time slot data is unavailable: ${error.message}`;
      }
    }
    return {setSelection};
  }

  const style = document.createElement('style');
  style.textContent = `#time-slots{background:#fff;border:1px solid #d6dbe3;border-radius:9px;margin:22px 0;padding:18px}#time-slots .slot-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap}#time-slots h2{margin:0 0 5px;color:#1f2a44;font-size:18px}#time-slots .slot-note{font-size:12px;color:#5b6475;margin:5px 0 12px}#time-slots .slot-scroll{overflow-x:auto}#time-slots table{min-width:1700px}#time-slots th{background:#1f2a44}#time-slots thead tr:nth-child(2) th{background:#3a4150}#time-slots td{padding:7px 10px}#time-slots .slot-name{text-align:left}#time-slots .slot-id{font-weight:700}#time-slots .slot-total td{background:#fdf0c2;font-weight:700}#time-slots .slot-boards{text-align:left;min-width:130px}#time-slots .slot-boards span{display:block;white-space:nowrap}#time-slots .slot-filter{position:relative}#time-slots .slot-filter-btn{border:1px solid #d6dbe3;border-radius:6px;background:#fff;padding:7px 10px;cursor:pointer;font:inherit;min-width:160px;text-align:left}#time-slots .slot-panel{position:absolute;z-index:30;right:0;top:calc(100% + 4px);width:255px;max-height:320px;overflow:auto;background:#fff;border:1px solid #d6dbe3;border-radius:7px;box-shadow:0 8px 24px #1f2a4433;padding:9px}#time-slots .slot-panel[hidden]{display:none}#time-slots .slot-actions{display:flex;gap:8px;padding-bottom:7px;border-bottom:1px solid #d6dbe3}#time-slots .slot-actions button{border:0;background:none;color:#2c5a86;text-decoration:underline;cursor:pointer;font:inherit}#time-slots .slot-options label{display:flex;align-items:center;gap:7px;padding:5px 1px;cursor:pointer}#time-slots .slot-options small{margin-left:auto;color:#5b6475}`;
  document.head.appendChild(style);
  window.TimeSlots = {mount};
})();
