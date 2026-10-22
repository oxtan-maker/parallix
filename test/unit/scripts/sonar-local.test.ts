// Regression provenance: TASK-2566.
// TASK-2586 — local missions use one provider-owned SHORT comparison. This
// focused test injects the branch-list response; no network or scanner runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assertShortBranch } from '../../../scripts/sonar-local.js';

test('task-2586: the local candidate must be confirmed as a SHORT comparison branch', async () => {
  const candidate = 'candidate/mission/task-2586';
  await assert.doesNotReject(assertShortBranch('test-token', candidate, async () => new Response(JSON.stringify({
    branches: [{ name: candidate, type: 'SHORT' }],
  }))));
  await assert.rejects(
    assertShortBranch('test-token', candidate, async () => new Response(JSON.stringify({
      branches: [{ name: candidate, type: 'LONG' }],
    }))),
    /must be SHORT to evaluate changes against main/,
  );
});

test('task-2586: SHORT confirmation fails closed when the provider lookup fails', async () => {
  await assert.rejects(
    assertShortBranch('test-token', 'candidate/mission/task-2586', async () => new Response('unavailable', { status: 502 }), 0),
    /branch lookup failed \(HTTP 502\)/,
  );
});

test('task-2586: SHORT confirmation retries a transient provider failure', async () => {
  let calls = 0;
  await assert.doesNotReject(assertShortBranch('test-token', 'candidate/mission/task-2586', async () => {
    calls += 1;
    return calls === 1
      ? new Response('unavailable', { status: 502 })
      : new Response(JSON.stringify({ branches: [{ name: 'candidate/mission/task-2586', type: 'SHORT' }] }));
  }, 0));
  assert.equal(calls, 2);
});
