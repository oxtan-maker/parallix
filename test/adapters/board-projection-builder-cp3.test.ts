import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

import { composeBoardProjection } from '../../src/composition/board-projection.js';
import { BoardProjectionBuilder } from '../../src/application/projections/board-readers.js';
import { ConcreteMissionReadAdapter } from '../../src/adapters/backlog/concrete-mission-read-adapter.js';
import { ConcreteReviewReadAdapter } from '../../src/adapters/backlog/concrete-review-read-adapter.js';
import { ConcreteGateReadAdapter } from '../../src/adapters/backlog/concrete-gate-read-adapter.js';
import { ConcreteAgentReadAdapter } from '../../src/adapters/backlog/concrete-agent-read-adapter.js';
import { ConcreteOperationLogReadAdapter } from '../../src/adapters/backlog/concrete-operation-log-read-adapter.js';
import { ConcreteGitReadAdapter } from '../../src/adapters/backlog/concrete-git-read-adapter.js';
import { agentFamily } from '../../src/domain/agents.js';
import { missionId, missionLabels } from '../../src/domain/mission.js';
import { repositoryId } from '../../src/domain/repository.js';
import type {
  AgentBlocklistRepository,
  BoardLaneEventRepository,
  OperationalHistoryRepository,
  UsageRepository,
} from '../../src/adapters/sqlite/ports.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function taskMd(frontmatter: Record<string, string>): string {
  const lines = Object.entries(frontmatter).map(([key, val]) => `${key}: ${val}`);
  return `---\n${lines.join('\n')}\n---\n\n# Task content\n`;
}

function createTempBacklog(files: Record<string, string>): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'px-board-test-'));
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
  async findAll() { return []; }
  async findByType() { return []; }
  async append() {}
  async clear() {}
}

class MockLaneEventRepo implements BoardLaneEventRepository {
  async findAll() { return []; }
  async findByMissionId() { return []; }
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

test('BoardProjectionBuilder is wired in composition root over all six concrete adapters', async () => {
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
      repositoryId: repositoryId('test-repo'),
      blocklistRepo: new MockBlocklistRepo(),
      historyRepo: new MockHistoryRepo(),
      laneEventRepo: new MockLaneEventRepo(),
      usageRepo: new MockUsageRepo(),
      knownAgentFamilies: [agentFamily('codex'), agentFamily('claude')],
    }).builder;

    assert.ok(builder instanceof BoardProjectionBuilder);

    const projection = await builder.build();
    assert.equal(projection.repositoryId, 'test-repo');
    assert.ok(Array.isArray(projection.stages));
    assert.ok(Array.isArray(projection.attentionQueue));
    assert.ok(Array.isArray(projection.wipCounts));
    assert.ok(Array.isArray(projection.sourceFacts));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('BoardProjectionBuilder.build() returns BoardProjection with missions from concrete adapter', async () => {
  const tmp = createTempBacklog({
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
      repositoryId: repositoryId('test-repo'),
      blocklistRepo: new MockBlocklistRepo(),
      historyRepo: new MockHistoryRepo(),
      laneEventRepo: new MockLaneEventRepo(),
      usageRepo: new MockUsageRepo(),
      knownAgentFamilies: [agentFamily('codex')],
    }).builder;

    const projection = await builder.build();

    // Should have missions from both stores
    const totalCards = projection.stages.reduce((sum, stage) => sum + stage.count, 0);
    assert.equal(totalCards, 2);

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
        if (!fs.existsSync(tasksDir)) return { ok: false, matches: [] };
        const files = fs.readdirSync(tasksDir).filter((f) => f.endsWith('.md'));
        const file = files.find((f) => f.toLowerCase().startsWith(slug.toLowerCase()));
        if (file) return { ok: true, taskFile: path.join(tasksDir, file), matches: [file] };
        return { ok: false, matches: [] };
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
        if (!fs.existsSync(tasksDir)) return { ok: false, matches: [] };
        const files = fs.readdirSync(tasksDir).filter((f) => f.endsWith('.md'));
        const file = files.find((f) => f.toLowerCase().startsWith(slug.toLowerCase()));
        if (file) return { ok: true, taskFile: path.join(tasksDir, file), matches: [file] };
        return { ok: false, matches: [] };
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
    assert.equal(missions[0].closedAt, '2026-07-15T12:00:00Z'); // closed
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('composeBoardProjection wires all eight adapters into BoardProjectionBuilder', () => {
  const builder = composeBoardProjection({
    rootDir: '/tmp',
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
