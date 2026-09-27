// TASK-2595: a landed squash commit must read like the mission, not the
// machinery. The subject carries the recorded mission title; the body records
// the mission task reference.
//
// The test drives the real `publishMission` (local Variant B landing) against
// a throwaway repository whose recorded title is distinct from the slug, so
// the title -> subject wiring and the task reference -> body wiring are both
// covered at the real Git boundary. Only the non-git landing collaborators
// (stash, persistence, stats, worktree cleanup, hooks, verification proofs)
// are stubbed.
//
// This crosses a real Git boundary, so it runs in the integration layer.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { createMissionLanding } from '../src/application/integrate/landing.js';
import { checkBacklogIntegrity } from '../src/adapters/backlog/task-file-io.js';
import {
  findMissionDir,
  missionBranchName,
  missionTitle,
} from '../src/adapters/filesystem/mission-paths.js';
import {
  findExistingSquashCommit,
  findLandedSquashOnBaseBranch,
} from '../src/adapters/cli/commands/integrate-conflict.js';
import * as fmt from '../src/application/presentation/cli-format.js';

const SLUG = 'task-9101';
const TITLE = 'Restore the lost changelog archive';
const BRANCH = `mission/${SLUG}`;

function gitRun(args: string[]) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  return { status: result.status ?? 1, stdout: String(result.stdout), stderr: String(result.stderr) };
}

function git(root: string, args: string[]): string {
  const result = gitRun(['-C', root, ...args]);
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout;
}

/**
 * Throwaway repository: `main` with a base commit, a mission dir recording a
 * title distinct from the slug plus the base branch, and a mission branch one
 * payload commit ahead of `main`.
 */
function buildFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2595-'));
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@parallix.test']);
  git(root, ['config', 'user.name', 'Test']);
  git(root, ['config', 'core.hooksPath', '/dev/null']);
  fs.writeFileSync(path.join(root, 'README.md'), 'base\n');
  fs.mkdirSync(path.join(root, 'missions', SLUG), { recursive: true });
  fs.writeFileSync(path.join(root, 'missions', SLUG, 'MISSION.md'), `# Mission: ${TITLE}\n\nBase-Branch: main\n`);
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'base']);

  git(root, ['checkout', '-q', '-b', BRANCH]);
  fs.writeFileSync(path.join(root, 'changelog.txt'), 'archive restored\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'restore changelog archive']);
  git(root, ['checkout', '-q', 'main']);
  return root;
}

/**
 * Drive the production `publishMission` with real Git and real mission-path
 * resolution (so the recorded MISSION.md title is what the landing sees);
 * only the non-git landing collaborators are stubbed.
 */
function landing(root: string) {
  const abort = new Error('IntegrationAbort');
  const { publishMission } = createMissionLanding({
    git: {
      git: gitRun,
      getCurrentBranch: () => BRANCH,
      detectRebaseState: () => ({ inProgress: false, rebaseHead: null, unmergedFiles: [] }),
    },
    fileSystem: { existsSync: (target: string) => fs.existsSync(target), isSymbolicLink: () => false },
    backlog: { checkBacklogIntegrity: (rootDir: string) => checkBacklogIntegrity(rootDir) },
    // Real mission-path resolution, rooted at the fixture repository. The
    // slug-scoped helpers default to `process.cwd()`, which the test points
    // at the fixture so the recorded title is the one the landing reads.
    missionPaths: {
      inferSlug: () => SLUG,
      findMissionDir: (slug: string) => findMissionDir(slug, root),
      findMissionArea: () => 'all',
      missionTitle: (slug: string) => missionTitle(slug),
      missionBranchName: (slug: string) => missionBranchName(slug, root),
      missionDirForSlug: (dir: string, slug: string) => path.join(dir, 'missions', slug),
      getPrimaryWorktree: () => root,
      getPrimaryBranch: () => 'main',
      conventionalWorktreePath: () => path.join(root, 'absent-worktree'),
      resolveMissionBaseBranch: () => 'main',
      resolveBaseWorktree: () => root,
      resolveWorktree: () => null,
      findMissionDocInBranches: () => null,
      // The probe merge is clean in the fixture, so conflict parsing is never
      // reached; keep the seam stubbed like the other non-git collaborators.
      parseConflictFilesFromMergeOutput: () => [],
      softResetTrailingBacklogNoise: () => false,
    },
    productConfig: { isForgejoReviewEnabled: () => false, isSelfHostedTaskCloseout: () => true },
    checkout: {
      stashMainCheckoutIfNeeded: () => null,
      findLandedSquashOnBaseBranch: () => null,
      maybeUpdateGraphifyOnPrimary: () => {},
    },
    landing: {
      createAbort: () => abort,
      classifyHookFailure: () => ({ isHookFailure: false }),
      persistLandedIntegrationOrAbort: async () => {},
      recordPostIntegrationStatsOrAbort: async () => {},
      cleanupMissionWorktree: () => true,
      runPostIntegrateHookOrAbort: () => {},
    },
    gates: { isIntendedPayloadAtHead: () => false },
    verification: {
      formatVerificationCommand: () => 'verify',
      captureVerifiedTreeProof: () => ({ ok: true, proof: {} }),
      assertVerifiedTreeProof: () => ({ ok: true }),
    },
  } as never, { promoteTaskForIntegrationIfNeeded: async () => {} });
  const run = {
    slug: SLUG,
    context: { area: 'all', mainDirtyEntries: [] },
    missionServices: { store: { load: async () => ({ kind: 'found', mission: { status: 'integration', title: TITLE }, version: 1 }) } },
    baseWorktree: root,
    baseBranch: 'main',
    seams: {},
    state: { temporaryStash: null, nextActionMessage: null },
  };
  return { publishMission: () => publishMission(run as never), abort };
}

test('TASK-2595: landed squash subject is the recorded title and body records the task reference', async (t) => {
  const root = buildFixture();
  t.mock.method(process, 'cwd', () => root);
  for (const quiet of ['debug', 'pass', 'plain', 'fail', 'info', 'warn'] as const) { t.mock.method(fmt.log, quiet, () => {}); }
  try {
    const headBefore = git(root, ['rev-parse', 'main']).trim();
    await landing(root).publishMission();
    const headAfter = git(root, ['rev-parse', 'main']).trim();

    assert.notEqual(headAfter, headBefore, 'the landing must advance main');
    assert.equal(
      git(root, ['rev-list', '--count', `${headBefore}..main`]).trim(),
      '1',
      'the mission must land as exactly one squash commit',
    );

    const subject = git(root, ['log', '-1', '--format=%s']).trim();
    assert.equal(subject, TITLE, `the subject must be the recorded title, got ${JSON.stringify(subject)}`);
    assert.notEqual(subject, SLUG, 'the subject must not fall back to the slug');

    const body = git(root, ['log', '-1', '--format=%b']);
    assert.ok(
      body.split('\n').includes(`Task: ${SLUG}`),
      `the body must record the mission task reference; body was ${JSON.stringify(body)}`,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/**
 * Detection fixture: `main` carries one legacy-shape squash
 * (`mission/task-9102: …` subject) and one TASK-2595-shape squash (title
 * subject + `Task: task-9103` body line), with mission dirs recording the
 * base branch so the base-branch-scoped detector can resolve it.
 */
function buildDetectionFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2595-detect-'));
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@parallix.test']);
  git(root, ['config', 'user.name', 'Test']);
  fs.mkdirSync(path.join(root, 'missions', 'task-9102'), { recursive: true });
  fs.mkdirSync(path.join(root, 'missions', 'task-9103'), { recursive: true });
  fs.writeFileSync(path.join(root, 'missions', 'task-9102', 'MISSION.md'), '# Mission: Legacy shape\n\nBase-Branch: main\n');
  fs.writeFileSync(path.join(root, 'missions', 'task-9103', 'MISSION.md'), `# Mission: ${TITLE}\n\nBase-Branch: main\n`);
  fs.writeFileSync(path.join(root, 'README.md'), 'base\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'base']);
  git(root, ['commit', '-qm', 'mission/task-9102: old style', '--allow-empty']);
  git(root, ['commit', '-qm', TITLE, '-m', 'Task: task-9103', '--allow-empty']);
  return root;
}

test('TASK-2595: landed-squash detection recognises the title subject plus task reference body', () => {
  const root = buildDetectionFixture();
  try {
    const head = git(root, ['rev-parse', 'HEAD']).trim();
    assert.equal(findExistingSquashCommit(root, 'task-9103'), head, 'the HEAD-scoped scan finds the new-shape squash by its task reference body line');
    assert.equal(findLandedSquashOnBaseBranch(root, 'task-9103'), head, 'the base-branch scan finds the new-shape squash by its task reference body line');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('TASK-2595: landed-squash detection still recognises the legacy mission/<slug>: subject', () => {
  const root = buildDetectionFixture();
  try {
    assert.ok(findExistingSquashCommit(root, 'task-9102'), 'the HEAD-scoped scan still finds the legacy-shape squash by subject prefix');
    assert.ok(findLandedSquashOnBaseBranch(root, 'task-9102'), 'the base-branch scan still finds the legacy-shape squash by subject prefix');
    assert.equal(findLandedSquashOnBaseBranch(root, 'task-9104'), null, 'an unrelated slug is never reported as landed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
