import test from 'node:test';
import assert from 'node:assert/strict';
import { runReviewLoop } from '../../../../src/application/review-loop/review-loop.js';
import { fakeReviewLoopPorts } from '../../../helpers/review-loop-ports.js';

function missingOutput(events: string[], options: { missionStore?: unknown; head?: () => string; onLaunch?: (_role: string) => void } = {}) {
  let headReads = 0;
  return fakeReviewLoopPorts({
    slug: 'task-2623',
    routing: { eligibleFamilies: () => ['codex'] },
    handoff: { handoff: async () => ({ ok: true }) },
    missionStore: (options.missionStore ?? null) as never,
    provider: {
      pollReview: async () => 'REQUEST_CHANGES',
      pollDisposition: async () => { events.push('provider-poll'); return 'CHANGES_MADE'; },
    },
    artifacts: {
      consumeReviewer: async () => ({ consumed: true, ok: true, reviewState: 'REQUEST_CHANGES', reviewFindings: [{ id: 'F1', summary: 'preserve committed fix' }] }),
      consumeImplementer: async () => ({ consumed: false }),
    },
    agents: { launch: async launch => { events.push(`launch:${launch.role}`); options.onLaunch?.(launch.role); return { agent: launch.agent, result: { status: 0 } }; } },
    preReview: { head: options.head ?? (() => (++headReads === 1 ? 'before-fix' : 'committed-fix')) },
    output: { log: message => { events.push(`log:${message}`); }, error: message => { events.push(`error:${message}`); }, onAutonomousStop: reason => { events.push(`stop:${reason}`); } },
  });
}

const request = { slug: 'task-2623', implementer: 'claude', reviewer: 'codex', maxAttempts: 1 };

test('task-2623: exited implementer with no protocol output recovers before provider disposition polling', async () => {
  const events: string[] = [];
  await runReviewLoop(request, missingOutput(events).ports);

  const recovery = events.findIndex(event => /missing protocol output|artifact recovery|relaunching implementer/i.test(event));
  const providerPoll = events.indexOf('provider-poll');
  assert.ok(events.some(event => /completed act-on-review/.test(event)), `process completion is reported: ${events.join(' | ')}`);
  assert.ok(recovery >= 0, `exited implementer is reconciled immediately: ${events.join(' | ')}`);
  assert.ok(providerPoll < 0 || recovery < providerPoll, `recovery starts before provider polling: ${events.join(' | ')}`);
  assert.ok(events.some(event => /IMPLEMENTER_ARTIFACT_RETRY_EXHAUSTED/.test(event)), `missing output escalates without fabricating a disposition: ${events.join(' | ')}`);
});

test('task-2623: exited implementer with no committed revision still recovers before polling', async () => {
  const events: string[] = [];
  await runReviewLoop(request, missingOutput(events, { head: () => 'unchanged-revision' }).ports);
  assert.ok(!events.includes('provider-poll'), `exited implementer does not consume the provider timeout: ${events.join(' | ')}`);
  assert.ok(events.some(event => /missing protocol output/.test(event)), `silent exit starts recovery: ${events.join(' | ')}`);
});

test('task-2623: recovery accepts a matching stored resolution written by the relaunch', async () => {
  const events: string[] = [];
  let actOnReviewLaunches = 0;
  let resolved = false;
  const missionStore = {
    load: async () => ({ kind: 'found', mission: { review: { rounds: [{
      number: 1, implementer: 'claude', disposition: resolved ? 'CHANGES_MADE' : null,
      response: resolved ? { resultingRevision: 'committed-fix' } : null,
    }] } } }),
  };
  const fake = missingOutput(events, { missionStore, onLaunch: role => { if (role === 'implementer') { resolved = ++actOnReviewLaunches >= 2; } } });
  await runReviewLoop(request, fake.ports);
  assert.ok(events.some(event => /recovery recognized stored workflow resolution/.test(event)), `relaunch resolution is accepted: ${events.join(' | ')}`);
  assert.ok(!events.some(event => /IMPLEMENTER_ARTIFACT_RETRY_EXHAUSTED/.test(event)), `matching authority prevents false escalation: ${events.join(' | ')}`);
  assert.ok(!events.includes('provider-poll'), `stored recovery resolution avoids polling: ${events.join(' | ')}`);
});

test('task-2623: a stored resolution is consumed only for the exiting implementer, round, and committed revision', async () => {
  const events: string[] = [];
  const matchingStore = {
    load: async () => ({ kind: 'found', mission: { review: { rounds: [{
      number: 1, implementer: 'claude', disposition: 'CHANGES_MADE',
      response: { resultingRevision: 'committed-fix' },
    }] } } }),
  };
  await runReviewLoop(request, missingOutput(events, { missionStore: matchingStore }).ports);
  assert.ok(events.some(event => /recognized stored workflow resolution/.test(event)), `matching resolution is recognized: ${events.join(' | ')}`);
  assert.ok(!events.includes('provider-poll'), `matching workflow resolution avoids provider polling: ${events.join(' | ')}`);

  const mismatches = [
    { number: 1, implementer: 'other-agent', resultingRevision: 'committed-fix' },
    { number: 2, implementer: 'claude', resultingRevision: 'committed-fix' },
    { number: 1, implementer: 'claude', resultingRevision: 'different-revision' },
  ];
  for (const mismatch of mismatches) {
    const rejected: string[] = [];
    const missionStore = { load: async () => ({ kind: 'found', mission: { review: { rounds: [{ ...mismatch, disposition: 'CHANGES_MADE', response: { resultingRevision: mismatch.resultingRevision } }] } } }) };
    await runReviewLoop(request, missingOutput(rejected, { missionStore }).ports);
    assert.ok(!rejected.some(event => /recognized stored workflow resolution/.test(event)), `mismatch is not accepted: ${JSON.stringify(mismatch)}`);
    assert.ok(rejected.some(event => /missing protocol output/.test(event)), `mismatch starts recovery and preserves the unanswered finding: ${JSON.stringify(mismatch)}`);
  }
});
