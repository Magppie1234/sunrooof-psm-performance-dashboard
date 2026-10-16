(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CallMetrics = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const seconds = value => {
    if (value == null || value === '') return 0;
    const parts = String(value).split(':').map(Number);
    return parts.some(isNaN) ? 0 : parts.reduce((total, part) => total * 60 + part, 0);
  };
  const id = value => value == null ? '' : String(value).trim();
  const callId = c => id(c.callId ?? c.CallID ?? c.callID ?? c['Call ID']);
  const attemptId = c => id(c.ucid ?? c.UCID);
  const start = c => String(c.start ?? c.StartTime ?? '');
  const connected = c => String(c.status ?? c.Status).toLowerCase() === 'answered' && seconds(c.talk ?? c.TalkTime) > 0;

  // Call ID identifies the customer call; UCID identifies each routing attempt.
  // Keep agent and date in the key so transfers and calls on other days stay separate.
  function key(c, index) {
    const mode = String(c.mode ?? c.Type ?? 'Unknown').toLowerCase();
    const date = c.date ?? c.CallDate ?? c['Call Date'] ?? (/^\d{4}-\d{2}-\d{2}/.exec(start(c)) || [''])[0];
    const agent = c.agentId ?? c.AgentID ?? c.AgentName ?? '';
    return mode === 'inbound' && callId(c)
      ? JSON.stringify([date, agent, mode, callId(c)])
      : JSON.stringify(['attempt', index]);
  }

  function group(calls) {
    const groups = new Map();
    calls.forEach((c, index) => {
      const k = key(c, index), time = start(c);
      let row = groups.get(k);
      if (!row) {
        row = {key: k, agentId: c.agentId ?? c.AgentID ?? c.AgentName ?? '',
          agentName: c.agentName ?? c.AgentName ?? c.AgentID ?? '',
          mode: String(c.mode ?? c.Type ?? 'Unknown'), callId: callId(c),
          start: time, lastStart: time, talk: 0, wrapup: 0, connected: false, attempts: []};
        groups.set(k, row);
      }
      if (time && (!row.start || time < row.start)) row.start = time;
      if (time > row.lastStart) row.lastStart = time;
      row.talk += seconds(c.talk ?? c.TalkTime);
      row.wrapup += seconds(c.wrapup ?? c.WrapupDuration);
      row.connected ||= connected(c);
      row.attempts.push(c);
    });
    return [...groups.values()];
  }

  // Preserve long numeric identifiers before JSON.parse can round them.
  function parseJson(text) {
    let property = '', colon = false;
    const preserved = text.replace(/"(?:\\.|[^"\\])*"|[{}\[\]:,]|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g,
      (token, offset) => {
        if (token[0] === '"') {
          property = /^\s*:/.test(text.slice(offset + token.length)) ? JSON.parse(token) : '';
          colon = false;
        } else if (token === ':') colon = true;
        else {
          const preserve = colon && /^(call[ _]?id|ucid)$/i.test(property) && /^\d+$/.test(token);
          property = ''; colon = false;
          if (preserve) return JSON.stringify(token);
        }
        return token;
      });
    return JSON.parse(preserved);
  }

  return {group, key, callId, attemptId, connected, parseJson};
});
