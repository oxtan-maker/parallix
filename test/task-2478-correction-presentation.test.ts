import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { mockModule, installModuleMocks } from './lib/module-mock.js';
const startReviewLoopModule = mockModule<typeof import('../src/adapters/review/review-loop.js')>('../src/adapters/review/review-loop.js', import.meta.url);
await installModuleMocks();
const { startReviewLoop, renderReviewVerdict } = startReviewLoopModule;
test.afterEach(() => mock.restoreAll());

/**
 * Focused correction-presentation tests for TASK-2478. These drive
 * startReviewLoop through the REQUEST_CHANGES → act-on-review seam so the
 * operator-facing correction chain (finding named before the implementer
 * launch) is asserted without launching real agents. maxAttempts=1 keeps the
 * run in round 1: after the implementer reports CHANGES_MADE the loop exits, so
 * no round-2 reviewer stub is required.
 */
function requestChangesDeps(
  opts: { logs?: string[]; errors?: string[]; launches?: string[] },
): any {
  return {
    worktree: fs.mkdtempSync(path.join(os.tmpdir(), 'task-2478-corr-')),
    maxAttempts: 1,
    verbose: false,
    maybeUpdateGraphifyBeforeReviewFn: () => {},
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task-999.md' }),
    // A named implementer (not "autonomous") so the act-on-review launch runs
    // rather than being skipped; a different family from the reviewer.
    getTaskImplementerFn: () => 'claude',
    readReviewStateFn: () => null,
    eligibleAgentsForStepFn: () => ['codex'],
    selectAgentFn: () => { throw new Error('No agents available'); },
    rebaseBeforeReviewRoundFn: async () => ({ ok: true }),
    // provider-disabled --start performs the handoff transition.
    performHandoffFn: async () => ({ ok: true }),
    runPreReviewGateFn: async () => ({ ok: true, area: 'docs', command: './scripts/verify-local.sh', exitCode: 0, stdout: '', stderr: '' }),
    // Round-1 reviewer produces a REQUEST_CHANGES verdict with two findings.
    consumeReviewerArtifactsFn: async () => ({
      consumed: true,
      ok: true,
      reviewState: 'REQUEST_CHANGES',
      reviewFindings: [
        { id: 'F1', summary: 'fractional input accepted instead of rejected' },
        { id: 'F2', summary: 'negative input dropped' },
      ],
    }),
    // Act-on-review implementer launch: record the launch, return a result the
    // fallback chain accepts.
    startAgentFn: async (mode: string) => {
      opts.launches!.push(mode);
      return { result: { ok: true } };
    },
    consumeImplementerArtifactsFn: async () => ({ consumed: true, ok: true, disposition: 'CHANGES_MADE' }),
    applyAgentFallbackFn: async ({ original }: { original: string }) => original,
    transitionTaskFn: () => true,
    transitionVirtualFn: () => true,
    writeReviewStateFn: () => {},
    recordStageStatsSafeFn: async () => {},
    log: (msg: string) => opts.logs!.push(msg),
    error: (msg: string) => opts.errors!.push(msg),
    exit: (code: number) => { throw new Error(`exit(${code})`); },
  };
}

test('ACTING ON REVIEW restates the concrete findings before the implementer launch', async () => {
  const logs: string[] = [];
  const errors: string[] = [];
  const launches: string[] = [];
  try {
    await startReviewLoop('task-999', { reviewer: 'codex', ...requestChangesDeps({ logs, errors, launches }) });
  } catch { /* round-1 exit path is irrelevant to this assertion */ }

  const idxActingOn = logs.findIndex((m) => m.includes('ACTING ON REVIEW'));
  const idxLaunch = logs.findIndex((m) => m.includes('launching implementer') && m.includes('act-on-review'));
  assert.ok(idxActingOn !== -1, 'ACTING ON REVIEW presentation present before implementer launch');
  assert.ok(idxLaunch !== -1, 'implementer launched for act-on-review (live response not mocked away)');
  assert.ok(idxActingOn < idxLaunch, 'findings presented before the implementer is launched');
  assert.match(logs[idxActingOn + 1], /Finding F1: fractional input accepted instead of rejected/);
  assert.match(logs[idxActingOn + 2], /Finding F2: negative input dropped/);
  assert.ok(errors.length === 0, `no errors: ${errors.join(' | ')}`);
});

test('APPROVED verdict carries the round number on a re-round (criterion 9)', () => {
  const round2: string[] = [];
  renderReviewVerdict('APPROVED', [], (l) => round2.push(l), false, 2);
  const approved = round2.find((m) => /APPROVED/.test(m) && m.includes('===='));
  assert.ok(approved && /round 2/.test(approved), `re-round approval names the round: ${approved}`);

  const round1: string[] = [];
  renderReviewVerdict('APPROVED', [], (l) => round1.push(l), false, 1);
  const first = round1.find((m) => /APPROVED/.test(m) && m.includes('===='));
  assert.ok(first && !/round/.test(first), 'round 1 approval is not suffixed');
});

test('re-round reruns verification against the revised tree and approves round 2 (criterion 6/7/9)', async () => {
  const logs: string[] = [];
  const errors: string[] = [];
  const launches: string[] = [];
  let reviewCalls = 0;
  try {
    await startReviewLoop('task-999', {
      reviewer: 'codex',
      ...requestChangesDeps({ logs, errors, launches }),
      // Round 1 -> REQUEST_CHANGES; round 2 -> APPROVED on the revised tree.
      maxAttempts: 2,
      consumeReviewerArtifactsFn: async () => {
        reviewCalls += 1;
        return reviewCalls === 1
          ? { consumed: true, ok: true, reviewState: 'REQUEST_CHANGES', reviewFindings: [{ id: 'F1', summary: 'fractional input accepted' }] }
          : { consumed: true, ok: true, reviewState: 'APPROVED', reviewFindings: [] };
      },
    });
  } catch { /* empty */ }

  const verifiedIdx = logs.findIndex((m) => m.includes('verification passed against the revised tree'));
  assert.ok(verifiedIdx !== -1, `round-2 verification rerun presented: ${logs.filter((m) => m.includes('verification passed'))}`);
  assert.match(logs[verifiedIdx], /round 2/);
  const approvedIdx = logs.findIndex((m) => /APPROVED/.test(m) && m.includes('====') && /round 2/.test(m));
  assert.ok(approvedIdx !== -1, `final approval associated with round 2: ${logs[approvedIdx]}`);
  assert.ok(errors.length === 0, `no errors: ${errors.join(' | ')}`);
});

test('REQUEST_CHANGES still emits no APPROVED verdict line', async () => {
  const logs: string[] = [];
  const errors: string[] = [];
  const launches: string[] = [];
  try {
    await startReviewLoop('task-999', { reviewer: 'codex', ...requestChangesDeps({ logs, errors, launches }) });
  } catch { /* empty */ }
  assert.ok(!logs.some((m) => /APPROVED/.test(m) && m.includes('====')), 'no APPROVED verdict for a request-changes run');
});
