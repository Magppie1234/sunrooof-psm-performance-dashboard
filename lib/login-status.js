// The account-wide login feed is authoritative, including agents with no calls.
// Use the shared gateway so credentials, durable cache and rate budgets stay central.
function createReader({query, observe = () => {}, now = Date.now}) {
  let snapshot = null, attemptedAt = null, pending = null, failed = false;
  async function refresh() {
    if (pending) return pending;
    if (attemptedAt !== null && now() - attemptedAt < 30000) return;
    attemptedAt = now();
    pending = (async () => {
      try {
        const r = await query('/ca_apis/getAgentLogins', {});
        const j = r.j || {};
        const list = Array.isArray(j.data) ? j.data : Array.isArray(j.message) ? j.message : null;
        if (r.http !== 200 || !['success','true'].includes(String(j.status).toLowerCase()) ||
            j.integration?.complete !== true || !list ||
            list.some(x => !x || !x.AgentId || !(x.AgentState || x.State))) throw Error('Incomplete login snapshot');
        const at = Number(j.integration.sampledAt) * 1000;
        if (!Number.isFinite(at) || at <= 0) throw Error('Missing login sample time');
        snapshot = {at, meta:j.integration, agents:list.map(x => ({agentId:String(x.AgentId),
          agentName:x.AgentName || String(x.AgentId), state:x.AgentState || x.State,
          mode:x.Mode || '', since:x.Since || '', loggedIn:true}))};
        failed = false;
      } catch { failed = true; }
    })().finally(() => {pending=null;});
    return pending;
  }
  return async function read(names = {}, configuredIds = []) {
    await refresh();
    if (snapshot) observe(snapshot.meta);
    const complete = !!snapshot && !failed && now()-snapshot.at <= 120000;
    const online = new Map((snapshot?.agents || []).map(x => [x.agentId,x]));
    const ids = [...new Set([...Object.keys(names), ...configuredIds, ...online.keys()])];
    return {status:ids.map(id => ({...(online.get(id) || {agentId:id, agentName:names[id] || id,
        state:complete ? 'LOGGED OUT' : 'UNKNOWN', mode:'', since:'', loggedIn:complete ? false : null}),
        ...(!complete ? {loggedIn:null,stale:true} : {}),
        checkedSecsAgo:snapshot ? Math.max(0,Math.round((now()-snapshot.at)/1000)) : null})),
      statusComplete:complete, statusFetchedAt:snapshot ? new Date(snapshot.at).toISOString() : null,
      ...(!complete ? {statusWarning:'Login status is refreshing. The logged-in count is unavailable until a complete, current update arrives.'} : {})};
  };
}
module.exports = {createReader};
