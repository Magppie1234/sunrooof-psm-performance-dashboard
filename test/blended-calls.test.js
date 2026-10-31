const {test} = require('node:test');
const assert = require('node:assert/strict');
const {summarize} = require('../lib/blended-calls');
const date = '2026-10-31';
const event = (agentId, at, mode, action='calling') => ({agentId, at, mode, action});
const call = (StartTime, changes={}) => ({AgentID:'A',Type:'Manual',StartTime,Status:'Answered',TalkTime:'00:01:00',...changes});
const history = events => ({ok:true,through:'2026-10-31T19:00:00+05:30',events});

test('assign calls by historical mode including a switch back to Manual', () => {
  const result = summarize([call('10:00:00'),call('11:00:00'),call('12:00:00'),call('13:00:00')],
    history([event('A','09:59:00','Manual'),event('A','11:00:00','Blended'),event('A','13:00:00','Manual')]),date);
  assert.deepEqual(result.rows[0],{agentId:'A',calls:2,connected:2,talk:120,knownCalls:4,unknownCalls:0,complete:true});
});
test('Blended spans inbound and outbound; inbound routing retries are counted once', () => {
  const calls = [call('10:00:00',{Type:'Inbound',CallID:'1',Status:'Unanswered',TalkTime:0}),
    call('10:01:00',{Type:'Inbound',CallID:'1'}),call('10:02:00',{Type:'Progressive'}),
    call('10:03:00',{Status:'Unanswered',TalkTime:0}),call('10:04:00',{AgentID:'B'})];
  const result = summarize(calls,history([event('A','09:59:00','Blended'),event('B','09:59:00','Manual')]),date);
  assert.equal(result.rows[0].calls,3);assert.equal(result.rows[0].connected,2);assert.equal(result.rows[0].talk,120);
  assert.equal(result.rows[1].calls,0);
});
test('unobserved history, logout, conflicting events and calls beyond watermark remain unknown', () => {
  const calls = [call('10:00:00'),call('11:00:00'),call('12:00:00'),call('13:00:00'),call('20:00:00')];
  const h = history([event('A','10:30:00','Blended'),event('A','12:00:00','Blended','logout'),
    event('A','13:00:00','Blended'),event('A','13:00:00','Manual')]);
  const row = summarize(calls,h,date).rows[0];
  assert.equal(row.calls,1);assert.equal(row.unknownCalls,4);assert.equal(row.complete,false);
  assert.equal(summarize(calls,null,date).available,false);
  assert.equal(summarize(calls,null,date).rows[0].unknownCalls,5);
});
test('IST call times match UTC events without crossing identities', () => {
  const row = summarize([call('10:00:00')],history([event('A','2026-10-31T04:30:00Z','Blended'),
    event('B','2026-10-31T04:29:00Z','Manual')]),date).rows[0];
  assert.equal(row.calls,1);assert.equal(row.complete,true);
});
