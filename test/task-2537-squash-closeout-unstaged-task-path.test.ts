// TASK-2537: the landed squash names its payload explicitly
// (`git commit --only -- <paths>`), and git fails-closed when a named pathspec
// matches nothing it knows. Closeout removes `backlog/tasks/<slug>`; when the
// task file was authored on the mission branch, the base branch never carried
// it, so after removal that source path
// exists in neither the index nor HEAD and the whole landing aborts with
// "pathspec did not match any git-known files".
//
// This is distinct from TASK-2533 (git *quoting* special filenames in the
// capture). Here the path is plain ASCII — it simply is not a live pathspec.
//
// The tests drive the real `squashAndLand` across a real Git boundary
// (throwaway repos in a temp dir), so they run in the integration layer.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { createSquashLanding } from '../src/application/integrate/squash.js';
import * as fmt from '../src/application/presentation/cli-format.js';

const SLUG = 'task-9002';
const TASK_FILE = `${SLUG} - Land-a-draft-authored-task.md`;
const TASKS_PATH = `backlog/tasks/${TASK_FILE}`;
const COMPLETED_PATH = `backlog/completed/${TASK_FILE}`;
const MISSION_PAYLOAD = 'src/landed-feature.txt';
const AMBIENT_PATH = 'ambient.txt';

function git(root: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
  return String(result.stdout);
}

function gitRun(args: string[]) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  return { status: result.status ?? 1, stdout: String(result.stdout), stderr: String(result.stderr) };
}

function writeFile(root: string, rel: string, body: string): void {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body);
}

/**
 * A repository at the exact shape the landing sees: `main` checked out with the
 * squashable mission branch beside it. `baseTracksTask` selects whether the
 * base branch already carries `backlog/tasks/<slug>` (the pre-existing case) or
 * whether the mission branch authored it (the TASK-2537 defect case).
 */
function seedRepository({ baseTracksTask }: { baseTracksTask: boolean }): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2537-'));
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@parallix.test']);
  git(root, ['config', 'user.name', 'Test']);
  git(root, ['config', 'core.hooksPath', '/dev/null']);
  writeFile(root, 'README.md', 'base\n');
  if (baseTracksTask) { writeFile(root, TASKS_PATH, 'status: active\n'); }
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'base']);

  git(root, ['checkout', '-q', '-b', `mission/${SLUG}`]);
  writeFile(root, TASKS_PATH, 'status: active\nbody: mission work\n');
  writeFile(root, MISSION_PAYLOAD, 'landed\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'mission payload']);
  git(root, ['checkout', '-q', 'main']);
  return root;
}

/** Drive the production `squashAndLand` with only the non-git seams stubbed. */
async function landMission(root: string, { selfHostedCloseout }: { selfHostedCloseout: boolean }): Promise<void> {
  const abort = new Error('IntegrationAbort');
  const { squashAndLand } = createSquashLanding({
    git: { git: gitRun },
    fileSystem: { existsSync: (target: string) => fs.existsSync(target) },
    backlog: {
      checkBacklogIntegrity: () => [],
      // Self-hosted closeout removes the task file; external Backlog.md
      // repositories retain the completed-task mirror. Staging an unrelated file
      // here stands in for a concurrent bare-board commit dirtying the index
      // after the payload was captured: `--only` must not inherit it.
      completeTask: (_slug, _rootDir, options) => {
        assert.deepEqual(options, { retainLegacyRecord: !selfHostedCloseout });
        if (selfHostedCloseout) {
          fs.rmSync(path.join(root, TASKS_PATH));
        } else {
          fs.mkdirSync(path.join(root, 'backlog/completed'), { recursive: true });
          fs.renameSync(path.join(root, TASKS_PATH), path.join(root, COMPLETED_PATH));
        }
        writeFile(root, AMBIENT_PATH, 'not payload\n');
        git(root, ['add', '--', AMBIENT_PATH]);
      },
      resolveTaskFile: () => selfHostedCloseout
        ? ({ ok: false, reason: 'missing', matches: [] })
        : ({ ok: true, taskFile: path.join(root, COMPLETED_PATH), matches: [path.join(root, COMPLETED_PATH)] }),
    },
    missionPaths: { softResetTrailingBacklogNoise: () => false },
    productConfig: {
      isForgejoReviewEnabled: () => false,
      isSelfHostedTaskCloseout: () => selfHostedCloseout,
    },
    checkout: { maybeUpdateGraphifyOnPrimary: () => {}, rewriteWorktreePaths: () => {} },
    gates: { isIntendedPayloadAtHead: () => false },
    landing: {
      createAbort: () => abort,
      classifyHookFailure: () => ({ isHookFailure: false }),
      persistLandedIntegrationOrAbort: async () => {},
      recordPostIntegrationStatsOrAbort: async () => {},
      cleanupMissionWorktree: () => true,
      runPostIntegrateHookOrAbort: () => {},
    },
    verification: {
      formatVerificationCommand: () => 'verify',
      captureVerifiedTreeProof: () => ({ ok: true, proof: {} }),
      assertVerifiedTreeProof: () => ({ ok: true }),
    },
  } as never, { promoteTaskForIntegrationIfNeeded: async () => {} });

  await squashAndLand({
    slug: SLUG,
    context: { area: 'all' },
    missionServices: { store: { load: async () => ({ kind: 'found', mission: { status: 'integration' }, version: 1 }) } },
    baseWorktree: root,
    baseBranch: 'main',
    seams: {},
    state: { temporaryStash: null, nextActionMessage: null },
  } as never, {
    branch: `mission/${SLUG}`,
    summary: 'land',
    landedFromSha: 'base',
    mainTaskFile: path.join(root, TASKS_PATH),
  });
}

/** `A`/`D`/`M` status per path in the landed commit, renames expanded. */
function landedStatus(root: string): Record<string, string> {
  const raw = git(root, ['diff-tree', '--no-commit-id', '--name-status', '-r', '-z', '--no-renames', 'HEAD'])
    .split('\0')
    .filter(Boolean);
  const status: Record<string, string> = {};
  for (let index = 0; index + 1 < raw.length; index += 2) { status[raw[index + 1]] = raw[index]; }
  return status;
}

function completedTaskFiles(root: string): string[] {
  return git(root, ['ls-tree', '-r', '--name-only', 'HEAD', '--', 'backlog/completed'])
    .trim()
    .split('\n')
    .filter(Boolean);
}

function quietLogs(t: { mock: { method: Function } }): void {
  for (const quiet of ['debug', 'pass', 'plain', 'fail', 'info'] as const) { t.mock.method(fmt.log, quiet, () => {}); }
}

test('TASK-2537: a task file absent from the base branch lands without a pathspec abort', async (t) => {
  quietLogs(t as never);
  const root = seedRepository({ baseTracksTask: false });

  await landMission(root, { selfHostedCloseout: true });

  const status = landedStatus(root);
  assert.equal(status[MISSION_PAYLOAD], 'A', 'the mission payload lands alongside the closeout');
  assert.equal(status[TASKS_PATH], undefined, 'the never-tracked source path carries no change to land');
  assert.equal(status[AMBIENT_PATH], undefined, 'the ambient staged entry stays outside the landed commit');
  assert.deepEqual(completedTaskFiles(root), [], 'self-hosted closeout creates no completed-task ledger');
  // The landed tree must not resurrect the tasks copy of a completed task.
  assert.notEqual(
    spawnSync('git', ['cat-file', '-e', `HEAD:${TASKS_PATH}`], { cwd: root }).status,
    0,
    'the landed tree holds no backlog/tasks copy of the completed task',
  );
  assert.equal(git(root, ['status', '--porcelain']).trim(), `A  ${AMBIENT_PATH}`, 'only the ambient entry remains staged');
});

test('TASK-2537: a base-tracked task file lands its removal without a completed ledger', async (t) => {
  quietLogs(t as never);
  const root = seedRepository({ baseTracksTask: true });

  await landMission(root, { selfHostedCloseout: true });

  const status = landedStatus(root);
  assert.equal(status[TASKS_PATH], 'D', 'the base-tracked source path is removed by the landed commit');
  assert.equal(status[MISSION_PAYLOAD], 'A', 'the mission payload lands alongside the closeout');
  assert.equal(status[AMBIENT_PATH], undefined, 'the ambient staged entry stays outside the landed commit');
  assert.deepEqual(completedTaskFiles(root), [], 'self-hosted closeout creates no completed-task ledger');
  assert.equal(git(root, ['status', '--porcelain']).trim(), `A  ${AMBIENT_PATH}`, 'only the ambient entry remains staged');
});

test('TASK-2537: an external Backlog.md repository retains its completed-task ledger', async (t) => {
  quietLogs(t as never);
  const root = seedRepository({ baseTracksTask: true });

  await landMission(root, { selfHostedCloseout: false });

  const status = landedStatus(root);
  assert.equal(status[TASKS_PATH], 'D', 'the source task leaves the active task directory');
  assert.equal(status[COMPLETED_PATH], 'A', 'external repositories retain the configured completed-task mirror');
  assert.equal(status[MISSION_PAYLOAD], 'A', 'the mission payload lands with external closeout');
  assert.deepEqual(completedTaskFiles(root), [COMPLETED_PATH], 'the completed record is committed for the external repository');
  assert.equal(git(root, ['status', '--porcelain']).trim(), `A  ${AMBIENT_PATH}`, 'only the ambient entry remains staged');
});
