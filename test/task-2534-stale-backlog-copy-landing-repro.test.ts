// TASK-2534: a landed squash must not resurrect stale `backlog/tasks/` copies.
//
// Shape mirrors `mission/task-2489` / `mission/task-2478`: the mission branch's
// unsquashed history adds `backlog/tasks/task-9001 - x.md` (a pre-squash commit
// of another mission), while main only received that mission's squash commit,
// which put the canonical file in `backlog/completed/`. `git merge --squash`
// sees "added on branch, absent at merge-base and on main" and stages the stale
// copy. The real `squashAndLand` runs against a throwaway repo; only the
// non-git landing collaborators are stubbed.
//
// This crosses a real Git boundary, so it runs in the integration layer.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { createSquashLanding } from '../src/application/integrate/squash.js';
import { checkBacklogIntegrity } from '../src/adapters/backlog/task-file-io.js';
import * as fmt from '../src/application/presentation/cli-format.js';

const STALE = 'backlog/tasks/task-9001 - x.md';
const CANONICAL = 'backlog/completed/task-9001 - x.md';
const NEW_TASK = 'backlog/tasks/task-9002 - new.md';

function gitRun(args: string[]) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  return { status: result.status ?? 1, stdout: String(result.stdout), stderr: String(result.stderr) };
}

function git(root: string, args: string[]): string {
  const result = gitRun(['-C', root, ...args]);
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout;
}

function write(root: string, rel: string, id: string): void {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), `---\nid: ${id}\ntitle: x\n---\n`);
}

/** main has the canonical completed file; the mission branch history adds the stale copy and a new task. */
function buildFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2534-'));
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@parallix.test']);
  git(root, ['config', 'user.name', 'Test']);
  git(root, ['config', 'core.hooksPath', '/dev/null']);
  fs.writeFileSync(path.join(root, 'README.md'), 'base\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'base']);

  git(root, ['checkout', '-q', '-b', 'mission/task-9002']);
  write(root, STALE, 'TASK-9001');
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'mission/task-9001 pre-squash history']);
  write(root, NEW_TASK, 'TASK-9002');
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'file task-9002']);

  git(root, ['checkout', '-q', 'main']);
  write(root, CANONICAL, 'TASK-9001');
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'mission/task-9001: squash']);
  return root;
}

function landing(root: string, extraBacklog: Record<string, unknown> = {}) {
  const abort = new Error('IntegrationAbort');
  const { squashAndLand } = createSquashLanding({
    git: { git: gitRun },
    fileSystem: { existsSync: (target: string) => fs.existsSync(target) },
    backlog: { checkBacklogIntegrity: (rootDir: string) => checkBacklogIntegrity(rootDir), ...extraBacklog },
    missionPaths: { softResetTrailingBacklogNoise: () => false },
    productConfig: { isForgejoReviewEnabled: () => false },
    checkout: { maybeUpdateGraphifyOnPrimary: () => {} },
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
  const run = {
    slug: 'task-9002',
    context: { area: 'all' },
    missionServices: { store: { load: async () => ({ kind: 'found', mission: { status: 'integration' }, version: 1 }) } },
    baseWorktree: root,
    baseBranch: 'main',
    seams: {},
    state: { temporaryStash: null, nextActionMessage: null },
  };
  const land = () => squashAndLand(run as never, {
    branch: 'mission/task-9002',
    summary: 'land',
    landedFromSha: 'base',
    mainTaskFile: path.join(root, 'backlog/tasks/task-9002-absent.md'),
  });
  return { land, abort };
}

test('TASK-2534: squash landing drops the stale task-9001 copy and keeps new task-9002', async (t) => {
  const root = buildFixture();
  const infos: string[] = [];
  t.mock.method(fmt.log, 'info', (message: string) => { infos.push(String(message)); });
  for (const quiet of ['debug', 'pass', 'plain', 'fail'] as const) { t.mock.method(fmt.log, quiet, () => {}); }

  await landing(root).land();

  const landed = git(root, ['ls-tree', '-r', '--name-only', 'HEAD']).split('\n');
  assert.ok(!landed.includes(STALE), `landed commit must not contain ${STALE}`);
  assert.ok(landed.includes(NEW_TASK), `landed commit must contain ${NEW_TASK}`);
  assert.ok(!fs.existsSync(path.join(root, STALE)), 'stale copy is removed from the working tree');
  assert.ok(
    infos.some(line => line.includes('task-9001') && line.includes(CANONICAL)),
    `an info line names task-9001 and ${CANONICAL}; got ${JSON.stringify(infos)}`,
  );
});

test('TASK-2534: landing aborts before the squash commit when a duplicate survives closeout', async (t) => {
  const root = buildFixture();
  // A duplicate the step-1 filter cannot see: it is already committed on main,
  // so the squash never stages it.
  write(root, 'backlog/tasks/task-9003 - old.md', 'TASK-9003');
  write(root, 'backlog/completed/task-9003 - old.md', 'TASK-9003');
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'pre-existing duplicate on main']);
  const headBefore = git(root, ['rev-parse', 'HEAD']).trim();
  const fails: string[] = [];
  t.mock.method(fmt.log, 'fail', (message: string) => { fails.push(String(message)); });
  for (const quiet of ['debug', 'pass', 'plain', 'info'] as const) { t.mock.method(fmt.log, quiet, () => {}); }

  const { land, abort } = landing(root);
  await assert.rejects(land(), error => error === abort, 'the integrity backstop aborts the landing');

  assert.ok(
    fails.some(line => line.includes('backlog/tasks/task-9003 - old.md')),
    `the abort message lists the offending path; got ${JSON.stringify(fails)}`,
  );

  assert.equal(git(root, ['rev-parse', 'HEAD']).trim(), headBefore, 'no squash commit is created');
  assert.equal(git(root, ['status', '--porcelain']), '', 'the staged squash is rolled back so a retry starts clean');
});
