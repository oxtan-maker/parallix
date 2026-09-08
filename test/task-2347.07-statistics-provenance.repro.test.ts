import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BoardProjectionBuilder,
  type AgentReadAdapter,
  type GateReadAdapter,
  type GitReadAdapter,
  type MissionReadAdapter,
  type OperationLogReadAdapter,
  type ReviewReadAdapter,
} from '../src/application/projections/board-readers.js';
import type { MetricsReadAdapter } from '../src/application/projections/metrics-read-adapter.js';
import { ConcreteMetricsReadAdapter } from '../src/application/projections/metrics-read-adapter.js';
import type { UsageRecord, UsageRepository } from '../src/application/ports/mission-measurements.js';
import type { BoardLaneEventEntry, BoardLaneEventRepository } from '../src/application/ports/operation-history.js';
import { agentFamily } from '../src/domain/agents.js';
import type { MissionId, MissionStatus } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';

const repository = repositoryId('statistics-repro');

test('metrics-read adapter failure projects explicit unavailable statistics instead of default zero values', async () => {
  const failingMetricsAdapter: MetricsReadAdapter = {
    async buildMetrics() {
      throw new Error('telemetry database unavailable');
    },
  };

  const projection = await new BoardProjectionBuilder(
    missionAdapter(), reviewAdapter(), gateAdapter(), agentAdapter(), gitAdapter(), operationLogAdapter(),
    { metricsAdapter: failingMetricsAdapter },
  ).build();

  assert.equal(projection.metrics.health.state, 'unavailable');
  assert.equal(projection.metrics.provenance.repositoryId, repository);
  assert.equal(projection.metrics.provenance.adapterSucceeded, false);
  assert.equal(projection.metrics.medianStateTimes.series.length, 0);
  assert.equal(projection.metrics.throughput.series.length, 0);
});

test('metrics projection reports controlled provenance and distinguishes no-completions from no-telemetry', async () => {
  const noCompletions = new ConcreteMetricsReadAdapter({
    repositoryId: repository,
    laneEventRepo: laneRepo([laneEntry()]),
    usageRepo: usageRepo([]),
  });
  const noTelemetry = new ConcreteMetricsReadAdapter({
    repositoryId: repository,
    laneEventRepo: laneRepo([]),
    usageRepo: usageRepo([]),
  });

  const noCompletionMetrics = await noCompletions.buildMetrics(new Map([["task-open" as MissionId, 'active' as MissionStatus]]));
  const noTelemetryMetrics = await noTelemetry.buildMetrics(new Map());

  assert.deepEqual(noCompletionMetrics.provenance, {
    repositoryId: repository,
    evaluatedWindow: { startedAt: '2026-08-01T10:00:00Z', endedAt: '2026-08-01T10:00:00Z' },
    sampleSize: 0,
    newestEventTimestamp: '2026-08-01T10:00:00Z',
    rejectedOrMissingIdentityRowCount: 0,
    adapterSucceeded: true,
  });
  assert.equal(noCompletionMetrics.health.state, 'no-completions');
  assert.equal(noTelemetryMetrics.health.state, 'no-telemetry');

  const preLifecycleMetrics = await noTelemetry.buildMetrics(new Map([
    ['task-completed' as MissionId, 'done' as MissionStatus],
  ]));
  assert.equal(preLifecycleMetrics.health.state, 'pre-lifecycle');

  const partialMetrics = await new ConcreteMetricsReadAdapter({
    repositoryId: repository,
    laneEventRepo: laneRepo([{ ...laneEntry(), missionId: '' }]),
    usageRepo: usageRepo([]),
  }).buildMetrics(new Map());
  assert.equal(partialMetrics.health.state, 'partial');
  assert.equal(partialMetrics.provenance.rejectedOrMissingIdentityRowCount, 1);
});

function laneEntry(): BoardLaneEventEntry {
  return {
    repositoryId: repository, missionId: 'task-open', fromStatus: 'backlog', toStatus: 'active', trigger: 'activate', agent: 'codex',
    occurredAt: '2026-08-01T10:00:00Z', idempotencyKey: 'task-open-activate',
  };
}

function laneRepo(entries: readonly BoardLaneEventEntry[]): BoardLaneEventRepository {
  return {
    async append() { return true; }, async findByMissionId() { return entries; }, async findAll() { return entries; },
    async findByRepositoryId() { return entries; }, async clear() {},
  };
}

function usageRepo(records: readonly UsageRecord[]): UsageRepository {
  return {
    async findAll() { return records; }, async findWhere() { return records; },
  };
}

function missionAdapter(): MissionReadAdapter {
  return {
    async loadAllMissions() { return []; },
    async loadMission() { return null; },
    getSourceFacts() { return []; },
  };
}

function reviewAdapter(): ReviewReadAdapter {
  return { async loadReviews(ids) { return new Map(ids.map((id) => [id, { review: null, approval: null }])); } };
}

function gateAdapter(): GateReadAdapter {
  return { async loadGateStatus() { return 'unknown' as const; } };
}

function agentAdapter(): AgentReadAdapter {
  return {
    async loadAgentAvailability() { return [{ family: agentFamily('codex'), launcherAvailable: true, block: { kind: 'none' as const } }]; },
    async loadAssignedAgent() { return null; },
  };
}

function gitAdapter(): GitReadAdapter {
  return { async loadRepositoryId() { return repository; }, async loadHeadCommit() { return 'test-head'; } };
}

function operationLogAdapter(): OperationLogReadAdapter {
  return { async loadOperationLog() { return []; } };
}
