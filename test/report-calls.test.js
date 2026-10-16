const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createReportCallReader } = require('../lib/report-calls');
const now = { date: '2026-10-15', time: '10:00:00' };

test('a missing archive day does not hide recent Ozonetel calls', async () => {
  const calls = [{ AgentID: 'A', Type: 'Manual', Status: 'Answered', TalkTime: '00:01:00' }];
  let archiveReads = 0;
  const read = createReportCallReader({ fetchCalls: async () => calls, savedCalls: async () => { archiveReads++; return []; } });
  assert.deepEqual(await read('2026-10-14', now), calls);
  assert.equal(archiveReads, 0);
});

test('recent CDRs take precedence over a partial saved day', async () => {
  const read = createReportCallReader({ fetchCalls: async () => ['first', 'second'], savedCalls: async () => ['first'] });
  assert.deepEqual(await read('2026-10-12', now), ['first', 'second']);
});

test('saved history is used when CDRs fail or return no records', async () => {
  for (const fetchCalls of [async () => { throw Error('rate limited'); }, async () => []]) {
    const read = createReportCallReader({ fetchCalls, savedCalls: async () => ['saved'] });
    const calls = await read('2026-10-14', now);
    assert.deepEqual(calls, ['saved']);
    assert.equal(calls.archiveFallback, true);
  }
});

test('a recent partial fallback is retried against CDRs on the next request', async () => {
  let reads = 0;
  const read = createReportCallReader({fetchCalls: async () => {
    if (++reads === 1) throw Error('rate limited');
    return ['first', 'second'];
  }, savedCalls: async () => ['first']});
  assert.equal((await read('2026-10-14', now)).archiveFallback, true);
  const complete = await read('2026-10-14', now);
  assert.deepEqual(complete, ['first','second']);
  assert.equal(complete.archiveFallback, undefined);
});

test('old archived dates avoid the limited-retention CDR endpoint', async () => {
  const read = createReportCallReader({ fetchCalls: async () => { throw Error('must not call'); }, savedCalls: async () => ['old'] });
  assert.deepEqual(await read('2026-09-22', now), ['old']);
});

test('unavailable sources remain an error, and a genuine empty day stays empty', async () => {
  const failing = createReportCallReader({ fetchCalls: async () => { throw Error('CDR failed'); }, savedCalls: async () => { throw Error('archive failed'); } });
  await assert.rejects(failing('2026-10-14', now), /archive failed/);
  const missing = createReportCallReader({ fetchCalls: async () => { throw Error('CDR failed'); }, savedCalls: async () => [] });
  await assert.rejects(missing('2026-10-14', now), /CDR failed/);
  const empty = createReportCallReader({ fetchCalls: async () => [], savedCalls: async () => [] });
  assert.deepEqual(await empty('2026-10-14', now), []);
});

test('concurrent counts, slots and raw downloads share one CDR request', async () => {
  let release, count = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const read = createReportCallReader({ fetchCalls: async () => { count++; await gate; return ['call']; }, savedCalls: async () => [] });
  const requests = [read('2026-10-14', now), read('2026-10-14', now), read('2026-10-14', now)];
  release();
  assert.deepEqual(await Promise.all(requests), [['call'], ['call'], ['call']]);
  assert.equal(count, 1);
});
