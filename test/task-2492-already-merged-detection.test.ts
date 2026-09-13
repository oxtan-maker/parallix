import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { findExistingSquashCommit } from '../src/adapters/cli/commands/integrate-conflict.js';
import { recoverMissionCommand } from '../src/interfaces/cli/recover.js';
import { recoverMissionLifecycle } from '../src/application/mission-lifecycle-recovery.js';
import { missionId } from '../src/domain/mission.js';

// Fixture-git coverage for the TASK-2492 detection wiring. Integration lands
// mission work with `git merge --squash`, so a landed mission branch tip is not
// reachable from `main`; detection must key on the squash commit subject, not
// branch ancestry. This test exercises the real `findExistingSquashCommit` seam
// against a live repo (SC1/SC5).
function makeRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2492-detect-'));
  const run = (args: string[]) => {
    const { status, stdout, stderr } = git(args, dir);
    if (status !== 0) { throw new Error(`git ${args.join(' ')} failed: ${stderr}`); }
    return stdout.trim();
  };
  run(['init', '-b', 'main']);
  run(['config', 'user.email', 'test@parallix.test']);
  run(['config', 'user.name', 'Test']);
  run(['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(dir, 'README.md'), '# base\n');
  run(['add', '.']);
  run(['commit', '-m', 'base']);
  return dir;
}

// Lightweight git runner scoped to a repo dir to avoid importing the module
// singleton and keep the fixture self-contained.
function git(args: string[], cwd: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { status: result.status, stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? '') };
}

test('TASK-2492: squash-landed mission payload is detected as already merged', () => {
  const rootDir = makeRepo();
  try {
    // Branch carries its own committed work.
    git(['checkout', '-b', 'mission/task-2492'], rootDir);
    fs.writeFileSync(path.join(rootDir, 'feature.txt'), 'work\n');
    git(['add', '.'], rootDir);
    git(['commit', '-m', 'add feature'], rootDir);

    // Squash-land onto main, exactly as `px integrate` does.
    git(['checkout', 'main'], rootDir);
    git(['merge', '--squash', 'mission/task-2492'], rootDir);
    git(['commit', '-m', 'mission/task-2492: add feature'], rootDir);

    // Authoritative payload containment: the squash commit subject is on main.
    const sha = findExistingSquashCommit(rootDir, 'task-2492');
    assert.ok(sha, 'squash commit for task-2492 must be found in the primary log');
    assert.match(sha as string, /^[0-9a-f]{40}$/);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('TASK-2492: branch with no committed payload is not reported as merged', () => {
  const rootDir = makeRepo();
  try {
    // Empty branch, nothing committed ahead of main — must never read as landed.
    git(['checkout', '-b', 'mission/task-2481'], rootDir);

    const sha = findExistingSquashCommit(rootDir, 'task-2481');
    assert.equal(sha, null);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('TASK-2492: recover command refuses a squash-landed mission and cleans up exactly once', async () => {
  const rootDir = makeRepo();
  try {
    git(['checkout', '-b', 'mission/task-2492'], rootDir);
    fs.writeFileSync(path.join(rootDir, 'feature.txt'), 'work\n');
    git(['add', '.'], rootDir);
    git(['commit', '-m', 'add feature'], rootDir);
    git(['checkout', 'main'], rootDir);
    git(['merge', '--squash', 'mission/task-2492'], rootDir);
    git(['commit', '-m', 'mission/task-2492: add feature'], rootDir);

    const mission = {
      id: missionId('task-2492'), repositoryId: 'repo' as never, title: 'Fixture', labels: [], assignee: null,
      checkpoints: [], review: null, netEngineeringLines: null, status: 'active' as const, closedAt: null,
    };
    const errors: string[] = [];
    let cleanupCalls = 0;
    const resumed = await recoverMissionCommand(['task-2492'], {
      // Real detection seam, wired like src/composition/create-cli.ts.
      taskStatus: () => 'active',
      alreadyMerged: (async (slug: string) => findExistingSquashCommit(rootDir, slug) !== null) as () => Promise<boolean>,
      cleanup: () => { cleanupCalls += 1; return true; },
      error: (message) => errors.push(message),
      store: {
        async load() { return { kind: 'found' as const, mission, version: 18 as never }; },
        async save() { throw new Error('must not reopen'); },
        async saveWithTransition() { throw new Error('must not reopen'); },
        async findTransitions() { return []; },
      } as never,
    });

    assert.equal(resumed, false);
    assert.equal(cleanupCalls, 1, 'cleanup must run exactly once');
    assert.deepEqual(errors, ['Recovery refused: durable integration history keeps this mission closed.']);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('TASK-2492: recovery does not fire for a not-yet-committed mission', async () => {
  const rootDir = makeRepo();
  try {
    git(['checkout', '-b', 'mission/task-2481'], rootDir);
    const mission = {
      id: missionId('task-2481'), repositoryId: 'repo' as never, title: 'Fixture', labels: [], assignee: null,
      checkpoints: [], review: null, netEngineeringLines: null, status: 'active' as const, closedAt: null,
    };
    let saved = 0;
    const result = await recoverMissionLifecycle({
      missionId: mission.id, taskStatus: 'active', actor: 'codex', occurredAt: new Date().toISOString(),
      alreadyMerged: (async (slug: string) => findExistingSquashCommit(rootDir, slug) !== null) as () => Promise<boolean>,
      store: {
        async load() { return { kind: 'found' as const, mission, version: 1 as never }; },
        async save() { saved += 1; return 2 as never; },
        async saveWithTransition() { saved += 1; return 3 as never; },
        async findTransitions() { return []; },
      } as never,
    });

    assert.equal(result.value?.action, 'none', 'not-landed mission must not be refused as integrated');
    assert.equal(saved, 0, 'recovery must not reopen or persist a not-landed mission');
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});
