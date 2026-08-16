
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { mockModule, installModuleMocks } from './lib/module-mock.js';
import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);
const gitModule = mockModule<typeof import('../src/adapters/git/git.js')>('../src/adapters/git/git.js', import.meta.url);
const missionUtilsModule = mockModule<typeof import('../src/adapters/filesystem/mission-utils.js')>('../src/adapters/filesystem/mission-utils.js', import.meta.url);
const backlogModule = mockModule<typeof import('../src/adapters/backlog/backlog.js')>('../src/adapters/backlog/backlog.js', import.meta.url);
const forgejoModule = mockModule<typeof import('../src/adapters/forgejo/forgejo.js')>('../src/adapters/forgejo/forgejo.js', import.meta.url);
const statsModule = mockModule<typeof import('../src/adapters/cli/commands/stats.js')>('../src/adapters/cli/commands/stats.js', import.meta.url);
const verificationModule = mockModule<typeof import('../src/adapters/verification/verification.js')>('../src/adapters/verification/verification.js', import.meta.url);
const __mm1 = mockModule<typeof import('../src/composition/application-services.js')>('../src/composition/application-services.js', import.meta.url);
const __mm2 = mockModule<typeof import('../src/adapters/cli/commands/integrate.js')>('../src/adapters/cli/commands/integrate.js', import.meta.url);
await installModuleMocks();
const { mock } = test;

const git = gitModule;
const missionUtils = missionUtilsModule;
const backlog = backlogModule;
const forgejo = forgejoModule;
const stats = statsModule;
const verification = verificationModule;
const composition = __mm1;

const TEST_SLUG = 'task-integrate-test';
const FAKE_ROOT = '/tmp/integrate-test-root';
const WORKTREE = path.join(FAKE_ROOT, '..', TEST_SLUG);

// The integrate module's command entry point is its default export; its
// helpers are named exports. Expose both through the ESM mock facade so the
// existing call sites (`integrate([...])` and `integrate.resolveConflicts...`)
// keep working without a writable CommonJS `exports` object.
function loadIntegrate() {
// @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
  return Object.assign((...args) => __mm2.default(...args), __mm2);
}

function setupMocks() {
  mock.method(backlog, 'getTaskClassification', () => 'ai_sdlc');
  mock.method(missionUtils, 'getPrimaryBranch', () => 'main');
  mock.method(missionUtils, 'inferSlug', (s) => s || TEST_SLUG);
  mock.method(missionUtils, 'findMissionDir', (_slug, rootDir = FAKE_ROOT) => path.join(rootDir, 'docs/missions/2026', TEST_SLUG));
  mock.method(missionUtils, 'findMissionArea', () => 'docs');
  mock.method(missionUtils, 'getPrimaryWorktree', () => FAKE_ROOT);
  mock.method(missionUtils, 'conventionalWorktreePath', () => path.join(FAKE_ROOT, '..', TEST_SLUG));
  mock.method(git, 'getCurrentBranch', () => 'mission/' + TEST_SLUG);
  mock.method(git, 'git', () => ({ status: 0, stdout: 'main', stderr: '' }));
  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true, taskFile: path.join(FAKE_ROOT, 'backlog/tasks/task.md') }));
  mock.method(backlog, 'getTaskStatus', () => 'ready-for-integration');
  mock.method(backlog, 'getTaskAssignee', () => 'claude');
  mock.method(backlog, 'setTaskStatus', () => true);
  mock.method(forgejo, 'getPrStatus', () => ({ exists: true, state: 'open', merged: false, number: 41 }));
  mock.method(forgejo, 'listOpenPrsForSlug', () => []);
  mock.method(forgejo, 'getLatestReviewDecision', () => ({ ok: true, reviewState: 'APPROVED' }));
  mock.method(forgejo, 'readToken', () => 'token');
  mock.method(forgejo, 'resolveTokenFile', () => 'token-file');
  mock.method(forgejo, 'syncMerged', () => ({ ok: true }));
  mock.method(verification, 'captureVerifiedTreeProof', (area, rootDir) => ({
    ok: true,
    proof: {
      rootDir: path.resolve(rootDir),
      area,
      command: 'mock-verification',
      commit: 'abc123',
      tree: 'tree123',
      verifiedAt: '2026-01-01T00:00:00.000Z'
    }
  }));
  mock.method(verification, 'assertVerifiedTreeProof', (proof, rootDir) => {
    const resolvedRoot = path.resolve(rootDir);
    if (!proof || proof.rootDir !== resolvedRoot) {
      return { ok: false, error: 'verification proof does not match the tree being published' };
    }
    return { ok: true, proof };
  });
  mock.method(stats, 'resolveMissionClassification', () => ({ classification: 'ai_sdlc' }));
  mock.method(process, 'cwd', () => FAKE_ROOT);
  mock.method(process, 'exit', () => {});

  // SC3: Mock createMissionApplicationServices for SQLite-first transitions.
  // The mission carries an authoritative approved Review so integrate's
  // lifecycle recovery reaches the scenario each test exercises.
  mock.method(composition, 'createMissionApplicationServices', async () => ({
    store: {
      _repoId: 'default',
      load: async () => ({ kind: 'found', mission: { status: 'review', review: { rounds: [{ decision: { kind: 'approved', decidedAt: '2026-01-01T10:30:00Z' } }] } }, version: 1 }),
    },
    lifecycle: {
      transition: async () => ({ status: 'completed', value: { to: 'review', version: 2 } }),
    },
    handoff: {
      recordNel: async () => ({}),
    },
  }));
  
  if (!fs.existsSync(FAKE_ROOT)) fs.mkdirSync(FAKE_ROOT, { recursive: true });
  fs.writeFileSync(path.join(FAKE_ROOT, 'workflow.config.json'), JSON.stringify({
    adapters: { verification: { command: 'true' } },
  }), 'utf8');
}

function cleanup() {
  mock.reset();
  if (fs.existsSync(FAKE_ROOT)) fs.rmSync(FAKE_ROOT, { recursive: true, force: true });
}

test('integrate fails when slug is missing', (t) => {
  setupMocks();
  mock.method(missionUtils, 'inferSlug', () => null);
  const integrate = loadIntegrate();
  const originalError = console.error;
  let errorLogged = false;
  console.error = () => { errorLogged = true; };

  integrate([]);
  assert.ok(errorLogged);

  console.error = originalError;
  cleanup();
});

test('integrate preflight failure stops execution', async (t) => {
  setupMocks();
  mock.method(git, 'getCurrentBranch', () => 'wrong-branch');
  const integrate = loadIntegrate();
  const originalError = console.error;
  let errorLogged = false;
  console.error = (msg) => { if (msg && msg.includes('Integration preflight failed')) errorLogged = true; };

  try {
    await integrate([TEST_SLUG, '--no-integration-gates'], { missionServicesFn: composition.createMissionApplicationServices });
  } catch {
    // Expected to throw
  }
  assert.ok(errorLogged);

  console.error = originalError;
  cleanup();
});

test('integrate dry-run mode', async (t) => {
  setupMocks();
  const integrate = loadIntegrate();
  const originalLog = console.log;
  let logLogged = false;
  console.log = (msg) => { if (msg && msg.includes('Dry run complete')) logLogged = true; };

  try {
    await integrate([TEST_SLUG, '--dry-run', '--no-integration-gates'], { missionServicesFn: composition.createMissionApplicationServices });
  } catch {
    // Expected to throw
  }
  assert.ok(logLogged);

  console.log = originalLog;
  cleanup();
});

test('resolveConflictsForMission - worktree missing', (t) => {
  setupMocks();
  const integrate = loadIntegrate();
  if (fs.existsSync(WORKTREE)) fs.rmSync(WORKTREE, { recursive: true, force: true });
  const originalError = console.error;
  let errorLogged = false;
  console.error = (msg) => { if (msg && msg.includes('Mission worktree not found')) errorLogged = true; };

  const result = integrate.resolveConflictsForMission(TEST_SLUG, 'docs', {
    resolveWorktreeFn: () => null,
    rootDir: FAKE_ROOT
  });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error, 'worktree-missing');
  assert.ok(errorLogged);

  console.error = originalError;
  cleanup();
});

test('resolveConflictsForMission - merge check failed', (t) => {
  setupMocks();
  const integrate = loadIntegrate();
  const wt = WORKTREE;
  if (!fs.existsSync(wt)) fs.mkdirSync(wt, { recursive: true });

  const result = integrate.resolveConflictsForMission(TEST_SLUG, 'docs', {
    resolveWorktreeFn: () => wt,
// @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
    getConflictFilesFn: () => { throw new Error('git error'); },
    rootDir: FAKE_ROOT
  });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error, 'merge-failed');

  fs.rmSync(wt, { recursive: true, force: true });
  cleanup();
});

test('resolveConflictsForMission - shared vs mission-specific classification', (t) => {
  setupMocks();
  const integrate = loadIntegrate();
  const wt = WORKTREE;
  if (!fs.existsSync(wt)) fs.mkdirSync(wt, { recursive: true });

  // Case 1: Shared file conflict
  const res1 = integrate.resolveConflictsForMission(TEST_SLUG, 'docs', {
    resolveWorktreeFn: () => wt,
// @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
    getConflictFilesFn: () => ['workflow/lib/commands/integrate.js'],
    rootDir: FAKE_ROOT
  });
  assert.strictEqual(res1.ok, false);
  assert.strictEqual(res1.error, 'shared-file-conflicts');

  // Case 2: Mission-specific conflict
  const res2 = integrate.resolveConflictsForMission(TEST_SLUG, 'docs', {
    resolveWorktreeFn: () => wt,
// @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
    getConflictFilesFn: () => [`docs/missions/2026/${TEST_SLUG}/CP-1.md`],
    rootDir: FAKE_ROOT
  });
  assert.strictEqual(res2.ok, true);
  assert.strictEqual(res2.missionSpecificFiles.length, 1);

  fs.rmSync(wt, { recursive: true, force: true });
  cleanup();
});

test('buildConflictResolutionPrompt returns formatted array', (t) => {
  setupMocks();
  const integrate = loadIntegrate();
  const prompt = integrate.buildConflictResolutionPrompt(TEST_SLUG, 'docs', {
    rootDir: FAKE_ROOT,
    worktreePath: WORKTREE
  });
  assert.ok(Array.isArray(prompt));
  assert.ok(prompt.some(line => line.includes('Conflict resolution options')));
  cleanup();
});
