// review read projection contract.
// Related scenarios share imports; each contract keeps its own hooks and mutable fixtures.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { ConcreteReviewReadAdapter } from '../src/adapters/backlog/concrete-review-read-adapter.js';
import { agentFamily } from '../src/domain/agents.js';
import { missionId, missionLabels, type Mission, type MissionId } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';
import {
  missionVersion,
  type MissionStore,
  type MissionLoadResult,
  type MissionVersion,
} from '../src/application/domain-ports.js';
import {
  changeRevision,
  type Review,
  type ReviewRound,
  type ReviewFinding,
  type FindingResolution,
  type ReviewEventRecord,
} from '../src/domain/review.js';
import fs from 'node:fs';
import path from 'node:path';
import { SqliteReviewProjectionReader } from '../src/adapters/sqlite/review-projection-reader.js';
import { BoardProjectionBuilder } from '../src/application/projections/board-readers.js';
import { SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from '../src/adapters/sqlite/migration-runner.js';
import { mkdtemp as registeredMkdtemp } from './helpers/temp-dir.js';
import status from '../src/adapters/cli/commands/status.js';
import { projectReviewHistory } from '../src/application/projections/mission-board.js';

// Regression provenance: TASK-2358.
describe("multi round repro", { concurrency: false }, () => {
  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function makeRound(n: number, reviewer: string, implementer: string, phase: string, disposition: string, findings: readonly ReviewFinding[] = [], resolutions: readonly FindingResolution[] = []): ReviewRound {
    return {
      number: n,
      subject: {
        change: { kind: 'local-branch', sourceBranch: `mission/task-2358`, targetBranch: 'main' },
        revision: `rev-${n}` as any,
      },
      reviewer: agentFamily(reviewer),
      implementer: agentFamily(implementer),
      startedAt: `2026-07-2${n}T10:00:00Z`,
      decision: disposition === 'APPROVED'
        ? { kind: 'approved', decidedAt: `2026-07-2${n}T11:00:00Z`, comment: disposition, source: { kind: 'local' } }
        : findings.length
          ? { kind: 'changes-requested', decidedAt: `2026-07-2${n}T11:00:00Z`, comment: disposition, findings }
          : null,
      response: resolutions.length
        ? { kind: 'resolved', respondedAt: `2026-07-2${n}T12:00:00Z`, resolutions, resultingRevision: `rev-${n + 1}` as any }
        : null,
      phase: phase as any,
      disposition: disposition as any,
      reviewerRetryCount: 0,
      implementerRetryCount: 0,
    };
  }

  function makeReview(
    rounds: readonly ReviewRound[],
    events: readonly ReviewEventRecord[] = [],
  ): Review {
    return {
      rounds: rounds as [ReviewRound, ...ReviewRound[]],
      intervention: null,
      stageLaunches: [],
      reviewEvents: events,
    };
  }

  function makeMission(slug: string, review: Review | null): Mission {
    return {
      id: missionId(slug),
      repositoryId: repositoryId('test-repo'),
      title: `Mission ${slug}`,
      labels: missionLabels([]),
      assignee: null,
      status: 'review',
      closedAt: null,
      checkpoints: [],
      review,
      netEngineeringLines: null,
    };
  }

  // ---------------------------------------------------------------------------
  // 3-round fixture: distinct reviewer/implementer/disposition per round
  // ---------------------------------------------------------------------------

  const round1 = makeRound(
    1,
    'codex',
    'custom',
    'fixing',
    'REQUEST_CHANGES',
    [{ id: 'f1' as any, summary: 'Missing error handling', location: 'src/lib.ts:10' }],
    [{ findingId: 'f1' as any, kind: 'fixed', evidence: 'Added try/catch' }],
  );

  const round2 = makeRound(
    2,
    'claude',
    'custom',
    'fixing',
    'REQUEST_CHANGES',
    [{ id: 'f2' as any, summary: 'Incorrect type annotation', location: 'src/lib.ts:25' }],
    [{ findingId: 'f2' as any, kind: 'fixed', evidence: 'Updated type' }],
  );

  const round3 = makeRound(
    3,
    'gemini',
    'custom',
    'approved',
    'APPROVED',
  );

  const reviewEvents: ReviewEventRecord[] = [
    {
      position: 1,
      eventType: 'reviewer_findings',
      roundNumber: 1,
      phase: 'reviewing',
      actor: 'codex',
      content: 'Found missing error handling',
      disposition: 'REQUEST_CHANGES',
      verdict: null,
      itemDispositions: null,
      blockedReason: null,
      followUpReference: null,
      createdAt: '2026-07-21T11:00:00Z',
    },
    {
      position: 2,
      eventType: 'implementer_round_summary',
      roundNumber: 1,
      phase: 'fixing',
      actor: 'custom',
      content: 'Fixed error handling',
      disposition: 'CHANGES_MADE',
      verdict: null,
      itemDispositions: null,
      blockedReason: null,
      followUpReference: null,
      createdAt: '2026-07-21T12:00:00Z',
    },
    {
      position: 3,
      eventType: 'reviewer_outcome',
      roundNumber: 3,
      phase: 'approved',
      actor: 'gemini',
      content: 'All changes approved',
      disposition: 'APPROVED',
      verdict: 'approved',
      itemDispositions: null,
      blockedReason: null,
      followUpReference: null,
      createdAt: '2026-07-23T11:00:00Z',
    },
  ];

  const review3rounds = makeReview([round1, round2, round3], reviewEvents);
  const mission3rounds = makeMission('task-2358', review3rounds);

  // Mock MissionStore that returns the 3-round mission
  const mockMissionStore: MissionStore = {
    async load(_id: MissionId): Promise<MissionLoadResult> {
      return { kind: 'found', mission: mission3rounds, version: missionVersion(1) };
    },
    async save(_mission: Mission, _expectedVersion: MissionVersion | null): Promise<MissionVersion> {
      return missionVersion(2);
    },
  };

  // Mock readReviewState returns flat single-round state (current round only)
  const mockReadReviewState = () => ({
    slug: 'task-2358',
    reviewer: 'gemini',
    implementer: 'custom',
    round: 3,
    startedAt: '2026-07-23T10:00:00Z',
    phase: 'approved',
    disposition: 'APPROVED',
    reviewerRetryCount: 0,
    implementerRetryCount: 0,
    metadata: {},
    phaseOriginal: null,
  } as any);

  // ---------------------------------------------------------------------------
  // Regression test: 3-round fixture must NOT collapse to 1 round
  // ---------------------------------------------------------------------------

  test('multi-round fixture does not collapse to 1 round', async () => {
    const adapter = new ConcreteReviewReadAdapter({
      rootDir: '/tmp',
      missionStore: mockMissionStore,
      readReviewState: mockReadReviewState,
      findMissionDir: () => '/tmp/missions/task-2358',
    });

    const review = await adapter.loadReview(missionId('task-2358'));
    assert.ok(review, 'Review must not be null');

    // SC1: round count matches persisted row count
    assert.equal(review.rounds.length, 3, 'Must return all 3 persisted rounds, not collapse to 1');

    // SC2: each round carries distinct persisted values
    assert.equal(review.rounds[0].number, 1, 'Round 1 number');
    assert.equal(review.rounds[0].reviewer, 'codex', 'Round 1 reviewer');
    assert.equal(review.rounds[0].implementer, 'custom', 'Round 1 implementer');
    assert.equal(review.rounds[0].disposition, 'REQUEST_CHANGES', 'Round 1 disposition');

    assert.equal(review.rounds[1].number, 2, 'Round 2 number');
    assert.equal(review.rounds[1].reviewer, 'claude', 'Round 2 reviewer');
    assert.equal(review.rounds[1].implementer, 'custom', 'Round 2 implementer');
    assert.equal(review.rounds[1].disposition, 'REQUEST_CHANGES', 'Round 2 disposition');

    assert.equal(review.rounds[2].number, 3, 'Round 3 number');
    assert.equal(review.rounds[2].reviewer, 'gemini', 'Round 3 reviewer');
    assert.equal(review.rounds[2].implementer, 'custom', 'Round 3 implementer');
    assert.equal(review.rounds[2].disposition, 'APPROVED', 'Round 3 disposition');

    // SC3: findings populated for changes-requested rounds
    const r1Decision = review.rounds[0].decision;
    assert.equal(r1Decision?.kind, 'changes-requested', 'Round 1 decision kind');
    if (r1Decision?.kind === 'changes-requested') {
      assert.equal(r1Decision.findings.length, 1, 'Round 1 finding count');
      assert.equal(r1Decision.findings[0].summary, 'Missing error handling', 'Round 1 finding summary');
    }

    const r2Decision = review.rounds[1].decision;
    assert.equal(r2Decision?.kind, 'changes-requested', 'Round 2 decision kind');
    if (r2Decision?.kind === 'changes-requested') {
      assert.equal(r2Decision.findings.length, 1, 'Round 2 finding count');
      assert.equal(r2Decision.findings[0].summary, 'Incorrect type annotation', 'Round 2 finding summary');
    }

    // SC4: resolutions populated for responded rounds
    const r1Response = review.rounds[0].response;
    assert.ok(r1Response, 'Round 1 must have response');
    assert.equal(r1Response.resolutions.length, 1, 'Round 1 resolution count');

    const r2Response = review.rounds[1].response;
    assert.ok(r2Response, 'Round 2 must have response');
    assert.equal(r2Response.resolutions.length, 1, 'Round 2 resolution count');

    // SC5: reviewEvents populated (not hardcoded [])
    assert.equal(review.reviewEvents.length, 3, 'Must have 3 review events, not 0');
  });

  test('zero-round mission falls back to flat ReviewState', async () => {
    // Store returns mission with no review
    const emptyStore: MissionStore = {
      async load(_id: MissionId): Promise<MissionLoadResult> {
        return {
          kind: 'found',
          mission: makeMission('task-empty', null),
          version: missionVersion(1),
        };
      },
      async save(_mission: Mission, _expectedVersion: MissionVersion | null): Promise<MissionVersion> {
        return missionVersion(2);
      },
    };

    const adapter = new ConcreteReviewReadAdapter({
      rootDir: '/tmp',
      missionStore: emptyStore,
      readReviewState: () => ({
        slug: 'task-empty',
        reviewer: 'codex',
        implementer: 'custom',
        round: 1,
        startedAt: '2026-07-20T10:00:00Z',
        phase: 'reviewing',
        disposition: null,
        reviewerRetryCount: 0,
        implementerRetryCount: 0,
        metadata: {},
        phaseOriginal: null,
      } as any),
      findMissionDir: () => '/tmp/missions/task-empty',
    });

    const review = await adapter.loadReview(missionId('task-empty'));
    assert.ok(review, 'Fallback Review must not be null');
    assert.ok(review.rounds.length >= 1, 'Fallback must produce at least 1 round');
  });

  test('null missionStore falls back to flat ReviewState', async () => {
    const adapter = new ConcreteReviewReadAdapter({
      rootDir: '/tmp',
      missionStore: null,
      readReviewState: () => ({
        slug: 'task-nullstore',
        reviewer: 'codex',
        implementer: 'custom',
        round: 1,
        startedAt: '2026-07-20T10:00:00Z',
        phase: 'reviewing',
        disposition: null,
        reviewerRetryCount: 0,
        implementerRetryCount: 0,
        metadata: {},
        phaseOriginal: null,
      } as any),
      findMissionDir: () => '/tmp/missions/task-nullstore',
    });

    const review = await adapter.loadReview(missionId('task-nullstore'));
    assert.ok(review, 'Fallback Review must not be null');
    assert.ok(review.rounds.length >= 1, 'Fallback must produce at least 1 round');
  });

  // ---------------------------------------------------------------------------
  // loadReview() / loadReviewApproval() agreement (reviewApproved signal)
  // ---------------------------------------------------------------------------

  test('loadReviewApproval returns same subject revision as loadReview for approved mission', async () => {
    // Approved round with a handoff-style revision (production shape)
    const handoffRevision = changeRevision('handoff-1786439209329');
    const approvedRound: ReviewRound = {
      number: 1,
      subject: {
        change: { kind: 'local-branch', sourceBranch: 'mission/task-approved', targetBranch: 'main' },
        revision: handoffRevision,
      },
      reviewer: agentFamily('codex'),
      implementer: agentFamily('custom'),
      startedAt: '2026-07-21T10:00:00Z',
      decision: {
        kind: 'approved',
        decidedAt: '2026-07-21T11:00:00Z',
        comment: 'APPROVED',
        source: { kind: 'local' },
      },
      response: null,
      phase: 'approved',
      disposition: 'APPROVED',
      reviewerRetryCount: 0,
      implementerRetryCount: 0,
    };

    const approvedReview = makeReview([approvedRound]);
    const approvedMission = makeMission('task-approved', approvedReview);

    const store: MissionStore = {
      async load(_id: MissionId): Promise<MissionLoadResult> {
        return { kind: 'found', mission: approvedMission, version: missionVersion(1) };
      },
      async save(_mission: Mission, _expectedVersion: MissionVersion | null): Promise<MissionVersion> {
        return missionVersion(2);
      },
    };

    const adapter = new ConcreteReviewReadAdapter({
      rootDir: '/tmp',
      missionStore: store,
      readReviewState: () => null,
      findMissionDir: () => '/tmp/missions/task-approved',
    });

    const review = await adapter.loadReview(missionId('task-approved'));
    const approval = await adapter.loadReviewApproval(missionId('task-approved'));

    assert.ok(review, 'Review must not be null');
    assert.ok(approval, 'Approval must not be null for approved mission');

    // The subject revision from loadReview must match loadReviewApproval
    const reviewSubject = review.rounds[review.rounds.length - 1].subject;
    assert.equal(reviewSubject.revision, approval.subject.revision, 'Revisions must match for reviewApproved to be true');
    assert.equal(reviewSubject.change.kind, approval.subject.change.kind, 'Change kinds must match');
  });

  test('loadReviewApproval returns null for non-approved mission', async () => {
    const fixingRound = makeRound(1, 'codex', 'custom', 'fixing', 'REQUEST_CHANGES');
    const fixingReview = makeReview([fixingRound]);
    const fixingMission = makeMission('task-fixing', fixingReview);

    const store: MissionStore = {
      async load(_id: MissionId): Promise<MissionLoadResult> {
        return { kind: 'found', mission: fixingMission, version: missionVersion(1) };
      },
      async save(_mission: Mission, _expectedVersion: MissionVersion | null): Promise<MissionVersion> {
        return missionVersion(2);
      },
    };

    const adapter = new ConcreteReviewReadAdapter({
      rootDir: '/tmp',
      missionStore: store,
      readReviewState: () => null,
      findMissionDir: () => '/tmp/missions/task-fixing',
    });

    const approval = await adapter.loadReviewApproval(missionId('task-fixing'));
    assert.equal(approval, null, 'Approval must be null for non-approved mission');
  });

  test('loadReviewApproval falls back to flat ReviewState when store is null', async () => {
    const adapter = new ConcreteReviewReadAdapter({
      rootDir: '/tmp',
      missionStore: null,
      readReviewState: () => ({
        slug: 'task-fallback',
        reviewer: 'codex',
        implementer: 'custom',
        round: 1,
        startedAt: '2026-07-20T10:00:00Z',
        phase: 'approved',
        disposition: 'APPROVED',
        reviewerRetryCount: 0,
        implementerRetryCount: 0,
        metadata: {},
        phaseOriginal: null,
      } as any),
      findMissionDir: () => '/tmp/missions/task-fallback',
    });

    const approval = await adapter.loadReviewApproval(missionId('task-fallback'));
    assert.ok(approval, 'Fallback approval must not be null');
    assert.ok(approval.approvedAt, 'Fallback must carry approvedAt');
  });
});

// Regression provenance: TASK-2401.
describe("review projection queries", { concurrency: false }, () => {
  function countingDatabase() {
    const calls: string[] = [];
    return {
      calls,
      async query<T>(sql: string, ids: readonly MissionId[]): Promise<T[]> {
        calls.push(sql);
        if (!sql.includes('mission_review_rounds')) { return []; }
        return ids.map((id, position) => ({
          mission_id: id,
          position,
          round_number: 1,
          change_kind: 'local-branch',
          provider: null,
          provider_change_id: null,
          provider_url: null,
          source_branch: `mission/${id}`,
          target_branch: 'main',
          revision: `revision-${id}`,
          reviewer: 'codex',
          implementer: 'custom',
          started_at: '2026-08-23T08:00:00.000Z',
          decision_kind: 'approved',
          decided_at: '2026-08-23T08:10:00.000Z',
          decision_comment: null,
          approval_source_kind: 'local',
          approval_source_provider: null,
          responded_at: null,
          resulting_revision: null,
          phase: 'approved',
          disposition: 'APPROVED',
          reviewer_retry_count: 0,
          implementer_retry_count: 0,
          implementer_response_content: null,
          item_dispositions: null,
          blocked_reason: null,
        })) as T[];
      },
    };
  }

  test('SQLite review projection uses four queries for one or many missions', async () => {
    for (const ids of [
      [missionId('task-2401-one')],
      [missionId('task-2401-a'), missionId('task-2401-b'), missionId('task-2401-c')],
    ]) {
      const database = countingDatabase();
      const facts = await new SqliteReviewProjectionReader(database).loadReviews(ids);
      assert.equal(database.calls.length, 4);
      assert.equal(facts.size, ids.length);
      assert.ok([...facts.values()].every(({ review, approval }) => review?.rounds.length === 1 && approval !== null));
    }
  });

  test('SQLite review projection SQL executes against the migrated schema', async () => {
    const dir = registeredMkdtemp('task-2401-review-projection-');
    try {
      const database = new SqliteDatabaseAdapter();
      await database.open({ path: path.join(dir, 'operator.db') });
      await new SqliteMigrationRunner(database).applyPending(loadDefaultMigrations());
      const facts = await new SqliteReviewProjectionReader(database).loadReviews([missionId('task-2401-schema')]);
      assert.equal(facts.size, 1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('SQLite review projection chunks mission sets beyond the bind-safe batch', async () => {
    const ids = Array.from({ length: 1000 }, (_, index) => missionId(`task-2401-${index}`));
    const database = countingDatabase();
    const facts = await new SqliteReviewProjectionReader(database).loadReviews(ids);
    assert.equal(facts.size, ids.length);
    assert.equal(database.calls.length, 8);
  });

  test('SQLite-backed board review projection never loads Mission aggregates', async () => {
    const database = countingDatabase();
    let aggregateLoads = 0;
    const adapter = new ConcreteReviewReadAdapter({
      rootDir: process.cwd(),
      missionStore: {
        async load() { aggregateLoads += 1; throw new Error('aggregate load is forbidden'); },
        async save() { throw new Error('not used'); },
      },
      projectionReader: new SqliteReviewProjectionReader(database),
    });

    const id = missionId('task-2401-board');
    const builder = new BoardProjectionBuilder(
      { async loadAllMissions() { return [{ id, repositoryId: repositoryId('repo'), title: 'board', labels: missionLabels([]), status: 'review' as const, closedAt: null, assignee: agentFamily('codex'), checkpoints: [], review: null, netEngineeringLines: null }]; }, async loadMission() { return null; }, getSourceFacts() { return []; } },
      adapter,
      { async loadGateStatus() { return 'passed' as const; } },
      { async loadAgentAvailability() { return []; }, async loadAssignedAgent() { return null; } },
      { async loadRepositoryId() { return repositoryId('repo'); }, async loadHeadCommit() { return 'head'; } },
      { async loadOperationLog() { return []; } },
    );
    const projection = await builder.build();
    assert.equal(aggregateLoads, 0);
    assert.equal(database.calls.length, 4);
    assert.equal(projection.stages.flatMap((stage) => stage.cards).find((card) => card.id === id)?.reviewRound, 1);
  });
});

// Regression provenance: TASK-2344.
describe("review history status repro", { concurrency: false }, () => {
  const slug = missionId('task-2344');

  function round(
    number: number,
    reviewer: 'codex' | 'claude',
    disposition: 'PUSHBACK_ALL' | 'BLOCKED',
    finding: ReviewFinding | null,
  ): ReviewRound {
    return {
      number,
      subject: {
        change: { kind: 'local-branch', sourceBranch: 'mission/task-2344', targetBranch: 'main' },
        revision: `revision-${number}` as any,
      },
      reviewer: agentFamily(reviewer),
      implementer: agentFamily('codex'),
      startedAt: `2026-08-0${number}T10:00:00Z`,
      decision: finding ? {
        kind: 'changes-requested',
        decidedAt: `2026-08-0${number}T11:00:00Z`,
        comment: disposition,
        findings: [finding],
      } : null,
      response: number === 1 ? {
        kind: 'resolved',
        respondedAt: '2026-08-01T12:00:00Z',
        resultingRevision: 'revision-2' as any,
        resolutions: [
          { findingId: 'finding-fixed' as any, kind: 'fixed', evidence: 'guard added' },
          { findingId: 'finding-pushback' as any, kind: 'disputed', rationale: 'already covered' },
        ],
      } : null,
      phase: number === 1 ? 'fixing' : 'reviewing',
      disposition,
      reviewerRetryCount: 0,
      implementerRetryCount: 0,
    };
  }

  test('px status task-2344 renders every persisted review round with earlier findings and resolutions', async () => {
    const rounds = [
      round(1, 'codex', 'PUSHBACK_ALL', {
        id: 'finding-fixed' as any,
        summary: 'earlier-round finding',
        location: 'src/example.ts:1',
      }),
      round(2, 'claude', 'BLOCKED', null),
    ] as [ReviewRound, ...ReviewRound[]];
    const review: Review = {
      rounds,
      intervention: null,
      stageLaunches: [],
      reviewEvents: [],
    };
    const mission: Mission = {
      id: slug,
      repositoryId: repositoryId('task-2344-test'),
      title: 'Review history status regression',
      labels: missionLabels(['bug']),
      assignee: null,
      status: 'review',
      closedAt: null,
      checkpoints: [],
      review,
      netEngineeringLines: null,
    };
    const store: MissionStore = {
      async load(_id: MissionId): Promise<MissionLoadResult> {
        return { kind: 'found', mission, version: missionVersion(1) };
      },
      async save(_mission: Mission, _expectedVersion: MissionVersion | null): Promise<MissionVersion> {
        return missionVersion(1);
      },
    };
    const persistedReview = await new ConcreteReviewReadAdapter({
      rootDir: process.cwd(),
      missionStore: store,
      readReviewState: () => null,
    }).loadReview(slug);
    assert.ok(persistedReview);

    const lines: string[] = [];
    await status(['task-2344'], {
      log: (line: string) => lines.push(line),
      exit: () => {},
      inferSlugFn: () => 'task-2344',
      getCurrentBranchFn: () => 'mission/task-2344',
      detectRebaseStateFn: () => ({ inProgress: false, detached: false, unmergedFiles: [] }),
      getPrStatusFn: () => ({ exists: false }),
      readAgentConfigOrExitFn: () => ({}),
      eligibleAgentsForStepFn: () => [],
      allWorkflowAgentNamesFn: () => [],
      workflowLauncherStatusFn: () => ({ supported: true }),
      getLastThreeCommitsFn: () => [],
      getUncommittedCountFn: () => 0,
      buildProjectionFn: async () => ({
        build: async () => ({
          stages: [{ cards: [{
            id: slug,
            status: 'review',
            rawStatus: 'review',
            checkpoint: null,
            checkpointDescription: null,
            reviewRound: 2,
            reviewPhase: 'reviewing',
            reviewDisposition: 'BLOCKED',
            reviewHistory: projectReviewHistory(persistedReview),
          }] }],
        }),
      }),
    });

    const output = lines.join('\n');
    assert.match(output, /Round 1 \[codex -> codex\]: PUSHBACK_ALL/);
    assert.match(output, /Round 2 \[claude -> codex\]: BLOCKED/);
    assert.match(output, /finding: earlier-round finding/);
    assert.match(output, /fixed: finding-fixed: guard added/);
    assert.match(output, /pushback: finding-pushback: already covered/);
  });
});
