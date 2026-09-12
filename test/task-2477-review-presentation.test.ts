import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { mockModule, installModuleMocks } from './lib/module-mock.js';
const startReviewLoopModule = mockModule<typeof import('../src/adapters/review/review-loop.js')>('../src/adapters/review/review-loop.js', import.meta.url);
await installModuleMocks();
const { startReviewLoop } = startReviewLoopModule;
test.afterEach(() => mock.restoreAll());

/**
 * Focused review-presentation tests for TASK-2477. These drive startReviewLoop
 * through controlled seams so the exact default/verbose emissions are asserted
 * without launching real agents.
 */
// Partial test-double factory: the doubles below are intentionally loose and
// the type errors surface at the startReviewLoop call site (all opts props are
// optional), so the factory return is typed `any` and the call sites stay
// clean. The ESM seam migration left these doubles partial on purpose.
function happyPathDeps(opts: { verbose?: boolean; outcome?: string; findings?: string[] }, logs: string[], errors: string[], launches: string[]): any {
  return {
    worktree: fs.mkdtempSync(path.join(os.tmpdir(), 'task-2477-pres-')),
    maxAttempts: 1,
    verbose: opts.verbose,
    maybeUpdateGraphifyBeforeReviewFn: () => {},
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task-999.md' }),
    getTaskImplementerFn: () => null,
    readReviewStateFn: () => null,
    eligibleAgentsForStepFn: () => ['codex'],
    selectAgentFn: () => { throw new Error('No agents available'); },
    rebaseBeforeReviewRoundFn: async () => ({ ok: true }),
    // SC1: a provider-disabled --start now performs the handoff transition.
    performHandoffFn: async () => ({ ok: true }),
    runPreReviewGateFn: async () => ({ ok: true, area: 'docs', command: './scripts/verify-local.sh', exitCode: 0, stdout: '', stderr: '' }),
    startAgentFn: async (mode: string) => { launches.push(mode); throw new Error(`unexpected ${mode} launch`); },
    consumeReviewerArtifactsFn: async () => ({ consumed: true, ok: true, reviewState: opts.outcome ?? 'APPROVED', findingSummaries: opts.findings ?? [] }),
    consumeImplementerArtifactsFn: async () => ({ consumed: true, ok: true, disposition: 'CHANGES_MADE' }),
    transitionTaskFn: () => true,
    transitionVirtualFn: () => true,
    writeReviewStateFn: () => {},
    log: (msg: string) => logs.push(msg),
    error: (msg: string) => errors.push(msg),
    exit: (code: number) => { throw new Error(`exit(${code})`); },
  };
}

test('single pre-review gate pass emission on the happy path', async () => {
  const logs: string[] = [];
  const errors: string[] = [];
  const launches: string[] = [];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2477-gate-'));
  try {
    await startReviewLoop('task-999', {
      ...happyPathDeps({ outcome: 'APPROVED' }, logs, errors, launches),
      worktree: root,
      // TASK-2477/F4: the stub emits the real announcement so the test asserts
      // how many times the gate-pass line is *emitted*, not how many times the
      // gate runs. A reintroduced duplicate emission in review-loop.ts would
      // push this count to 2 and fail.
      runPreReviewGateFn: async () => {
        logs.push('[PASS] Pre-review gate passed for area "docs".');
        return { ok: true, area: 'docs', command: './scripts/verify-local.sh', exitCode: 0, stdout: '', stderr: '' };
      },
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  assert.equal(logs.filter((m) => m.includes('Pre-review gate passed for area')).length, 1, `pre-review gate success announced exactly once on the happy path`);
  assert.equal(errors.length, 0, `no errors on happy path: ${errors.join(' | ')}`);
});

test('verdict prominence: APPROVED emitted before the review-stopped transition line', async () => {
  const logs: string[] = [];
  const errors: string[] = [];
  const launches: string[] = [];
  try {
    await startReviewLoop('task-999', happyPathDeps({ outcome: 'APPROVED' }, logs, errors, launches));
  } finally { /* empty */ }
  const approvedIdx = logs.findIndex((m) => /APPROVED/.test(m) && m.includes('===='));
  const stopIdx = logs.findIndex((m) => m.includes('Autonomous review stopped: reviewer approved'));
  assert.ok(approvedIdx !== -1, 'prominent APPROVED verdict is presented');
  assert.ok(stopIdx !== -1, 'review-stopped transition line present');
  assert.ok(approvedIdx < stopIdx, `verdict (${approvedIdx}) precedes the stop/transition line (${stopIdx})`);
});

test('non-APPROVED persisted state emits no APPROVED presentation', async () => {
  const logs: string[] = [];
  const errors: string[] = [];
  const launches: string[] = [];
  try {
    // REQUEST_CHANGES routes into the fixing branch; no approval is presented.
    await startReviewLoop('task-999', happyPathDeps({ outcome: 'REQUEST_CHANGES', findings: ['missing validation'] }, logs, errors, launches));
  } catch { /* fixing branch exit path is irrelevant to this assertion */ }
  assert.ok(!logs.some((m) => /APPROVED/.test(m) && m.includes('====')), 'no APPROVED verdict for a non-approval state');
});

test('verbose review start exposes poll/provider lines that default hides', async () => {
  const verboseLogs: string[] = [];
  const verboseErrors: string[] = [];
  const verboseLaunches: string[] = [];
  const defaultLogs: string[] = [];
  const defaultErrors: string[] = [];
  const defaultLaunches: string[] = [];
  try {
    await startReviewLoop('task-999', happyPathDeps({ verbose: true, outcome: 'APPROVED' }, verboseLogs, verboseErrors, verboseLaunches));
  } finally { /* empty */ }
  try {
    await startReviewLoop('task-999', happyPathDeps({ verbose: false, outcome: 'APPROVED' }, defaultLogs, defaultErrors, defaultLaunches));
  } finally { /* empty */ }
  assert.ok(verboseLogs.some((m) => m.includes('Forgejo validation skipped')), 'verbose on: provider-skipped line present');
  // TASK-2477/F4: Max attempts is part of the demoted review-start header too.
  assert.ok(defaultLogs.some((m) => /Poll interval|Poll timeout|Max attempts/.test(m)) === false, 'default off: poll/timeout/max-attempts lines absent');
  assert.ok(verboseLogs.some((m) => /Poll interval|Poll timeout/.test(m)), 'verbose on: poll lines present');
  assert.ok(verboseLogs.some((m) => /Max attempts/.test(m)), 'verbose on: max-attempts line present');
});

test('incomplete reviewer-artifact infrastructure failure survives at default verbosity', async () => {
  const logs: string[] = [];
  const errors: string[] = [];
  const launches: string[] = [];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2477-pres-'));
  try {
    await startReviewLoop('task-999', {
      ...happyPathDeps({ outcome: 'APPROVED' }, logs, errors, launches),
      worktree: root,
      consumeReviewerArtifactsFn: async () => ({ consumed: true, ok: false, diagnostic: 'persist failed (outcome): sqlite busy' }),
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  assert.ok(errors.some((m) => m.includes('Reviewer artifact infrastructure failure')), 'infra failure message surfaces at default verbosity');
});
