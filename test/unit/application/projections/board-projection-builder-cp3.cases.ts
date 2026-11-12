import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

import { composeBoardProjection } from '../../../../src/composition/board-projection.js';
import { BoardProjectionBuilder } from '../../../../src/application/projections/board-readers.js';
import { ConcreteMissionReadAdapter } from '../../../../src/adapters/backlog/concrete-mission-read-adapter.js';
import { ConcreteReviewReadAdapter } from '../../../../src/adapters/backlog/concrete-review-read-adapter.js';
import { ConcreteAgentReadAdapter } from '../../../../src/adapters/backlog/concrete-agent-read-adapter.js';
import { ConcreteOperationLogReadAdapter } from '../../../../src/adapters/backlog/concrete-operation-log-read-adapter.js';
import { ConcreteGitReadAdapter } from '../../../../src/adapters/backlog/concrete-git-read-adapter.js';
import { agentFamily } from '../../../../src/domain/agents.js';
import { missionId, missionLabels } from '../../../../src/domain/mission.js';
import { repositoryId } from '../../../../src/domain/repository.js';
import type {
  AgentBlocklistRepository,
} from '../../../../src/application/ports/agent-blocklist.js';
import type { BoardLaneEventRepository, OperationalHistoryRepository } from '../../../../src/application/ports/operation-history.js';
import type { UsageRepository } from '../../../../src/application/ports/mission-measurements.js';
import type { MissionStore } from '../../../../src/application/domain-ports.js';
import { missionVersion } from '../../../../src/application/domain-ports.js';
import type { Mission } from '../../../../src/domain/mission.js';
import type { OperationalHistoryEntry, BoardLaneEventEntry } from '../../../../src/application/ports/operation-history.js';
import { mkdtemp as registeredMkdtemp } from '../../../helpers/temp-dir.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function taskMd(frontmatter: Record<string, string>): string {
  const lines = Object.entries(frontmatter).map(([key, val]) => `${key}: ${val}`);
  return `---\n${lines.join('\n')}\n---\n\n# Task content\n`;
}

function createTempBacklog(files: Record<string, string>): string {
  const tmp = registeredMkdtemp('px-board-test-');
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = path.join(tmp, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf8');
  }
  return tmp;
}

class MockBlocklistRepo implements AgentBlocklistRepository {
  async findAll() { return []; }
  async findByAgent() { return undefined; }
  async save() {}
  async deleteByAgent() {}
  async clear() {}
}

class MockHistoryRepo implements OperationalHistoryRepository {
  constructor(readonly entries: readonly OperationalHistoryEntry[] = []) {}
  async findAll() { return this.entries; }
  async findByTypes(types: readonly string[]) { return this.entries.filter(row => types.includes(row.eventType)); }
  async findByType(type: string) { return this.entries.filter(row => row.eventType === type); }
  async findByTypeForMission(type: string, id: string) { return this.entries.filter(row => row.eventType === type
    && (JSON.parse(row.eventData) as { missionId?: unknown }).missionId === id); }
  async append() {}
  async clear() {}
}

class MockLaneEventRepo implements BoardLaneEventRepository {
  constructor(readonly entries: readonly BoardLaneEventEntry[] = []) {}
  async findAll() { return this.entries; }
  async findByMissionId(id: string) { return this.entries.filter(row => row.missionId === id); }
  async findByRepositoryId(id: string) { return this.entries.filter(row => row.repositoryId === id); }
  async append() { return true; }
  async clear() {}
}

class MockUsageRepo implements UsageRepository {
  async findAll() { return []; }
  async findWhere() { return []; }
  async save() {}
  async saveAll() {}
  async clear() {}
}

// ---------------------------------------------------------------------------
// BoardProjectionBuilder wiring tests
// ---------------------------------------------------------------------------

test('BoardProjectionBuilder is wired in composition root over all six concrete adapters', () => {
  const tmp = createTempBacklog({
    'backlog/tasks/task-1001 - test mission.md': taskMd({
      id: 'TASK-1001',
      status: 'refined',
      assignee: 'codex',
      title: 'Test Mission',
    }),
  });
  try {
    const builder = composeBoardProjection({
      rootDir: tmp,
      missionStore: null,
      repositoryId: repositoryId('test-repo'),
      blocklistRepo: new MockBlocklistRepo(),
      historyRepo: new MockHistoryRepo(),
      laneEventRepo: new MockLaneEventRepo(),
      usageRepo: new MockUsageRepo(),
      knownAgentFamilies: [agentFamily('codex'), agentFamily('claude')],
    }).builder;

    assert.ok(builder instanceof BoardProjectionBuilder);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('board without Mission authority shows only uningested inputs', async () => {
  const tmp = createTempBacklog({
    'backlog/tasks/task-2000 - input.md': taskMd({ id: 'TASK-2000', title: 'Input', status: 'backlog' }),
    'backlog/tasks/task-2001 - active mission.md': taskMd({
      id: 'TASK-2001',
      status: 'active',
      assignee: 'codex',
      title: 'Active Mission',
    }),
    'backlog/completed/task-2002 - done mission.md': taskMd({
      id: 'TASK-2002',
      status: 'done',
      assignee: 'codex',
      title: 'Done Mission',
      closedAt: '2026-07-01T00:00:00Z',
    }),
  });
  try {
    const builder = composeBoardProjection({
      rootDir: tmp,
      missionStore: null,
      repositoryId: repositoryId('test-repo'),
      blocklistRepo: new MockBlocklistRepo(),
      historyRepo: new MockHistoryRepo(),
      laneEventRepo: new MockLaneEventRepo(),
      usageRepo: new MockUsageRepo(),
      knownAgentFamilies: [agentFamily('codex')],
    }).builder;

    const projection = await builder.build();

    // Active/completed Markdown cannot reconstruct Mission lifecycle or evidence.
    const totalCards = projection.stages.reduce((sum, stage) => sum + stage.count, 0);
    assert.equal(totalCards, 1);
    assert.equal(projection.stages.flatMap(stage => stage.cards)[0].id, missionId('task-2000'));

    // Source facts should be populated
    assert.ok(projection.sourceFacts.length > 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Integration-base vs worktree reconciliation test
// ---------------------------------------------------------------------------

test('Integration-base vs worktree reconciliation: base owns status, worktree provides newer content', async () => {
  const tmp = createTempBacklog({
    'backlog/tasks/task-3001 - base task.md': taskMd({
      id: 'TASK-3001',
      status: 'integration',
      assignee: 'codex',
      title: 'Base Title',
    }),
  });
  try {
    // Simulate a worktree with updated content
    const worktreePath = path.join(tmp, 'worktree', 'task-3001');
    const worktreeTasksDir = path.join(worktreePath, 'backlog', 'tasks');
    fs.mkdirSync(worktreeTasksDir, { recursive: true });
    fs.writeFileSync(
      path.join(worktreeTasksDir, 'task-3001 - worktree task.md'),
      taskMd({
        id: 'TASK-3001',
        status: 'review',
        assignee: 'custom',
        title: 'Worktree Title',
      }),
      'utf8'
    );

    const adapter = new ConcreteMissionReadAdapter({
      rootDir: tmp,
      repositoryId: repositoryId('test-repo'),
      getTaskStorage: () => ({
        tasksDir: path.join(tmp, 'backlog', 'tasks'),
        completedDir: path.join(tmp, 'backlog', 'completed'),
        archiveTasksDir: path.join(tmp, 'backlog', 'archive', 'tasks'),
      }),
      findMissionDir: () => null,
      findCheckpoints: () => [],
      resolveWorktree: (slug) => slug === 'task-3001' ? worktreePath : null,
      resolveTaskFile: (slug, rootDir) => {
        const dir = rootDir || tmp;
        const tasksDir = path.join(dir, 'backlog', 'tasks');
        if (!fs.existsSync(tasksDir)) return { ok: false as const, matches: [] };
        const files = fs.readdirSync(tasksDir).filter((f) => f.endsWith('.md'));
        const file = files.find((f) => f.toLowerCase().startsWith(slug.toLowerCase()));
        if (file) return { ok: true as const, taskFile: path.join(tasksDir, file), matches: [file] };
        return { ok: false as const, matches: [] };
      },
    });

    const missions = await adapter.loadAllMissions();
    assert.equal(missions.length, 1);

    // ADR 0051: integration base owns status and assignee; worktree provides content
    assert.equal(missions[0].status, 'integration'); // from base
    assert.equal(missions[0].assignee, 'codex'); // from base
    assert.equal(missions[0].title, 'Worktree Title'); // from worktree
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('Integration-base vs worktree reconciliation: done + worktree present = unclosed mission', async () => {
  const tmp = createTempBacklog({
    'backlog/completed/task-4001 - done task.md': taskMd({
      id: 'TASK-4001',
      status: 'done',
      assignee: 'codex',
      title: 'Done Task',
    }),
  });
  try {
    // Worktree still exists (not cleaned up yet)
    const worktreePath = path.join(tmp, 'worktree', 'task-4001');
    const worktreeTasksDir = path.join(worktreePath, 'backlog', 'tasks');
    fs.mkdirSync(worktreeTasksDir, { recursive: true });
    fs.writeFileSync(
      path.join(worktreeTasksDir, 'task-4001 - worktree.md'),
      taskMd({
        id: 'TASK-4001',
        status: 'done',
        assignee: 'codex',
        title: 'Worktree Title',
      }),
      'utf8'
    );

    const adapter = new ConcreteMissionReadAdapter({
      rootDir: tmp,
      repositoryId: repositoryId('test-repo'),
      getTaskStorage: () => ({
        tasksDir: path.join(tmp, 'backlog', 'tasks'),
        completedDir: path.join(tmp, 'backlog', 'completed'),
        archiveTasksDir: path.join(tmp, 'backlog', 'archive', 'tasks'),
      }),
      findMissionDir: () => null,
      findCheckpoints: () => [],
      resolveWorktree: (slug) => slug === 'task-4001' ? worktreePath : null,
      resolveTaskFile: (slug, rootDir) => {
        const dir = rootDir || tmp;
        const tasksDir = path.join(dir, 'backlog', 'tasks');
        if (!fs.existsSync(tasksDir)) return { ok: false as const, matches: [] };
        const files = fs.readdirSync(tasksDir).filter((f) => f.endsWith('.md'));
        const file = files.find((f) => f.toLowerCase().startsWith(slug.toLowerCase()));
        if (file) return { ok: true as const, taskFile: path.join(tasksDir, file), matches: [file] };
        return { ok: false as const, matches: [] };
      },
    });

    const missions = await adapter.loadAllMissions();
    // done + worktree present = unclosed (open mission, not closed)
    assert.equal(missions.length, 1);
    assert.equal(missions[0].status, 'done');
    assert.equal(missions[0].closedAt, null); // unclosed because worktree still exists
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('Integration-base vs worktree reconciliation: done + worktree absent + closedAt = closed mission', async () => {
  const tmp = createTempBacklog({
    'backlog/completed/task-5001 - closed task.md': taskMd({
      id: 'TASK-5001',
      status: 'done',
      assignee: 'codex',
      title: 'Closed Task',
      closedAt: '2026-07-15T12:00:00Z',
    }),
  });
  try {
    const adapter = new ConcreteMissionReadAdapter({
      rootDir: tmp,
      repositoryId: repositoryId('test-repo'),
      getTaskStorage: () => ({
        tasksDir: path.join(tmp, 'backlog', 'tasks'),
        completedDir: path.join(tmp, 'backlog', 'completed'),
        archiveTasksDir: path.join(tmp, 'backlog', 'archive', 'tasks'),
      }),
      findMissionDir: () => null,
      findCheckpoints: () => [],
      resolveWorktree: () => null, // worktree absent
    });

    const missions = await adapter.loadAllMissions();
    assert.equal(missions.length, 1);
    assert.equal(missions[0].status, 'done');
    // Materializing a completed task closes it through closeMission, which
    // canonicalizes the closure instant to UTC ISO-8601 with millisecond
    // precision (TASK-2688).
    assert.equal(missions[0].closedAt, '2026-07-15T12:00:00.000Z'); // closed
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('composeBoardProjection wires all eight adapters into BoardProjectionBuilder', () => {
  const builder = composeBoardProjection({
    rootDir: '/tmp',
    missionStore: null,
    repositoryId: repositoryId('test-repo'),
    blocklistRepo: new MockBlocklistRepo(),
    historyRepo: new MockHistoryRepo(),
    laneEventRepo: new MockLaneEventRepo(),
    usageRepo: new MockUsageRepo(),
    knownAgentFamilies: [agentFamily('codex')],
  }).builder;

  // Verify the builder is a BoardProjectionBuilder instance
  assert.ok(builder instanceof BoardProjectionBuilder);
});

test('board FLOW retains recovered returns outside its cached analytical event families (TASK-2836 F1)', async () => {
  const rootDir = createTempBacklog({}), repo = repositoryId('test-repo'), id = missionId('task-2836-recovered');
  const closedAt = new Date().toISOString();
  const mission: Mission = { id, repositoryId: repo, title: 'Recovered return', labels: missionLabels(['user_value']),
    assignee: agentFamily('codex'), checkpoints: [], review: null, netEngineeringLines: null, status: 'done', closedAt, declaredGates: [] };
  const store: MissionStore = { load: async () => ({ kind: 'found', mission, version: missionVersion(1) }),
    save: async () => missionVersion(1), loadByRepository: async () => [mission] };
  const evidence = { identity: 'forgejo-review:1', source: 'forgejo-review', kind: 'review-decision', observedAt: closedAt,
    links: { repositoryId: repo, missionId: id, revision: null, pullRequest: 1 }, provenance: 'fixture',
    collectionEra: 'historical-reconstruction', classification: 'direct-observation', raw: { state: 'REQUEST_CHANGES', user: { login: 'human' } } };
  const history = new MockHistoryRepo([{ eventType: 'stats.recovery.evidence', eventData: JSON.stringify({ missionId: id, evidence }), createdAt: closedAt }]);
  const lanes = new MockLaneEventRepo([{ repositoryId: repo, missionId: id, fromStatus: 'integration', toStatus: 'done', trigger: 'land',
    agent: 'human', occurredAt: closedAt, idempotencyKey: 'land' }]);
  try {
    const builder = composeBoardProjection({ rootDir, missionStore: store, repositoryId: repo,
      blocklistRepo: new MockBlocklistRepo(), historyRepo: history, laneEventRepo: lanes, usageRepo: new MockUsageRepo(), knownAgentFamilies: [],
      launcherProbe: () => ({ available: true, detail: null }), readAgentConfig: () => null, detectRunningSessions: () => null,
      providerExecution: { observe: () => ({ observedAt: closedAt, complete: true, invocations: [], limitations: [] }) },
      gitFn: () => ({ status: 0, stdout: '', stderr: '' }), gateEvidence: { readDeclaredGates: async () => ({ checkout: { kind: 'absent' }, gates: [] }),
        readIntegrationGates: async () => ({ checkout: { kind: 'absent' }, configured: [], gates: [], running: null }) } }).builder;
    const current = await builder.build();
    assert.equal(current.metrics.analytics?.freshness, 'unavailable');
    await new Promise(resolve => setImmediate(resolve));
    const projection = await builder.build();
    assert.equal(projection.metrics.analytics?.freshness, 'fresh');
    assert.equal(projection.metrics.flow?.current.graph.nodes.find(node => node.id === 'implement')?.rework, 1);
    assert.equal(projection.metrics.flow?.current.sendBacks.human.numerator, 1);
  } finally { fs.rmSync(rootDir, { recursive: true, force: true }); }
});
