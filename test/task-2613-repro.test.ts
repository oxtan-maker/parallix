// TASK-2613: landing must archive the task file in `backlog/completed/`.
//
// TASK-2521.07 made this repository's closeout delete the landed task file.
// That left no canonical completed record, so the TASK-2534 stale-copy guards,
// which look for a `backlog/tasks/` copy of a task that already has a
// `backlog/completed/` record, stopped seeing anything. A later mission whose
// unsquashed history still carries an earlier mission's task file then
// resurrected that closed task on the base branch.
//
// The fixture carries this repository's own `workflow.config.json`, and the
// landing uses the production integrate ports for Git, Backlog and product
// configuration. Only the non-git landing collaborators are stubbed. This
// crosses a real Git boundary, so it runs in the integration layer.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createSquashLanding } from '../src/application/integrate/squash.js';
import { createIntegratePorts } from '../src/adapters/cli/commands/integrate.js';
import * as fmt from '../src/application/presentation/cli-format.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIRST = 'task-9101';
const SECOND = 'task-9102';
const FIRST_FILE = `${FIRST} - First-mission.md`;
const SECOND_FILE = `${SECOND} - Second-mission.md`;

function git(root: string, args: string[]): string {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
  return String(result.stdout);
}

function write(root: string, rel: string, body: string): void {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body);
}

function taskBody(id: string): string {
  return `---\nid: ${id.toUpperCase()}\ntitle: ${id}\nstatus: integration\n---\n`;
}

/**
 * `main` carries this repository's configuration. The first mission authors
 * its task file on its branch; the second mission branches from the first
 * mission's unsquashed history, so it carries the first task file too.
 */
function seedRepository(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2613-'));
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@parallix.test']);
  git(root, ['config', 'user.name', 'Test']);
  git(root, ['config', 'core.hooksPath', '/dev/null']);
  for (const rel of ['workflow.config.json', 'config/state-map.json']) {
    write(root, rel, fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'));
  }
  write(root, 'README.md', 'base\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'base']);

  git(root, ['checkout', '-q', '-b', `mission/${FIRST}`]);
  write(root, `backlog/tasks/${FIRST_FILE}`, taskBody(FIRST));
  write(root, 'src/first.txt', 'first\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'first mission']);

  git(root, ['checkout', '-q', '-b', `mission/${SECOND}`]);
  write(root, `backlog/tasks/${SECOND_FILE}`, taskBody(SECOND));
  write(root, 'src/second.txt', 'second\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'second mission']);
  git(root, ['checkout', '-q', 'main']);
  return root;
}

/** Drive `squashAndLand` through the production Git, Backlog and product-config ports. */
function landMission(root: string, slug: string, taskFile: string): Promise<void> {
  const production = createIntegratePorts();
  const { squashAndLand } = createSquashLanding({
    ...production,
    missionPaths: { softResetTrailingBacklogNoise: () => false },
    productConfig: { ...production.productConfig, isForgejoReviewEnabled: () => false },
    checkout: { maybeUpdateGraphifyOnPrimary: () => {}, rewriteWorktreePaths: () => {} },
    gates: { isIntendedPayloadAtHead: () => false },
    landing: {
      createAbort: () => new Error('IntegrationAbort'),
      classifyHookFailure: () => ({ isHookFailure: false }),
      persistLandedIntegrationOrAbort: async () => {},
      closeLandedIntegrationOrAbort: async () => {},
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

  return squashAndLand({
    slug,
    context: { area: 'all' },
    missionServices: { store: { load: async () => ({ kind: 'found', mission: { status: 'integration' }, version: 1 }) } },
    baseWorktree: root,
    baseBranch: 'main',
    seams: {},
    state: { temporaryStash: null, nextActionMessage: null },
  } as never, {
    branch: `mission/${slug}`,
    summary: `land ${slug}`,
    landedFromSha: 'base',
    mainTaskFile: path.join(root, 'backlog/tasks', taskFile),
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

function tracked(root: string, rel: string): boolean {
  return spawnSync('git', ['-C', root, 'cat-file', '-e', `HEAD:${rel}`]).status === 0;
}

function quietLogs(t: { mock: { method: Function } }): void {
  for (const quiet of ['debug', 'pass', 'plain', 'fail', 'info'] as const) { t.mock.method(fmt.log, quiet, () => {}); }
}

test('TASK-2613: landing moves the task file to backlog/completed as done in the landed squash', async (t) => {
  quietLogs(t as never);
  const root = seedRepository();

  await landMission(root, FIRST, FIRST_FILE);

  const completed = `backlog/completed/${FIRST_FILE}`;
  const status = landedStatus(root);
  assert.equal(status[completed], 'A', 'the landed squash adds the completed record');
  assert.equal(status['src/first.txt'], 'A', 'the mission payload lands alongside the closeout');
  assert.ok(!tracked(root, `backlog/tasks/${FIRST_FILE}`), 'the landed tree holds no backlog/tasks copy');
  assert.match(git(root, ['show', `HEAD:${completed}`]), /^status: done$/m, 'the completed record is status done');
  assert.equal(git(root, ['status', '--porcelain']), '', 'closeout leaves nothing unstaged or uncommitted');
});

test('TASK-2613: a base-tracked task file lands its removal and completed record together', async (t) => {
  quietLogs(t as never);
  const root = seedRepository();
  write(root, `backlog/tasks/${FIRST_FILE}`, taskBody(FIRST));
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'file first task on main']);

  await landMission(root, FIRST, FIRST_FILE);

  const status = landedStatus(root);
  assert.equal(status[`backlog/tasks/${FIRST_FILE}`], 'D', 'the landed squash stages the task file removal');
  assert.equal(status[`backlog/completed/${FIRST_FILE}`], 'A', 'the landed squash stages the completed record');
});

test('TASK-2613: a later landing drops the stale copy of an earlier landed task', async (t) => {
  quietLogs(t as never);
  const root = seedRepository();
  await landMission(root, FIRST, FIRST_FILE);

  await landMission(root, SECOND, SECOND_FILE);

  assert.ok(tracked(root, `backlog/completed/${FIRST_FILE}`), 'the earlier completed record stays canonical');
  assert.ok(
    !tracked(root, `backlog/tasks/${FIRST_FILE}`),
    'the second landing must not resurrect the first task in backlog/tasks',
  );
  assert.ok(tracked(root, `backlog/completed/${SECOND_FILE}`), 'the second mission is archived too');
  assert.ok(!fs.existsSync(path.join(root, 'backlog/tasks', FIRST_FILE)), 'the stale copy leaves the working tree');
});
