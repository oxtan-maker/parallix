import { activitySnapshots } from '../../../fixtures/execution-activity.js';
import { activityFixture } from '../../../fixtures/execution-activity.js';
import { statusResult } from '../../../fixtures/status-result.js';
import { fixtureMission } from '../../../fixtures/mission-builders.js';
import { makeCard } from '../../../fixtures/board-projection.js';
// Historical regression provenance: TASK-2402, TASK-2593.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { type AgentReadAdapter, BoardProjectionBuilder, type GateReadAdapter, type GitReadAdapter, type MissionReadAdapter, type OperationLogReadAdapter, type ReviewProjectionFact, type ReviewReadAdapter } from '../../../../src/application/projections/board-readers.js';
import { EXECUTION_ACTIVITY_EVENT_TYPE, type ExecutionActivity } from '../../../../src/application/recording/execution-activity-recorder.js';
import { createStatusBoardAdapter } from '../../../../src/adapters/cli/commands/status-adapter.js';
import { agentFamily } from '../../../../src/domain/agents.js';
import { type Mission, type MissionId, missionId, missionLabels } from '../../../../src/domain/mission.js';
import { type Review, type ReviewRound, changeRevision, reviewFindingId } from '../../../../src/domain/review.js';
import { repositoryId } from '../../../../src/domain/repository.js';
import { type StatusResult } from '../../../../src/application/ports/cli-workflows.js';
import { renderStatus, statusJson } from '../../../../src/interfaces/cli/status.js';
import { type CheckpointData } from '../../../../src/domain/checkpoint.js';
import { type MissionCard, type ReviewRoundSummary } from '../../../../src/application/projections/mission-board.js';

test('mission status renders concrete orphan recovery and preserves uncertain liveness (TASK-2826)', () => {
  for (const liveness of ['orphaned', 'live', 'unconfirmed'] as const) {
    const lines: string[] = [];
    const recovery = liveness === 'orphaned'
      ? { action: 'acknowledge-and-resume' as const, humanStop: null, evidence: ['no open workflow operation', 'no live workflow, coordinator, execution or reviewer'], guidance: 'Review round is orphaned and owned work has settled, so no further stop is required. Resume with px review task-orphan.' }
      : liveness === 'unconfirmed'
        ? { action: 'refuse-unconfirmed' as const, humanStop: null, evidence: ['workflow liveness unknown'], guidance: 'Absence of owned work is unconfirmed; do not acknowledge or resume the Review yet.' }
        : null;
    const result = statusResult({ slug: 'task-orphan', missionData: { backlogStatus: 'review', reviewHistory: [],
      reviewRound: 3, reviewPhase: 'reviewing', reviewLiveness: liveness, reviewRecovery: recovery } });
    renderStatus(result, line => lines.push(line));
    if (liveness === 'orphaned') {
      assert.match(lines.join('\n'), /orphaned.*px review task-orphan/s);
      assert.doesNotMatch(lines.join('\n'), /px stop/);
    }
    else { assert.doesNotMatch(lines.join('\n'), /orphaned/); }
    if (liveness === 'unconfirmed') { assert.match(lines.join('\n'), /unconfirmed/); }
    assert.equal(JSON.parse(statusJson(result)).review?.liveness, liveness);
  }
});

test('settled MAX_ATTEMPTS review guides acknowledgment and never asks for another stop (TASK-2839)', async () => {
  // TASK-2830 shape: round 10 still reviewing, MAX_ATTEMPTS human stop, a browser stop already settled.
  const id = missionId('task-2830');
  const repo = repositoryId('parallix');
  const subject = { change: { kind: 'local-branch' as const, sourceBranch: 'mission/task-2830', targetBranch: 'main' }, revision: changeRevision('revision-ten') };
  const review = { rounds: [{ number: 10, subject, reviewer: agentFamily('codex'), implementer: agentFamily('claude'), startedAt: '2026-11-03T08:00:00.000Z',
    decision: null, response: null, phase: 'reviewing', disposition: null, reviewerRetryCount: 0, implementerRetryCount: 0 }],
  intervention: { reason: 'MAX_ATTEMPTS', requestedAt: '2026-11-03T09:00:00.000Z', requestedBy: 'workflow' }, stageLaunches: [], reviewEvents: [] } as unknown as Review;
  const mission = fixtureMission('task-2830', { status: 'review', checkpoints: [] });
  const stopped = { id: 'op-browser-stop', repositoryId: repo, missionId: id, requestKey: 'stop', command: 'review:submit', generation: 1, phase: 'stopped',
    providerStarted: true, agent: 'codex', reviewer: null, originalStatus: 'review', previousAssignee: null, owner: null,
    createdAt: '2026-11-03T09:00:00.000Z', updatedAt: '2026-11-03T09:05:00.000Z', reason: null } as const;
  const settled = { workflow: null, liveness: { workflow: false, coordinator: false, execution: false, reviewer: false } };
  const builder = new BoardProjectionBuilder(
    { async loadAllMissions() { return [mission]; }, async loadMission() { return mission; }, getSourceFacts: () => [] },
    { async loadReviews(ids) { return new Map(ids.map(each => [each, { review, approval: null }])); } },
    { async observeGate() { return 'passed'; } },
    { async loadAgentAvailability() { return []; }, async loadAssignedAgent() { return null; }, async loadRunningSessions() { return []; } },
    { async loadRepositoryId() { return repo; }, async loadHeadCommit() { return 'abc123'; } },
    { async loadOperationLog() { return []; } },
    { workflowOperations: { async latest() { return stopped; }, async latestByMission() { return [stopped]; } },
      reviewExecution: async () => settled } as ConstructorParameters<typeof BoardProjectionBuilder>[6],
  );
  const data = await createStatusBoardAdapter({ buildProjectionFn: async () => builder }).getMissionData('task-2830', '/nonexistent-task-2839');
  const result = statusResult({ slug: 'task-2830', missionData: data });
  const lines: string[] = [];
  renderStatus(result, line => lines.push(line));
  assert.match(lines.join('\n'), /acknowledge-and-resume.*MAX_ATTEMPTS.*px review task-2830/s);
  assert.doesNotMatch(lines.join('\n'), /px stop/);
  const json = JSON.parse(statusJson(result)).review;
  assert.equal(json?.recovery?.action, 'acknowledge-and-resume');
  assert.doesNotMatch(JSON.stringify(json), /px stop/);

  const attention = (await builder.build()).attentionQueue.find(item => item.missionId === id);
  assert.deepEqual(attention?.action, { kind: 'review:submit', display: 'px review task-2830' });
  assert.doesNotMatch(JSON.stringify(attention?.reason), /px stop/);

  const { showReviewStatus } = await import('../../../../src/adapters/review/review-commands.js');
  const reviewStatus: string[] = [];
  await showReviewStatus('task-2830', { log: line => reviewStatus.push(line), resolveWorktreeFn: () => '/nonexistent-task-2839',
    readReviewStateFn: async () => ({ round: 10, phase: 'reviewing', disposition: 'MAX_ATTEMPTS', metadata: { humanEscalationReason: 'MAX_ATTEMPTS' } }) as never,
    readReviewLiveness: async () => settled as never });
  assert.match(reviewStatus.join('\n'), /acknowledge-and-resume.*px review task-2830/s);
  assert.doesNotMatch(reviewStatus.join('\n'), /px stop/);
});

test('status identifies non-executable wave parents, ordered dependencies, and Large exception readiness (PX-0030)', () => {
  const waveLines: string[] = [];
  const wave = statusResult({ slug: 'task-3000', missionData: { backlogStatus: 'backlog', reviewHistory: [],
    predictedNelBucket: 'Large', wave: { role: 'parent', children: [
      { id: 'task-3000.01', dependencies: [] }, { id: 'task-3000.02', dependencies: ['task-3000.01'] },
    ] } } });
  renderStatus(wave, line => waveLines.push(line));
  assert.match(waveLines.join('\n'), /Mission wave: non-executable parent/);
  assert.match(waveLines.join('\n'), /task-3000\.01 \(no prerequisites; draft with: px draft task-3000\.01\).*task-3000\.02 \(depends on: task-3000\.01; draft with: px draft task-3000\.02\)/s);
  assert.deepEqual(JSON.parse(statusJson(wave)).wave.children[1].dependencies, ['task-3000.01']);

  const blockedLines: string[] = [];
  renderStatus(statusResult({ slug: 'task-3001', missionData: { backlogStatus: 'backlog', reviewHistory: [], predictedNelBucket: 'Large' } }),
    line => blockedLines.push(line));
  assert.match(blockedLines.join('\n'), /Large-mission readiness: BLOCKED/);
  for (const missionStatus of ['active', 'review', 'integration', 'done']) {
    const inFlightLines: string[] = [];
    renderStatus(statusResult({ slug: 'task-3001', missionData: { missionStatus, backlogStatus: missionStatus, reviewHistory: [], predictedNelBucket: 'Large' } }),
      line => inFlightLines.push(line));
    assert.doesNotMatch(inFlightLines.join('\n'), /Large-mission readiness: BLOCKED/, `${missionStatus} is past draft readiness`);
  }
  const approved = statusResult({ slug: 'task-3002', missionData: { backlogStatus: 'backlog', reviewHistory: [], predictedNelBucket: 'Large',
    largeMissionRiskException: { rationale: 'single atomic boundary', approvedBy: 'operator', approvedAt: '2026-11-04T09:00:00.000Z' } } });
  assert.equal(JSON.parse(statusJson(approved)).largeMissionRiskException.approvedBy, 'operator');
});

describe("focused Mission status reads only the selected Mission", () => {
  // TASK-2402: `px status <slug>` must answer from a focused mission read rather
  // than building the whole board. These tests observe the read boundary itself —
  // which adapter calls happen — not elapsed time.

  const repo = repositoryId('parallix');
  const selectedId = missionId('task-2402');
  const unrelatedIds = ['task-9001', 'task-9002', 'task-9003', 'task-9004'].map(missionId);

  /** Every adapter call the focused path may make, recorded for boundary assertions. */
  interface ReadLedger {
    loadAllMissionsCalls: number;
    loadedMissionIds: MissionId[];
    materializedMissionIds: MissionId[];
    reviewRequests: MissionId[][];
    gateRequests: MissionId[];
    operationLogCalls: number;
    repositoryIdCalls: number;
    agentAvailabilityCalls: number;
    currentWorkRequests: MissionId[];
  }

  function newLedger(): ReadLedger {
    return {
      loadAllMissionsCalls: 0,
      loadedMissionIds: [],
      materializedMissionIds: [],
      reviewRequests: [],
      gateRequests: [],
      operationLogCalls: 0,
      repositoryIdCalls: 0,
      agentAvailabilityCalls: 0,
      currentWorkRequests: [],
    };
  }

  function checkpoint(id: MissionId) {
    return {
      missionId: id,
      name: 'CP-2',
      rawFilename: 'CP-2.md',
      firstLine: 'CP-2: focused mission status query',
      goalCheck: [],
      nextActionText: 'Run ./scripts/verify-local.sh all',
    };
  }

  function missionRecord(id: MissionId, overrides: Partial<Mission> = {}): Mission {
    return {
      id,
      repositoryId: repo,
      title: `Mission ${id}`,
      labels: missionLabels(['user_value']),
      status: 'review',
      rawStatus: 'in_review',
      closedAt: null,
      assignee: agentFamily('codex'),
      checkpoints: [checkpoint(id)],
      review: null,
      netEngineeringLines: null,
      ...overrides,
    } as Mission;
  }

  /** A two-round review with a settled first round and an approval still owed. */
  function reviewFixture(id: MissionId): Review {
    const subject = (revision: string) => ({
      change: { kind: 'local-branch' as const, sourceBranch: `mission/${id}`, targetBranch: 'main' },
      revision: changeRevision(revision),
    });
    const round = (overrides: Partial<ReviewRound> = {}): ReviewRound => ({
      number: 1,
      subject: subject('revision-one'),
      reviewer: agentFamily('codex'),
      implementer: agentFamily('custom'),
      startedAt: '2026-08-24T08:00:00.000Z',
      decision: null,
      response: null,
      phase: 'reviewing' as const,
      disposition: null,
      reviewerRetryCount: 0,
      implementerRetryCount: 0,
      ...overrides,
    });
    const findingId = reviewFindingId('task-2402-finding');
    const disputedId = reviewFindingId('task-2402-disputed');
    return {
      rounds: [
        round({
          decision: {
            kind: 'changes-requested',
            decidedAt: '2026-08-24T08:10:00.000Z',
            comment: 'Focus the read',
            findings: [
              { id: findingId, summary: 'Board build used for one mission', location: null },
              { id: disputedId, summary: 'Unrelated metric work', location: null },
            ],
          },
          response: {
            kind: 'resolved',
            respondedAt: '2026-08-24T08:20:00.000Z',
            resolutions: [
              { findingId, kind: 'fixed', evidence: 'Focused query covers it' },
              { findingId: disputedId, kind: 'disputed', rationale: 'Owned by TASK-2400' },
            ],
            resultingRevision: changeRevision('revision-two'),
          },
          phase: 'pending-approval',
          disposition: 'CHANGES_MADE',
        }),
        round({ number: 2, subject: subject('revision-two'), phase: 'reviewing' }),
      ],
      intervention: null,
      stageLaunches: [],
      reviewEvents: [{
        position: 1,
        eventType: 'blocked_publication',
        roundNumber: 1,
        phase: 'approved',
        actor: 'workflow',
        content: '',
        disposition: null,
        verdict: null,
        itemDispositions: null,
        blockedReason: 'external-formal-approval-owed',
        followUpReference: null,
        createdAt: '2026-08-24T09:01:00.000Z',
      }],
    } as Review;
  }

  function workEvent(id: MissionId, summary: string): ExecutionActivity {
    return {
      missionId: id,
      operationId: `op-${id}`,
      phase: 'execute',
      state: 'running',
      summary,
      agent: agentFamily('codex'),
      processId: null,
      processIdentity: null,
      blockedReason: null,
      occurredAt: '2026-08-24T09:00:00.000Z',
    } as ExecutionActivity;
  }

  /**
   * A builder over a fixture board that contains the selected mission plus four
   * unrelated ones. Every read is recorded so a test can assert which missions
   * were materialized at all.
   */
  function makeFixtureBuilder(ledger: ReadLedger) {
    const all = [missionRecord(selectedId, { review: null }), ...unrelatedIds.map((id) => missionRecord(id))];
    const reviews = new Map<MissionId, ReviewProjectionFact>([
      [selectedId, { review: reviewFixture(selectedId), approval: null }],
      ...unrelatedIds.map((id) => [id, { review: null, approval: null }] as const),
    ]);

    const missions: MissionReadAdapter = {
      async loadAllMissions() {
        ledger.loadAllMissionsCalls += 1;
        for (const mission of all) { ledger.materializedMissionIds.push(mission.id); }
        return all;
      },
      async loadMission(id) {
        ledger.loadedMissionIds.push(id);
        const found = all.find((mission) => mission.id === id) ?? null;
        if (found) { ledger.materializedMissionIds.push(found.id); }
        return found;
      },
      getSourceFacts() { return [{ source: 'task-markdown', status: 'fresh' as const, value: 'loaded' }]; },
    };

    const reviewAdapter: ReviewReadAdapter = {
      async loadReviews(ids) {
        ledger.reviewRequests.push([...ids]);
        return new Map(ids.map((id) => [id, reviews.get(id) ?? { review: null, approval: null }]));
      },
    };

    const gates: GateReadAdapter = {
      async observeGate(mission) { ledger.gateRequests.push(mission.id); return 'passed'; },
    };

    const agents: AgentReadAdapter = {
      async loadAgentAvailability() {
        ledger.agentAvailabilityCalls += 1;
        return [{ family: agentFamily('codex'), launcherAvailable: true, block: { kind: 'none' } }];
      },
      async loadAssignedAgent() { return agentFamily('codex'); },
      async loadRunningSessions() { return []; },
    };

    const git: GitReadAdapter = {
      async loadRepositoryId() { ledger.repositoryIdCalls += 1; return repo; },
      async loadHeadCommit() { return 'abc123'; },
    };

    const operationLog: OperationLogReadAdapter = {
      async loadOperationLog() { ledger.operationLogCalls += 1; return []; },
    };

    return new BoardProjectionBuilder(missions, reviewAdapter, gates, agents, git, operationLog, {
      currentWork: {
        async loadCurrentWork() {
          return activitySnapshots([
            workEvent(selectedId, 'implementing focused status query'),
            ...unrelatedIds.map((id) => workEvent(id, `unrelated work on ${id}`)),
          ]);
        },
        async loadMissionCurrentWork(id) {
          ledger.currentWorkRequests.push(id);
          return activitySnapshots([workEvent(id, id === selectedId ? 'implementing focused status query' : `unrelated work on ${id}`)]);
        },
      },
      now: () => Date.parse('2026-08-24T09:00:30.000Z'),
    });
  }

  function statusBoardFor(ledger: ReadLedger) {
    const builder = makeFixtureBuilder(ledger);
    return createStatusBoardAdapter({ buildProjectionFn: async () => builder });
  }

  // ---------------------------------------------------------------------------
  // Read boundary
  // ---------------------------------------------------------------------------

  test('explicit-slug status never loads every mission to find the selected one', async () => {
    const ledger = newLedger();
    const board = statusBoardFor(ledger);

    const data = await board.getMissionData(selectedId, '/repo');

    assert.ok(data, 'the selected mission must still resolve');
    assert.equal(ledger.loadAllMissionsCalls, 0, 'loadAllMissions must not run for an explicit slug');
    assert.deepEqual(ledger.loadedMissionIds, [selectedId]);
    assert.deepEqual(ledger.currentWorkRequests, [selectedId]);
  });

  test('explicit-slug status does not materialize unrelated missions', async () => {
    const ledger = newLedger();
    const board = statusBoardFor(ledger);

    await board.getMissionData(selectedId, '/repo');

    assert.deepEqual(ledger.materializedMissionIds, [selectedId]);
    assert.deepEqual(ledger.currentWorkRequests, [selectedId]);
    for (const unrelated of unrelatedIds) {
      assert.ok(!ledger.materializedMissionIds.includes(unrelated), `${unrelated} must not be materialized`);
      assert.ok(!ledger.gateRequests.includes(unrelated), `${unrelated} gate status must not be read`);
      assert.ok(
        !ledger.reviewRequests.some((request) => request.includes(unrelated)),
        `${unrelated} review state must not be read`,
      );
    }
  });

  test('explicit-slug status skips board-wide operation log and metrics reads', async () => {
    const ledger = newLedger();
    const board = statusBoardFor(ledger);

    await board.getMissionData(selectedId, '/repo');

    assert.equal(ledger.operationLogCalls, 0, 'the operation log is board-wide, not mission status');
    assert.equal(ledger.agentAvailabilityCalls, 0, 'board agent availability is not part of the status contract');
    assert.equal(ledger.repositoryIdCalls, 0, 'repository identity is only needed to assemble a board projection');
    assert.deepEqual(ledger.reviewRequests, [[selectedId]]);
    assert.deepEqual(ledger.gateRequests, [selectedId]);
  });


  // ---------------------------------------------------------------------------
  // Contract preservation
  // ---------------------------------------------------------------------------

  test('focused mission status returns the established status contract fields', async () => {
    const ledger = newLedger();
    const board = statusBoardFor(ledger);

    const data = await board.getMissionData(selectedId, '/repo');

    assert.ok(data);
    assert.equal(data.backlogStatus, 'in_review');
    assert.equal(data.checkpoint, 'CP-2.md');
    assert.equal(data.checkpointDescription, 'CP-2: focused mission status query');
    assert.equal(data.reviewPhase, 'reviewing');
    assert.equal(data.reviewRound, 2);
    assert.equal(data.reviewDisposition, null);
    assert.equal(data.approvalOwed, true);
    assert.equal(data.reviewHistory.length, 2);
    assert.equal(data.reviewHistory[0].reviewer, agentFamily('codex'));
    assert.equal(data.reviewHistory[0].implementer, agentFamily('custom'));
    assert.equal(data.reviewHistory[0].disposition, 'CHANGES_MADE');
    assert.equal(data.reviewHistory[0].comment, 'Focus the read');
    assert.deepEqual(data.reviewHistory[0].findingSummaries, [
      'Board build used for one mission',
      'Unrelated metric work',
    ]);
    assert.match(data.reviewHistory[0].fixes[0] ?? '', /Focused query covers it/);
    assert.match(data.reviewHistory[0].pushbacks[0] ?? '', /Owned by TASK-2400/);
  });

  test('focused mission status reports the selected mission activity only', async () => {
    const ledger = newLedger();
    const board = statusBoardFor(ledger);

    const data = await board.getMissionData(selectedId, '/repo');

    assert.ok(data?.activity);
    assert.equal(data.activity.work.kind, 'working');
    assert.equal(
      (data.activity.work as { summary: string }).summary,
      'implementing focused status query',
    );
    assert.equal(data.activity.coordinator.state, 'stopped');
  });

  test('focused mission status returns null for a mission that does not exist', async () => {
    const ledger = newLedger();
    const board = statusBoardFor(ledger);

    const data = await board.getMissionData(missionId('task-9999'), '/repo');

    assert.equal(data, null);
    assert.equal(ledger.loadAllMissionsCalls, 0);
  });

  test('focused mission status reports a recorded ad-hoc Mission without a Backlog card', async () => {
    const adHocId = missionId('px-1');
    const board = createStatusBoardAdapter({
      buildProjectionFn: async () => ({
        async buildMissionCard() { return null; },
      }),
      loadMissionFn: async (slug) => slug === adHocId
        ? { mission: missionRecord(adHocId, { status: 'active', rawStatus: 'active' }), version: 3 }
        : null,
    });

    const data = await board.getMissionData(adHocId, '/repo');

    assert.equal(data?.missionStatus, 'active');
    assert.equal(data?.backlogStatus, 'active');
    assert.equal(data?.title, `Mission ${adHocId}`);
  });

  test('focused mission status matches the board projection card for the same mission', async () => {
    const focusedLedger = newLedger();
    const board = statusBoardFor(focusedLedger);
    const focused = await board.getMissionData(selectedId, '/repo');

    const boardLedger = newLedger();
    const projection = await makeFixtureBuilder(boardLedger).build();
    const card = projection.stages.flatMap((stage) => stage.cards).find((entry) => entry.id === selectedId);

    assert.ok(card);
    assert.ok(focused);
    assert.equal(focused.backlogStatus, card.rawStatus ?? card.status);
    assert.equal(focused.checkpoint, card.checkpoint);
    assert.equal(focused.checkpointDescription, card.checkpointDescription);
    assert.equal(focused.reviewPhase, card.reviewPhase);
    assert.equal(focused.reviewRound, card.reviewRound);
    assert.equal(focused.reviewDisposition, card.reviewDisposition);
    assert.equal(focused.approvalOwed, card.approvalOwed);
    assert.equal(focused.sameAgentReview, card.sameAgentReview);
    assert.equal(focused.awaitingApprovals, card.awaitingApprovals);
    assert.equal(focused.reviewHistory.length, card.reviewHistory.length);
  });

  // TASK-2846.01: the board's ReviewRoundSummary is the one review-round read
  // model. The status port used to carry a field-for-field mirror that a
  // widening map rebuilt round by round, which let the two surfaces disagree.
  test('status review history is the board ReviewRoundSummary itself, not a mirror (TASK-2846.01)', async () => {
    const focused = await statusBoardFor(newLedger()).getMissionData(selectedId, '/repo');
    const card = (await makeFixtureBuilder(newLedger()).build())
      .stages.flatMap((stage) => stage.cards).find((entry) => entry.id === selectedId);
    assert.ok(focused && card);

    // The status port's rounds are assignable to the board's own type, and the
    // two carry the same facts round for round — no field is dropped, defaulted
    // or renamed on the way through the status adapter.
    const rounds: readonly ReviewRoundSummary[] = focused.reviewHistory;
    const cardRounds: readonly ReviewRoundSummary[] = (card as MissionCard).reviewHistory;
    assert.deepEqual(rounds, cardRounds);
    assert.equal(rounds[0].phase, 'pending-approval');
    assert.equal(rounds[0].disposition, 'CHANGES_MADE');
    assert.equal(rounds[1].phase, 'reviewing');
    assert.equal(rounds[1].disposition, null);
    assert.equal(rounds[1].decidedRevision, null);

    // Presentation is unchanged by the type consolidation: an undecided round
    // still prints as pending, and every conversation field still reaches the
    // reader.
    const lines: string[] = [];
    renderStatus(statusResult({ slug: selectedId, missionData: focused }), (line) => lines.push(line));
    assert.deepEqual(lines.filter((line) => /^  Round |^    (start revision|comment|finding|fixed|pushback): /.test(line)), [
      '  Round 1 [codex -> custom]: CHANGES_MADE',
      '    start revision: revision-one; decided revision: unknown',
      '    comment: Focus the read',
      '    finding: Board build used for one mission',
      '    finding: Unrelated metric work',
      '    fixed: task-2402-finding: Focused query covers it',
      '    pushback: task-2402-disputed: Owned by TASK-2400',
      '  Round 2 [codex -> custom]: pending',
      '    start revision: revision-two; decided revision: unknown',
    ]);
  });

  // ---------------------------------------------------------------------------
  // The no-slug path keeps its repository-wide reads
  // ---------------------------------------------------------------------------

  test('board projection build still reads every mission for the no-slug status path', async () => {
    const ledger = newLedger();

    await makeFixtureBuilder(ledger).build();

    assert.equal(ledger.loadAllMissionsCalls, 1);
    assert.equal(ledger.materializedMissionIds.length, unrelatedIds.length + 1);
    assert.equal(ledger.operationLogCalls, 1);
    assert.equal(ledger.repositoryIdCalls, 1);
  });
});

describe("status lists all checkpoints and evidence", () => {
  // TASK-2593: `px status` presents every checkpoint of a Mission in execution
  // order — planned ones with what they deliver, recorded ones with every Goal
  // Check criterion and its paired evidence — not only the latest checkpoint.

  const id = missionId('task-2593');

  function cp(name: string, firstLine: string, goalCheck: CheckpointData['goalCheck'] = [], nextActionText = ''): CheckpointData {
    return { missionId: id, name, firstLine, goalCheck, nextActionText };
  }

  /** Two recorded checkpoints followed by two planned ones, stored in execution order. */
  const checkpoints: CheckpointData[] = [
    cp('CP-1', 'Add focused coverage', [
      { criterion: 'Every checkpoint is shown', criterionId: 'sc-1', evidence: 'test/unit/interfaces/cli/status-read-model-contract.test.ts' },
      { criterion: 'Evidence is shown', criterionId: null, evidence: '`npm test`' },
    ], 'Continue with CP-2'),
    cp('CP-2', 'Update the renderer', [
      { criterion: 'Renderer lists all checkpoints', criterionId: null, evidence: 'src/interfaces/cli/status.ts' },
    ], 'Continue with CP-3'),
    cp('CP-3', 'Document the view'),
    cp('CP-4', 'Run the gate'),
  ];

  async function statusResult(repair?: CheckpointData['repair']): Promise<StatusResult> {
    const mission = {
      id,
      repositoryId: repositoryId('parallix'),
      title: 'px status all checkpoints and evidence',
      successCriteria: ['Every checkpoint is shown'], successCriterionIds: ['sc-1'],
      labels: missionLabels(['user_value']),
      status: 'active',
      rawStatus: 'active',
      closedAt: null,
      assignee: agentFamily('claude'),
      checkpoints: repair ? checkpoints.map(cp => cp.name === 'CP-4' ? { ...cp, repair } : cp) : checkpoints,
      review: null,
      netEngineeringLines: null,
    } as Mission;
    const board = createStatusBoardAdapter({
      buildProjectionFn: async () => ({ async buildMissionCard() { return null; } }),
      loadMissionFn: async () => ({ mission, version: 7 }),
    });
    return {
      branch: 'mission/task-2593',
      worktree: '/repo',
      rebaseInfo: null,
      slug: 'task-2593',
      missionData: await board.getMissionData(id, '/repo'),
      prInfo: null,
      staleWorktrees: [],
      staleWorktreeRebase: {},
      agents: [],
      lastThreeCommits: [],
      uncommittedCount: 0,
    };
  }

  test('px status renders every planned and recorded checkpoint in execution order with its Goal Check evidence', async () => {
    const lines: string[] = [];
    renderStatus(await statusResult(), (msg) => lines.push(msg));

    const start = lines.indexOf('Checkpoints:');
    assert.ok(start >= 0, 'renders the checkpoint section');
    assert.deepEqual(lines.slice(start, start + 10), [
      'Checkpoints:',
      '  [x] CP-1: Add focused coverage',
      '      Goal Check: Every checkpoint is shown',
      '        Evidence: test/unit/interfaces/cli/status-read-model-contract.test.ts',
      '      Goal Check: Evidence is shown',
      '        Evidence: `npm test`',
      '  [x] CP-2: Update the renderer',
      '      Goal Check: Renderer lists all checkpoints',
      '        Evidence: src/interfaces/cli/status.ts',
      '  [ ] CP-3: Document the view',
    ]);
    assert.equal(lines[start + 10], '  [ ] CP-4: Run the gate');
    assert.ok(lines[start + 11].startsWith('Declared gates:'), 'the checkpoint section ends after the last planned checkpoint');
    assert.ok(lines.includes('Last checkpoint: CP-2'), 'the latest recorded checkpoint is still named');
  });

  test('px status --json carries every checkpoint with its Goal Check evidence', async () => {
    const json = JSON.parse(statusJson(await statusResult()));
    assert.deepEqual(json.successCriterionIds, ['sc-1']);
    assert.deepEqual(json.checkpoints, [
      {
        name: 'CP-1',
        description: 'Add focused coverage',
        recorded: true,
        goalCheck: [
          { criterion: 'Every checkpoint is shown', criterionId: 'sc-1', evidence: 'test/unit/interfaces/cli/status-read-model-contract.test.ts' },
          { criterion: 'Evidence is shown', criterionId: null, evidence: '`npm test`' },
        ],
      },
      {
        name: 'CP-2',
        description: 'Update the renderer',
        recorded: true,
        goalCheck: [{ criterion: 'Renderer lists all checkpoints', criterionId: null, evidence: 'src/interfaces/cli/status.ts' }],
      },
      { name: 'CP-3', description: 'Document the view', recorded: false, goalCheck: [] },
      { name: 'CP-4', description: 'Run the gate', recorded: false, goalCheck: [] },
    ]);
  });
  test('status names a new blocked reason and preserves the operator acknowledgment (TASK-2756)', async () => {
    const prior = { command: 'npm test', diagnostic: 'old contradiction', authorityReason: 'operator owns criteria', proposedCorrection: 'amend criterion' };
    const repair: NonNullable<CheckpointData['repair']> = {
      incidentId: 'resume', command: 'npm test', authorizedGates: ['npm test'], authorizedCriteria: ['amended'],
      attempt: 1, evidenceRecorded: false, verified: false,
      acknowledgedBlocker: prior, acknowledgedBy: 'px active operator', acknowledgedAt: '2026-10-15T08:00:00.000Z',
      blocker: { ...prior, diagnostic: 'new contradiction', proposedCorrection: 'amend new criterion' },
    };
    const result = await statusResult(repair);
    const lines: string[] = [];
    renderStatus(result, line => lines.push(line));
    assert.match(lines.join('\n'), /Blocked: new contradiction/);
    assert.match(lines.join('\n'), /Prior stop acknowledged by px active operator at 2026-10-15T08:00:00.000Z:.*old contradiction.*amend criterion/);
    assert.deepEqual(JSON.parse(statusJson(result)).checkpoints.at(-1).repair, repair);
  });

  test('status exposes durable invalid-contract blocker and harness repair state (TASK-2695)', async () => {
    const repair: NonNullable<CheckpointData['repair']> = {
      incidentId: 'incident', gateKey: 'unit', command: 'npm test', authorizedGates: ['npm test'], authorizedCriteria: [], attempt: 1,
      evidenceRecorded: false, verified: false, blocker: {
        command: 'npm test', diagnostic: 'support module rejected', authorityReason: 'operator owns checks', proposedCorrection: 'select owner',
      },
    };
    const result = await statusResult(repair);
    const lines: string[] = [];
    renderStatus(result, line => lines.push(line));
    assert.match(lines.join('\n'), /Repair incident: incident; gate unit; attempt 1; harness verified: false/);
    assert.match(lines.join('\n'), /Human review required:.*support module rejected/);
    assert.deepEqual(JSON.parse(statusJson(result)).checkpoints.at(-1).repair, repair);
  });

  test('status distinguishes carried repair rows from fresh rows by source checkpoint (TASK-2755)', async () => {
    const repaired = checkpoints.map(item => item.name === 'CP-3' ? { ...item, goalCheck: [
      { criterion: 'Every checkpoint is shown', criterionId: 'sc-1', evidence: 'npm test -- fresh' },
      { criterion: 'Evidence is shown', criterionId: null, evidence: '`npm test`', carriedFrom: 'CP-1' },
    ], nextActionText: 'verify' } : item);
    const result = await statusResult();
    const board = createStatusBoardAdapter({
      buildProjectionFn: async () => ({ async buildMissionCard() { return null; } } as any),
      loadMissionFn: async () => ({ mission: { id, checkpoints: repaired, labels: missionLabels([]) } as unknown as Mission, version: 8 }),
    });
    const projected = await board.getMissionData(id, '/repo');
    assert.deepEqual(projected?.goalCheck, repaired[2].goalCheck, 'the latest checkpoint projects provenance only on carried rows');
    const json = JSON.parse(statusJson({ ...result, missionData: projected }));
    assert.deepEqual(json.checkpoints[2].goalCheck.map((row: { carriedFrom?: string }) => row.carriedFrom ?? null), [null, 'CP-1']);
    assert.deepEqual(json.latestCheckpoint.goalCheck.map((row: { carriedFrom?: string }) => row.carriedFrom ?? null), [null, 'CP-1']);
    const lines: string[] = [];
    renderStatus({ ...result, missionData: projected }, line => lines.push(line));
    assert.ok(lines.includes('      Goal Check: Every checkpoint is shown'), lines.join('\n'));
    assert.ok(lines.includes('      Goal Check: Evidence is shown (carried from CP-1)'), lines.join('\n'));
    assert.ok(lines.includes('  Evidence is shown (carried from CP-1): `npm test`'), lines.join('\n'));
  });

});

test('status projects stored classification and distinguishes unset from unknown without card inference (TASK-2731)', async () => {
  for (const value of ['ai_sdlc', 'user_value', 'unknown', null] as const) {
    for (const stored of [true, false]) {
      const mission = fixtureMission('task-classification', { labels: missionLabels(value ? ['bug', value] : ['bug']), checkpoints: [] });
      const board = createStatusBoardAdapter({
        buildProjectionFn: async () => ({ async buildMissionCard() { return makeCard({ title: 'provider card', labels: missionLabels(['ai_sdlc']), status: 'backlog', lane: 'backlog', reviewHistory: [], currentWork: null, blockingReason: null }); } }),
        loadMissionFn: async () => stored ? { mission, version: 1 } : null,
      });
      const md = await board.getMissionData('task-classification', '/repo');
      assert.equal(md?.classification, stored ? value : null);
      const result = statusResult({ missionData: md, slug: 'task-classification' });
      assert.equal(JSON.parse(statusJson(result)).classification, stored ? value : null);
      const lines: string[] = []; renderStatus(result, line => lines.push(line));
      assert.ok(lines.includes(`Classification: ${(stored ? value : null) ?? 'unset'}`), lines.join('\n'));
    }
  }
});

test('text and JSON status expose every recorded defect provenance field', async () => {
  const defectProvenance = {
    rootCauseSummary: 'Retry ownership was inverted', investigationEvidence: 'test/retry.test.ts and commit abc',
    attribution: { kind: 'originating-mission' as const, missionId: missionId('px-0001') },
  };
  const mission = fixtureMission('px-0002', { checkpoints: [], defectProvenance });
  const board = createStatusBoardAdapter({
    buildProjectionFn: async () => ({ async buildMissionCard() { return null; } } as any),
    loadMissionFn: async () => ({ mission, version: 3 }),
  });
  const missionData = await board.getMissionData(mission.id, '/repo');
  const result = statusResult({ slug: mission.id, missionData });
  assert.deepEqual(JSON.parse(statusJson(result)).defectProvenance, defectProvenance);
  const lines: string[] = []; renderStatus(result, line => lines.push(line));
  assert.ok(lines.includes('  Root cause: Retry ownership was inverted'));
  assert.ok(lines.includes('  Investigation evidence: test/retry.test.ts and commit abc'));
  assert.ok(lines.includes('  Attribution: originating-mission (px-0001)'));
});

test('status retains stored closeout timestamp when projection is unavailable (TASK-2782)', async () => {
  const closedAt = '2026-10-19T09:15:00.000Z';
  const mission = fixtureMission('task-closed', { status: 'done', closedAt, checkpoints: [] });
  const board = createStatusBoardAdapter({
    loadMissionFn: async () => ({ mission, version: 9 }),
    buildProjectionFn: async () => { throw new Error('projection unavailable'); },
  });
  const md = await board.getMissionData('task-closed', '/fixture');
  const result = statusResult({ slug: 'task-closed', missionData: md });
  const json = JSON.parse(statusJson(result));
  assert.equal(json.missionStatus, 'done');
  assert.equal(json.closedAt, closedAt);
  assert.equal(json.version, 9);
  const lines: string[] = [];
  renderStatus(result, line => lines.push(line));
  assert.ok(lines.includes(`Closed at: ${closedAt}`));
  assert.ok(lines.includes('Mission status: done'));
});

test('status unavailable Mission source does not invent file facts (TASK-2782)', async () => {
  const board = createStatusBoardAdapter({
    loadMissionFn: async () => { throw new Error('store unavailable'); },
    buildProjectionFn: async () => { throw new Error('projection unavailable'); },
  });
  const md = await board.getMissionData('task-unavailable', '/fixture');
  assert.equal(md, null);
  const result = statusResult({ slug: 'task-unavailable', missionData: md });
  const json = JSON.parse(statusJson(result));
  assert.equal(json.missionStatus, null);
  assert.equal(json.latestCheckpoint, null);
  assert.deepEqual(json.checkpoints, []);
  const lines: string[] = [];
  renderStatus(result, line => lines.push(line));
  assert.ok(lines.includes('Mission status: unknown (projection unavailable)'));
  assert.ok(lines.includes('Last checkpoint: none'));
});

test('root status renders uncertain worktree authority without stale or cleanup advice (TASK-2801)', () => {
  const lines: string[] = [];
  renderStatus(statusResult({ staleWorktrees: [{ slug: 'task-unknown', path: '/unknown',
    branch: 'refs/heads/mission/task-unknown', taskStatus: 'unknown', uncertainty: 'Mission authority unavailable' }],
  }), line => lines.push(line));
  const output = lines.join('\n');
  assert.match(output, /Worktree state uncertain:.*unknown/);
  assert.match(output, /Uncertain: Mission authority unavailable; no cleanup advised/);
  assert.doesNotMatch(output, /Stale worktree:|Cleanup:|recover-landed/);
});
