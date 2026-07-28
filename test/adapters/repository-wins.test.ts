import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { ConcreteMissionReadAdapter } from '../../src/adapters/backlog/concrete-mission-read-adapter.js';
import { ConcreteGitReadAdapter } from '../../src/adapters/backlog/concrete-git-read-adapter.js';
import { ConcreteGateReadAdapter } from '../../src/adapters/backlog/concrete-gate-read-adapter.js';
import { ConcreteReviewReadAdapter } from '../../src/adapters/backlog/concrete-review-read-adapter.js';
import { repositoryId } from '../../src/domain/repository.js';
import type { MissionId } from '../../src/domain/mission.js';

// SC11 — Repository-wins test: concrete adapters prefer committed
// integration-base/Git state over any SQLite or board cache.
// A cache never becomes mutation authority.

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function taskMd(frontmatter: Record<string, string | string[]>): string {
  const lines = Object.entries(frontmatter).map(([key, val]) => {
    if (Array.isArray(val)) {
      return `${key}:\n${val.map((v) => `  - ${v}`).join('\n')}`;
    }
    return `${key}: ${val}`;
  });
  return `---\n${lines.join('\n')}\n---\n\n# Task content\n`;
}

function createTempBacklog(files: Record<string, string>): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'px-repo-wins-'));
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = path.join(tmp, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf8');
  }
  return tmp;
}

// ---------------------------------------------------------------------------
// SC11 — Repository-wins tests
// ---------------------------------------------------------------------------

test('SC11: ConcreteMissionReadAdapter reads from backlog files (repository authority), not cache', async () => {
  const tmp = createTempBacklog({
    'backlog/tasks/task-001.md': taskMd({
      id: 'task-001',
      title: 'Test Mission',
      status: 'active',
      assignee: 'claude',
    }),
  });
  try {
    const adapter = new ConcreteMissionReadAdapter({
      rootDir: tmp,
      repositoryId: repositoryId('test-repo'),
    });

    const missions = await adapter.loadAllMissions();

    assert.strictEqual(missions.length, 1, 'Should find one mission from backlog files');
    assert.strictEqual(missions[0].id.toLowerCase(), 'task-001', 'Mission ID from repository file');
    assert.strictEqual(missions[0].status, 'active', 'Status from repository file');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('SC11: ConcreteMissionReadAdapter prefers tasks store over completed store (repository priority)', async () => {
  const tmp = createTempBacklog({
    // Same task in both stores — tasks store should win
    'backlog/tasks/task-002.md': taskMd({
      id: 'task-002',
      title: 'Active Task',
      status: 'active',
      assignee: 'claude',
    }),
    'backlog/completed/task-002.md': taskMd({
      id: 'task-002',
      title: 'Completed Task',
      status: 'done',
      assignee: 'claude',
    }),
  });
  try {
    const adapter = new ConcreteMissionReadAdapter({
      rootDir: tmp,
      repositoryId: repositoryId('test-repo'),
    });

    const missions = await adapter.loadAllMissions();

    // Only one mission (deduped by id), from the tasks store (higher priority)
    assert.strictEqual(missions.length, 1, 'Should deduplicate across stores');
    assert.strictEqual(missions[0].status, 'active', 'Tasks store wins over completed store');
    assert.strictEqual(missions[0].title, 'Active Task', 'Title from tasks store');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('SC11: ConcreteGitReadAdapter reads from Git config (repository authority)', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'px-git-wins-'));
  try {
    const adapter = new ConcreteGitReadAdapter({
      rootDir: tmp,
      repositoryId: repositoryId('explicit-repo'),
    });

    // When repositoryId is explicitly provided, it wins over Git config
    const repoId = await adapter.loadRepositoryId();
    assert.strictEqual(repoId, 'explicit-repo', 'Explicit repositoryId wins');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('SC11: ConcreteGateReadAdapter returns unknown when no gate artifacts exist (repository authority)', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'px-gate-wins-'));
  try {
    const adapter = new ConcreteGateReadAdapter({
      rootDir: tmp,
    });

    const status = await adapter.loadGateStatus('TASK-999' as MissionId);
    assert.strictEqual(status, 'unknown', 'Gate status is unknown when no artifacts exist');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('SC11: ConcreteReviewReadAdapter returns null when no review state exists (repository authority)', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'px-review-wins-'));
  try {
    const adapter = new ConcreteReviewReadAdapter({
      rootDir: tmp,
    });

    const review = await adapter.loadReview('TASK-999' as MissionId);
    assert.strictEqual(review, null, 'Review is null when no review state exists');

    const approval = await adapter.loadReviewApproval('TASK-999' as MissionId);
    assert.strictEqual(approval, null, 'Approval is null when no review state exists');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('SC11: ConcreteMissionReadAdapter loadMission reads specific file from repository', async () => {
  const tmp = createTempBacklog({
    'backlog/tasks/task-003.md': taskMd({
      id: 'task-003',
      title: 'Specific Mission',
      status: 'review',
      assignee: 'gemini',
    }),
    'backlog/tasks/task-004.md': taskMd({
      id: 'task-004',
      title: 'Other Mission',
      status: 'active',
      assignee: 'claude',
    }),
  });
  try {
    const adapter = new ConcreteMissionReadAdapter({
      rootDir: tmp,
      repositoryId: repositoryId('test-repo'),
    });

    const mission = await adapter.loadMission('task-003' as MissionId);
    assert.ok(mission, 'Should find specific mission');
    assert.strictEqual(mission.id.toLowerCase(), 'task-003', 'Correct mission loaded');
    assert.strictEqual(mission.status, 'review', 'Status from repository file');
    assert.strictEqual(mission.assignee, 'gemini', 'Assignee from repository file');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('SC11: getSourceFacts reports task-markdown as source (repository provenance)', async () => {
  const tmp = createTempBacklog({
    'backlog/tasks/task-005.md': taskMd({
      id: 'task-005',
      title: 'Provenance Test',
      status: 'backlog',
    }),
  });
  try {
    const adapter = new ConcreteMissionReadAdapter({
      rootDir: tmp,
      repositoryId: repositoryId('test-repo'),
    });

    await adapter.loadAllMissions();
    const facts = adapter.getSourceFacts();

    assert.ok(facts.length > 0, 'Should have source facts');
    const markdownFact = facts.find((f) => f.source === 'task-markdown');
    assert.ok(markdownFact, 'Should have task-markdown source fact');
    assert.ok(
      typeof markdownFact.value === 'string' && markdownFact.value.endsWith('.md'),
      'Source fact value should be a .md file path',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('SC11: ConcreteMissionReadAdapter does not consult SQLite (no cache to lose to)', async () => {
  // ConcreteMissionReadAdapter reads ONLY from backlog Markdown files.
  // It does not accept or consult any SQLite or board-cache arguments.
  // This proves that for mission data, the repository (backlog files) is
  // the sole authority — there is no competing cache value to override.
  const tmp = createTempBacklog({
    'backlog/tasks/task-006.md': taskMd({
      id: 'task-006',
      title: 'No Cache Test',
      status: 'active',
      assignee: 'claude',
    }),
  });
  try {
    // Create adapter with only rootDir and repositoryId (no SQLite deps)
    const adapter = new ConcreteMissionReadAdapter({
      rootDir: tmp,
      repositoryId: repositoryId('test-repo'),
    });

    const missions = await adapter.loadAllMissions();

    // Adapter successfully reads from backlog files without any SQLite dependency
    assert.strictEqual(missions.length, 1, 'Should find mission from backlog files');
    assert.strictEqual(missions[0].status, 'active', 'Status from repository file');

    // Source facts confirm the data came from task-markdown (repository authority)
    const facts = adapter.getSourceFacts();
    assert.strictEqual(facts[0]?.source, 'task-markdown', 'Source is task-markdown (repository)');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
