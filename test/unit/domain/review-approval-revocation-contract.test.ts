// review approval revocation contract.
// Related scenarios share imports; each contract keeps its own hooks and mutable fixtures.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { RevokeReviewDecisionUseCase } from '../../../src/application/revoke-review-decision-use-case.js';
import { getLatestReviewForPr } from '../../../src/adapters/forgejo/forgejo.js';
import { agentFamily } from '../../../src/domain/agents.js';
import { missionId, missionLabels, type Mission } from '../../../src/domain/mission.js';
import { decideMission } from '../../../src/domain/mission-workflow.js';
import { repositoryId } from '../../../src/domain/repository.js';
import {
  applyReviewerCommand,
  changeRevision,
  ConfiguredReviewerEligibility,
  reviewFindingId,
  startReview,
  reviewStatus,
  type Review,
} from '../../../src/domain/review.js';
import fs from 'node:fs';
import path from 'node:path';
import { MissionLifecycleService } from '../../../src/application/mission-lifecycle-service.js';
import {
  missionApprovalCoverage,
  recordBranchMove,
  reportedApprovalStaleness,
  type ChangeIdentityPort,
} from '../../../src/application/approval-coverage.js';
import { BoardProjectionBuilder, type ReviewProjectionFact } from '../../../src/application/projections/board-readers.js';
import { type StatusResult } from '../../../src/application/status-command-use-case.js';
import { createStatusBoardAdapter } from '../../../src/adapters/cli/commands/status-adapter.js';
import { renderStatus, statusJson } from '../../../src/interfaces/cli/status.js';
import {
  routeIntegrationGateFailure,
  type IntegrationGateRouteOptions,
} from '../../../src/adapters/cli/commands/integrate-gate-rebound.js';
import {
  assessApprovalCoverage,
  recordApprovalSuperseded,
  staleApprovalSentence,
} from '../../../src/domain/approval-coverage.js';
import { type MissionTransitionStore } from '../../../src/application/domain-ports.js';

// Regression provenance: TASK-2543.
describe("revoke review", { concurrency: false }, () => {
  const id = missionId('task-2543');
  const review = applyReviewerCommand(startReview(
    { change: { kind: 'local-branch', sourceBranch: 'mission/task-2543', targetBranch: 'main' }, revision: changeRevision('abc') },
    agentFamily('custom'), agentFamily('codex'), '2026-01-01T00:00:00Z',
    ConfiguredReviewerEligibility.fromReviewStep({ eligible: [agentFamily('custom')], strategy: 'random' }),
  ), { type: 'approve', decidedAt: '2026-01-01T00:01:00Z', comment: null, source: { kind: 'local' } });
  const mission: Mission = { id, repositoryId: repositoryId('repo'), title: 'revoke', labels: missionLabels([]), assignee: null, checkpoints: [], review, netEngineeringLines: null, status: 'integration', closedAt: null };

  test('refused revocation does not read or mutate its store', async () => {
    let reads = 0;
    const useCase = new RevokeReviewDecisionUseCase({
      async load() { reads++; throw new Error('must not load'); },
      async save() { throw new Error('must not save'); },
    } as never, {} as never);
    const result = await useCase.execute({
      slug: 'task-2543', round: 1, reason: '', operator: 'operator',
      occurredAt: '2026-09-25T00:00:00Z', expectedVersion: 1,
    });
    assert.equal(result.status, 'failed');
    assert.equal(reads, 0);
  });

  test('an active mission without approval leaves its store, lifecycle, and provider untouched', async () => {
    let transitions = 0;
    let providerCalls = 0;
    const activeMission = { ...mission, status: 'active' as const, review: null };
    const store = { async load() { return { kind: 'found' as const, mission: activeMission, version: 1 as never }; } };
    const lifecycle = { async transition() { transitions++; throw new Error('must not transition'); } };
    const useCase = new RevokeReviewDecisionUseCase(store as never, lifecycle as never, {
      async dismissApproval() { providerCalls++; },
    });
    const result = await useCase.execute({ slug: 'task-2543', round: 1, reason: 'unfounded', operator: 'operator', occurredAt: '2026-01-01T00:02:00Z', expectedVersion: 1 });
    assert.equal(result.status, 'failed');
    assert.equal(transitions, 0);
    assert.equal(providerCalls, 0);
    assert.equal(activeMission.status, 'active');
    assert.equal(activeMission.review, null);
  });

  test('provider failure leaves local revocation durable', async () => {
    let saved: Mission | null = null;
    const store = { async load() { return { kind: 'found' as const, mission, version: 1 as never }; }, async save() { throw new Error('unused'); } };
    const lifecycle = { async transition(request: any) { saved = { ...mission, status: 'review', review: request.command.review }; return { status: 'completed', value: { mission: saved } }; } };
    const useCase = new RevokeReviewDecisionUseCase(store as never, lifecycle as never, { async dismissApproval() { throw new Error('offline'); } });
    const result = await useCase.execute({ slug: 'task-2543', round: 1, reason: 'unfounded', operator: 'operator', occurredAt: '2026-01-01T00:02:00Z', expectedVersion: 1 });
    assert.equal(result.status, 'completed');
    assert.match(result.value!.providerDiagnostic!, /provider was not updated/);
    assert.equal(saved?.status, 'review');
    assert.equal(saved?.review?.rounds.length, 2);
  });

  test('provider REQUEST_CHANGES after an agent approval keeps the mission reviewable', async () => {
    const providerReview = await getLatestReviewForPr(41, 'codex', '2026-01-01T00:00:00Z', 'fake-token', {
      apiCall: async () => ({ ok: true, data: [
        { user: { login: 'codex' }, submitted_at: '2026-01-01T00:01:00Z', state: 'APPROVED' },
        { user: { login: 'human' }, submitted_at: '2026-01-01T00:02:00Z', state: 'REQUEST_CHANGES' },
      ] }),
    });
    assert.deepEqual(providerReview, { state: 'REQUEST_CHANGES', submittedAt: '2026-01-01T00:02:00Z' });
    const requested = applyReviewerCommand(startReview(
      { change: { kind: 'local-branch', sourceBranch: 'mission/task-2543', targetBranch: 'main' }, revision: changeRevision('provider') },
      agentFamily('custom'), agentFamily('codex'), '2026-01-01T00:00:00Z',
      ConfiguredReviewerEligibility.fromReviewStep({ eligible: [agentFamily('custom')], strategy: 'random' }),
    ), {
      type: 'request-changes', decidedAt: providerReview!.submittedAt, comment: null,
      findings: [{ id: reviewFindingId('provider-finding'), summary: 'Human review wins', location: 'provider' }],
    });
    const resulting = decideMission({ ...mission, status: 'review', review: requested }, { type: 'request-changes', review: requested });
    assert.equal(resulting.status, 'active');
  });
});

// Regression provenance: TASK-2555.
describe("stand down", { concurrency: false }, () => {
  // TASK-2555: an approval that no longer covers the branch is computed from
  // recorded revisions with no operator input; it returns to review on the new
  // revision through the TASK-2543 stand-down path, is never auto-approved,
  // raises no finding, and no agent-facing prompt or automated loop path can
  // stand it down. px status, --json and the board report it, and the
  // integration gate's refusal names a reported staleness.

  const slug = 'task-2555';
  const approved = applyReviewerCommand(startReview(
    { change: { kind: 'local-branch', sourceBranch: 'mission/task-2555', targetBranch: 'main' }, revision: changeRevision('a1a1a1a') },
    agentFamily('custom'), agentFamily('codex'), '2026-09-22T00:00:00Z',
    ConfiguredReviewerEligibility.fromReviewStep({ eligible: [agentFamily('custom')], strategy: 'random' }),
  ), { type: 'approve', decidedAt: '2026-09-22T00:01:00Z', comment: null, source: { kind: 'local' } });
  const mission = {
    id: missionId(slug), repositoryId: repositoryId('repo'), title: 'Stale approval', labels: missionLabels([]),
    status: 'integration', closedAt: null, assignee: agentFamily('codex'), checkpoints: [], review: approved, netEngineeringLines: null,
  } as Mission;

  /** In-memory store with the save/transition contract the lifecycle service relies on. */
  function memoryStore(initial: Mission) {
    let current = initial;
    let version = 1;
    let saves = 0;
    const store = {
      async load() { return { kind: 'found' as const, mission: current, version: version as never }; },
      async save(next: Mission) { saves++; current = next; version++; return version as never; },
      async saveWithTransition(next: Mission) { saves++; current = next; version++; return version as never; },
    } as unknown as MissionTransitionStore;
    return { store, get current() { return current; }, get saves() { return saves; } };
  }

  const moved: ChangeIdentityPort = {
    branchHead: () => 'b2b2b2b',
    changeIdentity: (revision) => (revision === 'a1a1a1a' ? 'approved-change' : 'rescoped-change'),
  };

  test('the operator stand-down of a stale approval opens a new round for the new revision, never approved', async () => {
    const memory = memoryStore(mission);
    const result = await new RevokeReviewDecisionUseCase(memory.store, new MissionLifecycleService(memory.store), null, moved).execute({
      slug, round: 1, reason: 'The branch was re-scoped after approval', operator: 'operator', occurredAt: '2026-09-22T03:00:00Z', expectedVersion: 1,
    });
    assert.equal(result.status, 'completed', result.error?.message);
    const review = memory.current.review!;
    assert.equal(memory.current.status, 'review');
    assert.equal(reviewStatus(review), 'awaiting-review');
    assert.equal(review.rounds.length, 2);
    const [withdrawn, opened] = review.rounds;
    // The original approval stays in history, superseded and withdrawn.
    assert.equal(withdrawn.subject.revision, 'a1a1a1a');
    assert.equal(withdrawn.decision?.kind, 'approved');
    assert.equal(withdrawn.decision?.kind === 'approved' && withdrawn.decision.supersession?.supersedingRevision, 'b2b2b2b');
    assert.equal(withdrawn.decision?.kind === 'approved' && withdrawn.decision.revocation?.revokedBy, 'operator');
    // The new round reviews the revision that would land, with nothing decided and nothing owed.
    assert.equal(opened.subject.revision, 'b2b2b2b');
    assert.equal(opened.decision, null);
    assert.equal(opened.response, null);
    assert.equal(opened.disposition, null);
  });

  test('a stale approval is never requested changes: recording it keeps the approval and opens no finding', async () => {
    const memory = memoryStore(mission);
    const recording = await recordBranchMove({
      store: memory.store, slug, identity: moved, landedRevision: 'b2b2b2b', movedFrom: 'a1a1a1a', recordedBy: 'px rebase', occurredAt: '2026-09-22T02:00:00Z',
    });
    assert.equal(recording.outcome, 'recorded');
    const review = memory.current.review!;
    assert.equal(memory.current.status, 'integration');
    assert.equal(reviewStatus(review), 'approved');
    assert.equal(review.rounds.length, 1);
    assert.equal(review.rounds[0].disposition, 'APPROVED');
    assert.ok(review.rounds.every((round) => round.decision?.kind !== 'changes-requested'));
  });

  test('an automated branch move records staleness only; it never withdraws the approval', async () => {
    const memory = memoryStore(mission);
    await recordBranchMove({
      store: memory.store, slug, identity: moved, landedRevision: 'b2b2b2b', movedFrom: 'a1a1a1a', recordedBy: 'px rebase', occurredAt: '2026-09-22T02:00:00Z',
    });
    const decision = memory.current.review!.rounds[0].decision;
    assert.equal(decision?.kind === 'approved' && decision.revocation, undefined);
    assert.equal(memory.saves, 1);
  });

  test('no agent-facing prompt or review-loop module can reach the stand-down', () => {
    const root = path.resolve(import.meta.dirname, '..', '..', '..');
    const prompts = fs.readdirSync(path.join(root, 'prompts')).map((file) => path.join('prompts', file));
    const loopModules = fs.readdirSync(path.join(root, 'src/adapters/review')).map((file) => path.join('src/adapters/review', file));
    const automated = [
      ...prompts,
      ...loopModules,
      'src/application/rebase-workflow.ts',
      'src/adapters/rebase/rebase-workflow-adapter.ts',
      'src/application/approval-coverage.ts',
      'src/domain/approval-coverage.ts',
    ];
    for (const file of automated) {
      const text = fs.readFileSync(path.join(root, file), 'utf8');
      assert.ok(!/RevokeReviewDecisionUseCase|revokeApprovedDecision|type: 'revoke-approval'/.test(text), `${file} must not stand an approval down`);
      if (file.startsWith('prompts')) { assert.ok(!/revoke-review/.test(text), `${file} must not offer the stand-down to an agent`); }
    }
  });

  test('a branch move that still carries the approved change leaves the approval untouched', async () => {
    const memory = memoryStore(mission);
    const replayed: ChangeIdentityPort = { branchHead: () => 'c3c3c3c', changeIdentity: () => 'approved-change' };
    const recording = await recordBranchMove({
      store: memory.store, slug, identity: replayed, landedRevision: 'c3c3c3c', movedFrom: 'a1a1a1a', recordedBy: 'px rebase', occurredAt: '2026-09-22T02:00:00Z',
    });
    assert.equal(recording.outcome, 'covers');
    assert.equal(memory.saves, 0);
    assert.equal(memory.current, mission);
  });

  test('a refused stand-down leaves the mission, its review history and the provider unchanged', async () => {
    for (const request of [
      { round: 2, reason: 'wrong round', expectedVersion: 1 },
      { round: 1, reason: '', expectedVersion: 1 },
      { round: 1, reason: 'stale write', expectedVersion: 7 },
    ]) {
      const memory = memoryStore(mission);
      let providerCalls = 0;
      const lifecycle = new MissionLifecycleService(memory.store);
      const result = await new RevokeReviewDecisionUseCase(memory.store, lifecycle, { async dismissApproval() { providerCalls++; } }, moved).execute({
        slug, operator: 'operator', occurredAt: '2026-09-22T03:00:00Z', ...request,
      });
      assert.equal(result.status, 'failed', JSON.stringify(request));
      assert.equal(memory.saves, 0);
      assert.equal(memory.current, mission);
      assert.equal(memory.current.status, 'integration');
      assert.equal(memory.current.review!.rounds.length, 1);
      assert.equal(providerCalls, 0);
    }
  });

  // --- the staleness rule -----------------------------------------------------

  function identity(head: string | null, ids: Record<string, string>): ChangeIdentityPort {
    return { branchHead: () => head, changeIdentity: (revision) => ids[revision] ?? null };
  }

  test('an approval whose branch moved to a different change is computed stale without operator input', () => {
    const coverage = missionApprovalCoverage(approved, identity('b2b2b2b', { a1a1a1a: 'id-approved', b2b2b2b: 'id-rescoped' }));
    assert.equal(coverage?.kind, 'stale');
    assert.equal(coverage?.kind === 'stale' && coverage.landedRevision, 'b2b2b2b');
    assert.equal(coverage?.kind === 'stale' && coverage.recorded, null);
    assert.doesNotMatch(staleApprovalSentence(coverage as never), /request(ed)? changes?(?! were)/i);
  });

  test('an approval still covering its branch is reported as covering', () => {
    assert.equal(missionApprovalCoverage(approved, identity('a1a1a1a', {}))?.kind, 'covers');
    // A clean rebase replays the identical change under a new commit.
    assert.equal(missionApprovalCoverage(approved, identity('c3c3c3c', { a1a1a1a: 'same', c3c3c3c: 'same' }))?.kind, 'covers');
  });

  test('an unreadable approved revision or branch is unverifiable, not stale', () => {
    assert.equal(missionApprovalCoverage(approved, identity('b2b2b2b', { b2b2b2b: 'x' }))?.kind, 'unverifiable');
    assert.equal(missionApprovalCoverage(approved, identity(null, {}))?.kind, 'unverifiable');
  });

  test('no effective approval means no coverage question', () => {
    const open = startReview(approved.rounds[0].subject, agentFamily('custom'), agentFamily('codex'), '2026-01-01T00:00:00Z',
      ConfiguredReviewerEligibility.fromReviewStep({ eligible: [agentFamily('custom')], strategy: 'random' }));
    assert.equal(assessApprovalCoverage(open, { landedRevision: changeRevision('zzz'), sameChange: false }), null);
    assert.equal(assessApprovalCoverage(null, null), null);
  });

  test('a recorded supersession keeps the approval effective, in history, and authoritative over later observation', () => {
    const superseded = recordApprovalSuperseded(approved, { supersededAt: '2026-01-02T00:00:00Z', supersedingRevision: 'b2b2b2b', recordedBy: 'px rebase' });
    assert.equal(reviewStatus(superseded), 'approved');
    assert.equal(superseded.rounds.length, 1);
    const decision = superseded.rounds[0].decision;
    assert.equal(decision?.kind === 'approved' && decision.supersession?.supersedingRevision, 'b2b2b2b');
    const coverage = assessApprovalCoverage(superseded, { landedRevision: changeRevision('a1a1a1a'), sameChange: true });
    assert.equal(coverage?.kind, 'stale');
    assert.equal(coverage?.kind === 'stale' && coverage.recorded?.recordedBy, 'px rebase');
    // The first recorded move is the moment the approval stopped covering the work.
    assert.equal(recordApprovalSuperseded(superseded, { supersededAt: 'later', supersedingRevision: 'd4d4d4d', recordedBy: 'px rebase' }), superseded);
  });

  // --- the integration gate's refusal ---------------------------------------

  const SLUG = 'task-2555-fixture';
  function routeArgs(messages: string[], reportedStaleness: string | null): IntegrationGateRouteOptions {
    let head = { commit: 'approved-commit', tree: 'approved-tree' };
    return {
      slug: SLUG,
      missionWorktree: '/tmp/mission',
      branch: `mission/${SLUG}`,
      verificationCommand: './scripts/verify-local.sh all',
      failedGate: { key: 'integration-suite', command: 'npm run test:integration', exitCode: 1, stdout: '', stderr: 'failed' },
      gateError: 'integration-suite exited with code 1',
      gates: [{ key: 'integration-suite', command: 'npm run test:integration', order: 1 }],
      implementer: 'codex',
      repositoryId: 'parallix',
      approval: { ok: true, reviewState: 'APPROVED', reviewerApproved: true },
      reviewerUser: 'qwen',
      reportedStaleness,
      startAgentFn: (async () => { head = { commit: 'repaired-commit', tree: 'repaired-tree' }; return { agent: 'codex', result: { status: 0 } }; }) as never,
      transitionTaskFn: async () => true,
      captureFinalTreeFn: (() => ({ ok: true, rootDir: '/tmp/mission', commit: head.commit, tree: head.tree })) as never,
      runPhaseGatesFn: (async () => ({ ok: true, failedGate: null, error: null })) as never,
      invalidateApprovalFn: (async () => ({ ok: true, dismissed: ['qwen'], errors: [] })) as never,
      log: (m: string) => messages.push(m),
      error: (m: string) => messages.push(m),
      gateRunLog: () => {},
      gateRunError: () => {},
    } as unknown as IntegrationGateRouteOptions;
  }

  test('the revision-changed refusal names a staleness px rebase already reported', async () => {
    const superseded = recordApprovalSuperseded(approved, { supersededAt: '2026-09-22T01:00:00Z', supersedingRevision: 'b2b2b2b', recordedBy: 'px rebase' });
    const reported = reportedApprovalStaleness(superseded);
    assert.ok(reported);
    const messages: string[] = [];
    const route = await routeIntegrationGateFailure(routeArgs(messages, reported));
    assert.equal(route.route, 'revision-changed');
    const text = messages.join('\n');
    assert.match(text, /requires a fresh review: prior approved revision approved-commit, repaired revision repaired-commit/);
    assert.match(text, /already reported as no longer covering the branch before integration \(px status task-2555-fixture\): Approval from round 1 covers revision a1a1a1a, no longer what the branch would land \(b2b2b2b\) \(recorded by px rebase/);
  });

  test('without a reported staleness the existing refusal is unchanged', async () => {
    assert.equal(reportedApprovalStaleness(approved), null);
    const messages: string[] = [];
    const route = await routeIntegrationGateFailure(routeArgs(messages, null));
    assert.equal(route.route, 'revision-changed');
    const text = messages.join('\n');
    assert.match(text, /requires a fresh review/);
    assert.doesNotMatch(text, /already reported/);
  });

  // --- px status, px status --json and the board ------------------------------

  const statusId = missionId('task-2555');
  const statusApproved = applyReviewerCommand(startReview(
    { change: { kind: 'local-branch', sourceBranch: 'mission/task-2555', targetBranch: 'main' }, revision: changeRevision('a1a1a1a') },
    agentFamily('custom'), agentFamily('codex'), '2026-09-22T00:00:00Z',
    ConfiguredReviewerEligibility.fromReviewStep({ eligible: [agentFamily('custom')], strategy: 'random' }),
  ), { type: 'approve', decidedAt: '2026-09-22T00:01:00Z', comment: 'looks right', source: { kind: 'local' } });

  function statusMission(review: Review): Mission {
    return {
      id: statusId, repositoryId: repositoryId('parallix'), title: 'Stale approval', labels: missionLabels([]),
      status: 'integration', closedAt: null, assignee: agentFamily('codex'), checkpoints: [], review, netEngineeringLines: null,
    } as Mission;
  }

  function statusBuilder(review: Review, identity?: ChangeIdentityPort) {
    const record = statusMission(review);
    const fact: ReviewProjectionFact = { review, approval: null };
    return new BoardProjectionBuilder(
      { async loadAllMissions() { return [record]; }, async loadMission() { return record; }, getSourceFacts: () => [] },
      { async loadReviews(ids) { return new Map(ids.map((m) => [m, fact])); } },
      { async loadGateStatus() { return 'passed'; } },
      { async loadAgentAvailability() { return []; }, async loadAssignedAgent() { return null; } },
      { async loadRepositoryId() { return repositoryId('parallix'); }, async loadHeadCommit() { return 'x'; } },
      { async loadOperationLog() { return []; } },
      identity ? { changeIdentity: identity } : {},
    );
  }

  /** The found shape: the branch was rebased and re-scoped after round 1 was approved. */
  const rebasedAndRescoped: ChangeIdentityPort = {
    branchHead: () => 'b2b2b2b',
    changeIdentity: (revision) => (revision === 'a1a1a1a' ? 'approved-change' : 'rescoped-change'),
  };

  async function statusOf(review: Review, identity?: ChangeIdentityPort) {
    const board = createStatusBoardAdapter({ buildProjectionFn: async () => statusBuilder(review, identity) });
    const missionData = await board.getMissionData(statusId, '/repo');
    const result = {
      branch: 'mission/task-2555', worktree: '/repo', rebaseInfo: null, slug: statusId, missionData, prInfo: null,
      staleWorktrees: [], staleWorktreeRebase: {}, agents: [], agentOverride: undefined, lastThreeCommits: [], uncommittedCount: 0,
    } as unknown as StatusResult;
    const lines: string[] = [];
    renderStatus(result, (line) => lines.push(line));
    return { missionData, json: JSON.parse(statusJson(result)), text: lines.join('\n') };
  }

  test('a rebased approved mission in integration reports its approval stale in px status and --json', async () => {
    const { missionData, json, text } = await statusOf(statusApproved, rebasedAndRescoped);
    assert.equal(missionData?.approvalCoverage?.kind, 'stale');
    assert.equal(json.review.approvalCoverage.kind, 'stale');
    assert.equal(json.review.approvalCoverage.approvedRevision, 'a1a1a1a');
    assert.equal(json.review.approvalCoverage.landedRevision, 'b2b2b2b');
    assert.match(text, /Approval no longer covers the branch: Approval from round 1 covers revision a1a1a1a/);
    assert.match(text, /px revoke-review --decision 1 --reason <text> --operator <name>/);
    // Not a request for changes: the disposition stays APPROVED and no finding is listed.
    assert.equal(json.review.disposition, 'APPROVED');
    assert.doesNotMatch(text, /finding:/);
  });

  test('the board card flags a stale approval', async () => {
    const card = await statusBuilder(statusApproved, rebasedAndRescoped).buildMissionCard(statusId);
    assert.equal(card?.approvalCoverage?.kind, 'stale');
    assert.ok(card?.flags.some((flag) => /approval no longer covers the branch/.test(flag)));
  });

  test('an approval that still covers its branch is reported as covering, with no flag', async () => {
    const identity: ChangeIdentityPort = { branchHead: () => 'c3c3c3c', changeIdentity: () => 'same-change' };
    const card = await statusBuilder(statusApproved, identity).buildMissionCard(statusId);
    assert.equal(card?.approvalCoverage?.kind, 'covers');
    assert.deepEqual(card?.flags, []);
    const { text } = await statusOf(statusApproved, identity);
    assert.doesNotMatch(text, /no longer covers/);
  });

  test('a recorded supersession is shown in status and in the round history without reading git', async () => {
    const superseded = recordApprovalSuperseded(statusApproved, { supersededAt: '2026-09-22T01:00:00Z', supersedingRevision: 'b2b2b2b', recordedBy: 'px rebase' });
    const { json, text } = await statusOf(superseded);
    assert.equal(json.review.approvalCoverage.kind, 'stale');
    assert.equal(json.review.history[0].supersession.revision, 'b2b2b2b');
    assert.match(text, /superseded by revision b2b2b2b \(px rebase, 2026-09-22T01:00:00Z\)/);
  });
});
