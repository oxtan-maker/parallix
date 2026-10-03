// Mission domain contract: pure Mission invariants, authority, and outcomes.
//
// Behavior-owned suite (TASK-2622.06 pilot). Sections keep their historical
// task provenance in the describe names; every legacy case name is unchanged.
//   Mission lifecycle and review invariants: task-2294, task-2322, task-2322.09
//   Mission field and legacy-path authority: TASK-2294
//   Mission outcome and completed statistics: task-2294, task-2347.09

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { agentFamily } from '../src/domain/agents.js';
import { recordCheckpoint } from '../src/domain/checkpoint.js';
import { closeMission, missionId, missionLabels, MissionRuleViolation, recordNetEngineeringLines, requireClosedMission, type Mission, type ClosedMission } from '../src/domain/mission.js';
import { decideMission } from '../src/domain/mission-workflow.js';
import { repositoryId } from '../src/domain/repository.js';
import { applyImplementerCommand, applyReviewerCommand, beginNextReviewRound, changeRevision, ConfiguredReviewerEligibility, currentReviewRound, requestReviewIntervention, reviewFindingId, revokeApprovedDecision, reviewStatus, resumeReview, startReview, type ReviewedChange } from '../src/domain/review.js';
import { shouldResume } from '../src/domain/session.js';
import { LEGACY_INVENTORY_AUTHORITY, MISSION_FIELD_AUTHORITY, missionMutationOwner, OPERATOR_CONCERN_AUTHORITY, reconcileMissionRead } from '../src/application/mission-authority.js';
import { externalTaskRef } from '../src/domain/external-task.js';
import { MACHINE_WRITTEN_PATH_INVENTORY } from './fixtures/durable-state-inventory.js';
import { AGENT_WORK_STAGE_BY_ACTIVITY, AGENT_WORK_STAGES, ATTRIBUTED_AGENT_WORK_STAGES, completedMissionStatistics, modelInvolvement, sumMeasured, totalInputAndOutputTokens, type AgentRunMeasurement, type Measurement, type MissionOutcome } from '../src/domain/usage.js';
import { missionOutcome } from './fixtures/mission-outcome.js';
import { laneEvent, metricsAdapter } from './fixtures/metrics-adapter.js';

describe('Mission lifecycle and review invariants (task-2294, task-2322, task-2322.09)', () => {
  const id = missionId('task-2294');
  const repo = repositoryId('parallix');
  const implementer = agentFamily('configured-implementer');
  const reviewer = agentFamily('configured-reviewer');

  test('missionId accepts dotted child-task suffixes', () => {
    assert.equal(missionId('task-2322.09'), 'task-2322.09');
  });

  test('missionId rejects empty dotted segments', () => {
    assert.throws(() => missionId('task-2322..09'), /Invalid mission slug/);
  });
  const reviewerEligibility = ConfiguredReviewerEligibility.fromReviewStep({
    eligible: [reviewer],
    strategy: 'random',
  });
  const pullRequest = {
    kind: 'pull-request' as const,
    provider: 'forgejo',
    id: '152',
    url: '/pull/152',
    sourceBranch: 'mission/task-2294',
    targetBranch: 'main',
  };

  function mission(status: Mission['status'] = 'refined'): Mission {
    return {
      id,
      repositoryId: repo,
      title: 'Model the domain',
      labels: missionLabels(['user_value']),
      status,
      rawStatus: status,
      closedAt: null,
      assignee: null,
      checkpoints: [{ missionId: id, name: 'CP-1', firstLine: 'Do the work', goalCheck: [], nextActionText: '' }],
      // Draft settles this before activation; a refined mission without it cannot
      // activate (requireDraftedContract).
      brief: { goal: 'Model the domain', why: 'The model is the contract', scope: 'The domain layer', outOfScope: [] },
      declaredGates: ['npm test'],
      successCriteria: ['The mission is done'],
      predictedNelBucket: 'Small',
      review: null,
      netEngineeringLines: null,
    };
  }

  function initialReview(change: ReviewedChange = pullRequest) {
    return startReview(
      { change, revision: changeRevision('abc123') },
      reviewer,
      implementer,
      '2026-07-22T08:00:00Z',
      reviewerEligibility,
    );
  }

  function approve(review = initialReview(), comment: string | null = null) {
    return applyReviewerCommand(review, {
      type: 'approve',
      decidedAt: '2026-07-22T08:30:00Z',
      comment,
      source: { kind: 'provider', provider: 'forgejo' },
    });
  }

  const finding = {
    id: reviewFindingId('F1'),
    summary: 'State is not derived from the command protocol',
    location: 'src/domain/review.ts',
  };

  test('mission labels preserve independent and extensible dimensions', () => {
    assert.deepEqual(missionLabels(['AI_SDLC', 'bug', 'ai_sdlc']), ['ai_sdlc', 'bug']);
    assert.throws(() => missionLabels(['  ']), /cannot be empty/);
  });

  test('mission lifecycle follows the command-owned path without UI-only states', () => {
    const active = decideMission(mission(), { type: 'activate', agent: implementer });
    const withEvidence = {
      ...active,
      checkpoints: [{
        missionId: id,
        name: 'CP-1',
        rawFilename: 'CP-1.md',
        firstLine: 'CP-1: Model the domain',
        goalCheck: [{ criterion: 'model', evidence: 'test' }],
        nextActionText: 'request review',
      }],
    };
    const reviewConversation = initialReview();
    const review = decideMission(withEvidence, {
      type: 'submit-for-review',
      gatesPassed: true,
      review: reviewConversation,
      reviewerEligibility,
    });
    const approved = decideMission(review, {
      type: 'approve',
      review: approve(reviewConversation, 'Ready to integrate'),
    });
    const done = decideMission(approved, { type: 'integrate' });
    assert.deepEqual([active.status, review.status, approved.status, done.status], [
      'active', 'review', 'integration', 'done',
    ]);
    assert.equal(done.closedAt, null);
  });

  test('mission lifecycle rejects unsupported jumps and missing handoff evidence', () => {
    const approvedReview = approve();
    assert.equal(decideMission(mission('refined'), { type: 'activate', agent: implementer }).status, 'active');
    assert.throws(() => decideMission(mission('backlog'), { type: 'activate', agent: implementer }), MissionRuleViolation);
    assert.throws(
      () => decideMission(mission('backlog'), { type: 'approve', review: approvedReview }),
      MissionRuleViolation,
    );
    assert.throws(() => decideMission(mission('refined'), { type: 'integrate' }), MissionRuleViolation);
    // integrate from review is forbidden — recovery must approve (review → integration) first
    assert.throws(() => decideMission(mission('review'), { type: 'integrate' }), MissionRuleViolation);
    assert.throws(
      () => decideMission(mission('active'), {
        type: 'submit-for-review',
        gatesPassed: true,
        review: initialReview(),
        reviewerEligibility,
      }),
      /checkpoint evidence/,
    );
    assert.throws(
      () => decideMission({
        ...mission('active'),
        checkpoints: [{ missionId: id, name: 'CP-1', rawFilename: 'CP-1.md', firstLine: 'CP-1', goalCheck: [], nextActionText: 'x' }],
      }, {
        type: 'submit-for-review',
        gatesPassed: false,
        review: initialReview(),
        reviewerEligibility,
      }),
      /gates pass/,
    );
  });

  test('reviewer commands are approve or request-changes and approval may carry a comment', () => {
    const review = initialReview();
    const approved = approve(review, 'One non-blocking observation');
    assert.equal(reviewStatus(approved), 'approved');
    assert.equal(currentReviewRound(approved).decision?.kind, 'approved');
    assert.equal(currentReviewRound(approved).decision?.comment, 'One non-blocking observation');

    const changes = applyReviewerCommand(review, {
      type: 'request-changes',
      decidedAt: '2026-07-22T08:30:00Z',
      comment: 'Please address the finding',
      findings: [finding],
    });
    assert.equal(reviewStatus(changes), 'awaiting-implementation');
    assert.throws(() => applyReviewerCommand(changes, {
      type: 'approve',
      decidedAt: 'later',
      comment: null,
      source: { kind: 'local' },
    }), /awaiting-implementation/);
  });

  test('review assignment accepts only reviewers eligible in user configuration', () => {
    const configuredReviewer = agentFamily('another-configured-reviewer');
    const configuredEligibility = ConfiguredReviewerEligibility.fromReviewStep({
      eligible: [configuredReviewer],
      strategy: 'random',
    });
    assert.equal(startReview(
      { change: pullRequest, revision: changeRevision('abc123') },
      configuredReviewer,
      implementer,
      'now',
      configuredEligibility,
    ).rounds[0].reviewer, configuredReviewer);
    assert.throws(() => startReview(
      { change: pullRequest, revision: changeRevision('abc123') },
      agentFamily('legacy-default'),
      implementer,
      'now',
      configuredEligibility,
    ), /not eligible under the configured review policy/);
    assert.throws(
      () => ConfiguredReviewerEligibility.fromReviewStep(undefined),
      /explicitly configured review step/,
    );
    assert.throws(
      () => ConfiguredReviewerEligibility.fromReviewStep({ eligible: [], strategy: 'random' }),
      /at least one eligible reviewer/,
    );

    const active = {
      ...mission('active'),
      checkpoints: [{
        missionId: id,
        name: 'CP-1',
        rawFilename: 'CP-1.md',
        firstLine: 'CP-1: Review ready',
        goalCheck: [{ criterion: 'review', evidence: 'ready' }],
        nextActionText: 'request review',
      }],
    };
    assert.throws(() => decideMission(active, {
      type: 'submit-for-review',
      gatesPassed: true,
      review: initialReview(),
      reviewerEligibility: configuredEligibility,
    }), /not eligible under the configured review policy/);
  });

  test('implementer resolution accounts for every finding and opens a new revision round', () => {
    const requested = applyReviewerCommand(initialReview(), {
      type: 'request-changes',
      decidedAt: '2026-07-22T08:30:00Z',
      comment: null,
      findings: [finding],
    });
    assert.throws(() => applyImplementerCommand(requested, {
      type: 'submit-resolution',
      respondedAt: '2026-07-22T09:00:00Z',
      resolutions: [],
      resultingRevision: changeRevision('def456'),
    }), /Missing resolution for F1/);

    const resolved = applyImplementerCommand(requested, {
      type: 'submit-resolution',
      respondedAt: '2026-07-22T09:00:00Z',
      resolutions: [{
        findingId: finding.id,
        kind: 'disputed',
        rationale: 'The behavior is required by the mission',
      }],
      resultingRevision: changeRevision('def456'),
    });
    assert.equal(reviewStatus(resolved), 'ready-for-next-round');
    const next = beginNextReviewRound(
      resolved,
      reviewer,
      implementer,
      '2026-07-22T09:01:00Z',
      reviewerEligibility,
    );
    assert.equal(reviewStatus(next), 'awaiting-review');
    assert.equal(next.rounds.length, 2);
    assert.equal(currentReviewRound(next).number, 2);
    assert.equal(currentReviewRound(next).subject.revision, 'def456');
    assert.equal(next.rounds[0].response?.kind, 'resolved');
    assert.throws(() => beginNextReviewRound(
      resolved,
      agentFamily('legacy-default'),
      implementer,
      '2026-07-22T09:01:00Z',
      reviewerEligibility,
    ), /not eligible under the configured review policy/);
  });

  test('parked and blocked legacy dispositions collapse to human intervention', () => {
    const requested = applyReviewerCommand(initialReview(), {
      type: 'request-changes',
      decidedAt: '2026-07-22T08:30:00Z',
      comment: null,
      findings: [finding],
    });
    const intervention = applyImplementerCommand(requested, {
      type: 'request-human-intervention',
      requestedAt: '2026-07-22T09:00:00Z',
      reason: 'Needs an operator decision before the finding can be resolved',
    });
    assert.equal(reviewStatus(intervention), 'human-intervention');
    assert.equal(intervention.intervention?.requestedBy, 'implementer');
    assert.equal(reviewStatus(resumeReview(intervention)), 'awaiting-implementation');

    const reviewerFailure = requestReviewIntervention(initialReview(), {
      requestedAt: '2026-07-22T09:00:00Z',
      requestedBy: 'workflow',
      reason: 'Reviewer retries exhausted',
    });
    assert.equal(reviewStatus(reviewerFailure), 'human-intervention');
    assert.equal(reviewStatus(resumeReview(reviewerFailure)), 'awaiting-review');
  });

  test('mission approval must preserve the exact reviewed revision', () => {
    const active = {
      ...mission('active'),
      checkpoints: [{
        missionId: id,
        name: 'CP-1',
        rawFilename: 'CP-1.md',
        firstLine: 'CP-1: Model the domain',
        goalCheck: [{ criterion: 'model', evidence: 'test' }],
        nextActionText: 'review',
      }],
    };
    const localChange = {
      kind: 'local-branch' as const,
      sourceBranch: 'mission/task-2294',
      targetBranch: 'main',
    };
    const submitted = initialReview(localChange);
    const inReview = decideMission(active, {
      type: 'submit-for-review',
      gatesPassed: true,
      review: submitted,
      reviewerEligibility,
    });
    const wrongRevision = startReview(
      { change: localChange, revision: changeRevision('different') },
      reviewer,
      implementer,
      'now',
      reviewerEligibility,
    );
    assert.throws(() => decideMission(inReview, {
      type: 'approve',
      review: approve(wrongRevision),
    }), /exact reviewed revision/);
    assert.equal(decideMission(inReview, {
      type: 'approve',
      review: applyReviewerCommand(submitted, {
        type: 'approve',
        decidedAt: 'now',
        comment: null,
        source: { kind: 'local' },
      }),
    }).status, 'integration');
  });

  test('invalid provider identity cannot enter review', () => {
    assert.throws(() => startReview(
      {
        change: { ...pullRequest, provider: '' },
        revision: changeRevision('abc123'),
      },
      reviewer,
      implementer,
      'now',
      reviewerEligibility,
    ), /provider and its opaque id/);
  });

  test('done remains open until closeout records closure', () => {
    const integrated = mission('done');
    assert.throws(() => requireClosedMission(integrated), /not closed/);
    const closed = closeMission(integrated, '2026-07-22T10:00:00Z');
    assert.equal(requireClosedMission(closed).closedAt, '2026-07-22T10:00:00Z');
    assert.throws(() => closeMission(mission('active'), 'now'), /before integration is done/);
    assert.throws(() => closeMission(integrated, '  '), /closure time/);
    assert.throws(() => closeMission(closed, 'later'), /already closed/);
    assert.throws(() => decideMission(closed, { type: 'activate', agent: implementer }), /was closed/);
  });

  test('NEL is a replaceable mission attribute captured at handoff', () => {
    const measured = recordNetEngineeringLines(mission('active'), 91);
    assert.equal(measured.netEngineeringLines, 91);
    assert.equal(recordNetEngineeringLines(measured, 74).netEngineeringLines, 74);
    assert.throws(() => recordNetEngineeringLines(measured, -1), /non-negative integer/);
  });

  test('activation records the actual implementer and may refresh an active assignment', () => {
    const active = { ...mission('active'), assignee: implementer };
    const reassigned = decideMission(active, { type: 'activate', agent: reviewer });
    assert.equal(reassigned.status, 'active');
    assert.equal(reassigned.assignee, reviewer);
  });

  test('integration queue remains a required durable lifecycle transition', () => {
    const approvedReview = approve();
    const approved = decideMission(
      { ...mission('review'), review: initialReview() },
      { type: 'approve', review: approvedReview },
    );
    const integrated = decideMission(approved, { type: 'integrate' });
    assert.equal(approved.status, 'integration');
    assert.equal(integrated.status, 'done');
    assert.equal(integrated.closedAt, null);
  });

  test('revoking the current approval preserves it and opens a fresh review round', () => {
    const approved = approve();
    const revoked = revokeApprovedDecision(approved, 1, {
      revokedAt: '2026-07-22T09:00:00Z', revokedBy: 'operator', reason: 'The gate result was not obtained',
    });
    assert.equal(revoked.rounds.length, 2);
    assert.deepEqual(revoked.rounds[0].decision?.kind, 'approved');
    assert.equal(revoked.rounds[0].decision?.revocation?.reason, 'The gate result was not obtained');
    assert.equal(reviewStatus(revoked), 'awaiting-review');
    assert.equal(decideMission({ ...mission('integration'), review: approved }, { type: 'revoke-approval', review: revoked }).status, 'review');
    assert.throws(() => revokeApprovedDecision(approved, 2, {
      revokedAt: 'now', revokedBy: 'operator', reason: 'wrong round',
    }), /not the current effective decision/);
    assert.throws(() => revokeApprovedDecision(approved, 1, {
      revokedAt: 'now', revokedBy: 'operator', reason: '',
    }), /operator reason/);
  });

  test('recording the same checkpoint replaces stale evidence after a redo', () => {
    const first = { missionId: id, name: 'CP-1', rawFilename: 'CP-1.md', firstLine: 'CP-1: old', goalCheck: [{ criterion: 'old', evidence: 'old' }], nextActionText: 'old action' };
    const replacement = { missionId: id, name: 'CP-1', rawFilename: 'CP-1.md', firstLine: 'CP-1: new', goalCheck: [{ criterion: 'new', evidence: 'new' }], nextActionText: 'new action' };
    const checkpoints = recordCheckpoint(recordCheckpoint([], first), replacement);
    assert.equal(checkpoints.length, 1);
    assert.equal(checkpoints[0]?.nextActionText, 'new action');
  });

  test('recordCheckpoint rejects blank Goal Check text as defense in depth (TASK-2634)', () => {
    const base = { missionId: id, name: 'CP-1', firstLine: 'CP-1: x', nextActionText: 'next' };
    assert.throws(() => recordCheckpoint([], { ...base, goalCheck: [{ criterion: ' ', evidence: 'e' }] }), /goal criterion must not be empty/);
    assert.throws(() => recordCheckpoint([], { ...base, goalCheck: [{ criterion: 'c', evidence: ' ' }] }), /goal evidence must not be empty/);
  });

  test('resume marker is scoped to mission, role, and extensible agent family', () => {
    const marker = { missionId: id, role: 'execute' as const, agent: agentFamily('new-runner'), lastLaunched: 'now', sessionId: null };
    assert.equal(shouldResume(marker, id, 'execute', agentFamily('new-runner')), true);
    assert.equal(shouldResume(marker, id, 'review', agentFamily('new-runner')), false);
    assert.equal(shouldResume(marker, id, 'execute', implementer), false);
  });

  test('a draft cannot become refined on a contract never finished', () => {
    // Prompt text asking the drafting agent to check its own work is followed
    // exactly as often as it is not. Refine is where every draft ends, so that is
    // where the contract has to be complete.
    const bare = { ...mission('backlog'), brief: null, declaredGates: [], successCriteria: [], checkpoints: [] } as Mission;
    assert.throws(
      () => decideMission(bare, { type: 'refine' }),
      (error: unknown) => error instanceof MissionRuleViolation
        && /mission contract is incomplete/.test((error as Error).message)
        && /px goal set/.test((error as Error).message)
        && /px criterion add/.test((error as Error).message)
        && /px checkpoint plan/.test((error as Error).message)
        && /px gate add/.test((error as Error).message),
    );
    assert.equal(decideMission(mission('backlog'), { type: 'refine' }).status, 'refined');

    for (const [part, missing] of [
      [{ brief: { goal: 'g', why: 'w', scope: null, outOfScope: [] } }, /Missing a scope \(`px scope set`\)/],
      [{ successCriteria: [] }, /at least one success criterion \(`px criterion add`\)/],
      [{ checkpoints: [] }, /a checkpoint plan \(`px checkpoint plan`\)/],
      [{ declaredGates: [] }, /at least one verification gate/],
      [{ predictedNelBucket: null }, /a predicted NEL bucket \(`px nel set`\)/],
      [{ labels: missionLabels(['user_value', 'bug']), reproductionTest: null }, /a reproduction test for this bug mission \(`px repro set`\)/],
    ] as const) {
      const incomplete = { ...mission('backlog'), ...part } as Mission;
      assert.throws(() => decideMission(incomplete, { type: 'refine' }), missing);
      // A partly recorded contract is not a legacy mission: activation refuses it too.
      assert.throws(() => decideMission({ ...incomplete, status: 'refined' } as Mission, { type: 'activate', agent: implementer }), missing);
    }

    // out-of-scope is new, so no existing mission has one; demanding it would
    // fail missions whose contract is otherwise complete.
    const noOutOfScope = {
      ...mission('refined'),
      brief: { goal: 'g', why: 'w', scope: 's', outOfScope: [] },
    } as Mission;
    assert.equal(decideMission(noOutOfScope, { type: 'activate', agent: implementer }).status, 'active');
  });

  test('a mission drafted before the contract was Mission state still activates and relaunches', () => {
    // Its mission document, checkpoint plan and CP-N.md evidence are its
    // contract. Refusing it would strand every open legacy mission the first time
    // its agent is relaunched after a usage block or restart.
    const legacy = { ...mission('refined'), brief: null, declaredGates: [], successCriteria: [], checkpoints: [] } as Mission;
    const active = decideMission(legacy, { type: 'activate', agent: implementer });
    assert.equal(active.status, 'active');
    assert.equal(decideMission(active, { type: 'activate', agent: implementer }).status, 'active');
  });
});

describe('Mission field and legacy-path authority (TASK-2294)', () => {
  const repositoryMission: Mission = {
    id: missionId('task-2294'), repositoryId: repositoryId('parallix'), title: 'authoritative',
    labels: missionLabels(['user_value', 'bug']), status: 'active', rawStatus: 'active', closedAt: null, assignee: agentFamily('codex'),
    checkpoints: [], brief: null, declaredGates: [], successCriteria: [], completedSuccessCriteria: [], dependencies: [], predictedNelBucket: null, reproductionTest: null, review: null, netEngineeringLines: 10,
    externalTaskRef: externalTaskRef('backlog', 'TASK-2294', 'backlog/tasks/task-2294.md'),
  };

  test('authority is exhaustive over mission fields and covers the legacy path inventory', () => {
    assert.deepEqual(Object.keys(MISSION_FIELD_AUTHORITY).sort(), Object.keys(repositoryMission).sort());
    assert.equal(missionMutationOwner('status'), 'target-repository');
    assert.equal(OPERATOR_CONCERN_AUTHORITY.agentBlocks.owner, 'operator-local');
    assert.equal(OPERATOR_CONCERN_AUTHORITY.agentSelectionPolicy.owner, 'tool-owned-asset');
    const liveIds = MACHINE_WRITTEN_PATH_INVENTORY.map((entry) => entry.id).sort();
    assert.deepEqual(Object.keys(LEGACY_INVENTORY_AUTHORITY).sort(), liveIds);
  });

  test('mission reads prefer repository truth and label cache fallback stale', () => {
    const cached = { ...repositoryMission, title: 'cached', status: 'review' as const };
    assert.deepEqual(reconcileMissionRead(repositoryMission, cached), {
      mission: repositoryMission, source: 'target-repository', stale: false,
    });
    assert.deepEqual(reconcileMissionRead(null, cached), {
      mission: cached, source: 'operator-cache', stale: true,
    });
  });
});

describe('Mission outcome and completed statistics (task-2294, task-2347.09)', () => {
  const measured = <T>(value: T): Measurement<T> => ({ kind: 'measured', value });
  const unavailable = <T>(reason: string): Measurement<T> => ({ kind: 'unavailable', reason });

  function closedMission(overrides: Partial<Omit<ClosedMission, 'status' | 'closedAt'>> = {}) {
    return requireClosedMission({
      id: missionId('task-2294'),
      repositoryId: repositoryId('parallix'),
      title: 'Model the domain',
      labels: missionLabels(['ai_sdlc', 'bug']),
      status: 'done',
      rawStatus: 'done',
      closedAt: '2026-07-22T10:00:00Z',
      assignee: agentFamily('configured-implementer'),
      checkpoints: [],
      review: null,
      netEngineeringLines: 90,
      ...overrides,
    });
  }

  function run(overrides: Partial<AgentRunMeasurement> = {}): AgentRunMeasurement {
    return {
      recordedOn: '2026-07-22',
      stage: 'execute',
      role: 'implementer',
      agent: agentFamily('configured-implementer'),
      runtime: { provider: measured('configured-provider'), model: measured('configured-model') },
      durationMinutes: measured(10),
      tokens: { input: measured(100), output: measured(50), cached: measured(25), context: measured(150) },
      toolCalls: measured(4),
      providerUsage: {
        beforePercent: unavailable('not sampled'),
        afterPercent: measured(9),
        deltaPercent: unavailable('not sampled'),
      },
      costUsd: measured(1.5),
      ...overrides,
    };
  }

  function outcome(runs: readonly AgentRunMeasurement[]): MissionOutcome {
    return missionOutcome({
      missionId: missionId('task-2294'),
      repositoryId: repositoryId('parallix'),
      cycleTimeMinutes: 120,
      reviewFixRounds: 2,
      labels: missionLabels(['ai_sdlc']),
      implementer: agentFamily('configured-implementer'),
      modelsInvolved: modelInvolvement(runs),
      totalInputAndOutputTokens: totalInputAndOutputTokens(runs),
      totalCostUsd: sumMeasured(runs.map((entry) => entry.costUsd)),
      totalToolCalls: sumMeasured(runs.map((entry) => entry.toolCalls)),
      runs,
    });
  }

  test('completed mission statistics retain model involvement across stage and role', () => {
    const result = completedMissionStatistics(closedMission(), outcome([
      run(),
      run({
        stage: 'review',
        role: 'reviewer',
        agent: agentFamily('configured-reviewer'),
        runtime: { provider: measured('review-provider'), model: measured('review-model') },
        durationMinutes: measured(5),
        tokens: { input: measured(20), output: measured(10), cached: measured(5), context: measured(30) },
        costUsd: measured(0.5),
      }),
    ]));
    assert.equal(result.totalDurationMinutes, 15);
    assert.equal(result.totalInputAndOutputTokens, 180);
    assert.equal(result.totalCachedTokens, 30);
    assert.equal(result.totalContextTokens, 180);
    assert.equal(result.totalToolCalls, 8);
    assert.equal(result.totalCostUsd, 2);
    assert.equal(result.reviewFixRounds, 2);
    assert.equal(result.netEngineeringLines, 90);
    assert.equal(result.closedAt, '2026-07-22T10:00:00Z');
    assert.equal(result.implementer, 'configured-implementer');
    assert.deepEqual(result.labels, ['ai_sdlc', 'bug']);
    assert.deepEqual(result.modelsInvolved, [
      { recordedOn: '2026-07-22', stage: 'execute', role: 'implementer', agent: 'configured-implementer', provider: 'configured-provider', model: 'configured-model' },
      { recordedOn: '2026-07-22', stage: 'review', role: 'reviewer', agent: 'configured-reviewer', provider: 'review-provider', model: 'review-model' },
    ]);
  });

  test('missing provider telemetry stays unknown instead of becoming a dishonest zero', () => {
    const result = completedMissionStatistics(closedMission(), outcome([run({
      runtime: { provider: unavailable('provider not reported'), model: unavailable('model not reported') },
      tokens: { input: unavailable('provider does not report tokens'), output: measured(50), cached: measured(0), context: unavailable('not reported') },
    })]));
    assert.equal(result.totalInputAndOutputTokens, null);
    assert.equal(result.totalDurationMinutes, 10);
    assert.equal(result.modelsInvolved[0]?.provider, null);
    assert.equal(result.modelsInvolved[0]?.model, null);
  });

  test('a mission with no recorded runs reports unknown totals, not zero work', () => {
    const result = completedMissionStatistics(closedMission(), outcome([]));
    assert.equal(result.totalInputAndOutputTokens, null);
    assert.equal(result.totalDurationMinutes, null);
    assert.equal(result.totalCostUsd, null);
  });

  test('completed statistics reject mismatched identity and missing mission NEL', () => {
    assert.throws(
      () => completedMissionStatistics(closedMission(), { ...outcome([]), missionId: missionId('task-other') }),
      /identity does not match/,
    );
    assert.throws(() => completedMissionStatistics(closedMission({ netEngineeringLines: null }), outcome([])), /no NEL measurement/);
  });

  // ---------------------------------------------------------------------------
  // task-2347.09 SC1/SC2 — the cohort dimensions a comparison slices on
  // ---------------------------------------------------------------------------

  test('SC1: a constructed mission outcome carries every cohort dimension and total', () => {
    const constructed = outcome([run()]);
    for (const field of [
      'labels',
      'implementer',
      'modelsInvolved',
      'totalInputAndOutputTokens',
      'totalCostUsd',
      'totalToolCalls',
      'closedAt',
    ] as const) {
      assert.ok(field in constructed, `MissionOutcome must declare ${field}`);
      assert.notEqual(constructed[field], undefined, `MissionOutcome.${field} must be populated`);
    }
    assert.deepEqual(constructed.labels, missionLabels(['ai_sdlc']));
    assert.equal(constructed.implementer, agentFamily('configured-implementer'));
    assert.equal(constructed.totalInputAndOutputTokens, 150);
    assert.equal(constructed.totalCostUsd, 1.5);
    assert.equal(constructed.totalToolCalls, 4);
  });

  test('usage and lane rows preserve spend without guessing the final implementer', async () => {
    const repo = repositoryId('parallix');
    const task = 'task-2347.09-dimensions';
    const outcomes = await metricsAdapter(
      repo,
      [
        laneEvent(repo, task, null, 'backlog', 'create', '2026-08-01T10:00:00Z'),
        laneEvent(repo, task, 'integration', 'done', 'integrate', '2026-08-02T12:00:00Z'),
      ],
      [
        {
          date: '2026-08-01',
          repo,
          mission: task,
          classification: 'user_value',
          implementer: 'codex',
          implementer_agent: 'codex',
          stage: 'execute',
          provider: 'openai',
          model: 'gpt-5',
          input_tokens: 1000,
          output_tokens: 200,
          tool_calls: 12,
          duration_minutes: 22,
          cost_usd: 0.5,
        },
        {
          date: '2026-08-02',
          repo,
          mission: task,
          classification: 'user_value',
          implementer: 'codex',
          reviewer_agent: 'claude',
          stage: 'review',
          provider: 'anthropic',
          model: 'claude-opus-5',
          input_tokens: 800,
          output_tokens: 100,
          tool_calls: 5,
          duration_minutes: 15,
          cost_usd: 0.25,
        },
      ],
    ).readOutcomes();

    assert.equal(outcomes.length, 1);
    const projected = outcomes[0]!;
    assert.deepEqual(projected.labels, missionLabels(['user_value']));
    assert.equal(projected.implementer, null, 'Attempt telemetry is not delivery attribution');
    assert.deepEqual(
      projected.modelsInvolved.map((involvement) => [involvement.role, involvement.provider, involvement.model]),
      [['implementer', 'openai', 'gpt-5'], ['reviewer', 'anthropic', 'claude-opus-5']],
    );
    // 1000 + 200 + 800 + 100 — cached and context tokens stay out of this total.
    assert.equal(projected.totalInputAndOutputTokens, 2100);
    assert.equal(projected.totalCostUsd, 0.75);
    assert.equal(projected.totalToolCalls, 17);
    assert.equal(projected.closedAt, '2026-08-02T12:00:00Z');
  });

  test('SC2: an unmeasured column leaves the affected total unavailable, not zero', async () => {
    const repo = repositoryId('parallix');
    const task = 'task-2347.09-partial';
    const outcomes = await metricsAdapter(
      repo,
      [laneEvent(repo, task, 'integration', 'done', 'integrate', '2026-08-02T12:00:00Z')],
      [
        { date: '2026-08-01', repo, mission: task, implementer_agent: 'codex', stage: 'execute', tool_calls: 3, cost_usd: 0.1, },
        { date: '2026-08-02', repo, mission: task, implementer_agent: 'codex', stage: 'execute', input_tokens: 10, output_tokens: 5, cost_usd: 0.2, },
      ],
    ).readOutcomes();

    const projected = outcomes[0]!;
    assert.equal(projected.totalInputAndOutputTokens, null, 'a run without token columns must not report a partial total');
    assert.equal(projected.totalToolCalls, null);
    assert.ok(Math.abs((projected.totalCostUsd ?? 0) - 0.3) < 1e-9, 'cost sums across runs that do report it');
    assert.deepEqual(projected.labels, [], 'an unclassified mission carries no label rather than a guessed one');
  });

  test('known token-using activities map to explicit work stages instead of default', () => {
    assert.deepEqual(AGENT_WORK_STAGES, [
      'draft',
      'execute',
      'review-preparation',
      'review',
      'review-response',
      'conflict-resolution',
      'integration-verification',
      'default',
    ]);
    const mappedStages = Object.values(AGENT_WORK_STAGE_BY_ACTIVITY);
    assert.equal((mappedStages as readonly string[]).includes('default'), false);
    assert.deepEqual(new Set(mappedStages), new Set(ATTRIBUTED_AGENT_WORK_STAGES));
    assert.equal(AGENT_WORK_STAGE_BY_ACTIVITY['handoff-repair'], 'review-preparation');
    assert.equal(AGENT_WORK_STAGE_BY_ACTIVITY['pre-review-gate-repair'], 'review-preparation');
    assert.equal(AGENT_WORK_STAGE_BY_ACTIVITY['static-review-repair'], 'review-preparation');
    assert.equal(AGENT_WORK_STAGE_BY_ACTIVITY['review-response'], 'review-response');
    assert.equal(AGENT_WORK_STAGE_BY_ACTIVITY['conflict-resolution'], 'conflict-resolution');
    assert.equal(AGENT_WORK_STAGE_BY_ACTIVITY['integration-verification'], 'integration-verification');
  });
});
