import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { mockModule, installModuleMocks } from '../../../lib/module-mock.js';

const reviewLoopModule = mockModule<typeof import('../../../../src/adapters/review/review-loop.js')>('../../../../src/adapters/review/review-loop.js', import.meta.url);
await installModuleMocks();
const { startReviewLoop } = reviewLoopModule;
test.afterEach(() => mock.restoreAll());

function missingOutputDeps(events: string[]): any {
  let headReads = 0;
  return {
    worktree: '/virtual/task-2623-worktree', maxAttempts: 1, verbose: false,
    maybeUpdateGraphifyBeforeReviewFn: () => {},
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/virtual/task.md' }),
    getTaskImplementerFn: () => 'claude', readReviewStateFn: () => null,
    eligibleAgentsForStepFn: () => ['codex'], selectAgentFn: () => { throw new Error('unused'); },
    rebaseBeforeReviewRoundFn: async () => ({ ok: true }),
    performHandoffFn: async () => ({ ok: true }),
    runPreReviewGateFn: async () => ({ ok: true, area: 'unit', command: 'npm test', exitCode: 0, stdout: '', stderr: '' }),
    consumeReviewerArtifactsFn: async () => ({ consumed: true, ok: true, reviewState: 'REQUEST_CHANGES', reviewFindings: [{ id: 'F1', summary: 'preserve committed fix' }] }),
    startAgentFn: async (step: string) => { events.push(`launch:${step}`); return { agent: 'claude', result: { status: 0 } }; },
    consumeImplementerArtifactsFn: async () => ({ consumed: false }),
    applyAgentFallbackFn: async ({ original }: { original: string }) => original,
    transitionTaskFn: async () => true, writeReviewStateFn: () => ({ outcome: 'committed' }),
    recordStageStatsSafeFn: async () => {}, isForgejoReviewEnabledFn: () => true,
    forgejoAvailableFn: async () => true, getPrStatusFn: () => ({ exists: true, state: 'open', number: 2623 }),
    resolveForgejoUserFn: () => 'claude', readTokenFn: () => 'token',
    pollForReviewFn: async () => 'REQUEST_CHANGES',
    pollForDispositionFn: async () => { events.push('provider-poll'); return 'CHANGES_MADE'; },
    hasNewCommittedChangeFn: () => true, pushReviewRefFn: () => ({ status: 0 }),
    log: (message: string) => events.push(`log:${message}`), error: (message: string) => events.push(`error:${message}`),
    exit: () => {}, gitFn: (args: string[]) => {
      if (args.includes('HEAD')) {
        headReads += 1;
        return { status: 0, stdout: `${headReads === 1 ? 'before-fix' : 'committed-fix'}\n`, stderr: '' };
      }
      return { status: 0, stdout: 'main\n', stderr: '' };
    },
  };
}

test('task-2623: exited implementer with no protocol output recovers before provider disposition polling', async () => {
  const events: string[] = [];
  await startReviewLoop('task-2623-repro', { reviewer: 'codex', ...missingOutputDeps(events) });

  const recovery = events.findIndex(event => /missing protocol output|artifact recovery|relaunching implementer/i.test(event));
  const providerPoll = events.indexOf('provider-poll');
  assert.ok(events.some(event => /completed act-on-review/.test(event)), `process completion is reported: ${events.join(' | ')}`);
  assert.ok(recovery >= 0, `exited implementer is reconciled immediately: ${events.join(' | ')}`);
  assert.ok(providerPoll < 0 || recovery < providerPoll, `recovery starts before provider polling: ${events.join(' | ')}`);
  assert.ok(events.some(event => /IMPLEMENTER_ARTIFACT_RETRY_EXHAUSTED/.test(event)), `missing output escalates without fabricating a disposition: ${events.join(' | ')}`);
});

test('task-2623: exited implementer with no committed revision still recovers before polling', async () => {
  const events: string[] = [];
  const deps = missingOutputDeps(events);
  deps.gitFn = () => ({ status: 0, stdout: 'unchanged-revision\n', stderr: '' });
  await startReviewLoop('task-2623-polling', { reviewer: 'codex', ...deps });
  assert.ok(!events.includes('provider-poll'), `exited implementer does not consume the provider timeout: ${events.join(' | ')}`);
  assert.ok(events.some(event => /missing protocol output/.test(event)), `silent exit starts recovery: ${events.join(' | ')}`);
});

test('task-2623: recovery accepts a matching stored resolution written by the relaunch', async () => {
  const events: string[] = [];
  let actOnReviewLaunches = 0;
  let resolved = false;
  const deps = missingOutputDeps(events);
  const startAgent = deps.startAgentFn;
  deps.startAgentFn = async (step: string, ...rest: unknown[]) => {
    if (step === 'act-on-review') {
      actOnReviewLaunches += 1;
      resolved = actOnReviewLaunches >= 2;
    }
    return await startAgent(step, ...rest);
  };
  const missionStore = {
    load: async () => ({ kind: 'found', mission: { review: { rounds: [{
      number: 1, implementer: 'claude', disposition: resolved ? 'CHANGES_MADE' : null,
      response: resolved ? { resultingRevision: 'committed-fix' } : null,
    }] } } }),
  };
  await startReviewLoop('task-2623-relaunch-resolution', { reviewer: 'codex', missionStore, ...deps });
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
  await startReviewLoop('task-2623-matching', { reviewer: 'codex', missionStore: matchingStore, ...missingOutputDeps(events) });
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
    await startReviewLoop('task-2623-mismatch', { reviewer: 'codex', missionStore, ...missingOutputDeps(rejected) });
    assert.ok(!rejected.some(event => /recognized stored workflow resolution/.test(event)), `mismatch is not accepted: ${JSON.stringify(mismatch)}`);
    assert.ok(rejected.some(event => /missing protocol output/.test(event)), `mismatch starts recovery and preserves the unanswered finding: ${JSON.stringify(mismatch)}`);
  }
});
