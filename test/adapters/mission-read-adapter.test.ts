import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

import { ConcreteMissionReadAdapter } from '../../src/adapters/backlog/concrete-mission-read-adapter.js';
import { missionId, missionLabels } from '../../src/domain/mission.js';
import { agentFamily } from '../../src/domain/agents.js';
import { repositoryId } from '../../src/domain/repository.js';
import type {
  BacklogMissionSnapshot,
  BacklogMissionMaterializationResult,
} from '../../src/adapters/backlog/mission-materialization.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a temporary directory with a realistic backlog structure. */
function createTempBacklog(files: Record<string, string>, rootDir?: string): string {
  const tmp = rootDir || fs.mkdtempSync(path.join(os.tmpdir(), 'px-mra-test-'));
  const tasksDir = path.join(tmp, 'backlog', 'tasks');
  const completedDir = path.join(tmp, 'backlog', 'completed');
  const archiveDir = path.join(tmp, 'backlog', 'archive', 'tasks');

  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = path.join(tmp, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf8');
  }

  return tmp;
}

function taskMd(frontmatter: Record<string, string | string[]>): string {
  const lines = Object.entries(frontmatter).map(([key, val]) => {
    if (Array.isArray(val)) {
      return `${key}:\n${val.map((v) => `  - ${v}`).join('\n')}`;
    }
    return `${key}: ${val}`;
  });
  return `---\n${lines.join('\n')}\n---\n\n# Task content\n`;
}

// ---------------------------------------------------------------------------
// loadAllMissions tests
// ---------------------------------------------------------------------------

test('ConcreteMissionReadAdapter loadAllMissions returns missions from tasks store', async () => {
  const tmp = createTempBacklog({
    'backlog/tasks/task-1001 - first task.md': taskMd({
      id: 'TASK-1001',
      status: 'refined',
      assignee: 'codex',
      title: 'First Task',
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
      resolveWorktree: () => null,
    });

    const missions = await adapter.loadAllMissions();
    assert.equal(missions.length, 1);
    assert.equal(missions[0].id, 'task-1001');
    assert.equal(missions[0].status, 'refined');
    assert.equal(missions[0].title, 'First Task');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('ConcreteMissionReadAdapter loadAllMissions returns missions from completed store', async () => {
  const tmp = createTempBacklog({
    'backlog/completed/task-2001 - done task.md': taskMd({
      id: 'TASK-2001',
      status: 'done',
      assignee: 'codex',
      title: 'Done Task',
      closedAt: '2026-07-01T00:00:00Z',
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
      resolveWorktree: () => null,
    });

    const missions = await adapter.loadAllMissions();
    assert.equal(missions.length, 1);
    assert.equal(missions[0].id, 'task-2001');
    assert.equal(missions[0].status, 'done');
    assert.equal(missions[0].closedAt, '2026-07-01T00:00:00Z');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('ConcreteMissionReadAdapter loadAllMissions reads from tasks, completed, and archive stores', async () => {
  const tmp = createTempBacklog({
    'backlog/tasks/task-1001 - active.md': taskMd({
      id: 'TASK-1001',
      status: 'active',
      assignee: 'codex',
      title: 'Active Task',
    }),
    'backlog/completed/task-2001 - done.md': taskMd({
      id: 'TASK-2001',
      status: 'done',
      assignee: 'codex',
      title: 'Done Task',
      closedAt: '2026-07-01T00:00:00Z',
    }),
    'backlog/archive/tasks/task-3001 - archived.md': taskMd({
      id: 'TASK-3001',
      status: 'done',
      assignee: 'codex',
      title: 'Archived Task',
      closedAt: '2026-06-01T00:00:00Z',
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
      resolveWorktree: () => null,
    });

    const missions = await adapter.loadAllMissions();
    assert.equal(missions.length, 3);
    assert.equal(missions[0].id, 'task-1001');
    assert.equal(missions[1].id, 'task-2001');
    assert.equal(missions[2].id, 'task-3001');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('ConcreteMissionReadAdapter deduplicates task ids across stores preferring lower-priority directory', async () => {
  const tmp = createTempBacklog({
    'backlog/tasks/task-1001 - stale copy.md': taskMd({
      id: 'TASK-1001',
      status: 'active',
      assignee: 'codex',
      title: 'Stale Copy',
    }),
    'backlog/completed/task-1001 - canonical.md': taskMd({
      id: 'TASK-1001',
      status: 'done',
      assignee: 'codex',
      title: 'Canonical Done',
      closedAt: '2026-07-01T00:00:00Z',
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
      resolveWorktree: () => null,
    });

    const missions = await adapter.loadAllMissions();
    assert.equal(missions.length, 1);
    assert.equal(missions[0].id, 'task-1001');
    assert.equal(missions[0].status, 'active'); // tasks/ copy (priority 0) preferred over completed/ (priority 1)
    // The "active" status is mapped by missionStatusFromBacklog
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('ConcreteMissionReadAdapter returns empty array when no task files exist', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'px-mra-empty-'));
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
      resolveWorktree: () => null,
    });

    const missions = await adapter.loadAllMissions();
    assert.equal(missions.length, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('ConcreteMissionReadAdapter getSourceFacts returns non-empty source facts after load', async () => {
  const tmp = createTempBacklog({
    'backlog/tasks/task-1001 - first.md': taskMd({
      id: 'TASK-1001',
      status: 'refined',
      assignee: 'codex',
      title: 'First',
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
      resolveWorktree: () => null,
    });

    await adapter.loadAllMissions();
    const facts = adapter.getSourceFacts();
    assert.ok(facts.length > 0);
    assert.equal(facts[0].source, 'task-markdown');
    assert.ok(facts[0].value?.includes('task-1001'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// loadMission tests
// ---------------------------------------------------------------------------

test('ConcreteMissionReadAdapter loadMission returns mission by id', async () => {
  const tmp = createTempBacklog({
    'backlog/tasks/task-5001 - specific.md': taskMd({
      id: 'TASK-5001',
      status: 'refined',
      assignee: 'custom',
      title: 'Specific Task',
    }),
  });
  try {
    const tasksDir = path.join(tmp, 'backlog', 'tasks');
    const adapter = new ConcreteMissionReadAdapter({
      rootDir: tmp,
      repositoryId: repositoryId('test-repo'),
      resolveTaskFile: (slug) => {
        const files = fs.readdirSync(tasksDir).filter((f) => f.endsWith('.md'));
        const file = files.find((f) => f.toLowerCase().startsWith(slug.toLowerCase()));
        if (file) return { ok: true, taskFile: path.join(tasksDir, file), matches: [file] };
        return { ok: false, matches: [] };
      },
      getTaskStorage: () => ({
        tasksDir,
        completedDir: path.join(tmp, 'backlog', 'completed'),
        archiveTasksDir: path.join(tmp, 'backlog', 'archive', 'tasks'),
      }),
      findMissionDir: () => null,
      findCheckpoints: () => [],
      resolveWorktree: () => null,
    });

    const mission = await adapter.loadMission(missionId('task-5001'));
    assert.ok(mission !== null);
    assert.equal(mission!.id, 'task-5001');
    assert.equal(mission!.title, 'Specific Task');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('ConcreteMissionReadAdapter loadMission returns null for missing id', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'px-mra-missing-'));
  try {
    const adapter = new ConcreteMissionReadAdapter({
      rootDir: tmp,
      repositoryId: repositoryId('test-repo'),
      resolveTaskFile: () => ({ ok: false, matches: [] }),
      getTaskStorage: () => ({
        tasksDir: path.join(tmp, 'backlog', 'tasks'),
        completedDir: path.join(tmp, 'backlog', 'completed'),
        archiveTasksDir: path.join(tmp, 'backlog', 'archive', 'tasks'),
      }),
      findMissionDir: () => null,
      findCheckpoints: () => [],
      resolveWorktree: () => null,
    });

    const mission = await adapter.loadMission(missionId('task-9999'));
    assert.equal(mission, null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// materializeBacklogMission outcome coverage
// ---------------------------------------------------------------------------

test('Materialization: found with integration-base content and absent worktree', async () => {
  const tmp = createTempBacklog({
    'backlog/tasks/task-6001 - base content.md': taskMd({
      id: 'TASK-6001',
      status: 'refined',
      assignee: 'codex',
      title: 'Base Content',
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
      resolveWorktree: () => null, // absent worktree
    });

    const missions = await adapter.loadAllMissions();
    assert.equal(missions.length, 1);
    assert.equal(missions[0].status, 'refined');
    assert.equal(missions[0].closedAt, null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('Materialization: completed task with closedAt becomes ClosedMission', async () => {
  const tmp = createTempBacklog({
    'backlog/completed/task-7001 - closed.md': taskMd({
      id: 'TASK-7001',
      status: 'done',
      assignee: 'codex',
      title: 'Closed Mission',
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
      resolveWorktree: () => null,
    });

    const missions = await adapter.loadAllMissions();
    assert.equal(missions.length, 1);
    assert.equal(missions[0].status, 'done');
    assert.equal(missions[0].closedAt, '2026-07-15T12:00:00Z');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('Materialization: status mapping from backlog vocabulary', async () => {
  const tmp = createTempBacklog({
    'backlog/tasks/task-8001 - ready.md': taskMd({
      id: 'TASK-8001',
      status: 'ready',
      assignee: 'codex',
      title: 'Ready',
    }),
    'backlog/tasks/task-8002 - approved.md': taskMd({
      id: 'TASK-8002',
      status: 'approved',
      assignee: 'codex',
      title: 'Approved',
    }),
    'backlog/tasks/task-8003 - integration.md': taskMd({
      id: 'TASK-8003',
      status: 'integration',
      assignee: 'codex',
      title: 'Integration',
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
      resolveWorktree: () => null,
    });

    const missions = await adapter.loadAllMissions();
    assert.equal(missions.length, 3);

    const byId = new Map(missions.map((m) => [m.id, m]));
    assert.equal(byId.get(missionId('task-8001'))!.status, 'refined'); // ready -> refined
    assert.equal(byId.get(missionId('task-8002'))!.status, 'integration'); // approved -> integration
    assert.equal(byId.get(missionId('task-8003'))!.status, 'integration');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// unavailable source facts
// ---------------------------------------------------------------------------

test('ConcreteMissionReadAdapter records unavailable source fact for materialization failures', async () => {
  const tmp = createTempBacklog({
    'backlog/completed/task-9001 - done without closedAt.md': taskMd({
      id: 'TASK-9001',
      status: 'done',
      assignee: 'codex',
      title: 'Done Without ClosedAt',
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
      resolveWorktree: () => null,
    });

    const missions = await adapter.loadAllMissions();
    // A done task in completed store without closedAt fails materialization
    // (closure-time-missing) because worktree is absent but no closedAt
    assert.equal(missions.length, 0);

    const facts = adapter.getSourceFacts();
    assert.equal(facts.length, 1);
    assert.equal(facts[0].status, 'unavailable');
    assert.equal(facts[0].value, 'closure-time-missing');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// worktree present
// ---------------------------------------------------------------------------

test('ConcreteMissionReadAdapter uses worktree content when worktree is present', async () => {
  const tmp = createTempBacklog({
    'backlog/tasks/task-4001 - base.md': taskMd({
      id: 'TASK-4001',
      status: 'integration',
      assignee: 'codex',
      title: 'Base Title',
    }),
  });
  try {
    // Simulate a worktree with updated content
    const worktreePath = path.join(tmp, 'worktree', 'task-4001');
    const worktreeTasksDir = path.join(worktreePath, 'backlog', 'tasks');
    fs.mkdirSync(worktreeTasksDir, { recursive: true });
    fs.writeFileSync(
      path.join(worktreeTasksDir, 'task-4001 - worktree.md'),
      taskMd({
        id: 'TASK-4001',
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
      resolveWorktree: (slug) => {
        if (slug === 'task-4001') return worktreePath;
        return null;
      },
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
    // Integration base owns status; worktree provides content
    assert.equal(missions[0].status, 'integration');
    assert.equal(missions[0].assignee, 'codex'); // base assignee
    assert.equal(missions[0].title, 'Worktree Title'); // worktree title
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
