import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { recoverMissionCommand } from '../src/interfaces/cli/recover.js';
import { landedMissionIntake } from '../src/adapters/cli/commands/recover-landed-intake.js';
import { status } from '../src/adapters/cli/commands/status.js';
import { missionId, type Mission } from '../src/domain/mission.js';
import { missionVersion } from '../src/application/domain-ports.js';

const slug = 'task-2516-fixture';

function git(root: string, args: string[]) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return String(result.stdout).trim();
}

/** Same as landedFixture but the payload is never squash-landed on base. */
function unlandedFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2516-unlanded-'));
  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@parallix.test']);
  git(root, ['config', 'user.name', 'Test']);
  fs.mkdirSync(path.join(root, 'backlog', 'completed'), { recursive: true });
  fs.mkdirSync(path.join(root, 'missions', slug), { recursive: true });
  fs.writeFileSync(path.join(root, 'backlog', 'completed', `${slug} - fixture.md`), `---\nid: ${slug.toUpperCase()}\ntitle: Unlanded fixture\nstatus: done\nlabels: [bug]\n---\n`);
  fs.writeFileSync(path.join(root, 'missions', slug, 'MISSION.md'), `# Fixture\n\nBase-Branch: main\n`);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'completed task']);
  git(root, ['checkout', '-b', `mission/${slug}`]);
  fs.writeFileSync(path.join(root, 'payload.txt'), 'unlanded payload\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'payload']);
  git(root, ['checkout', 'main']);
  // No squash merge onto main: the payload never lands on the recorded base.
  const worktree = `${root}-${slug}`;
  git(root, ['worktree', 'add', worktree, `mission/${slug}`]);
  return { root, worktree };
}

function landedFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2516-'));
  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@parallix.test']);
  git(root, ['config', 'user.name', 'Test']);
  fs.mkdirSync(path.join(root, 'backlog', 'completed'), { recursive: true });
  fs.mkdirSync(path.join(root, 'missions', slug), { recursive: true });
  fs.writeFileSync(path.join(root, 'backlog', 'completed', `${slug} - fixture.md`), `---\nid: ${slug.toUpperCase()}\ntitle: Recovered fixture\nstatus: done\nlabels: [bug]\n---\n`);
  fs.writeFileSync(path.join(root, 'missions', slug, 'MISSION.md'), `# Fixture\n\nBase-Branch: main\n`);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'completed task']);
  git(root, ['checkout', '-b', `mission/${slug}`]);
  fs.writeFileSync(path.join(root, 'payload.txt'), 'landed payload\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'payload']);
  git(root, ['checkout', 'main']);
  git(root, ['merge', '--squash', `mission/${slug}`]);
  git(root, ['commit', '-m', `mission/${slug}: landed payload`]);
  const worktree = `${root}-${slug}`;
  git(root, ['worktree', 'add', worktree, `mission/${slug}`]);
  return { root, worktree };
}

test('TASK-2516: completed landed mission without an aggregate recovers once, projects done, then cleans up', async () => {
  const { root, worktree } = landedFixture();
  const stored: Mission[] = [];
  const cleanupOrder: string[] = [];
  try {
    const recovered = await recoverMissionCommand([slug], {
      taskStatus: () => 'done',
      rootDir: root,
      landedIntake: async (s: string) => landedMissionIntake(s, root),
      store: {
        async load() { return stored[0] ? { kind: 'found' as const, mission: stored[0], version: missionVersion(1) } : { kind: 'missing' as const }; },
        async save(mission) { stored[0] = mission; return missionVersion(1); },
        async saveWithTransition(mission) { stored[0] = mission; return missionVersion(1); },
      },
      cleanup: () => {
        assert.equal(stored[0]?.status, 'done', 'cleanup must follow durable closeout');
        assert.ok(stored[0]?.closedAt, 'status projection reads the closed aggregate');
        cleanupOrder.push('cleanup');
        git(root, ['worktree', 'remove', '--force', worktree]);
        git(root, ['branch', '-D', `mission/${slug}`]);
        return true;
      },
    } as never);

    assert.equal(recovered, true, 'the completed, squash-landed fixture must recover');
    assert.equal(stored.length, 1, 'recovery persists exactly one aggregate');
    assert.equal(stored[0]?.status, 'done');
    assert.ok(stored[0]?.closedAt, 'the persisted aggregate is status-projectable as closed/done');
    assert.deepEqual(cleanupOrder, ['cleanup']);

    const statusLines: string[] = [];
    await status([slug], {
      getCurrentBranchFn: () => 'main',
      buildProjectionFn: async () => ({ build: async () => ({ stages: [{ cards: [{ id: slug, status: stored[0]?.status, rawStatus: 'done', checkpoint: null, checkpointDescription: null }] }] }) }),
      getPrStatusFn: () => ({ exists: false }), readAgentConfigOrExitFn: () => ({}),
      eligibleAgentsForStepFn: () => [], workflowLauncherStatusFn: () => ({ supported: true }),
      getLastThreeCommitsFn: () => [], getUncommittedCountFn: () => 0,
      detectRebaseStateFn: () => ({ inProgress: false, detached: false, unmergedFiles: [] }),
      log: line => statusLines.push(line), exit: () => {},
    } as never);
    assert.ok(statusLines.includes('Backlog status: done'), 'px status projects the recovered aggregate as done');

    const repeated = await recoverMissionCommand([slug], {
      taskStatus: () => 'done', rootDir: root,
      landedIntake: async (s: string) => landedMissionIntake(s, root),
      store: {
        async load() { return { kind: 'found' as const, mission: stored[0], version: missionVersion(1) }; },
        async save() { throw new Error('repeat must not write'); },
        async saveWithTransition() { throw new Error('repeat must not write'); },
      },
      cleanup: () => { throw new Error('repeat must not clean up'); },
    } as never);
    assert.equal(repeated, true, 'repeat recovery is an idempotent no-op');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('TASK-2516: unlanded payload is refused without mutation and leaves the worktree and branch intact', async () => {
  const { root, worktree } = unlandedFixture();
  const stored: Mission[] = [];
  try {
    const refused = await recoverMissionCommand([slug], {
      taskStatus: () => 'done', rootDir: root,
      landedIntake: async (s: string) => landedMissionIntake(s, root),
      store: {
        async load() { return { kind: 'missing' as const }; },
        async save() { throw new Error('refusal must not persist an aggregate'); },
        async saveWithTransition() { throw new Error('refusal must not persist an aggregate'); },
      },
      cleanup: () => { throw new Error('refusal must not clean up'); },
    } as never);
    assert.equal(refused, false, 'an unlanded payload is refused');
    assert.equal(stored.length, 0, 'no closed/done aggregate is created for an unlanded payload');
    assert.ok(fs.existsSync(worktree), 'the stale worktree survives a refused recovery');
    const branchList = git(root, ['branch', '--list', `mission/${slug}`]);
    assert.ok(branchList.includes(`mission/${slug}`), 'the mission branch survives a refused recovery');
  } finally {
    git(root, ['worktree', 'remove', '--force', worktree]);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('TASK-2516: a closeout that cannot be read back leaves cleanup unattempted', async () => {
  const { root, worktree } = landedFixture();
  try {
    const failed = await recoverMissionCommand([slug], {
      taskStatus: () => 'done', rootDir: root,
      landedIntake: async (s: string) => landedMissionIntake(s, root),
      store: {
        async load() { return { kind: 'missing' as const }; },
        async save() { throw new Error('failed closeout must not persist'); },
        async saveWithTransition() { return missionVersion(1); },
      },
      cleanup: () => { throw new Error('cleanup must not run when closeout cannot be read back'); },
    } as never);
    assert.equal(failed, false, 'a closeout that cannot be read back as done fails recovery');
    assert.ok(fs.existsSync(worktree), 'the stale worktree survives a failed closeout');
    const branchList = git(root, ['branch', '--list', `mission/${slug}`]);
    assert.ok(branchList.includes(`mission/${slug}`), 'the mission branch survives a failed closeout');
  } finally {
    git(root, ['worktree', 'remove', '--force', worktree]);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
