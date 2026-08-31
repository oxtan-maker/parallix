/**
 * Characterization tests for the observable CLI, TUI, and shared board-projection
 * behavior that the ADR 0053 migration must retain.
 *
 * All tests mock Forgejo, agents, Git, and expensive subprocesses. No test
 * contacts real Forgejo, launches agents, or runs performance-heavy commands.
 *
 * These tests preserve the distinction between:
 * - Task authoring and Git observations (external inputs/facts)
 * - Mission lifecycle authority (database-owned domain state after cutover)
 *
 * Related: ADR 0053 (operational persistence), ADR 0051 (application boundary).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  ADR0053_PERSISTENCE_INVENTORY,
  type ADR0053BoundaryEntry,
} from './fixtures/durable-state-inventory.js';
import {
  BoardProjectionBuilder,
  checkProjectionStaleness,
  type AgentReadAdapter,
  type GateReadAdapter,
  type GitReadAdapter,
  type MissionReadAdapter,
  type OperationLogReadAdapter,
  type ReviewReadAdapter,
} from '../src/application/projections/board-readers.js';
import { agentFamily, type AgentFamily } from '../src/domain/agents.js';
import { missionId, missionLabels, type Mission, type MissionId, MISSION_STATUSES } from '../src/domain/mission.js';
import { repositoryId, type RepositoryId } from '../src/domain/repository.js';
import { shouldResume, type SessionMarker } from '../src/domain/session.js';
import { triggerFromTransition, parseMissionStatus } from '../src/domain/board-event.js';
import { completedMissionStatistics, type MissionOutcome } from '../src/domain/usage.js';
import { missionOutcome } from './fixtures/mission-outcome.js';
import statsBackfill from '../src/adapters/cli/commands/stats-backfill.js';
import { resolveKnownAgentFamilies } from '../src/interfaces/tui/agent-config-resolver.js';

const ROOT = process.cwd();
const repo = repositoryId('parallix');

// ---------------------------------------------------------------------------
// Mock adapters (all in-memory, no external I/O)
// ---------------------------------------------------------------------------

function makeMissionAdapter(missions: Mission[] = []): MissionReadAdapter {
  return {
    async loadAllMissions() { return missions; },
    async loadMission(id: MissionId) { return missions.find((m) => m.id === id) ?? null; },
    getSourceFacts() { return [{ source: 'task-markdown', status: 'fresh', value: 'mocked' }]; },
  };
}

function makeReviewAdapter(): ReviewReadAdapter {
  return {
    async loadReviews(ids) { return new Map(ids.map((id) => [id, { review: null, approval: null }])); },
  };
}

function makeGateAdapter(status: 'passed' | 'failed' | 'running' | 'unknown' = 'passed'): GateReadAdapter {
  return { async loadGateStatus() { return status; } };
}

function makeAgentAdapter(): AgentReadAdapter {
  return {
    async loadAgentAvailability() {
      return [{ family: agentFamily('codex'), launcherAvailable: true, block: { kind: 'none' } }];
    },
    async loadAssignedAgent() { return agentFamily('codex'); },
  };
}

function makeGitAdapter(headCommit = 'abc123'): GitReadAdapter {
  return {
    async loadRepositoryId() { return repo; },
    async loadHeadCommit() { return headCommit; },
  };
}

function makeOperationLogAdapter(): OperationLogReadAdapter {
  return { async loadOperationLog() { return []; } };
}

// ---------------------------------------------------------------------------
// SC3: CLI characterization — stats-backfill --apply boundary (production code)
// ---------------------------------------------------------------------------

test('SC3: CLI statsBackfill distinguishes --apply (mutation) from read-only report', async () => {
  // Calls the real statsBackfill function with mocked service and log.
  // --apply passes 'stats:apply' capability and writes rows.
  // Without --apply, it produces a read-only report (no capabilities).
  // This --apply mutation boundary must survive the ADR 0053 migration.
  let receivedCapabilities: Set<string> | null = null;
  let receivedApply: boolean | null = null;
  const mockService = {
    async execute(params: { apply: boolean; capabilities: Set<string> }) {
      receivedApply = params.apply;
      receivedCapabilities = params.capabilities;
      return {
        status: 'completed' as const,
        value: { rows: [], unresolved: [], skipped: [] },
        durableEvidence: [],
      };
    },
  };
  const logs: string[] = [];
  const exitCode: number[] = [];

  // Test with --apply
  await statsBackfill(['--apply'], {
    service: mockService as any,
    log: (msg: string) => { logs.push(msg); return null; },
    error: (msg: string) => { logs.push(msg); return null; },
    exit: (code?: number) => { exitCode.push(code ?? 0); throw new Error('exit'); },
  });
  assert.equal(receivedApply, true, 'statsBackfill --apply must set apply=true');
  assert.ok(
    receivedCapabilities?.has('stats:apply'),
    'statsBackfill --apply must include stats:apply capability',
  );

  // Test without --apply (reset state)
  receivedApply = null;
  receivedCapabilities = null;
  logs.length = 0;
  await statsBackfill(['--json'], {
    service: mockService as any,
    log: (msg: string) => { logs.push(msg); return null; },
    error: (msg: string) => { logs.push(msg); return null; },
    exit: (code?: number) => { exitCode.push(code ?? 0); throw new Error('exit'); },
  });
  assert.equal(receivedApply, false, 'statsBackfill without --apply must set apply=false');
  assert.ok(
    !receivedCapabilities?.has('stats:apply'),
    'statsBackfill without --apply must not include stats:apply capability',
  );
});

test('SC3: CLI statsBackfill --help returns usage without contacting storage', async () => {
  // Calls the real statsBackfill function. --help returns early (before any
  // durable IO) by calling printUsage(log). No service.execute() is called.
  const logs: string[] = [];
  const mockService = {
    async execute() {
      assert.fail('service.execute must not be called for --help');
    },
  };
  await statsBackfill(['--help'], {
    service: mockService as any,
    log: (msg: string) => { logs.push(msg); return null; },
    error: (msg: string) => { logs.push(msg); return null; },
    exit: () => { throw new Error('exit'); },
  });
  assert.ok(
    logs.length > 0,
    'statsBackfill --help must produce usage output via log',
  );
});

// ---------------------------------------------------------------------------
// SC3: TUI characterization — agent config resolution (production code)
// ---------------------------------------------------------------------------

test('SC3: TUI resolveKnownAgentFamilies reads config/agents.json and returns family list', () => {
  // Calls the real resolveKnownAgentFamilies function from ui-command.ts.
  // It reads config/agents.json via readFileSync to resolve known agent families.
  // This is a Configuration concept (ADR 0053: configuration-or-secret).
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tui-agent-config-'));
  try {
    const configPath = path.join(tmpDir, 'config', 'agents.json');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({ families: ['codex', 'claude', 'vibe'] }),
    );

    const families = resolveKnownAgentFamilies(tmpDir);
    assert.ok(Array.isArray(families), 'TUI must return agent families as array');
    assert.equal(families.length, 3, 'TUI must read all agent families from config');
    assert.ok(families.includes('codex'), 'TUI must include codex family');
    assert.ok(families.includes('claude'), 'TUI must include claude family');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('SC3: TUI resolveKnownAgentFamilies returns empty list when config is missing', () => {
  // Calls the real resolveKnownAgentFamilies function with a missing config.
  // It must return an empty list rather than crashing.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tui-agent-config-missing-'));
  try {
    // Do not create config/agents.json — simulate missing config
    const families = resolveKnownAgentFamilies(tmpDir);
    assert.ok(Array.isArray(families), 'TUI must handle missing agents.json gracefully');
    assert.equal(families.length, 0, 'TUI must return empty list when config is missing');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// SC3: Board projection behavior must survive migration
// ---------------------------------------------------------------------------

test('SC3: BoardProjectionBuilder composes mocked read adapters into a valid projection', async () => {
  const missions: Mission[] = [
    {
      id: missionId('task-0001'),
      repositoryId: repo,
      title: 'Active mission',
      labels: missionLabels(['user_value']),
      status: 'active',
      rawStatus: 'active',
      closedAt: null,
      assignee: agentFamily('codex'),
      checkpoints: [],
      review: null,
      netEngineeringLines: null,
    },
  ];

  const builder = new BoardProjectionBuilder(
    makeMissionAdapter(missions),
    makeReviewAdapter(),
    makeGateAdapter(),
    makeAgentAdapter(),
    makeGitAdapter(),
    makeOperationLogAdapter(),
  );

  const projection = await builder.build();

  assert.equal(projection.repositoryId, repo);
  assert.ok(Array.isArray(projection.stages));
  assert.ok(Array.isArray(projection.wipCounts));
  assert.ok(Array.isArray(projection.attentionQueue));
  assert.ok(Array.isArray(projection.sourceFacts));
});

test('SC3: BoardProjectionBuilder handles empty mission set without error', async () => {
  const builder = new BoardProjectionBuilder(
    makeMissionAdapter([]),
    makeReviewAdapter(),
    makeGateAdapter(),
    makeAgentAdapter(),
    makeGitAdapter(),
    makeOperationLogAdapter(),
  );

  const projection = await builder.build();
  assert.equal(projection.repositoryId, repo);
  // BoardProjectionBuilder always produces all 6 lane stages even with no missions
  assert.ok(Array.isArray(projection.stages));
  assert.ok(Array.isArray(projection.wipCounts));
});

test('SC3: checkProjectionStaleness returns fresh when Git HEAD matches', () => {
  const result = checkProjectionStaleness('abc123', 'abc123');
  assert.equal(result.status, 'fresh');
  assert.equal(result.source, 'git');
});

test('SC3: checkProjectionStaleness returns stale when Git HEAD differs', () => {
  const result = checkProjectionStaleness('abc123', 'def456');
  assert.equal(result.status, 'stale');
  assert.equal(result.source, 'git');
});

test('SC3: checkProjectionStaleness returns stale when no cached HEAD', () => {
  const result = checkProjectionStaleness(null, 'abc123');
  assert.equal(result.status, 'stale');
  assert.equal(result.source, 'git');
});

// ---------------------------------------------------------------------------
// SC3: Session marker resume behavior must survive migration
// ---------------------------------------------------------------------------

test('SC3: shouldResume returns true when same agent family and mission', () => {
  const marker: SessionMarker = {
    missionId: missionId('task-0001'),
    role: 'execute',
    agent: agentFamily('codex'),
    lastLaunched: '2026-01-01T00:00:00Z',
    sessionId: 'session-1',
  };
  assert.equal(
    shouldResume(marker, missionId('task-0001'), 'execute', agentFamily('codex')),
    true,
  );
});

test('SC3: shouldResume returns false when different agent family', () => {
  const marker: SessionMarker = {
    missionId: missionId('task-0001'),
    role: 'execute',
    agent: agentFamily('codex'),
    lastLaunched: '2026-01-01T00:00:00Z',
    sessionId: 'session-1',
  };
  assert.equal(
    shouldResume(marker, missionId('task-0001'), 'execute', agentFamily('claude')),
    false,
  );
});

test('SC3: shouldResume returns false when marker is null', () => {
  assert.equal(
    shouldResume(null, missionId('task-0001'), 'execute', agentFamily('codex')),
    false,
  );
});

test('SC3: shouldResume returns false when mission id differs', () => {
  const marker: SessionMarker = {
    missionId: missionId('task-0001'),
    role: 'execute',
    agent: agentFamily('codex'),
    lastLaunched: '2026-01-01T00:00:00Z',
    sessionId: 'session-1',
  };
  assert.equal(
    shouldResume(marker, missionId('task-0002'), 'execute', agentFamily('codex')),
    false,
  );
});

test('SC3: shouldResume returns false when role differs', () => {
  const marker: SessionMarker = {
    missionId: missionId('task-0001'),
    role: 'execute',
    agent: agentFamily('codex'),
    lastLaunched: '2026-01-01T00:00:00Z',
    sessionId: 'session-1',
  };
  assert.equal(
    shouldResume(marker, missionId('task-0001'), 'draft', agentFamily('codex')),
    false,
  );
});

// ---------------------------------------------------------------------------
// SC3: Lane transition trigger derivation must survive migration
// ---------------------------------------------------------------------------

test('SC3: triggerFromTransition maps all known transitions correctly', () => {
  assert.equal(triggerFromTransition(null, 'active'), 'activate');
  assert.equal(triggerFromTransition('backlog', 'active'), null);
  assert.equal(triggerFromTransition('backlog', 'refined'), 'refine');
  assert.equal(triggerFromTransition('refined', 'active'), 'activate');
  assert.equal(triggerFromTransition('active', 'active'), 'activate');
  assert.equal(triggerFromTransition('active', 'review'), 'submit-for-review');
  assert.equal(triggerFromTransition('review', 'active'), 'request-changes');
  assert.equal(triggerFromTransition('review', 'integration'), 'approve');
  assert.equal(triggerFromTransition('integration', 'done'), 'integrate');
  assert.equal(triggerFromTransition('backlog', 'review'), null);
});

test('SC3: parseMissionStatus recognizes all valid MissionStatus values', () => {
  for (const status of MISSION_STATUSES) {
    assert.equal(parseMissionStatus(status), status);
  }
  assert.equal(parseMissionStatus('invalid'), null);
  assert.equal(parseMissionStatus(''), null);
});

// ---------------------------------------------------------------------------
// SC3: MissionOutcome derivation must survive migration
// ---------------------------------------------------------------------------

test('SC3: completedMissionStatistics derives correct statistics from closed mission and outcome', () => {
  const closedMission: Mission = {
    id: missionId('task-0001'),
    repositoryId: repo,
    title: 'Closed mission',
    labels: missionLabels(['user_value']),
    status: 'done',
    rawStatus: 'done',
    closedAt: '2026-01-01T00:00:00Z',
    assignee: agentFamily('codex'),
    checkpoints: [],
    review: null,
    netEngineeringLines: 42,
  };
  const outcome: MissionOutcome = missionOutcome({
    missionId: missionId('task-0001'),
    repositoryId: repo,
    cycleTimeMinutes: 120,
    reviewFixRounds: 1,
    runs: [
      {
        recordedOn: '2026-01-01T00:00:00Z',
        stage: 'execute',
        role: 'implementer',
        agent: agentFamily('codex'),
        runtime: { provider: { kind: 'measured', value: 'openai' }, model: { kind: 'measured', value: 'gpt-4' } },
        durationMinutes: { kind: 'measured', value: 30 },
        tokens: {
          input: { kind: 'measured', value: 1000 },
          output: { kind: 'measured', value: 500 },
          cached: { kind: 'measured', value: 100 },
          context: { kind: 'measured', value: 1500 },
        },
        toolCalls: { kind: 'measured', value: 5 },
        providerUsage: {
          beforePercent: { kind: 'measured', value: 10 },
          afterPercent: { kind: 'measured', value: 15 },
          deltaPercent: { kind: 'measured', value: 5 },
        },
        costUsd: { kind: 'measured', value: 0.50 },
      },
    ],
  });

  const stats = completedMissionStatistics(closedMission, outcome);
  assert.equal(stats.missionId, 'task-0001');
  assert.equal(stats.netEngineeringLines, 42);
  assert.equal(stats.reviewFixRounds, 1);
  assert.equal(stats.totalDurationMinutes, 30);
  assert.equal(stats.totalCostUsd, 0.50);
  assert.equal(stats.totalInputAndOutputTokens, 1500);
});

test('SC3: completedMissionStatistics rejects mismatched mission identity', () => {
  const closedMission: Mission = {
    id: missionId('task-0001'),
    repositoryId: repo,
    title: 'Mission',
    labels: missionLabels([]),
    status: 'done',
    rawStatus: 'done',
    closedAt: '2026-01-01T00:00:00Z',
    assignee: agentFamily('codex'),
    checkpoints: [],
    review: null,
    netEngineeringLines: 10,
  };
  const outcome: MissionOutcome = missionOutcome({
    missionId: missionId('task-9999'),
    repositoryId: repo,
    cycleTimeMinutes: 60,
    reviewFixRounds: 0,
    runs: [],
  });

  assert.throws(
    () => completedMissionStatistics(closedMission, outcome),
    /Mission outcome identity does not match the closed mission/,
  );
});

// ---------------------------------------------------------------------------
// SC5: Task intake remains external — inventory has no code path that repairs task files
// ---------------------------------------------------------------------------

test('SC5: TaskIntake inventory entries are external-fact-or-intake (not database-owned)', () => {
  const taskEntries = ADR0053_PERSISTENCE_INVENTORY.filter(
    (e) => e.concept === 'TaskIntake',
  );
  assert.ok(taskEntries.length > 0, 'TaskIntake must have inventory entries');
  for (const entry of taskEntries) {
    assert.equal(
      entry.classification,
      'external-fact-or-intake',
      `${entry.id} must be external-fact-or-intake`,
    );
  }
});

test('SC5: GitObservations inventory entries are external-fact-or-intake (not database-owned)', () => {
  const gitEntries = ADR0053_PERSISTENCE_INVENTORY.filter(
    (e) => e.concept === 'GitObservations',
  );
  assert.ok(gitEntries.length > 0, 'GitObservations must have inventory entries');
  for (const entry of gitEntries) {
    assert.equal(
      entry.classification,
      'external-fact-or-intake',
      `${entry.id} must be external-fact-or-intake`,
    );
  }
});

test('SC5: Mission and TaskIntake classifications are distinct (authority separation)', () => {
  const missionEntries = ADR0053_PERSISTENCE_INVENTORY.filter(
    (e) => e.concept === 'Mission',
  );
  const taskEntries = ADR0053_PERSISTENCE_INVENTORY.filter(
    (e) => e.concept === 'TaskIntake',
  );
  // Mission = database-owned-domain-state (cutover target)
  // TaskIntake = external-fact-or-intake (permanent, no cutover)
  for (const entry of missionEntries) {
    assert.equal(entry.classification, 'database-owned-domain-state');
  }
  for (const entry of taskEntries) {
    assert.equal(entry.classification, 'external-fact-or-intake');
  }
});

// ---------------------------------------------------------------------------
// SC6: No authority switch in this mission — no production path changed
// ---------------------------------------------------------------------------

test('SC6: inventory preserves current file-backed default paths for Mission/CheckpointData/Review', () => {
  const missionEntries = ADR0053_PERSISTENCE_INVENTORY.filter(
    (e) => e.concept === 'Mission' && e.pathType === 'default',
  );
  const checkpointEntries = ADR0053_PERSISTENCE_INVENTORY.filter(
    (e) => e.concept === 'CheckpointData' && e.pathType === 'default',
  );
  const reviewEntries = ADR0053_PERSISTENCE_INVENTORY.filter(
    (e) => e.concept === 'Review' && e.pathType === 'default',
  );
  assert.ok(missionEntries.length > 0, 'Mission must have default entries');
  assert.ok(checkpointEntries.length > 0, 'CheckpointData must have default entries');
  assert.ok(reviewEntries.length > 0, 'Review must have default entries');
});

test('SC6: Configuration entries remain configuration-or-secret (not migrated to domain state)', () => {
  const configEntries = ADR0053_PERSISTENCE_INVENTORY.filter(
    (e) => e.concept === 'Configuration',
  );
  for (const entry of configEntries) {
    assert.equal(entry.classification, 'configuration-or-secret');
  }
});

test('SC6: Secrets entries remain configuration-or-secret (not migrated to domain state)', () => {
  const secretEntries = ADR0053_PERSISTENCE_INVENTORY.filter(
    (e) => e.concept === 'Secrets',
  );
  for (const entry of secretEntries) {
    assert.equal(entry.classification, 'configuration-or-secret');
  }
});

test('SC6: LargeArtifacts entries are classified as generated-artifact or database-owned-domain-state', () => {
  // LargeArtifacts includes both generated output files (reports, verdicts)
  // and SQLite adapter infrastructure (importer, migration-runner) that
  // handles large-file imports. Both are valid classifications.
  const artifactEntries = ADR0053_PERSISTENCE_INVENTORY.filter(
    (e) => e.concept === 'LargeArtifacts',
  );
  const validLargeArtifactClassifications = new Set([
    'generated-artifact',
    'database-owned-domain-state',
  ]);
  for (const entry of artifactEntries) {
    assert.ok(
      validLargeArtifactClassifications.has(entry.classification),
      `${entry.id} (LargeArtifacts) must be generated-artifact or database-owned-domain-state, got: ${entry.classification}`,
    );
  }
});
