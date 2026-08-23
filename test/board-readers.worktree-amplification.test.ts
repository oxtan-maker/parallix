import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import { ConcreteGateReadAdapter } from '../src/adapters/backlog/concrete-gate-read-adapter.js';
import { ConcreteMissionReadAdapter } from '../src/adapters/backlog/concrete-mission-read-adapter.js';
import { BoardProjectionBuilder } from '../src/application/projections/board-readers.js';
import { snapshotWorktreeTopology } from '../src/adapters/git/worktree.js';
import { repositoryId } from '../src/domain/repository.js';

function taskDocument(id: string, title = id): string {
  return `---\nid: ${id}\ntitle: ${title}\nstatus: active\nassignee: codex\nlabels: [user_value]\nclosedAt: 2026-08-23\n---\n`;
}

function fixture(count: number, archive = false) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'px-board-read-amplification-'));
  const dir = path.join(rootDir, archive ? 'backlog/archive/tasks' : 'backlog/tasks');
  fs.mkdirSync(dir, { recursive: true });
  const taskFiles = new Map<string, string>();
  for (let number = 1; number <= count; number += 1) {
    const id = `task-${String(number).padStart(4, '0')}`;
    const file = path.join(dir, `${id}.md`);
    fs.writeFileSync(file, taskDocument(id), 'utf8');
    taskFiles.set(id, file);
  }
  return { rootDir, taskFiles };
}

async function buildWithCounts(count: number) {
  const { rootDir, taskFiles } = fixture(count);
  let gitCalls = 0;
  let taskReads = 0;
  const originalReadFileSync = fs.readFileSync;
  fs.readFileSync = ((filePath: fs.PathOrFileDescriptor, ...args: unknown[]) => {
    if (typeof filePath === 'string' && [...taskFiles.values()].includes(filePath)) {
      taskReads += 1;
    }
    return originalReadFileSync(filePath, ...(args as [BufferEncoding]));
  }) as typeof fs.readFileSync;
  syncBuiltinESMExports();

  const resolveTaskFile = (id: string) => {
    const taskFile = taskFiles.get(id.toLowerCase());
    return taskFile ? { ok: true, taskFile, matches: [taskFile] } : { ok: false, matches: [], reason: 'missing' };
  };
  const resolveWorktree = () => null;
  try {
    const missions = new ConcreteMissionReadAdapter({
      rootDir,
      repositoryId: repositoryId('test-repo'),
      resolveTaskFile,
      resolveWorktree,
    });
    const gates = new ConcreteGateReadAdapter({ rootDir, resolveWorktree });
    await new BoardProjectionBuilder(
      missions,
      { async loadReviews(ids) { return new Map(ids.map((id) => [id, { review: null, approval: null }])); } },
      gates,
      { async loadAgentAvailability() { return []; }, async loadAssignedAgent() { return null; } },
      { async loadRepositoryId() { return repositoryId('test-repo'); }, async loadHeadCommit() { return 'head'; } },
      { async loadOperationLog() { return []; } },
      {
        prepareReads: () => {
          const topology = snapshotWorktreeTopology({
            cwd: rootDir,
            gitFn: () => ({ status: 0, stdout: (gitCalls += 1, '') }),
            currentBranch: () => '',
          });
          missions.useWorktreeTopology(topology);
          gates.useWorktreeTopology(topology);
        },
      },
    ).build();
    return { gitCalls, taskReads, distinctTaskFiles: taskFiles.size };
  } finally {
    fs.readFileSync = originalReadFileSync;
    syncBuiltinESMExports();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
}

test('board projection worktree-list count is O(1) vs mission count', async () => {
  const five = await buildWithCounts(5);
  const fifty = await buildWithCounts(50);
  assert.ok(fifty.gitCalls <= five.gitCalls + 2, `${five.gitCalls} -> ${fifty.gitCalls}`);
});

test('board projection reads each distinct task document once for metadata', async () => {
  const result = await buildWithCounts(5);
  assert.equal(result.taskReads, result.distinctTaskFiles);
});

test('board projection does not scan or materialize backlog archive', async () => {
  const { rootDir } = fixture(1, true);
  const archiveDir = path.join(rootDir, 'backlog/archive/tasks');
  const originalExistsSync = fs.existsSync;
  const originalReaddirSync = fs.readdirSync;
  const scanned: string[] = [];
  fs.existsSync = ((candidate: fs.PathLike) => {
    if (candidate === archiveDir) { scanned.push('exists'); }
    return originalExistsSync(candidate);
  }) as typeof fs.existsSync;
  fs.readdirSync = ((candidate: fs.PathLike, ...args: unknown[]) => {
    if (candidate === archiveDir) { scanned.push('readdir'); }
    return originalReaddirSync(candidate, ...(args as []));
  }) as typeof fs.readdirSync;
  syncBuiltinESMExports();
  try {
    const missions = await new ConcreteMissionReadAdapter({ rootDir, repositoryId: repositoryId('test-repo') }).loadAllMissions();
    assert.deepEqual(missions, []);
    assert.deepEqual(scanned, []);
  } finally {
    fs.existsSync = originalExistsSync;
    fs.readdirSync = originalReaddirSync;
    syncBuiltinESMExports();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});
