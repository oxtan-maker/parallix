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
  standingApprovalHolders,
  type IntegrationGateRouteOptions,
} from '../src/adapters/cli/commands/integrate-gate-rebound.js';
import { DEFAULT_FORGEJO_USER } from '../src/adapters/forgejo/forgejo.js';
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
  invalidations: Array<{ slug: string; branch: string; reviewerUser: string | null }>;
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
    readReboundsFn: async () => 0,
    recordReboundFn: async () => true,
    captureFinalTreeFn: (() => ({ ok: true, rootDir: '/tmp/mission', commit: h.head.commit, tree: h.head.tree })) as never,
    // The identical gate set re-runs green once the repair is in place.
    runPhaseGatesFn: (async (_phase: string, o: any) => ({
      ok: true, phase: 'integration', gates: o.gates, executed: 1, skipped: false, dryRun: false, failedGate: null, error: null,
    })) as never,
    invalidateApprovalFn: (async (opts: any) => {
      h.invalidations.push({ slug: opts.slug, branch: opts.branch, reviewerUser: opts.reviewerUser ?? null });
      return { ok: true, retracted: [REVIEWER], errors: [] };
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
  assert.deepEqual(h.invalidations[0], { slug: SLUG, branch: `mission/${SLUG}`, reviewerUser: REVIEWER });
  const said = h.messages.join('\n');
  assert.match(said, /re-review|review/i, 'the operator is told the mission must be re-reviewed');
  assert.match(said, /approved-tree/, 'the approved revision is named as evidence');
  assert.match(said, /repaired-tree/, 'the repaired revision is named as evidence');
});

test('TASK-2528: an unchanged retry after the same integration error still lands on its existing approval', async () => {
  const h = harness();
  const route = await routeIntegrationGateFailure(routeArgs(h, false));

  assert.equal(route.route, 'fixed', 'an unchanged retry keeps the route its still-current approval allows');
  assert.deepEqual(h.invalidations, [], 'an unchanged retry never retracts the approval');
});

// ── Retraction targets the account that actually holds the approval ──────────

test('TASK-2528: only the logins holding a standing approval are retracted', () => {
  assert.deepEqual(
    standingApprovalHolders({ ok: true, defaultUserApproved: true, reviewerApproved: true }, REVIEWER),
    [DEFAULT_FORGEJO_USER, REVIEWER],
    'both the repo default user and the configured reviewer are retracted when both approved',
  );
  assert.deepEqual(
    standingApprovalHolders({ ok: true, defaultUserApproved: false, reviewerApproved: true }, REVIEWER),
    [REVIEWER],
    'a reviewer-only approval retracts the reviewer, never the default user',
  );
  assert.deepEqual(
    standingApprovalHolders({ ok: true, defaultUserApproved: true, reviewerApproved: false }, REVIEWER),
    [DEFAULT_FORGEJO_USER],
    'a reviewer who did not approve is not posted as',
  );
  assert.deepEqual(
    standingApprovalHolders({ ok: false, error: 'api-failed' }, REVIEWER),
    [],
    'an unreadable approval names no holder rather than guessing one',
  );
});

test('TASK-2528: the approval is retracted as the approving login, not the integrating one', async () => {
  const posted: Array<{ branch: string; user: string; outcome: string; body: string }> = [];
  const result = await invalidateApprovedPrReview({
    slug: SLUG,
    branch: `mission/${SLUG}`,
    approval: { ok: true, reviewerApproved: true },
    reviewerUser: REVIEWER,
    summary: staleApprovalSummary(SLUG, 'approved-tree', 'repaired-tree', 'integration-suite'),
    readTokenFn: ((user: string) => `token-for-${user}`) as never,
    postReviewFn: ((branch: string, _token: string, outcome: string, body: string, o: any) => {
      posted.push({ branch, user: o.forgejoUser, outcome, body });
      return { ok: true, data: null, status: 200 };
    }) as never,
  });

  assert.deepEqual(result, { ok: true, retracted: [REVIEWER], errors: [] });
  assert.equal(posted.length, 1, 'exactly one retraction per standing approval');
  assert.equal(posted[0]!.user, REVIEWER, 'the retraction is posted as the login whose approval it retracts');
  assert.equal(posted[0]!.outcome, 'request-changes');
  assert.match(posted[0]!.body, /approved-tree/);
  assert.match(posted[0]!.body, /repaired-tree/);
});

test('TASK-2528: an approval that cannot be retracted is reported and still refuses the merge', async () => {
  const result = await invalidateApprovedPrReview({
    slug: SLUG,
    branch: `mission/${SLUG}`,
    approval: { ok: true, reviewerApproved: true },
    reviewerUser: REVIEWER,
    summary: 'irrelevant',
    readTokenFn: (() => null) as never,
    postReviewFn: (() => { throw new Error('must not post without a token'); }) as never,
  });

  assert.equal(result.ok, false, 'a missing token is a failure, never a silent skip');
  assert.deepEqual(result.retracted, []);
  assert.match(result.errors.join('\n'), /no Forgejo token for qwen/);

  // The merge refusal does not depend on the retraction succeeding.
  const h = harness();
  const route = await routeIntegrationGateFailure({
    ...routeArgs(h, true),
    invalidateApprovalFn: (async () => ({ ok: false, retracted: [], errors: ['provider rejected the retraction'] })) as never,
  } as never);
  assert.equal(route.route, 'revision-changed', 'a failed retraction still refuses to land the changed revision');
  assert.match(h.messages.join('\n'), /Stale approval left standing/);
});
