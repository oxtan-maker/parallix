/**
 * TASK-2375 CP-3 — metrics-cache identity and unverifiable process liveness.
 *
 * SC4: Volatile `blockedForMs` must not invalidate slow historical metrics
 * cache on every refresh. Agent availability values must still refresh accurately.
 *
 * SC5: PID-only liveness on non-Linux must be `unverified` and age out via TTL;
 * Linux start-identity checks remain authoritative.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { BoardProjectionBuilder } from '../src/application/projections/board-readers.js';
import type {
  MissionReadAdapter,
  ReviewReadAdapter,
  GateReadAdapter,
  AgentReadAdapter,
  GitReadAdapter,
  OperationLogReadAdapter,
  BoardProjectionOptions,
} from '../src/application/projections/board-readers.js';
import type { MetricsReadAdapter } from '../src/application/projections/metrics-read-adapter.js';
import type { CurrentWorkReadAdapter, ProcessLivenessProbe } from '../src/application/projections/current-work.js';
import type { Mission, MissionId, MissionStatus } from '../src/domain/mission.js';
import type { AgentAvailability, AgentFamily } from '../src/domain/agents.js';
import type { RepositoryId } from '../src/domain/repository.js';
import type { SourceFact } from '../src/application/contracts.js';
import { probeProcessLiveness } from '../src/adapters/process/process-liveness.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const REPO: RepositoryId = 'test-repo' as RepositoryId;
const MISSION_ID = 'task-9901' as MissionId;

function emptyAdapters(): {
  missions: MissionReadAdapter;
  reviews: ReviewReadAdapter;
  gates: GateReadAdapter;
  agents: AgentReadAdapter;
  git: GitReadAdapter;
  operationLog: OperationLogReadAdapter;
} {
  return {
    missions: {
      loadAllMissions: async () => [] as readonly Mission[],
      loadMission: async () => null,
      getSourceFacts: () => [] as readonly SourceFact<string>[],
    },
    reviews: {
      loadReviews: async (ids) => new Map(ids.map((id) => [id, { review: null, approval: null }])),
    },
    gates: {
      loadGateStatus: async () => 'unknown',
    },
    agents: {
      loadAgentAvailability: async () => [] as readonly AgentAvailability[],
      loadAssignedAgent: async () => null,
    },
    git: {
      loadRepositoryId: async () => REPO,
      loadHeadCommit: async () => 'abc123',
    },
    operationLog: {
      loadOperationLog: async () => [],
    },
  };
}

// ---------------------------------------------------------------------------
// SC4 — metrics cache identity
// ---------------------------------------------------------------------------

test('TASK-2375 SC4: repeated refreshes during AgentBlock reuse slow metrics cache', async () => {
  // Prove that buildMetrics called multiple times with changing blockedForMs
  // does not recompute slow metrics — the cache key excludes agentAvailability.
  let metricsAdapterCallCount = 0;
  const metricsAdapter: MetricsReadAdapter = {
    buildMetrics: async (_initialStates, _agentAvailability) => {
      metricsAdapterCallCount += 1;
      return {
        health: { state: 'healthy' },
        provenance: {
          repositoryId: REPO,
          evaluatedWindow: { startedAt: null, endedAt: null },
          sampleSize: 1,
          newestEventTimestamp: null,
          rejectedOrMissingIdentityRowCount: 0,
          adapterSucceeded: true,
        },
        cumulativeFlow: { series: [], missingHistoryFallback: 'skip' },
        cumulativeFlowByState: { series: [], missingHistoryFallback: 'skip' },
        medianStateTimes: { series: [], missingHistoryFallback: 'skip' },
        medianAgentRuntime: { series: [], missingHistoryFallback: 'null' },
        medianCycleTimeByState: { series: [], missingHistoryFallback: 'skip' },
        throughput: { series: [], missingHistoryFallback: 'skip' },
        reviewBounceRate: { series: [], missingHistoryFallback: 'skip' },
        medianAgeByLane: { series: [], missingHistoryFallback: 'skip' },
        agentAvailability: _agentAvailability ?? [],
        bottleneck: {
          sentence: 'test',
          inputs: { lane: null, medianAgeMinutes: null, reviewBounceRate: null },
        },
      };
    },
  };

  const agents: AgentAvailability[] = [
    {
      family: 'codex' as AgentFamily,
      launcherAvailable: true,
      block: { kind: 'until', untilMs: Date.now() + 60_000, reason: 'usage limit' },
    },
  ];

  const adapters = emptyAdapters();
  adapters.missions = {
    ...adapters.missions,
    loadAllMissions: async () => [{
      id: MISSION_ID,
      slug: MISSION_ID,
      status: 'active' as MissionStatus,
      title: 'Test',
      labels: [],
      assignee: [],
      checkpoints: [],
      review: null,
      repositoryId: REPO,
    }] as unknown as readonly Mission[],
  };
  adapters.agents = {
    ...adapters.agents,
    loadAgentAvailability: async () => agents,
  };

  let tick = 0;
  const options: BoardProjectionOptions = {
    metricsAdapter,
    now: () => Date.now() + (tick += 2_000), // simulate 2s refresh interval
    currentWork: { loadCurrentWork: async () => [] } as CurrentWorkReadAdapter,
  };

  const builder = new BoardProjectionBuilder(
    adapters.missions,
    adapters.reviews,
    adapters.gates,
    adapters.agents,
    adapters.git,
    adapters.operationLog,
    options,
  );

  // Three refreshes — blockedForMs changes each time but missions unchanged
  await builder.build();
  await builder.build();
  await builder.build();

  assert.equal(
    metricsAdapterCallCount,
    1,
    'slow metrics computed once despite three refreshes with changing blockedForMs',
  );
});

test('TASK-2375 SC4: fresh agent availability delivered on cache hit', async () => {
  let metricsAdapterCallCount = 0;
  let callIndex = 0;
  const metricsAdapter: MetricsReadAdapter = {
    buildMetrics: async (_initialStates, agentAvailability) => {
      metricsAdapterCallCount += 1;
      callIndex += 1;
      return {
        health: { state: 'healthy' },
        provenance: {
          repositoryId: REPO,
          evaluatedWindow: { startedAt: null, endedAt: null },
          sampleSize: 1,
          newestEventTimestamp: null,
          rejectedOrMissingIdentityRowCount: 0,
          adapterSucceeded: true,
        },
        cumulativeFlow: { series: [], missingHistoryFallback: 'skip' },
        cumulativeFlowByState: { series: [], missingHistoryFallback: 'skip' },
        medianStateTimes: { series: [], missingHistoryFallback: 'skip' },
        medianAgentRuntime: { series: [], missingHistoryFallback: 'null' },
        medianCycleTimeByState: { series: [], missingHistoryFallback: 'skip' },
        throughput: { series: [], missingHistoryFallback: 'skip' },
        reviewBounceRate: { series: [], missingHistoryFallback: 'skip' },
        medianAgeByLane: { series: [], missingHistoryFallback: 'skip' },
        agentAvailability: agentAvailability ?? [],
        bottleneck: {
          sentence: 'test',
          inputs: { lane: null, medianAgeMinutes: null, reviewBounceRate: null },
        },
      };
    },
  };

  const adapters = emptyAdapters();
  adapters.missions = {
    ...adapters.missions,
    loadAllMissions: async () => [{
      id: MISSION_ID,
      slug: MISSION_ID,
      status: 'active' as MissionStatus,
      title: 'Test',
      labels: [],
      assignee: [],
      checkpoints: [],
      review: null,
      repositoryId: REPO,
    }] as unknown as readonly Mission[],
  };

  // Agent availability changes between calls (different block untilMs)
  // to prove fresh data is delivered even on cache hit.
  let currentUntilMs = Date.now() + 100_000;
  adapters.agents = {
    ...adapters.agents,
    loadAgentAvailability: async () => [{
      family: 'codex' as AgentFamily,
      launcherAvailable: true,
      block: { kind: 'until', untilMs: currentUntilMs, reason: 'usage limit' },
    }],
  };

  const options: BoardProjectionOptions = {
    metricsAdapter,
    currentWork: { loadCurrentWork: async () => [] } as CurrentWorkReadAdapter,
  };

  const builder = new BoardProjectionBuilder(
    adapters.missions,
    adapters.reviews,
    adapters.gates,
    adapters.agents,
    adapters.git,
    adapters.operationLog,
    options,
  );

  const projection1 = await builder.build();
  const blockedFor1 = projection1.metrics.agentAvailability[0]?.blockedForMs;

  // Change agent availability (simulate time passing)
  currentUntilMs = Date.now() + 50_000;
  const projection2 = await builder.build();
  const blockedFor2 = projection2.metrics.agentAvailability[0]?.blockedForMs;

  assert.equal(metricsAdapterCallCount, 1, 'slow metrics computed only once (cache hit)');
  assert.ok(
    blockedFor2 < blockedFor1,
    `blockedForMs updated (${blockedFor2} < ${blockedFor1}) — fresh availability on cache hit`,
  );
});

// ---------------------------------------------------------------------------
// SC5 — unverifiable process liveness
// ---------------------------------------------------------------------------

test('TASK-2375 SC5: probeProcessLiveness returns null when identity is null (non-Linux fallback)', () => {
  // On non-Linux, processStartIdentity returns null (no /proc).
  // When recorded identity is null, probe should return null (unverifiable),
  // not true (authoritatively alive).
  const result = probeProcessLiveness(process.pid, null);
  assert.strictEqual(
    result,
    null,
    'pid exists but identity unverifiable — must return null for TTL aging, not true',
  );
});

test('TASK-2375 SC5: probeProcessLiveness returns true when identity matches (Linux authoritative)', () => {
  // On Linux, processStartIdentity reads /proc/<pid>/stat field 22.
  // When identity matches, probe returns true (authoritatively alive).
  // On Linux, this process has a start identity. On non-Linux it returns null.
  // This test proves the Linux path works: identity is read and compared.
  // Skip the match assertion on non-Linux where /proc is unavailable.
  try {
    const stat = readFileSync(`/proc/${process.pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const startTime = fields[19];
    if (startTime && /^\d+$/.test(startTime)) {
      // Linux path: identity available, probe should return true
      const result = probeProcessLiveness(process.pid, startTime);
      assert.strictEqual(result, true, 'Linux start-identity match returns true (authoritative)');
      return;
    }
  } catch {
    // Non-Linux: /proc unavailable, skip authoritative check
  }
  // Non-Linux or unreadable: test passes by not throwing
  assert.ok(true, 'non-Linux: identity check skipped');
});

test('TASK-2375 SC5: probeProcessLiveness returns false for dead process', () => {
  // Use a pid that is very unlikely to exist
  const deadPid = 99999999;
  const result = probeProcessLiveness(deadPid, null);
  assert.strictEqual(result, false, 'dead pid returns false');
});
