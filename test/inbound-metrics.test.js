const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const metrics = require('../call-metrics');

function attempt(callId, changes = {}) {
  return {AgentID: 'A', AgentName: 'Agent', Type: 'Inbound', CallID: callId,
    UCID: 'attempt-' + callId, StartTime: '13:07:48', Status: 'Unanswered',
    TalkTime: '00:00:00', WrapupDuration: '00:00:00', ...changes};
}
function fixture(sizes, answeredGroups) {
  return sizes.flatMap((size, group) => Array.from({length: size}, (_, index) =>
    attempt('196346355451360' + String(group).padStart(2, '0'), {
      UCID: `${group}-${index}`, StartTime: `13:07:${String(index % 60).padStart(2, '0')}`,
      ...(index === size - 1 && answeredGroups.includes(group) ? {Status: 'Answered', TalkTime: '00:01:00'} : {}),
    })));
}
function api(calls) {
  const module = {exports: {}};
  const source = fs.readFileSync(require.resolve('../api/report'), 'utf8');
  vm.runInNewContext(source + '\nmodule.exports.inspect = {callCounts,timeSlots,liveData,cdrCache,liveCache};', {
    module, URL, Date, Map, Set, Buffer,
    process: {env: {OZONETEL_API_KEY: 'test', OZONETEL_USERNAME: 'test'}},
    require: path => {
      if (path === '../call-metrics') return metrics;
      if(path==='../lib/integration-client.cjs')return {configured:()=>true,wrap:f=>f,observe:()=>{}};
      if(path==='../lib/login-status')return require('../lib/login-status');
      assert.equal(path, '../lib/report-calls');
      return {createReportCallReader: () => async () => calls};
    },
  });
  return module.exports;
}

for (const [name, sizes, answered, expected] of [
  ['19 routing attempts represent 9 calls', [4,3,3,3,2,1,1,1,1], [6,7,8], [19,9,3,'33.3']],
  ['99 network retries do not inflate 111 attempts into 111 calls', [99,3,1,1,1,1,1,1,1,1,1], [1,2,3,4,5,6,7,8], [111,11,8,'72.7']],
]) {
  test(name + ' across history, live, slots and detail API', async () => {
    const calls = fixture(sizes, answered), handler = api(calls);
    const {callCounts, timeSlots, liveData, cdrCache, liveCache} = handler.inspect;
    const count = callCounts(calls)[0];
    assert.equal(count.calls, expected[1]);
    assert.equal(count.connected, expected[2]);
    assert.equal((100 * count.connected / count.calls).toFixed(1), expected[3]);
    const slot = timeSlots(calls)[0].slots[1];
    assert.equal(slot.calls, expected[1]);
    assert.equal(slot.connected, expected[2]);
    assert.equal(slot.talk, expected[2] * 60);
    cdrCache.set('2026-10-14', {at: Date.now(), calls});
    liveCache.stateAt = Date.now();
    const live = await liveData('2026-10-14', {date: '2026-10-14'});
    assert.equal(live.rows[0].calls, expected[1]);
    assert.equal(live.rows[0].connected, expected[2]);
    assert.equal(live.totalCalls, expected[1]);
    let body;
    await handler({url: '/api/report?view=calls&date=2026-10-14&agent=A'}, {
      setHeader() {}, status(code) {assert.equal(code, 200); return this;}, json(value) {body = value;},
    });
    assert.equal(body.calls.length, expected[0]);
    assert.equal(new Set(body.calls.map(c => c.callId)).size, expected[1]);
    assert.equal(new Set(body.calls.map(c => c.ucid)).size, expected[0]);
    const clientCount = metrics.group(body.calls.map(c => ({...c, date: '2026-10-14'})));
    assert.equal(clientCount.length, expected[1]);
    assert.equal(clientCount.filter(c => c.connected).length, expected[2]);
  });
}

test('count once in first slot, connect once, retain all talk/wrap and latest attempt', () => {
  const calls = [attempt('one', {StartTime:'12:01:00',Status:'Answered',TalkTime:'00:02:00',WrapupDuration:'00:00:20'}),
    attempt('one', {StartTime:'11:59:00'}),
    attempt('one', {StartTime:'12:02:00',Status:'Answered',TalkTime:'00:01:00',WrapupDuration:'00:00:10'})];
  const [group] = metrics.group(calls);
  assert.equal(group.connected, true);
  assert.equal(group.talk, 180);
  assert.equal(group.wrapup, 30);
  assert.equal(group.lastStart, '12:02:00');
  const {callCounts,timeSlots} = api(calls).inspect;
  assert.equal(callCounts(calls)[0].connected, 1);
  const slots = timeSlots(calls)[0].slots;
  assert.equal(slots[0].calls, 1);
  assert.equal(slots[0].connected, 1);
  assert.equal(slots[0].talk, 180);
  assert.equal(slots[1].calls, 0);
});

test('scope by date and agent, preserve other modes, missing IDs and genuine repeat callers', () => {
  const calls = [attempt('one'), attempt('one'), attempt('two'),
    attempt('one', {AgentID:'B'}), attempt('one', {CallDate:'2026-10-13'}),
    attempt('one', {Type:'Manual'}), attempt('one', {Type:'Manual'}),
    attempt('one', {Type:'Progressive'}), attempt('one', {Type:'Progressive'}),
    attempt(''), attempt('')].map(c => ({...c, CallerID:'same-phone'}));
  assert.equal(metrics.group(calls).length, 10);
  assert.equal(calls.length, 11);
});

test('preserve exact long IDs before parsing without changing numeric metrics or strings', () => {
  const json = '{"CallID":19634635545136092,"UCID":19634635545136093,"TalkTime":12,"description":"CallID: 19634635545136094","nested":[{"Call ID":19634635545136094}]}';
  const data = metrics.parseJson(json);
  assert.equal(data.CallID, '19634635545136092');
  assert.equal(data.UCID, '19634635545136093');
  assert.equal(data.nested[0]['Call ID'], '19634635545136094');
  assert.equal(data.TalkTime, 12);
  assert.equal(data.description, 'CallID: 19634635545136094');
  assert.equal(metrics.group(metrics.parseJson('[{"Type":"Inbound","CallID":19634635545136092},{"Type":"Inbound","CallID":19634635545136093}]')).length, 2);
});

test('detail view shows unique totals and retains retries when filtering connected calls', () => {
  const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  const source = html.slice(html.indexOf('function drawCalls()'), html.indexOf('function callsCsv()'));
  const elements = {'#dlgMode': {value:'Inbound'}, '#dlgStatus': {value:''}, '#dlgMeta': {}, '#dlgBody': {}, '#date': {value:'2026-10-14'}};
  const callRows = fixture([99,3,1,1,1,1,1,1,1,1,1], [1,2,3,4,5,6,7,8]).map(c => ({
    callId:c.CallID, agentId:c.AgentID, date:'2026-10-14', mode:c.Type, start:c.StartTime,
    status:c.Status, talk:metrics.group([c])[0].talk, ring:0, wrapup:0, hold:0,
  }));
  const context = vm.createContext({CallMetrics:metrics, callRows, callWarning:'', $:selector=>elements[selector],
    titleCase:x=>x, pickedDates:()=>['2026-10-14'], fmtDate:x=>x, pct:(n,d)=>(100*n/d).toFixed(1)+'%',
    hms:x=>x, esc:x=>String(x??''), isVm:()=>false, modeCls:()=>'', VM:{maxTalk:17}});
  vm.runInContext(source+'\ndrawCalls();',context);
  assert.match(elements['#dlgMeta'].textContent, /11 calls · 111 attempt rows · 8 connected \(72.7%\)/);
  assert.equal((elements['#dlgBody'].innerHTML.match(/<tr>/g)||[]).length-1,111);
  elements['#dlgStatus'].value='conn';
  vm.runInContext('drawCalls()',context);
  assert.match(elements['#dlgMeta'].textContent, /8 calls · 10 attempt rows · 8 connected \(100.0%\)/);
  assert.equal((elements['#dlgBody'].innerHTML.match(/<tr>/g)||[]).length-1,10);
});

test('partial recent archives are not cached as complete historical totals', async () => {
  const calls = [attempt('one')];
  Object.defineProperty(calls, 'archiveFallback', {value:true});
  const handler = api(calls), headers = {};
  let body;
  await handler({url:'/api/report?view=call-counts&date=2026-10-14'}, {
    setHeader(name,value) {headers[name]=value;},
    status(code) {assert.equal(code,200);return this;}, json(value) {body=value;},
  });
  assert.equal(headers['Cache-Control'],'no-store');
  assert.equal(body.archiveFallback,true);
  assert.match(body.warning,/incomplete/);
});
