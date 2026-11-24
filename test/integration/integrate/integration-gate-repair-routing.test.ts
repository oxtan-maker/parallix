import type { IntegrationGateFailureRequest, IntegrationGateRoute } from '../../../src/application/ports/integrate-workflow.js';
// ---------------------------------------------------------------------------
// TASK-2492 / TASK-2872.02 — the integration tests action (the only owner of gate
// execution; `px integrate` starts none) wires a failed integration gate through
// the routing module instead of dead-ending in `IntegrationAbort`.
//
// The routing module's four outcomes are covered by
// `test/unit/application/rebound-kernel-contract.test.ts` with injected seams. This
// file proves the tests-action wiring: that a red `runPhaseGates('integration', …)`
// result calls `routeIntegrationGateFailure` with the failed gate, the gate
// error, the configured gate set, a named implementer, and a transition seam.
// Re-review after a repaired candidate is owned by the review loop and its
// integration suites, not by integrate.
//
// Nothing here launches an agent, opens a database, or executes a gate: the
// routing seam is injected and returns a configurable route, the integration
// gate itself is a seam returning a fixed failed outcome, and the Git/Forgejo/
// worktree/verification boundaries are doubled exactly as the squash-hook
// bounce test does.
// ---------------------------------------------------------------------------
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mockModule, installModuleMocks } from '../../lib/module-mock.js';
import { missionExecutionContext } from '../../fixtures/mission-execution-context.js';

const git = mockModule<typeof import('../../../src/adapters/git/git.js')>('../../../src/adapters/git/git.js', import.meta.url);
const missionUtils = mockModule<typeof import('../../../src/adapters/filesystem/mission-utils.js')>('../../../src/adapters/filesystem/mission-utils.js', import.meta.url);
const backlog = mockModule<typeof import('../../../src/adapters/backlog/backlog.js')>('../../../src/adapters/backlog/backlog.js', import.meta.url);
const forgejo = mockModule<typeof import('../../../src/adapters/forgejo/forgejo.js')>('../../../src/adapters/forgejo/forgejo.js', import.meta.url);
const verification = mockModule<typeof import('../../../src/adapters/verification/verification.js')>('../../../src/adapters/verification/verification.js', import.meta.url);
const repositoryGates = mockModule<typeof import('../../../src/adapters/config/repository-gates.js')>('../../../src/adapters/config/repository-gates.js', import.meta.url);
mockModule('../../../src/adapters/git/mission-execution-context.js', import.meta.url);
const executionContext = mockModule<typeof import('../../../src/adapters/git/mission-execution-context.js')>('../../../src/adapters/git/mission-execution-context.js', import.meta.url);
const integrate = mockModule<typeof import('../../../src/adapters/cli/commands/integrate.js')>('../../../src/adapters/cli/commands/integrate.js', import.meta.url);
await installModuleMocks();

import { MissionIntegrationService } from '../../../src/application/mission-integration-service.js';
import { MissionLifecycleService } from '../../../src/application/mission-lifecycle-service.js';
import { reviewStatistics } from '../../../src/application/services/review-statistics.js';
import type { MissionStatus } from '../../../src/domain/mission.js';
import { approvedReview, inMemoryTransitionStore, integrateCommandMission } from '../../fixtures/mission-builders.js';
import { currentReviewRound, changeRevision, type Review } from '../../../src/domain/review.js';

const SLUG = 'task-2492-gate-bounce';
const LANDED_SHA = 'a11ced0000000000000000000000000000000001';

function createFakeStore(status: MissionStatus) {
  const review = status === 'review' || status === 'integration' ? approvedReview(SLUG) : null;
  const current = review ? currentReviewRound(review) : null;
  const currentRevisionReview: Review | null = review && current ? {
    ...review,
    rounds: [{ ...current, decision: { ...current.decision!, revision: changeRevision(LANDED_SHA) } }],
  } : review;
  return inMemoryTransitionStore(integrateCommandMission(SLUG, status, currentRevisionReview));
}

function servicesFor() {
  const store = createFakeStore('integration');
  return {
    store,
    lifecycle: new MissionLifecycleService(store),
    integration: new MissionIntegrationService(store),
    nel: { recordNel: async () => ({}) },
  };
}

const ok = (stdout = '') => ({ status: 0, stdout, stderr: '' });

const FAILED_GATE = {
  key: 'integration-suite',
  command: 'npm run test:integration',
  exitCode: 1,
  stdout: '',
  stderr: 'test/review-identity-placeholder.test.ts:20 failed',
};

interface Scenario {
  /** Route the injected routing seam returns for a red gate. */
  route: 'fixed' | 'exhausted' | 'mainline' | 'limit-reached' | 'stranded';
}

async function runTestsAction(scenario: Scenario) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-2492g-'));
  fs.mkdirSync(path.join(root, 'backlog', 'tasks'), { recursive: true });
  fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
    adapters: { review: { provider: 'forgejo' }, verification: { command: 'true' } },
  }));
  const taskFile = path.join(root, 'backlog', 'tasks', 'task.md');
  fs.writeFileSync(taskFile, 'status: approved\n');
  const services = servicesFor();
  const launches: string[] = [];
  const seamLaunches: string[] = [];
  const logs: string[] = [];
  const captured: IntegrationGateFailureRequest[] = [];

  mock.method(process.stdout, 'write', (chunk: string | Uint8Array) => {
    logs.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
    return true;
  });
  mock.method(process.stderr, 'write', (chunk: string | Uint8Array) => {
    logs.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
    return true;
  });

  mock.method(missionUtils, 'inferSlug', () => SLUG);
  mock.method(missionUtils, 'getPrimaryBranch', () => 'main');
  mock.method(missionUtils, 'getPrimaryWorktree', () => root);
  mock.method(missionUtils, 'findMissionDir', () => path.join(root, 'missions', SLUG));
  mock.method(missionUtils, 'findMissionArea', () => 'all');
  mock.method(missionUtils, 'conventionalWorktreePath', () => path.join(root, '..', SLUG));
  mock.method(executionContext, 'resolveMissionExecutionContext', (id: string) => ({
    ok: true as const,
    context: missionExecutionContext({ missionId: id, missionWorktree: root, baseWorktree: root, baseBranch: 'main' }),
  }));
  mock.method(missionUtils, 'resolveMainRepo', () => root);
  mock.method(missionUtils, 'missionTitle', () => 'fixture');
  mock.method(missionUtils, 'updateGraphifyKnowledgeGraph', () => false);
  mock.method(missionUtils, 'softResetTrailingBacklogNoise', () => false);
  mock.method(missionUtils, 'resolveWorktree', () => root);
  mock.method(git, 'getCurrentBranch', () => `mission/${SLUG}`);
  mock.method(git, 'git', (args: string[]) => {
    const joined = args.join(' ');
    if (args.includes('--format=%cI')) { return ok('2026-09-26T10:00:00Z\n'); }
    if (joined.includes('branch --show-current')) { return ok('main\n'); }
    if (joined.includes('status --porcelain')) { return ok(''); }
    if (args.includes('rev-parse') || args.includes('merge-base')) {
      const revision = LANDED_SHA;
      return ok(`${revision}\n`);
    }
    if (joined.includes('merge') && joined.includes('--no-commit')) { return ok(''); }
    if (joined.includes('merge') && joined.includes('--abort')) { return ok(''); }
    if (joined.includes('merge') && joined.includes('--squash')) { return ok(''); }
    if (args.includes('diff') && args.includes('--cached')) { return ok('fixture.ts\n'); }
    if (args.includes('commit')) { return ok(''); }
    return ok('');
  });
  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true as const, taskFile }));
  mock.method(backlog, 'getTaskClassification', () => 'ai_sdlc');
  mock.method(backlog, 'getTaskStatus', () => 'approved');
  mock.method(backlog, 'getTaskAssignee', () => 'codex');
  mock.method(backlog, 'completeTask', () => true);
  mock.method(backlog, 'setTaskStatus', () => true);
  mock.method(forgejo, 'getPrStatus', () => ({ exists: true as const, state: 'open', merged: false, number: 1 }));
  mock.method(forgejo, 'getLatestReviewDecision', () => ({ ok: true as const, reviewState: 'APPROVED',
    defaultUserApproved: true, defaultUserApprovedAt: '2026-09-26T09:00:00Z' }));
  mock.method(forgejo, 'readToken', () => 'token');
  mock.method(forgejo, 'resolveTokenFile', () => 'token-file');
  mock.method(forgejo, 'listOpenPrsForSlug', () => []);
  mock.method(verification, 'captureVerifiedTreeProof', () => ({ ok: true as const, proof: { rootDir: root } }));
  mock.method(verification, 'assertVerifiedTreeProof', () => ({ ok: true as const }));
  mock.method(process, 'cwd', () => root);
  let exitCode: number | undefined;
  mock.method(process, 'exit', (code?: number) => { exitCode = code; });

  // The integration gate itself is a seam: a red outcome drives the failure
  // branch. The real gate never runs in the test.
  mock.method(repositoryGates, 'loadPhaseGates', () => [
    { key: 'integration-suite', command: FAILED_GATE.command, order: 1 },
  ]);
  mock.method(repositoryGates, 'loadRequirePreIntegration', () => false);
  mock.method(repositoryGates, 'runPhaseGates', async () => ({
    ok: false,
    skipped: false,
    failedGate: FAILED_GATE,
    error: `Repository gate "${FAILED_GATE.key}" exited with code 1 for integration.`,
  }));

  const routeIntegrationGateFailureFn = mock.fn(async (args: IntegrationGateFailureRequest): Promise<IntegrationGateRoute> => {
    captured.push(args);
    if (scenario.route === 'fixed') {
      // A recoverable mission-regression route transitions the task back to
      // the implementer and relaunches exactly once.
      await args.transitionTaskFn(args.slug);
      seamLaunches.push('launched');
      return { route: 'fixed', rebounds: 1 };
    }
    return { route: scenario.route, rebounds: 0 };
  });

  let error: Error | undefined;
  try {
    await integrate.runReviewStepTests(SLUG, {
      missionServicesFn: async () => services,
      startAgentFn: async () => { launches.push('launched'); return { agent: 'codex', result: { status: 0 } }; },
      transitionTaskFn: async () => { launches.push('transitioned'); return true; },
      applyAgentFallbackFn: async ({ original }: { original: string }) => original,
      routeIntegrationGateFailureFn: routeIntegrationGateFailureFn,
    });
  } catch (e) {
    error = e as Error;
  } finally {
    mock.reset();
    fs.rmSync(root, { recursive: true, force: true });
  }
  const mission = services.store.mission();
  return { error, exitCode, launches, seamLaunches, logs, captured, mission,
    laneEvents: services.store.events.map(event => `${event.from}>${event.to}:${event.trigger}`),
    statistics: reviewStatistics(mission.review).total };
}

// A red integration gate calls the routing seam with the failed gate, the gate
// error, the configured gate set, a named implementer, and a working transition
// seam. Only a `fixed` route lets the merge proceed.
test('TASK-2492: a red integration gate routes through the seam with the failed gate and a named implementer', async () => {
  const result = await runTestsAction({ route: 'fixed' });
  assert.equal(result.captured.length, 1, 'the routing seam is called exactly once on a red gate');
  const args = result.captured[0]!;
  assert.ok(args.failedGate, 'the failed gate is passed through');
  assert.equal(args.failedGate.key, 'integration-suite');
  assert.match(String(args.gateError), /integration/i, 'the gate error is passed through');
  assert.ok(Array.isArray(args.gates), 'the configured gate set is passed through');
  assert.equal(args.implementer, 'codex', 'the named implementer is passed through');
  assert.equal(typeof args.transitionTaskFn, 'function', 'a transition seam is wired');
  assert.equal(typeof args.startAgentFn, 'function', 'a launch seam is wired');
  assert.equal(result.seamLaunches.length, 1, 'a fixed route relaunches the implementer once');
  assert.doesNotMatch(result.logs.join('\n'), /Aborting before merge/, 'a fixed route proceeds past the gate rather than aborting');
});

test('TASK-2492: a non-fixed route aborts before merge (IntegrationAbort → exit 1)', async () => {
  const result = await runTestsAction({ route: 'exhausted' });
  assert.equal(result.captured.length, 1);
  assert.match(result.logs.join('\n'), /Aborting before merge/, 'a non-fixed route aborts before the merge');
  assert.equal(result.seamLaunches.length, 0, 'the seam did not relaunch for a non-fixed route');
});

test('TASK-2492: a limit-reached route aborts before merge', async () => {
  const result = await runTestsAction({ route: 'limit-reached' });
  assert.match(result.logs.join('\n'), /Aborting before merge/);
  assert.equal(result.seamLaunches.length, 0);
});
