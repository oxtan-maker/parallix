import type { IntegrateWorkflowPorts, IntegrationGateRunRecord } from '../../../src/application/ports/integrate-workflow.js';
import { missionVersion } from '../../../src/application/domain-ports.js';
import { approvedReview, fixtureMission, inMemoryTransitionStore } from '../../fixtures/mission-builders.js';
import { classifyReboundReason } from '../../../src/domain/rebound-policy.js';
import { phaseGateResult } from '../../helpers/phase-gate-result.js';
import { integrationServices } from '../../helpers/stub-integration-services.js';
import { integrationContext } from '../../fixtures/integration-context.js';
import { stubIntegrateWorkflowPorts } from '../../helpers/stub-integrate-workflow-ports.js';
import { mkdtemp } from '../../helpers/temp-dir.js';
// Integration tests evidence: the sha-keyed validation marker (TASK-2625), the gate-run receipt the
// policy tests action records, and the landing-time read of that receipt over real git movement.
//
// TASK-2872.02: integrate never starts a gate. It reads the recorded receipt, which still covers the
// candidate after bookkeeping-only movement, a verified version hook (TASK-2867.09) or a recorded
// completed rebase (PX-0048), and which refuses naming tests after any other movement.
//
// No .only, no bare .skip.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildIntegrationValidationMarker,
  INTEGRATION_VALIDATION_EVENT_TYPE,
  parseIntegrationValidationMarker,
  passingIntegrationReceiptApplies,
} from '../../../src/application/integrate/validation-marker.js';
import { captureFinalIntegrationTree } from '../../../src/adapters/cli/commands/integrate-gates.js';
import { createTestsActionExecutor, requireCurrentIntegrationTests } from '../../../src/application/integrate/tests-action.js';
import { createIntegrationGateStep } from '../../../src/application/integrate/gates.js';
import { routeIntegrationGateFailure } from '../../../src/adapters/cli/commands/integrate-gate-rebound.js';
import { setLogger } from '../../../src/application/presentation/cli-format.js';
import type { OperationalHistoryService } from '../../../src/application/services/operational-history-service.js';
import { openRepairFixture } from '../../lib/integration-repair-fixture.js';
import { SqliteOperationalHistoryRepository } from '../../../src/adapters/sqlite/operational-history-repository.js';
import { bookkeepingCommitMessage } from '../../../src/domain/approval-coverage.js';
import { verificationEquivalentRevision } from '../../../src/adapters/git/revision-equivalence.js';
import { approveEligibleIntegrationShortcut } from '../../../src/application/integrate/approval.js';
import { MissionLifecycleService } from '../../../src/application/mission-lifecycle-service.js';
import { recordApproval } from '../../../src/adapters/review/review-round.js';
import { agentFamily } from '../../../src/domain/agents.js';
import { changeRevision, type Review } from '../../../src/domain/review.js';
import { createIntegrationVerificationEvidencePort, readIntegrationGateRun } from '../../../src/adapters/verification/integration-verification-proof.js';
import { missionId } from '../../../src/domain/mission.js';

const EVENT = INTEGRATION_VALIDATION_EVENT_TYPE;
const SLUG = 'task-2625';

// ── buildIntegrationValidationMarker ─────────────────────────────────────────

test('buildIntegrationValidationMarker keeps distinct non-empty hooks and rejects an empty whitelist', () => {
  const marker = buildIntegrationValidationMarker(SLUG, 'abc123', ['unit', 'integration-ci', 'unit']);
  assert.deepEqual(marker.hooks, ['unit', 'integration-ci']);
  assert.equal(marker.sha, 'abc123');
  assert.throws(() => buildIntegrationValidationMarker(SLUG, 'abc', []), /at least one validated hook/);
  assert.throws(() => buildIntegrationValidationMarker(SLUG, '', ['unit']), /validating sha/);
  assert.throws(() => buildIntegrationValidationMarker('', 'sha', ['unit']), /mission id/);
});

// ── parseIntegrationValidationMarker ──────────────────────────────────────────

test('parseIntegrationValidationMarker accepts a well-formed marker and rejects every malformed shape', () => {
  const good = parseIntegrationValidationMarker({
    eventType: EVENT,
    eventData: JSON.stringify({ missionId: SLUG, sha: 'deadbeef', hooks: ['unit', 'integration-ci'] }),
  });
  assert.equal(good?.sha, 'deadbeef');
  assert.deepEqual(good?.hooks, ['unit', 'integration-ci']);

  assert.equal(parseIntegrationValidationMarker({ eventType: 'other', eventData: '{}' }), null);
  assert.equal(parseIntegrationValidationMarker({ eventType: EVENT, eventData: 'not json' }), null);
  assert.equal(parseIntegrationValidationMarker({ eventType: EVENT, eventData: JSON.stringify({ sha: 'x', hooks: ['unit'] }) }), null); // no missionId
  assert.equal(parseIntegrationValidationMarker({ eventType: EVENT, eventData: JSON.stringify({ missionId: SLUG, sha: 'x' }) }), null); // no hooks
  assert.equal(parseIntegrationValidationMarker({ eventType: EVENT, eventData: JSON.stringify({ missionId: SLUG, sha: 'x', hooks: [] }) }), null); // empty whitelist
  assert.equal(parseIntegrationValidationMarker(null), null);
});

test('passing receipt policy preserves exact and equivalent coverage but rejects incomplete, stale, failed, cancelled, superseded, and other-plan evidence (TASK-2867.09)', () => {
  const configured = [{ key: 'unit', command: 'u' }, { key: 'integration-ci', command: 'i' }];
  const receipt = { gateRunId: 'original-run', revision: 'tested', status: 'passed' as const, current: true, carried: null,
    gates: configured, outcomes: configured.map(gate => ({ ...gate, exitCode: 0 })) };
  assert.equal(passingIntegrationReceiptApplies(receipt, 'tested', configured, 'exact'), true, 'exact-head policy restart');
  assert.equal(passingIntegrationReceiptApplies({ ...receipt, revision: 'before-backlog' }, 'after-backlog', configured, 'equivalent'), true,
    'adapter-proven equivalent inputs retain the receipt');
  assert.equal(passingIntegrationReceiptApplies({ ...receipt, current: false, carried: [{ from: 'before', to: 'after' }] },
    'after', configured, 'equivalent'), true, 'completed rebase retains the receipt');
  const rejected = [
    null,
    { ...receipt, gateRunId: null },
    { ...receipt, gates: configured.slice(0, 1), outcomes: receipt.outcomes.slice(0, 1) },
    { ...receipt, current: false },
    { ...receipt, status: 'failed' as const },
    { ...receipt, status: 'cancelled' as const },
    { ...receipt, status: 'running' as const },
    { ...receipt, outcomes: [{ ...configured[0], exitCode: 1 }, receipt.outcomes[1]] },
  ];
  for (const candidate of rejected) {
    assert.equal(passingIntegrationReceiptApplies(candidate, 'tested', configured, 'equivalent'), false);
  }
  assert.equal(passingIntegrationReceiptApplies(receipt, 'tested', [{ key: 'unit', command: 'changed' }], 'equivalent'), false,
    'gate-plan mismatch reruns');
});

test('revision equivalence avoids Git reads for the identical revision and stops after one diff for obvious changes (TASK-2867.09)', () => {
  const original = '1'.repeat(40), candidate = '2'.repeat(40);
  const calls: string[][] = [];
  const backlogOnly = (args: string[]) => {
    calls.push(args);
    return { status: 0, stdout: 'backlog/tasks/task-1.md\0', stderr: '' };
  };
  assert.equal(verificationEquivalentRevision('/repo', original, original, backlogOnly), true);
  assert.equal(calls.length, 0, 'same revision requires no Git read');
  assert.equal(verificationEquivalentRevision('/repo', original, candidate, backlogOnly), true);
  assert.equal(calls.length, 1, 'Backlog-only movement requires one diff');

  calls.length = 0;
  const substantive = (args: string[]) => {
    calls.push(args);
    return { status: 0, stdout: 'src/change.ts\0', stderr: '' };
  };
  assert.equal(verificationEquivalentRevision('/repo', original, candidate, substantive), false);
  assert.equal(calls.length, 1, 'an obviously substantive path stops after one diff');
});

function makeStep(overrides: {
  runPhaseGates?: IntegrateWorkflowPorts['gates']['runPhaseGates'];
} = {}) {
  const recorded: Array<{ missionId: string; sha: string; hooks: string[]; failed?: boolean }> = [];
  const step = createIntegrationGateStep(stubIntegrateWorkflowPorts({
    gates: {
      resolveIntegrationVerificationWorktree: () => '/fw',
      captureFinalIntegrationTree: () => ({ ok: true as const, rootDir: '/fw', commit: 'final', tree: 't' }),
      loadPhaseGates: () => [{ key: 'unit', command: 'u', order: 1 }, { key: 'integration-ci', command: 'i', order: 2 }],
      loadRequirePreIntegration: () => false,
      runPhaseGates: overrides.runPhaseGates
        ? overrides.runPhaseGates
        : async () => phaseGateResult({ skipped: false, gates: [{ key: 'unit', command: 'u', order: 1 }, { key: 'integration-ci', command: 'i', order: 2 }], executed: 2 }),
    },
    landing: { createAbort: () => Object.assign(new Error('aborted'), { name: 'IntegrationAbort' }) },
    verification: { formatVerificationCommand: () => 'verify' },
  }));
  const operationalHistory: Pick<OperationalHistoryService, 'recordIntegrationValidation'> = {
    async recordIntegrationValidation(marker: { missionId: string; sha: string; hooks: readonly string[]; failed?: boolean }) {
      recorded.push({ missionId: marker.missionId, sha: marker.sha, hooks: [...marker.hooks], failed: marker.failed });
    },
  };
  return { step, operationalHistory, recorded };
}

const TASK_FILE = 'backlog/tasks/task-9001 - Example-task.md';

// ── TASK-2646: real git movement through the gates-port adapter ──────────────

/**
 * A throwaway repository with hermetic git config (no user/system config,
 * hooks, signing, or auto-gc) so each case spends its CPU budget only on the
 * git operations it asserts on.
 */
function openGitRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'px-validation-skip-'));
  const env = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: os.devNull,
    GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'commit.gpgsign', GIT_CONFIG_VALUE_0: 'false', GIT_CONFIG_KEY_1: 'gc.auto', GIT_CONFIG_VALUE_1: '0',
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid',
  };
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const head = () => git('rev-parse', 'HEAD');
  const commit = (files: Record<string, string>, message: string) => {
    for (const [file, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), content);
    }
    git('add', '-A');
    git('commit', '-q', '--no-verify', '-m', message);
  };
  git('init', '-q', '-b', 'main');
  commit({ 'src/a.ts': 'export const a = 1;\n', [TASK_FILE]: 'status: active\n',
    'package.json': '{\n  "version": "1.0.0"\n}\n' }, 'base');
  return { root, git, head, commit, close: () => fs.rmSync(root, { recursive: true, force: true }) };
}

// ── TASK-2867.09: review-step tests evidence at the landing candidate ────
// One real Git approval-to-landing flow: the policy-selected tests action writes
// a green receipt, agent and human approval preserve it, then the tagged version
// hook moves the candidate. Landing reads currency through the production adapter.

test('a complete green policy tests receipt survives agent and human approval and the verified version hook (TASK-2867.09)', async () => {
  const repo = openGitRepo();
  const diagnostics: string[] = [];
  const previous = setLogger({ log: message => diagnostics.push(String(message)), error: message => diagnostics.push(String(message)) });
  try {
    repo.git('checkout', '-q', '-b', 'mission');
    let launches = 0;
    const evidence = createIntegrationVerificationEvidencePort();
    const runState: { receipt: IntegrationGateRunRecord | null } = { receipt: null };
    const readRun = () => runState.receipt;
    const ports = stubIntegrateWorkflowPorts({
      process: { cwd: () => repo.root, claimIntegration: async () => async () => {} },
      git: { getCurrentBranch: () => 'mission' },
      gates: {
        resolveIntegrationVerificationWorktree: () => repo.root,
        captureFinalIntegrationTree: root => captureFinalIntegrationTree(root),
        loadPhaseGates: () => REBOUND_GATES, loadRequirePreIntegration: () => true,
        runPhaseGates: async () => {
          launches++;
          const outcomes = REBOUND_GATES.map(({ key, command }) => ({ key, command, exitCode: 0 }));
          const run = await evidence.start(repo.root, REBOUND_GATES, { missionId: missionId(SLUG), operatorInvocation: false });
          assert.ok(run, 'the real receipt adapter starts the policy gate run');
          run.complete(outcomes, 'passed');
          // Cache the writer's persisted fields for the tests action; landing below deliberately rereads currency.
          const stored = JSON.parse(fs.readFileSync(path.join(repo.root, '.git', 'integration-verification-proof.json'), 'utf8')) as {
            run: { gateRunId: string }; revision: string; status: 'passed';
            gates: { key: string; command: string }[]; outcomes: { key: string; command: string; exitCode: number }[];
          };
          runState.receipt = { gateRunId: stored.run.gateRunId, revision: stored.revision, status: stored.status,
            current: true, carried: null, gates: stored.gates, outcomes: stored.outcomes };
          return phaseGateResult({ gates: REBOUND_GATES, executed: REBOUND_GATES.length,
            outcomes: outcomes.map(outcome => ({ ...outcome, stdout: '', stderr: '' })), proofReusable: true });
        },
        readGateRun: readRun,
      },
      verification: { formatVerificationCommand: () => 'verify' },
      landing: { createAbort: () => Object.assign(new Error('aborted'), { name: 'IntegrationAbort' }),
        isAbort: error => (error as Error)?.name === 'IntegrationAbort' },
    });
    const services = integrationServices({ operationalHistory: { recordIntegrationValidation: async () => {} } });
    const outcome = await createTestsActionExecutor(ports, {
      buildIntegrationContext: async (slug, options) => integrationContext({ slug, executionContext: options.executionContext,
        baseWorktree: repo.root, missionWorktree: repo.root, reviewState: { implementer: 'custom' } }),
      runIntegrationRebase: async () => {},
      runRequiredLocalGates: request => createIntegrationGateStep(ports).runRequiredLocalGates(request),
    }).runTestsAction({ slug: SLUG, policySelection: 'tests', missionServicesFn: async () => services,
      executionContext: { missionId: SLUG, missionWorktree: repo.root, missionBranch: 'mission', baseWorktree: repo.root, baseBranch: 'main' },
      seams: {
        routeIntegrationGateFailureFn: async () => { throw new Error('green tests must not enter repair'); },
        startAgentFn: async () => { throw new Error('green tests must not launch a repair agent'); },
        transitionTaskFn: async () => true,
        applyAgentFallbackFn: async () => 'custom',
      } });
    if (outcome.kind !== 'completed' || outcome.verdict !== 'passed') { assert.fail(JSON.stringify(outcome)); }
    const originalRunId = runState.receipt?.gateRunId;
    assert.ok(originalRunId);
    assert.equal(outcome.evidence.gateRunId, originalRunId);
    const validated = repo.head();
    assert.equal(launches, 1, 'the policy tests action launches one complete local gate batch');

    // The existing agent-review aggregate and human shortcut owner consume the
    // original receipt without replacing it.
    const review = approvedReview(SLUG);
    const round = review.rounds[0];
    const approved: Review = { ...review, rounds: [{ ...round,
      subject: { ...round.subject, revision: changeRevision(validated) },
      decision: round.decision?.kind === 'approved'
        ? { ...round.decision, revision: changeRevision(validated) }
        : round.decision,
    }] };
    const approvalMission = fixtureMission(SLUG, {
      status: 'review', assignee: agentFamily('codex'), review: approved,
    });
    const approvalStore = inMemoryTransitionStore(approvalMission);
    const approvalServices = integrationServices({
      store: approvalStore,
      lifecycle: new MissionLifecycleService(approvalStore),
    });
    const approvalContext = integrationContext({ slug: SLUG, missionStatus: 'review', missionReview: approved,
      baseWorktree: repo.root, missionWorktree: repo.root });
    const approvalPorts = stubIntegrateWorkflowPorts({
      productConfig: { resolveReviewActionLimit: () => 40 },
      gates: {
        resolveIntegrationVerificationWorktree: () => repo.root,
        captureFinalIntegrationTree: root => captureFinalIntegrationTree(root),
        loadPhaseGates: () => REBOUND_GATES,
        readGateRun: readRun,
      },
      landing: { createAbort: () => Object.assign(new Error(diagnostics.join('\n')), { name: 'IntegrationAbort' }) },
      review: { submitApproval: async (slug, _message, options) => {
        const result = await recordApproval(slug, { comment: 'Integrated by human', revision: options.reviewedRevision,
          decidedAt: '2026-11-22T10:00:00Z', source: { kind: 'local' } },
        { missionStore: options.missionServices.store, lifecycleService: options.missionServices.lifecycle });
        return result.outcome === 'failed' ? { ok: false, diagnostic: result.diagnostic } : { ok: true };
      } },
    });
    await approveEligibleIntegrationShortcut(approvalContext, await approvalStore.load(approvalMission.id),
      approvalServices, approvalPorts);
    assert.equal((await approvalStore.load(approvalMission.id)).mission.status, 'integration');
    assert.equal(runState.receipt?.gateRunId, originalRunId, 'approval preserves the original gate receipt');

    repo.commit({ 'package.json': '{\n  "version": "1.0.1"\n}\n' },
      bookkeepingCommitMessage('chore(task-2867.09): integrate pre-commit hook', 'pre-commit-hook'));

    const finalized = repo.head();
    assert.notEqual(finalized, validated, 'the verified hook moved the candidate');
    const landingState: { receipt: ReturnType<typeof readIntegrationGateRun> } = { receipt: null };
    const landingPorts = stubIntegrateWorkflowPorts({
      gates: {
        resolveIntegrationVerificationWorktree: () => repo.root,
        captureFinalIntegrationTree: root => captureFinalIntegrationTree(root),
        loadPhaseGates: () => REBOUND_GATES, loadRequirePreIntegration: () => true,
        readGateRun: checkout => { landingState.receipt = readIntegrationGateRun(checkout); return landingState.receipt; },
      },
      landing: { createAbort: message => Object.assign(new Error(message), { name: 'IntegrationAbort' }) },
    });
    assert.match(requireCurrentIntegrationTests(landingPorts, SLUG, repo.root), /2 integration test\(s\) passed/,
      'landing reads the complete original receipt');
    assert.equal(launches, 1, 'landing launches no second local gate batch');
    assert.equal(landingState.receipt?.current, true, 'the production reader proves the hook-only revision equivalent');
    assert.equal(landingState.receipt?.gateRunId, originalRunId, 'the original run identity and verdict provenance survive');
  } finally { setLogger(previous); repo.close(); }
});

// ── SC1: the rebound green-validation path persists the skip marker ──────────

const REBOUND_GATES = [
  { key: 'unit', command: 'u', order: 1 },
  { key: 'integration-ci', command: 'i', order: 2 },
];

function completeGreenReboundResult() {
  return phaseGateResult({
    gates: REBOUND_GATES,
    executed: REBOUND_GATES.length,
    outcomes: REBOUND_GATES.map(gate => ({ ...gate, exitCode: 0, stdout: '', stderr: '' })),
  });
}

test('rebound verify rerun green records the skip marker keyed on the fix commit (SC1)', async () => {
  let recorded: { value: { missionId: string; sha: string; hooks: string[] } | null } = { value: null };
  const route = await routeIntegrationGateFailure({
    slug: SLUG,
    missionWorktree: '/fw',
    failedGate: { key: 'integration-ci', command: 'int', exitCode: 1, stdout: '', stderr: '' },
    gates: REBOUND_GATES,
    implementer: 'custom',
    repositoryId: 'unknown',
    // The kernel bounces the mission active, the implementer fixes, and the
    // verify seam re-runs the identical gate set green. Replaying context.verify()
    // drives the real verify seam (my injected runPhaseGatesFn + captureFinalTreeFn)
    // so the marker is recorded, then report the bounce fixed.
    runPhaseGatesFn: async () => completeGreenReboundResult(),
    captureFinalTreeFn: () => ({ ok: true as const, rootDir: '/fw', commit: 'fixsha123', tree: 't' }),
    reboundFn: async (reason, ctx) => { await ctx.verify(1); return { attempts: 1, outcome: 'fixed', diagnostic: '', implementer: ctx.implementer, classification: classifyReboundReason(reason) }; },
    startAgentFn: async () => ({ agent: 'custom', result: { status: 0 } }),
    transitionTaskFn: async () => true,
    recordIntegrationValidationFn: async (input) => {
      recorded.value = { missionId: input.missionId, sha: input.sha, hooks: [...input.hooks] };
    },
  });
  assert.equal(route.route, 'fixed', 'routing reports the bounce fixed');
  assert.ok(recorded.value, 'the rebound green-validation path persisted the skip marker');
  assert.equal(recorded.value!.missionId, SLUG);
  assert.equal(recorded.value!.sha, 'fixsha123', 'keyed on the fix commit, not the pre-rebase head');
  assert.deepEqual(recorded.value!.hooks.sort(), ['integration-ci', 'unit'], 'every validated hook is whitelisted');
});

test('rebound verify rerun green with no recording store leaves the full suite to run next time', async () => {
  const route = await routeIntegrationGateFailure({
    slug: SLUG,
    missionWorktree: '/fw',
    failedGate: { key: 'integration-ci', command: 'int', exitCode: 1, stdout: '', stderr: '' },
    gates: REBOUND_GATES,
    implementer: 'custom',
    repositoryId: 'unknown',
    runPhaseGatesFn: async () => completeGreenReboundResult(),
    captureFinalTreeFn: () => ({ ok: true as const, rootDir: '/fw', commit: 'fixsha123', tree: 't' }),
    startAgentFn: async () => { throw new Error('Unexpected launch'); },
    transitionTaskFn: async () => { throw new Error('Unexpected transition'); },
    // Replaying verify drives the real seam; with no recordIntegrationValidationFn
    // injected the seam short-circuits the record, so an unavailable store is inert.
    reboundFn: async (reason, ctx) => { await ctx.verify(1); return { attempts: 1, outcome: 'fixed', diagnostic: '', implementer: ctx.implementer, classification: classifyReboundReason(reason) }; },
  });
  assert.equal(route.route, 'fixed');
});


// ── TASK-2872.02: integrate reads the recorded receipt over real git movement ──

/** Landing ports over a real checkout: the production reader decides whether the receipt is current or carried. */
function landingPorts(repo: ReturnType<typeof openGitRepo>) {
  return stubIntegrateWorkflowPorts({
    gates: {
      resolveIntegrationVerificationWorktree: () => repo.root,
      captureFinalIntegrationTree: root => captureFinalIntegrationTree(root),
      loadPhaseGates: () => REBOUND_GATES, loadRequirePreIntegration: () => true,
      readGateRun: checkout => readIntegrationGateRun(checkout),
    },
    landing: { createAbort: message => Object.assign(new Error(message), { name: 'IntegrationAbort' }) },
  });
}

/** Record a complete green receipt for the checkout's current head, as the tests action would. */
async function recordGreenTests(repo: ReturnType<typeof openGitRepo>) {
  const run = await createIntegrationVerificationEvidencePort().start(repo.root, REBOUND_GATES, { missionId: missionId(SLUG), operatorInvocation: false });
  assert.ok(run, 'the receipt adapter starts the run');
  run.complete(REBOUND_GATES.map(({ key, command }) => ({ key, command, exitCode: 0 })), 'passed');
}

test('a completed rebase recorded by the gate-run writer carries the recorded tests past upstream source (PX-0048, TASK-2872.02)', async () => {
  const previous = setLogger({ log: () => {}, error: () => {} });
  const repo = openGitRepo();
  try {
    repo.git('checkout', '-q', '-b', 'mission');
    repo.commit({ 'src/a.ts': 'export const a = 2;\n' }, 'fix');
    // The gate-run writer installs the completed-rebase recorder before the green receipt exists.
    await recordGreenTests(repo);
    const tested = repo.head();
    repo.git('checkout', '-q', 'main');
    repo.commit({ 'src/c.ts': 'export const c = 1;\n' }, 'upstream before landing');
    repo.git('rebase', '-q', 'main', 'mission');
    assert.notEqual(repo.head(), tested, 'the rebase moved the candidate');
    assert.match(requireCurrentIntegrationTests(landingPorts(repo), SLUG, repo.root), /2 integration test\(s\) passed/);
  } finally { setLogger(previous); repo.close(); }
});

test('a later edit after the recorded tests refuses naming tests; bookkeeping-only movement keeps them current (TASK-2646, TASK-2872.02)', async () => {
  const previous = setLogger({ log: () => {}, error: () => {} });
  const repo = openGitRepo();
  try {
    repo.git('checkout', '-q', '-b', 'mission');
    await recordGreenTests(repo);
    repo.commit({ [TASK_FILE]: 'status: review\n' }, 'backlog bookkeeping');
    assert.match(requireCurrentIntegrationTests(landingPorts(repo), SLUG, repo.root), /2 integration test\(s\) passed/);
    repo.commit({ 'src/a.ts': 'export const a = 3;\n' }, 'new implementation');
    assert.throws(() => requireCurrentIntegrationTests(landingPorts(repo), SLUG, repo.root), /needs current passing tests/);
  } finally { setLogger(previous); repo.close(); }
});

// ── durable round-trip through the real operational_history table (SC1) ───────

test('the integration-validation marker persists and reads back through the real SQLite operational_history table', async () => {
  const fixture = await openRepairFixture({ slug: 'task-2625-durable' });
  try {
    const repo = new SqliteOperationalHistoryRepository(fixture.database);
    await repo.append({
      eventType: EVENT,
      eventData: JSON.stringify({ missionId: fixture.slug, sha: fixture.approvedRevision, hooks: ['unit', 'integration-ci'] }),
      createdAt: new Date().toISOString(),
    });
    const entries = await repo.findByTypeForMission!(EVENT, fixture.slug);
    assert.equal(entries.length, 1, 'exactly one marker row for the mission');
    const marker = parseIntegrationValidationMarker(entries[0]);
    assert.equal(marker?.sha, fixture.approvedRevision, 'marker reads back the validating sha');
    assert.deepEqual(marker?.hooks, ['unit', 'integration-ci']);
  } finally {
    await fixture.close();
  }
});
test('runRequiredLocalGates records failure without green validation when the suite fails', async () => {
  const { step, operationalHistory, recorded } = makeStep({
    runPhaseGates: async () => (phaseGateResult({ ok: false as const, skipped: false, failedGate: { key: 'unit' }, error: 'red' })),
  });
  const previous = setLogger({ log: () => {}, error: () => {} });
  try {
    await assert.rejects(
      step.runRequiredLocalGates({
        slug: SLUG,
        context: integrationContext({ missionHeadSha: 'validating-sha', baseWorktree: '/fw', area: 'all', branch: `mission/${SLUG}` }),
        missionLoad: { kind: 'found', version: missionVersion(1), mission: fixtureMission(SLUG, { status: 'integration', review: null }) },
        missionServices: integrationServices({ operationalHistory }),
        realAgent: null,
        realAgentModel: null,
        seams: {
          transitionTaskFn: async () => true,
          startAgentFn: async () => { throw new Error('no launch'); },
          applyAgentFallbackFn: async () => 'custom',
          routeIntegrationGateFailureFn: async () => { throw Object.assign(new Error('red gate'), { name: 'IntegrationAbort' }); },
        },
      }),
      (error: Error) => error.name === 'IntegrationAbort',
    );
    assert.equal(recorded.filter(marker => !marker.failed).length, 0, 'no green marker recorded on a red suite');
    assert.deepEqual(recorded, [{ missionId: SLUG, sha: 'final', hooks: ['unit'], failed: true }],
      'the failed hook invalidates earlier green evidence');
  } finally { setLogger(previous); }
});
