// TASK-2533: the landed squash captures its payload with
// `git diff --cached --name-only -z --`, which emits git's RAW NUL-delimited,
// unquoted paths (NUL-delimited so special filenames — backslash, non-ASCII —
// stay literal). This is the protocol that must stay: plain `--name-only`
// output instead emits a QUOTED/ESCAPED form (e.g. `"...\342\200\224..."`)
// whose leading `"` never matches the real file, so `git commit --only`
// aborts with "pathspec did not match any git-known files". This test guards
// the shared capture against a regression back to quoted output.
//
// This crosses a real Git boundary (throwaway repo in a temp dir), so it runs
// in the integration layer.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { createSquashLanding } from '../src/application/integrate/squash.js';
import * as fmt from '../src/application/presentation/cli-format.js';

// A filename carrying literal backslashes, exactly like the real landed task
// files (`backlog/tasks/task-2521.01 - Mission-1-\342\200\224-...md`).
const SPECIAL = 'task-\\342\\200\\224-Lock.md';

function git(root: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
  return String(result.stdout);
}

/** Stage a payload file whose name needs git quoting, then leave it staged. */
function stageSpecialPayload(root: string): void {
  fs.writeFileSync(path.join(root, SPECIAL), 'payload\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'payload']);
  fs.writeFileSync(path.join(root, SPECIAL), 'payload\nlanded\n');
  git(root, ['add', '.']);
}

test('TASK-2533: the quoted `--name-only` form is NOT a valid commit pathspec', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2533-quoted-'));
  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@parallix.test']);
  git(root, ['config', 'user.name', 'Test']);
  stageSpecialPayload(root);

  // The buggy capture: plain `--name-only` output, split on newlines.
  const quoted = git(root, ['diff', '--cached', '--name-only', '--']).trim();
  assert.match(quoted, /^"/, 'git quotes special filenames in plain --name-only output');

  // Feeding that quoted form to `git commit --only` must fail: the leading `"`
  // is not part of the real path, so git rejects the pathspec. This is exactly
  // the abort the landed squash hit before the `-z` fix.
  const result = spawnSync('git', ['commit', '--only', '-m', 'x', '--', quoted], { cwd: root, encoding: 'utf8' });
  assert.notEqual(result.status, 0, 'the quoted pathspec must not commit');
  assert.match(
    (result.stderr || result.stdout || ''),
    /did not match|motsvarade/i,
    'the failure is the pathspec mismatch, not an unrelated error',
  );
});

test('TASK-2533: the `-z` raw-path form commits the special file as a pathspec', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2533-z-'));
  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@parallix.test']);
  git(root, ['config', 'user.name', 'Test']);
  stageSpecialPayload(root);

  // The fixed capture: NUL-delimited, unquoted, raw paths.
  const raw = git(root, ['diff', '--cached', '--name-only', '-z', '--']);
  const paths = raw.split('\0').filter(Boolean);
  assert.equal(paths.length, 1, 'one raw path captured');
  assert.equal(paths[0], SPECIAL, 'raw path is literal, unquoted');

  const commit = git(root, ['commit', '--only', '-m', 'x', '--', ...paths]);
  assert.match(commit, /1 file changed/, 'the special file lands via the raw pathspec');
});

test('TASK-2533: `-z` capture preserves leading/trailing whitespace in filenames (no trim)', () => {
  // Regression for the codex-review trim() finding: a filename that starts or
  // ends with whitespace is legal on disk, so the raw pathspec must keep those
  // bytes. Trimming would drop them and break the pathspec.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2533-ws-'));
  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@parallix.test']);
  git(root, ['config', 'user.name', 'Test']);
  const wsName = ' f .md'; // leading + trailing space
  fs.writeFileSync(path.join(root, wsName), 'payload\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'payload']);
  fs.writeFileSync(path.join(root, wsName), 'payload\nlanded\n');
  git(root, ['add', '.']);

  const raw = git(root, ['diff', '--cached', '--name-only', '-z', '--']);
  const paths = raw.split('\0').filter(Boolean);
  assert.equal(paths[0], wsName, 'raw path keeps leading/trailing whitespace');

  const commit = git(root, ['commit', '--only', '-m', 'x', '--', ...paths]);
  assert.match(commit, /1 file changed/, 'the whitespace-padded file lands via the raw pathspec');
});

// Drive the real `squashAndLand` so the regression fails if the production
// payload capture regresses to quoted `--name-only` output. Only the non-git
// landing collaborators are stubbed (same shape as the task-2534 repro).
const NON_ASCII = 'backlog/tasks/task-9001 - Mission-1-—-x.md';
const BACKSLASH = 'docs/back\\slash.md';
const ASCII = 'src/plain.txt';

function gitRun(args: string[]) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  return { status: result.status ?? 1, stdout: String(result.stdout), stderr: String(result.stderr) };
}

function writeFile(root: string, rel: string, body: string): void {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body);
}

test('TASK-2533: squash landing commits backslash and non-ASCII payload paths with ordinary ones', async (t) => {
  for (const quiet of ['debug', 'pass', 'plain', 'fail', 'info'] as const) { t.mock.method(fmt.log, quiet, () => {}); }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2533-land-'));
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@parallix.test']);
  git(root, ['config', 'user.name', 'Test']);
  git(root, ['config', 'core.hooksPath', '/dev/null']);
  writeFile(root, 'README.md', 'base\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'base']);
  git(root, ['checkout', '-q', '-b', 'mission/task-9001']);
  for (const rel of [NON_ASCII, BACKSLASH, ASCII]) { writeFile(root, rel, `${rel}\n`); }
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'mission payload']);
  git(root, ['checkout', '-q', 'main']);
  // Unrelated working-tree entry must stay outside the named payload.
  writeFile(root, 'ambient.txt', 'not payload\n');

  const abort = new Error('IntegrationAbort');
  const { squashAndLand } = createSquashLanding({
    git: { git: gitRun },
    fileSystem: { existsSync: (target: string) => fs.existsSync(target) },
    backlog: { checkBacklogIntegrity: () => [] },
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
    slug: 'task-9001',
    context: { area: 'all' },
    missionServices: { store: { load: async () => ({ kind: 'found', mission: { status: 'integration' }, version: 1 }) } },
    baseWorktree: root,
    baseBranch: 'main',
    seams: {},
    state: { temporaryStash: null, nextActionMessage: null },
  };
  await squashAndLand(run as never, {
    branch: 'mission/task-9001',
    summary: 'land',
    landedFromSha: 'base',
    mainTaskFile: path.join(root, 'backlog/tasks/task-9001-absent.md'),
  });

  const landed = git(root, ['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', 'HEAD']).split('\0').filter(Boolean).sort();
  assert.deepEqual(landed, [ASCII, BACKSLASH, NON_ASCII].sort(), 'landed commit holds exactly the raw payload paths');
  assert.equal(git(root, ['status', '--porcelain']).trim(), '?? ambient.txt', 'unrelated working-tree entry stays outside the commit');
});
