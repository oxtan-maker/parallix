// Contract: the identity behind the historical analytics cache. A warm board
// build must be able to answer "is the cached summary still current?" from
// compact durable facts, so the cache key and the delivery revision never
// serialize the Mission review/checkpoint aggregates or hash whole history rows.
// Invalidation still moves when any fact the summary is derived from moves.
import test from 'node:test';
import assert from 'node:assert/strict';

import { emptyBoardRepositories } from '../../../helpers/empty-board-repositories.js';
import { fixtureMission, pendingReview, requestedChangesReview } from '../../../fixtures/mission-builders.js';
import { HistoricalBoardMetrics } from '../../../../src/application/projections/historical-board-metrics.js';
import {
  ConcreteMetricsReadAdapter, type MetricsReadAdapter,
} from '../../../../src/application/projections/metrics-read-adapter.js';
import { USAGE_IDENTITY_COLUMNS } from '../../../../src/application/projections/metrics-delivery-identity.js';
import { buildBoardMetrics } from '../../../../src/application/projections/board.js';
import { measuredValue } from '../../../../src/domain/usage.js';
import { missionId, missionLabels, type Mission } from '../../../../src/domain/mission.js';
import { repositoryId } from '../../../../src/domain/repository.js';
import type { BoardLaneEventRepository } from '../../../../src/application/ports/operation-history.js';
import type { BoardLaneEventEntry } from '../../../../src/application/ports/operation-history.js';
import type { UsageRecord, UsageRepository } from '../../../../src/application/ports/mission-measurements.js';
import { currentReviewRound, replaceCurrentRound } from '../../../../src/domain/review.js';

const repo = repositoryId('parallix');
const id = missionId('task-2854-identity');
const NOW = Date.parse('2026-11-12T12:00:00Z');
const settle = () => new Promise<void>(resolve => setImmediate(resolve));

/** Counted seam: `JSON.stringify` of the aggregate increments `reads`. */
function counted<T extends object>(value: T, reads: { count: number }): T {
  return Object.defineProperty(value, 'toJSON', {
    value: () => { reads.count += 1; return Array.isArray(value) ? [...value] : { ...value }; },
    enumerable: false, configurable: true,
  }) as T;
}

function summary(throughput: number) {
  return buildBoardMetrics({
    cumulativeFlow: { series: [], missingHistoryFallback: 'skip' },
    medianStateTimes: { series: [], missingHistoryFallback: 'skip' },
    reviewBounceRate: { series: [], missingHistoryFallback: 'skip' },
    throughput: { series: [{ at: '2026-11-12T00:00:00Z', value: throughput }], missingHistoryFallback: 'skip' },
  });
}

function analytics(throughputs: number[]) {
  const historical = new HistoricalBoardMetrics({
    metricsAdapter: {
      async buildMetrics() { const next = throughputs.length + 1; throughputs.push(next); return summary(next); },
    } as MetricsReadAdapter,
    now: () => NOW,
  });
  return historical;
}

function analyticsInput(missions: readonly Mission[], evidenceRevision: string) {
  return { repositoryId: repo, missions, agentAvailability: [], nowMs: NOW, deliveries: new Map(), evidenceRevision };
}

test('unchanged analytics build reuses the revision identity without serializing review or checkpoint evidence (TASK-2854.03)', async () => {
  const reviewReads = { count: 0 }; const checkpointReads = { count: 0 };
  const mission = fixtureMission('task-2854-identity', {
    repositoryId: repo, labels: missionLabels([]), status: 'active', closedAt: null,
    review: counted(pendingReview('task-2854-identity'), reviewReads),
    checkpoints: counted(fixtureMission('task-2854-identity').checkpoints, checkpointReads),
  });
  const reconstructions: number[] = [];
  const historical = analytics(reconstructions);
  const input = analyticsInput([mission], 'evidence-v1');

  const cold = await historical.build(input, true);
  const warm = await historical.build(input);

  assert.equal(cold.analytics?.freshness, 'fresh');
  assert.equal(warm.analytics?.freshness, 'fresh', 'an unchanged build keeps the cached historical summary');
  assert.equal(warm.analytics?.revision, cold.analytics?.revision, 'an unchanged build reports the same analytics revision');
  assert.deepEqual(reconstructions, [1], 'the unchanged warm build does not reconstruct the summary');
  assert.equal(reviewReads.count, 0, 'the analytics identity reads review facts, never the review aggregate');
  assert.equal(checkpointReads.count, 0, 'the analytics identity reads checkpoint facts, never the checkpoint aggregate');
});

test('analytics identity moves on review judgment, new checkpoint evidence and moved durable evidence (TASK-2854.03)', async () => {
  const reconstructions: number[] = [];
  const historical = analytics(reconstructions);
  const base = fixtureMission('task-2854-identity', { repositoryId: repo, status: 'active', checkpoints: [], review: null });
  const build = async (mission: Mission, evidenceRevision = 'evidence-v1') =>
    (await historical.build(analyticsInput([mission], evidenceRevision), true)).analytics;

  assert.equal((await build(base))?.freshness, 'fresh');
  assert.deepEqual(reconstructions, [1]);

  const reviewed = { ...base, review: pendingReview('task-2854-identity') };
  assert.equal((await build(reviewed))?.freshness, 'fresh');
  assert.deepEqual(reconstructions, [1, 2], 'a new review aggregate reconstructs the summary');

  const judged = { ...reviewed, review: requestedChangesReview('task-2854-identity', { startedAt: '2026-11-10T10:00:00Z', decidedAt: '2026-11-11T10:00:00Z' }) };
  assert.equal((await build(judged))?.freshness, 'fresh');
  assert.deepEqual(reconstructions, [1, 2, 3], 'a recorded reviewer judgment reconstructs the summary');

  const checkpointed = { ...judged, checkpoints: fixtureMission('task-2854-identity').checkpoints };
  assert.equal((await build(checkpointed))?.freshness, 'fresh');
  assert.deepEqual(reconstructions, [1, 2, 3, 4], 'a new checkpoint reconstructs the summary');

  assert.equal((await build(checkpointed, 'evidence-v2'))?.freshness, 'fresh');
  assert.deepEqual(reconstructions, [1, 2, 3, 4, 5], 'moved durable evidence reconstructs the summary');
  await settle();
});

test('analytics identity ignores review prose the summary never reads (TASK-2854.03)', async () => {
  const reconstructions: number[] = [];
  const historical = analytics(reconstructions);
  const review = requestedChangesReview('task-2854-identity', { startedAt: '2026-11-10T10:00:00Z', decidedAt: '2026-11-11T10:00:00Z' });
  const mission = fixtureMission('task-2854-identity', { repositoryId: repo, status: 'active', checkpoints: [], review });
  assert.equal((await historical.build(analyticsInput([mission], 'evidence-v1'), true)).analytics?.freshness, 'fresh');
  assert.deepEqual(reconstructions, [1]);

  // Audit prose and round summaries are board text; the historical summary is
  // derived from decisions, revisions and timestamps only.
  const amended = {
    ...mission,
    review: {
      ...review,
      rounds: replaceCurrentRound(review, { ...currentReviewRound(review), implementerResponseContent: 'a much longer round summary' }),
      reviewEvents: review.reviewEvents.map(event => ({ ...event, content: `${event.content} amended audit prose` })),
    },
  };
  const warm = await historical.build(analyticsInput([amended], 'evidence-v1'));
  assert.equal(warm.analytics?.freshness, 'fresh', 'review prose does not invalidate the historical summary');
  assert.deepEqual(reconstructions, [1], 'review prose does not reconstruct the summary');
});

test('delivery revision stays stable without hashing full lane and usage rows (TASK-2854.03)', async () => {
  const laneReads = { count: 0 }; const usageReads = { count: 0 };
  let evidenceRevision = 'history-v1';
  const laneRows: BoardLaneEventEntry[] = [
    { id: 1, repositoryId: 'parallix', missionId: 'task-2854-identity', fromStatus: null, toStatus: 'active', trigger: 'activate', agent: 'codex', occurredAt: '2026-11-10T08:00:00Z', idempotencyKey: 'intake' },
    { id: 2, repositoryId: 'parallix', missionId: 'task-2854-identity', fromStatus: 'integration', toStatus: 'done', trigger: 'integrate', agent: 'codex', occurredAt: '2026-11-11T09:00:00Z', idempotencyKey: 'delivered' },
  ].map(row => counted(row, laneReads));
  const usageRows: UsageRecord[] = [
    { repo: 'parallix', mission: 'task-2854-identity', date: '2026-11-11', duration_minutes: 12 },
  ].map(row => counted(row, usageReads));
  const laneEventRepo: BoardLaneEventRepository = {
    ...emptyBoardRepositories().laneEventRepo,
    findByRepositoryId: async () => laneRows,
  };
  const usageRepo: UsageRepository = {
    ...emptyBoardRepositories().usageRepo,
    findWhere: async () => usageRows,
  };
  const adapter = new ConcreteMetricsReadAdapter({
    laneEventRepo, usageRepo, repositoryId: repo,
    evidenceRevision: async () => evidenceRevision,
  });

  const first = await adapter.readDeliveryIdentity();
  const second = await adapter.readDeliveryIdentity();

  assert.deepEqual(first.deliveries, [{ missionId: id, closedAt: '2026-11-11T09:00:00.000Z' }]);
  assert.equal(second.revision, first.revision, 'unchanged durable evidence keeps the analytics revision');
  assert.equal(laneReads.count, 0, 'the delivery revision reads row keys, never whole lane rows');
  assert.equal(usageReads.count, 0, 'the delivery revision reads row keys, never whole usage rows');

  evidenceRevision = 'history-v2';
  const moved = await adapter.readDeliveryIdentity();
  assert.notEqual(moved.revision, second.revision, 'moved durable history moves the analytics revision');

  laneRows.push({ id: 3, repositoryId: 'parallix', missionId: 'task-2854-identity', fromStatus: 'done', toStatus: 'active', trigger: 'reopen', agent: 'codex', occurredAt: '2026-11-12T07:00:00Z', idempotencyKey: 'reopened' });
  const appended = await adapter.readDeliveryIdentity();
  assert.notEqual(appended.revision, moved.revision, 'a new lane transition moves the analytics revision');
});

test('delivery revision moves when a retained usage row is rewritten in place (TASK-2854.03)', async () => {
  const usageReads = { count: 0 };
  const usageRow = (overrides: Partial<UsageRecord>): UsageRecord => counted(
    { repo: 'parallix', mission: 'task-2854-identity', date: '2026-11-11', stage: 'implement', duration_minutes: 12, cost_usd: 1, input_tokens: 100, ...overrides },
    usageReads,
  );
  let usageRows: UsageRecord[] = [usageRow({})];
  const laneRows: BoardLaneEventEntry[] = [
    { id: 1, repositoryId: 'parallix', missionId: 'task-2854-identity', fromStatus: null, toStatus: 'active', trigger: 'activate', agent: 'codex', occurredAt: '2026-11-10T08:00:00Z', idempotencyKey: 'intake' },
    { id: 2, repositoryId: 'parallix', missionId: 'task-2854-identity', fromStatus: 'integration', toStatus: 'done', trigger: 'integrate', agent: 'codex', occurredAt: '2026-11-11T09:00:00Z', idempotencyKey: 'delivered' },
  ];
  const adapter = new ConcreteMetricsReadAdapter({
    laneEventRepo: { ...emptyBoardRepositories().laneEventRepo, findByRepositoryId: async () => laneRows },
    usageRepo: {
      findAll: async () => usageRows,
      findWhere: async () => usageRows,
    },
    repositoryId: repo,
    evidenceRevision: async () => 'history-v1',
  });

  const first = await adapter.readDeliveryIdentity();
  assert.equal(measuredValue((await adapter.readOutcomes())[0]!.runs[0]!.durationMinutes), 12);

  // `SqliteMeasurementStore` rewrites a retained (repo, mission, stage,
  // actor_key) row in place, so a corrected run keeps the row count and the
  // measurement day while changing the values the summary reports.
  usageRows = [usageRow({ duration_minutes: 99, cost_usd: 8, input_tokens: 4_000 })];

  const rewritten = await adapter.readDeliveryIdentity();
  const outcomes = await adapter.readOutcomes();
  assert.equal(measuredValue(outcomes[0]!.runs[0]!.durationMinutes), 99, 'the read outcomes reflect the rewritten run');
  assert.equal(outcomes[0]!.totalCostUsd, 8);
  assert.notEqual(rewritten.revision, first.revision, 'a rewritten measurement moves the analytics revision');
  assert.deepEqual(rewritten.deliveries, first.deliveries, 'the delivery itself is unchanged');
  assert.equal(usageReads.count, 0, 'the identity reads the consumed columns, never whole usage rows');

  const unchanged = await adapter.readDeliveryIdentity();
  assert.equal(unchanged.revision, rewritten.revision, 'an unchanged rewrite keeps the analytics revision');
});

test('each consumed usage fact moves the delivery revision (TASK-2854.03)', async () => {
  const base: UsageRecord = {
    repo: 'parallix', mission: 'task-2854-identity', date: '2026-11-11', stage: 'implement',
    classification: 'ai_sdlc', implementer: 'codex', implementer_agent: 'codex', reviewer_agent: 'claude',
    provider: 'openai', model: 'gpt-5', duration_minutes: 12, cost_usd: 1, input_tokens: 100,
    output_tokens: 50, cached_tokens: 5, context_tokens: 1_000, tool_calls: 3,
    openai_usage_before: 10, openai_usage_after: 20, openai_usage_delta: 10,
  };
  let usageRows: UsageRecord[] = [base];
  const adapter = new ConcreteMetricsReadAdapter({
    laneEventRepo: {
      ...emptyBoardRepositories().laneEventRepo,
      findByRepositoryId: async () => [
        { id: 1, repositoryId: 'parallix', missionId: 'task-2854-identity', fromStatus: null, toStatus: 'active', trigger: 'activate', agent: 'codex', occurredAt: '2026-11-10T08:00:00Z', idempotencyKey: 'intake' },
        { id: 2, repositoryId: 'parallix', missionId: 'task-2854-identity', fromStatus: 'integration', toStatus: 'done', trigger: 'integrate', agent: 'codex', occurredAt: '2026-11-11T09:00:00Z', idempotencyKey: 'delivered' },
      ],
    },
    usageRepo: { findAll: async () => usageRows, findWhere: async () => usageRows },
    repositoryId: repo,
    evidenceRevision: async () => 'history-v1',
  });

  const baseline = (await adapter.readDeliveryIdentity()).revision;
  const stale: string[] = [];
  for (const column of USAGE_IDENTITY_COLUMNS) {
    const current = (base as Readonly<Record<string, unknown>>)[column];
    const amended = typeof current === 'number' ? current + 7 : `${String(current ?? '')}-amended`;
    usageRows = [{ ...base, [column]: amended }];
    if ((await adapter.readDeliveryIdentity()).revision === baseline) { stale.push(column); }
  }

  assert.deepEqual(stale, [], 'a rewritten usage fact the summary reports invalidates the cached summary');
});

test('delivery revision separates a missing usage fact from a present-empty one (TASK-2854.03)', async () => {
  const base: UsageRecord = {
    repo: 'parallix', mission: 'task-2854-identity', date: '2026-11-11', stage: 'implement',
    classification: 'ai_sdlc', implementer: 'codex', implementer_agent: 'codex', reviewer_agent: 'claude',
    provider: 'openai', model: 'gpt-5', duration_minutes: 12, cost_usd: 1, input_tokens: 100,
  };
  let usageRows: UsageRecord[] = [base];
  const adapter = new ConcreteMetricsReadAdapter({
    laneEventRepo: {
      ...emptyBoardRepositories().laneEventRepo,
      findByRepositoryId: async () => [
        { id: 1, repositoryId: 'parallix', missionId: 'task-2854-identity', fromStatus: null, toStatus: 'active', trigger: 'activate', agent: 'codex', occurredAt: '2026-11-10T08:00:00Z', idempotencyKey: 'intake' },
        { id: 2, repositoryId: 'parallix', missionId: 'task-2854-identity', fromStatus: 'integration', toStatus: 'done', trigger: 'integrate', agent: 'codex', occurredAt: '2026-11-11T09:00:00Z', idempotencyKey: 'delivered' },
      ],
    },
    usageRepo: { findAll: async () => usageRows, findWhere: async () => usageRows },
    repositoryId: repo,
    evidenceRevision: async () => 'history-v1',
  });
  const cohorts = (outcomes: Awaited<ReturnType<ConcreteMetricsReadAdapter['readOutcomes']>>) =>
    outcomes[0]!.modelsInvolved.map(entry => ({ agent: entry.agent, provider: entry.provider, model: entry.model }));

  // An accepted rewrite may empty the attribution text while keeping the row
  // count and the measurement day. The summary reports an empty `provider` as a
  // measured value and a missing one as unavailable, so the identity must not
  // collapse the two into one tuple slot.
  usageRows = [{ ...base, provider: undefined, implementer_agent: undefined }];
  const missing = await adapter.readOutcomes();
  const missingRevision = (await adapter.readDeliveryIdentity()).revision;
  usageRows = [{ ...base, provider: '', implementer_agent: '' }];
  const emptied = await adapter.readOutcomes();
  const emptiedRevision = (await adapter.readDeliveryIdentity()).revision;

  assert.deepEqual(cohorts(missing), [{ agent: 'codex', provider: null, model: 'gpt-5' }], 'a missing provider stays unavailable');
  assert.deepEqual(cohorts(emptied), [{ agent: 'unknown', provider: '', model: 'gpt-5' }], 'an empty provider is a measured cohort fact');
  assert.notEqual(emptiedRevision, missingRevision, 'emptying a consumed usage fact moves the analytics revision');

  const collapsed: string[] = [];
  for (const column of USAGE_IDENTITY_COLUMNS) {
    usageRows = [{ ...base, [column]: '' }];
    const presentEmpty = (await adapter.readDeliveryIdentity()).revision;
    const absentRow = { ...base } as Record<string, unknown>;
    delete absentRow[column];
    usageRows = [absentRow as UsageRecord];
    if ((await adapter.readDeliveryIdentity()).revision === presentEmpty) { collapsed.push(column); }
  }

  assert.deepEqual(collapsed, [], 'a present-empty usage fact never reads as the same fact as a missing one');
});
