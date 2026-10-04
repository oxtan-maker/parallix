// review loop presentation contract.
// Related scenarios share imports; each contract keeps its own hooks and mutable fixtures.
import test, { describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mkdtemp as registeredMkdtemp } from '../../../helpers/temp-dir.js';
import { renderReviewVerdict, reviewIndependence, startReviewLoop } from '../../../../src/adapters/review/review-loop.js';

// Regression provenance: TASK-1209.
describe("review loop", { concurrency: false }, () => {
  test('startReviewLoop skips reviewer and implementer launches for autonomous fallback in provider=none mode', async () => {
    const root = registeredMkdtemp('task-1209-review-loop-');
    const logs = [];
    const errors = [];
    const launches = [];

    try {
      fs.writeFileSync(
        path.join(root, 'workflow.config.json'),
        JSON.stringify({ product: {}, adapters: { review: { provider: 'none' } } })
      );

      await startReviewLoop('task-999', {
        worktree: root,
        maxAttempts: 1,
        maybeUpdateGraphifyBeforeReviewFn: () => {},
  // @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
        resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task-999.md' }),
        getTaskImplementerFn: () => null,
        readReviewStateFn: () => null,
        // SC1: a provider-disabled --start now performs the handoff transition.
        performHandoffFn: async () => ({ ok: true }),
        eligibleAgentsForStepFn: () => ['codex'],
        selectAgentFn: () => { throw new Error('No agents available'); },
  // @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
        rebaseBeforeReviewRoundFn: async () => ({ ok: true }),
        startAgentFn: async (mode) => {
          launches.push(mode);
          throw new Error(`unexpected ${mode} launch`);
        },
        consumeReviewerArtifactsFn: async () => ({ consumed: true, ok: true, reviewState: 'REQUEST_CHANGES' }),
        consumeImplementerArtifactsFn: async () => ({ consumed: true, ok: true, disposition: 'CHANGES_MADE' }),
  // @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
        transitionTaskFn: () => true,
        transitionVirtualFn: () => true,
  // @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
        writeReviewStateFn: () => {},
        log: (msg) => logs.push(msg),
        error: (msg) => errors.push(msg),
        exit: (code) => {
          throw new Error(`exit(${code})`);
        }
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }

    assert.deepEqual(launches, [], 'autonomous fallback should not launch any agents');
    assert.equal(errors.length, 0, `expected no errors, got: ${errors.join(' | ')}`);
    assert.ok(logs.some(msg => msg.includes('skipping reviewer launch')), 'should log reviewer launch bypass');
    assert.ok(logs.some(msg => msg.includes('skipping implementer launch')), 'should log implementer launch bypass');
    assert.equal(logs.filter(msg => msg.includes('Selected reviewer:')).length, 1, 'reviewer selection is announced once');
    assert.ok(logs.some(msg => msg.includes('REVIEW — task-999')), 'operator header identifies the mission');
    assert.ok(logs.some(msg => msg.includes('Independence: same-family fallback / self-review')), 'operator header states the fallback relationship');
    assert.equal(logs.some(msg => /Poll interval|Poll timeout|Max attempts|Persisted reviewer artifacts/.test(msg)), false, 'default output hides review plumbing');
  });
});

// Regression provenance: TASK-2477.
describe("review presentation", { concurrency: false }, () => {
  /**
   * Focused review-presentation tests for TASK-2477. These drive startReviewLoop
   * through controlled seams so the exact default/verbose emissions are asserted
   * without launching real agents.
   */
  // Partial test-double factory: the doubles below are intentionally loose and
  // the type errors surface at the startReviewLoop call site (all opts props are
  // optional), so the factory return is typed `any` and the call sites stay
  // clean. The ESM seam migration left these doubles partial on purpose.
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });
  function happyPathDeps(opts: { verbose?: boolean; outcome?: string; findings?: string[] }, logs: string[], errors: string[], launches: string[]): any {
    const worktree = registeredMkdtemp('review-presentation-');
    roots.push(worktree);
    return {
      worktree,
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
    const root = registeredMkdtemp('task-2477-gate-');
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
    const root = registeredMkdtemp('task-2477-pres-');
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
});

// Regression provenance: TASK-2351.
describe('review independence and verdict output', () => {
  test('review presentation classifies different-family and same-family fallback from agent-family identity', () => {
    assert.equal(reviewIndependence('claude', 'custom'), 'different-family review');
    assert.equal(reviewIndependence('claude', 'claude'), 'same-family fallback / self-review');
    assert.doesNotMatch(reviewIndependence('claude', 'claude'), /different-family/);
  });

  test('review verdict presentation is authoritative and renders blocking findings before follow-up work', () => {
    const logs: string[] = [];
    // Structured findings carry the id so the verdict names the finding
    // (TASK-2478/criterion 5): the operator must tell WHICH finding blocks.
    renderReviewVerdict('REQUEST_CHANGES', [{ id: 'F1', summary: 'missing validation' }, { id: 'F2', summary: 'unhandled retry' }], (line) => logs.push(line));
    assert.match(logs[0], /CHANGES REQUESTED/);
    assert.match(logs[1], /Blocking finding: F1 — missing validation/);
    assert.match(logs[2], /Blocking finding: F2 — unhandled retry/);

    renderReviewVerdict('COMMENT', [], (line) => logs.push(line));
    assert.equal(logs.length, 3, 'non-authoritative states cannot produce an approval or changes verdict');
  });
});

test('renderReviewVerdict renders an APPROVED verdict as a PASS banner', () => {
  const logs: string[] = [];
  renderReviewVerdict('APPROVED', [], (line) => logs.push(line));
  assert.equal(logs.length, 1);
  assert.match(logs[0], /APPROVED/);
  assert.match(logs[0], /\[PASS\]/);
});

test('renderReviewVerdict surfaces a non-binary verdict only when verbose', () => {
  const quiet: string[] = [];
  renderReviewVerdict('COMMENT', [], (line) => quiet.push(line));
  assert.equal(quiet.length, 0, 'non-binary verdict is silent without verbose');

  const verbose: string[] = [];
  renderReviewVerdict('COMMENT', [], (line) => verbose.push(line), true);
  assert.equal(verbose.length, 1);
  assert.match(verbose[0], /Reviewer outcome = COMMENT/);
});
