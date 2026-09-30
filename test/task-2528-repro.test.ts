// ---------------------------------------------------------------------------
// TASK-2528 — re-running integrate after an integration-error fix must not
// land the repaired code under the approval given to the pre-repair revision.
//
// The scenario modelled here is the reported one: an approved PR reaches
// `px integrate`, an integration gate reports an integration error, the
// implementer repairs the mission in its worktree, and the identical gate set
// re-runs green. Before the fix the recovery reported `fixed` and the merge
// proceeded, so the reviewer's approval of the *previous* revision carried the
// repaired diff into `main` unreviewed.
//
// Both post-error retries are covered: the changed one must invalidate the
// standing approval and refuse to land, the unchanged one must keep its
// approval and stay eligible to land.
//
// Nothing here opens a database, launches an agent, executes a gate, or talks
// to Forgejo: every boundary is injected and the real rebound kernel runs in
// the middle.
// ---------------------------------------------------------------------------
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  invalidateApprovedPrReview,
  routeIntegrationGateFailure,
  staleApprovalSummary,
  type IntegrationGateRouteOptions,
} from '../src/adapters/cli/commands/integrate-gate-rebound.js';
import type { GateRunOutcome } from '../src/adapters/config/repository-gates.js';

const SLUG = 'task-2528-fixture';
const GATE_COMMAND = 'npm run test:integration';
const REVIEWER = 'qwen';

const failedGate = (): GateRunOutcome => ({
  key: 'integration-suite',
  command: GATE_COMMAND,
  exitCode: 1,
  stdout: '',
  stderr: 'test/integration/landing.test.ts:42 failed',
});

interface Harness {
  /** The mission worktree HEAD, as the gate runner and the recovery observe it. */
  head: { commit: string; tree: string };
  transitions: string[];
  invalidations: Array<{ slug: string; branch: string }>;
  messages: string[];
}

function harness(): Harness {
  return {
    head: { commit: 'approved-commit', tree: 'approved-tree' },
    transitions: [],
    invalidations: [],
    messages: [],
  };
}

/**
 * One post-integration-error retry.
 *
 * `repairChangesDiff` decides what the implementer relaunch does to the
 * mission worktree: a real repair advances HEAD to a new commit and tree, a
 * no-op retry (a flaky gate that passes on the second run) leaves it alone.
 */
function routeArgs(h: Harness, repairChangesDiff: boolean): IntegrationGateRouteOptions {
  return {
    slug: SLUG,
    missionWorktree: '/tmp/mission',
    baseWorktree: '/tmp/base',
    baseBranch: 'main',
    branch: `mission/${SLUG}`,
    verificationCommand: './scripts/verify-local.sh all',
    failedGate: failedGate(),
    gateError: 'Repository gate "integration-suite" exited with code 1 for integration.',
    gates: [{ key: 'integration-suite', command: GATE_COMMAND, order: 3 }],
    implementer: 'codex',
    repositoryId: 'parallix',
    // The standing approval the reviewer gave to `approved-tree`.
    approval: { ok: true, reviewState: 'APPROVED', reviewerApproved: true, reviewerApprovedAt: '2026-09-16T10:00:00Z' },
    reviewerUser: REVIEWER,
    startAgentFn: (async () => {
      if (repairChangesDiff) { h.head = { commit: 'repaired-commit', tree: 'repaired-tree' }; }
      return { agent: 'codex', result: { status: 0 } };
    }) as never,
    transitionTaskFn: async (slug: string) => { h.transitions.push(slug); return true; },
    probeBaseBranchReproductionFn: (async () => ({ checked: true, reproduced: false, detail: 'passes on main', baseCommit: 'base-commit' })) as never,
    captureFinalTreeFn: (() => ({ ok: true, rootDir: '/tmp/mission', commit: h.head.commit, tree: h.head.tree })) as never,
    // The identical gate set re-runs green once the repair is in place.
    runPhaseGatesFn: (async (_phase: string, o: any) => ({
      ok: true, phase: 'integration', gates: o.gates, executed: 1, skipped: false, dryRun: false, failedGate: null, error: null,
    })) as never,
    invalidateApprovalFn: (async (opts: any) => {
      h.invalidations.push({ slug: opts.slug, branch: opts.branch });
      return { ok: true, dismissed: [REVIEWER], errors: [] };
    }) as never,
    log: (m: string) => h.messages.push(m),
    error: (m: string) => h.messages.push(m),
    gateRunLog: (m: string) => h.messages.push(m),
    gateRunError: (m: string) => h.messages.push(m),
  } as unknown as IntegrationGateRouteOptions;
}

test('TASK-2528: a post-integration-error repair that changes the mission diff cannot land on the prior approval', async () => {
  const h = harness();
  const route = await routeIntegrationGateFailure(routeArgs(h, true));

  assert.notEqual(
    route.route,
    'fixed',
    'a repair that changed the approved diff must not report the route the caller merges on',
  );
  assert.equal(route.route, 'revision-changed', 'the changed revision is its own operator-facing route');
  assert.deepEqual(h.transitions, [SLUG], 'the mission is handed back to the implementer exactly once');
  assert.equal(h.invalidations.length, 1, 'the standing approval is invalidated exactly once');
  assert.deepEqual(h.invalidations[0], { slug: SLUG, branch: `mission/${SLUG}` });
  const said = h.messages.join('\n');
  assert.match(said, /re-review|review/i, 'the operator is told the mission must be re-reviewed');
  assert.match(said, /approved-commit/, 'the approved commit is named as evidence');
  assert.match(said, /repaired-commit/, 'the repaired commit is named as evidence');
});

test('TASK-2528: an unchanged retry after the same integration error still lands on its existing approval', async () => {
  const h = harness();
  const route = await routeIntegrationGateFailure(routeArgs(h, false));

  assert.equal(route.route, 'fixed', 'an unchanged retry keeps the route its still-current approval allows');
  assert.deepEqual(h.invalidations, [], 'an unchanged retry never retracts the approval');
});

test('TASK-2528: a pre-retracted approval cannot take the fixed route even when the tree is unchanged', async () => {
  const h = harness();
  const route = await routeIntegrationGateFailure({
    ...routeArgs(h, false),
    reactivateMissionFn: async () => true,
  });
  assert.equal(route.route, 'revision-changed');
  assert.equal(h.invalidations.length, 1);
});

// ── Dismissal acts as the dedicated parallix login (TASK-2620) ───────────────

test('TASK-2620: a stale approval is dismissed as parallix; no review is posted as the reviewer', async () => {
  const dismissals: Array<{ branch: string; user: string; token: string; reason: string }> = [];
  const result = await invalidateApprovedPrReview({
    slug: SLUG,
    branch: `mission/${SLUG}`,
    approval: { ok: true, reviewerApproved: true },
    summary: staleApprovalSummary(SLUG, 'approved-commit', 'repaired-commit', 'integration-suite'),
    readTokenFn: ((user: string) => `token-for-${user}`) as never,
    dismissFn: ((branch: string, token: string, reason: string, o: any) => {
      dismissals.push({ branch, user: o.forgejoUser, token, reason });
      return { ok: true, dismissed: [REVIEWER], errors: [] };
    }) as never,
  });

  assert.deepEqual(result, { ok: true, dismissed: [REVIEWER], errors: [] });
  assert.equal(dismissals.length, 1);
  assert.equal(dismissals[0]!.user, 'parallix', 'Parallix acts as its own login');
  assert.equal(dismissals[0]!.token, 'token-for-parallix', 'never the reviewer\'s token');
  assert.match(dismissals[0]!.reason, /approved-commit/);
  assert.match(dismissals[0]!.reason, /repaired-commit/);
  assert.doesNotMatch(dismissals[0]!.reason, /\bF\d+\b|blocking/i, 'the reason is not a fabricated finding');
});

test('TASK-2620: no provider approval means nothing to dismiss', async () => {
  const result = await invalidateApprovedPrReview({
    slug: SLUG, branch: `mission/${SLUG}`, approval: { ok: false, error: 'forgejo-off' }, summary: 'irrelevant',
    readTokenFn: (() => { throw new Error('must not read a token'); }) as never,
  });
  assert.deepEqual(result, { ok: true, dismissed: [], errors: [] });
});

test('TASK-2528: an approval that cannot be retracted is reported and still refuses the merge', async () => {
  const result = await invalidateApprovedPrReview({
    slug: SLUG,
    branch: `mission/${SLUG}`,
    approval: { ok: true, reviewerApproved: true },
    summary: 'irrelevant',
    readTokenFn: (() => null) as never,
    dismissFn: (() => { throw new Error('must not dismiss without a token'); }) as never,
  });

  assert.equal(result.ok, false, 'a missing token is a failure, never a silent skip');
  assert.deepEqual(result.dismissed, []);
  assert.match(result.errors.join('\n'), /no Forgejo token for parallix/);

  // The merge refusal does not depend on the retraction succeeding.
  const h = harness();
  const route = await routeIntegrationGateFailure({
    ...routeArgs(h, true),
    invalidateApprovalFn: (async () => ({ ok: false, dismissed: [], errors: ['provider rejected the dismissal'] })) as never,
  } as never);
  assert.equal(route.route, 'revision-changed', 'a failed retraction still refuses to land the changed revision');
  assert.match(h.messages.join('\n'), /Provider approval was not updated/);
});
