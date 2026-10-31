const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('daily counts and time slots come from the same call records in one response', async () => {
  const calls = [
    { AgentID: 'A', AgentName: 'Agent', Type: 'Manual', StartTime: '11:00:00', Status: 'Answered', TalkTime: '00:01:00' },
    { AgentID: 'A', AgentName: 'Agent', Type: 'Manual', StartTime: '15:00:00', Status: 'NotAnswered', TalkTime: '00:00:00' },
  ];
  let reads = 0;
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../api/report'), 'utf8'), {
    module, URL, Date, Map, Set, Buffer,
    process: { env: { OZONETEL_API_KEY: 'test', OZONETEL_USERNAME: 'test' } },
    require: path => {
      if (path === '../lib/blended-calls') return require('../lib/blended-calls');
      if (path === '../call-metrics') return require('../call-metrics');
      if(path==='../lib/integration-client.cjs')return {configured:()=>true,wrap:f=>f,observe:()=>{}};
      if(path==='../lib/login-status')return require('../lib/login-status');
      assert.equal(path, '../lib/report-calls');
      return { createReportCallReader: () => async () => { reads++; return calls; } };
    },
  });
  let status, body;
  const res = { setHeader() {}, status(code) { status = code; return this; }, json(value) { body = value; } };
  await module.exports({ url: '/api/report?view=call-counts&date=2026-10-14' }, res);
  assert.equal(status, 200);
  assert.equal(reads, 1);
  assert.equal(body.rows[0].calls, 2);
  assert.equal(body.rows[0].connected, 1);
  assert.equal(body.slots[0].slots.reduce((n, slot) => n + slot.calls, 0), 2);
  assert.equal(body.slots[0].slots.reduce((n, slot) => n + slot.connected, 0), 1);
});
