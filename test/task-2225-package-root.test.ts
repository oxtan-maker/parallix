
// task-2225 — TS migration phase T2: packageRoot() asset-resolution hardening.
//
// Proves the packageRoot() helper resolves the Parallix package root from a
// module import.meta.dirname without consulting process.cwd(), and that every migrated
// package-owned asset lookup still resolves to its intended asset even when the
// process CWD is a temporary directory outside the checkout.
//
// See MISSION docs/adr/0044-workflow-distribution-model.md §6, §9 and
// src/adapters/filesystem/package-root.ts.

import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mockModule, installModuleMocks } from './lib/module-mock.js';
const packageRootModule = mockModule<typeof import('../src/adapters/filesystem/package-root.js')>('../src/adapters/filesystem/package-root.js', import.meta.url);
const reviewPrompts = mockModule<typeof import('../src/adapters/review/review-prompts.js')>('../src/adapters/review/review-prompts.js', import.meta.url);
const draft = mockModule<typeof import('../src/adapters/cli/commands/draft.js')>('../src/adapters/cli/commands/draft.js', import.meta.url);
const active = mockModule<typeof import('../src/adapters/cli/commands/active.js')>('../src/adapters/cli/commands/active.js', import.meta.url);
const stateMap = mockModule<typeof import('../src/adapters/config/state-map.js')>('../src/adapters/config/state-map.js', import.meta.url);
const agentConfig = mockModule<typeof import('../src/adapters/agents/agent-config.js')>('../src/adapters/agents/agent-config.js', import.meta.url);
const runtimeMatrix = mockModule<typeof import('../src/adapters/agents/runtime-matrix.js')>('../src/adapters/agents/runtime-matrix.js', import.meta.url);
const mutationGate = mockModule<typeof import('../src/adapters/verification/mutation-gate.js')>('../src/adapters/verification/mutation-gate.js', import.meta.url);
const stats = mockModule<typeof import('../src/adapters/cli/commands/stats.js')>('../src/adapters/cli/commands/stats.js', import.meta.url);
const reviewLoop = mockModule<typeof import('../src/adapters/review/review-loop.js')>('../src/adapters/review/review-loop.js', import.meta.url);
await installModuleMocks();
test.afterEach(() => mock.restoreAll());
const { packageRoot } = packageRootModule;

// The real checkout root, resolved from this test's own directory.
const ROOT = packageRoot(import.meta.dirname);

function readPkgName(root) {
  return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).name;
}

// Run `fn` with process.cwd() set to a fresh temp dir outside the checkout,
// restoring the original CWD (and cleaning up) afterwards.
function withTempCwd(fn) {
  const original = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'px-t2225-'));
  try {
    process.chdir(tmp);
    return fn(tmp);
  } finally {
    process.chdir(original);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function withTempCwdAsync(fn) {
  const original = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'px-t2225-'));
  try {
    process.chdir(tmp);
    return await fn(tmp);
  } finally {
    process.chdir(original);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('packageRoot resolves the checkout root by package name', () => {
  assert.equal(readPkgName(ROOT), '@magnusekdahl/parallix');
});

test('packageRoot walks up from any nested module dir to the same root', () => {
  for (const dir of [
    'src/adapters',
    'src/adapters/filesystem',
    'src/adapters/cli/commands',
    'src/adapters/review',
    'src/adapters/agents',
  ]) {
    assert.equal(
      packageRoot(path.join(ROOT, dir)),
      ROOT,
      `packageRoot(${dir}) should resolve to the checkout root`,
    );
  }
});

test('packageRoot does not consult process.cwd()', () => {
  const fromOutsideCheckout = withTempCwd(() => packageRoot(path.join(ROOT, 'src', 'adapters', 'filesystem')));
  assert.equal(fromOutsideCheckout, ROOT);
  // Also confirm passing the temp CWD itself (no matching ancestor) throws
  // rather than silently succeeding via a CWD fallback.
  withTempCwd((tmp) => {
    assert.throws(() => packageRoot(tmp), /could not find a package\.json named @magnusekdahl\/parallix/);
  });
});

test('packageRoot throws when no matching ancestor package.json exists', () => {
  assert.throws(() => packageRoot(os.tmpdir()), /@magnusekdahl\/parallix/);
});

test('packageRoot rejects an empty starting directory', () => {
  assert.throws(() => packageRoot(''), /non-empty string/);
});

// Every migrated package-owned asset, keyed by the relative path each call
// site now derives via `path.join(packageRoot(import.meta.dirname), ...)`. `mustExist`
// assets are shipped files; the remaining entries ship only their directory
// (the leaf file is created/downloaded at runtime), so we assert the parent
// directory resolves under the root instead.
const MIGRATED_ASSETS = [
  { rel: 'prompts/review.md', mustExist: true },                 // review-prompts.ts
  { rel: 'prompts/act-on-review.md', mustExist: true },          // review-prompts.ts
  { rel: 'prompts/draft.md', mustExist: true },                  // draft.ts
  { rel: 'templates/mission-scaffold.md', mustExist: true },     // draft.ts
  { rel: 'prompts/execute.md', mustExist: true },                // active.ts
  { rel: 'config/agents.json', mustExist: true },                // agent-config.ts, runtime-matrix.ts
  { rel: 'config/state-map.json', mustExist: true },             // state-map.ts
  { rel: 'scripts/bootstrap.sh', mustExist: false },             // review-loop.ts
  { rel: 'config/mutation-baseline.json', mustExist: false },    // mutation-gate.ts
];

test('every migrated asset resolves under the package root from a temp CWD', () => {
  withTempCwd(() => {
    for (const { rel, mustExist } of MIGRATED_ASSETS) {
      const resolved = path.join(packageRoot(path.join(ROOT, 'src', 'adapters', 'filesystem')), ...rel.split('/'));
      assert.equal(resolved, path.join(ROOT, ...rel.split('/')), `${rel} must resolve under the root`);
      if (mustExist) {
        assert.ok(fs.existsSync(resolved), `${rel} must exist as a shipped asset`);
      } else {
        // The shipped directory must exist even when the leaf file does not.
        assert.ok(fs.existsSync(path.dirname(resolved)), `${path.dirname(rel)}/ must exist`);
      }
    }
  });
});

test('every migrated call site resolves its package asset from a temp CWD', async () => {
  await withTempCwdAsync(async () => {
    // Load every migrated module after changing CWD, then invoke the paths that
    // consume a shipped asset. This verifies the call-site resolver, rather
    // than only exercising packageRoot() with a synthetic module directory.

    assert.match(reviewPrompts.buildReviewPrompt({
      reviewer: 'codex', branch: 'mission/task-2225', implementer: 'codex', attempt: 1, repoRoot: ROOT,
    }), /Mode: review/);
    assert.match(draft.buildDraftPrompt('task-2225', { rootDir: ROOT }), /Mode: draft/);
    assert.match(active.buildExecutePrompt('task-2225', '', { rootDir: ROOT }), /Mode: execute/);
    assert.deepEqual(stateMap.loadStateMap(), JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'state-map.json'), 'utf8')));
    assert.deepEqual(agentConfig.readAgentConfig().steps, JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'agents.json'), 'utf8')).steps);
    assert.equal(runtimeMatrix.buildAutonomousReviewMatrix().configPath, path.join(ROOT, 'config', 'agents.json'));

    // These leaves are intentionally absent in the current source layout. The
    // exported baseline path still proves its real call site anchors to the
    // package, not the temporary CWD.
    assert.equal(mutationGate.DEFAULT_BASELINE_PATH, path.join(ROOT, 'config', 'mutation-baseline.json'));
    // TASK-2322.08: stats.ts no longer resolves any shipped package asset —
    // `data/stats.seed.csv` and the whole stats-path resolver chain are gone.
// @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
    assert.equal(stats.resolveStatsPath, undefined);

    // The bootstrap path is used only when the provider is unavailable. Drive
    // that branch with injected dependencies and assert the actual command.
    const stop = new Error('stop after bootstrap failure');
    await assert.rejects(
      reviewLoop.startReviewLoop('task-2225', {
        worktree: ROOT,
        isReviewProviderEnabledFn: () => true,
        providerAvailableFn: async () => false,
        runFn: (command, args) => {
          assert.equal(command, 'bash');
          assert.deepEqual(args, [path.join(ROOT, 'scripts', 'bootstrap.sh')]);
          return { status: 1, signal: null, stdout: '', stderr: '' };
        },
        resolveTaskFileFn: () => {
          const taskFile = path.join(ROOT, 'backlog', 'tasks', 'task-2225 - TS-migration-phase-T2-packageRoot-asset-resolution-hardening.md');
          return { ok: true, taskFile, matches: [taskFile] };
        },
        exit: () => { throw stop; },
        log: () => {}, error: () => {},
      }),
      (error) => error === stop,
    );
  });
});
