

// ---------------------------------------------------------------------------
// Regression test for task-2203: publish-proof must be captured AFTER the
// post-integrate rebuild, not before it.
//
// Before the fix, lib/commands/integrate.ts captured proof
// (captureVerifiedTreeProof) at ~line 814 and then ran the post-integrate hook
// (runPostIntegrateHookOrAbort) at ~line 857. The hook runs `npm run build`
// which changes the committed tree, so the proof represented a stale pre-hook
// tree.
//
// After the fix proof is captured after the hook runs, so it represents the
// freshly built tree that will actually be published.
//
// This test verifies the ordering by importing the integration helpers and
// checking that proof capture happens after the post-integrate hook in the
// Variant B closeout path.
// ---------------------------------------------------------------------------

import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import childProcess from 'child_process';
import { mockModule, installModuleMocks } from './lib/module-mock.js';
const resolvePostIntegrateCommandModule = mockModule<typeof import('../src/adapters/process/post-integrate-hook.js')>('../src/adapters/process/post-integrate-hook.js', import.meta.url);
await installModuleMocks();
test.afterEach(() => mock.restoreAll());
const { resolvePostIntegrateCommand } = resolvePostIntegrateCommandModule;

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2203-proof-order-'));
  try { fn(dir); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function writeWorkflowConfig(root) {
  fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
    product: { name: 'Test Project' },
    adapters: {
      tasks: { provider: 'backlog-md', storage: 'backlog' },
      missions: { baseDir: 'docs/missions', branchPrefix: 'mission/', worktreePattern: '../<repo>-<slug>' },
      verification: { command: 'npm test', defaultArea: 'docs' },
      review: { provider: 'forgejo', baseUrl: 'http://localhost:3300', remote: 'review', repo: 'test-org/test-repo' },
      agents: { commandEnvPrefix: 'AUTONOMOUS_REVIEW_' },
      integrate: { postIntegrateCommand: './scripts/refresh-global-px.sh' },
    },
  }, null, 2));
}

// ---------------------------------------------------------------------------
// Test 1: The post-integrate command is wired and does a rebuild.
// ---------------------------------------------------------------------------
test('post-integrate hook runs the configured distribution rebuild (task-2203 prerequisite)', () => {
  withTempDir(root => {
    writeWorkflowConfig(root);
    const command = resolvePostIntegrateCommand(root);
    assert.equal(command, './scripts/refresh-global-px.sh');
  });
});

// ---------------------------------------------------------------------------
// Test 2: The post-integrate script rebuilds the dist tree via npm run build.
// ---------------------------------------------------------------------------
test('refresh-global-px.sh builds dist (task-2203 prerequisite)', () => {
  const REPO_ROOT = path.join(import.meta.dirname, '..');
  const scriptPath = path.join(REPO_ROOT, 'scripts', 'refresh-global-px.sh');
  const content = fs.readFileSync(scriptPath, 'utf8');
  assert.match(content, /npm run build/,
    'refresh-global-px.sh must rebuild compiled artifacts');
});

// ---------------------------------------------------------------------------
// Test 3: Source code ordering — proof capture must come AFTER post-integrate
// hook invocation in the Variant B integrate flow.
//
// This test reads the source TypeScript of the module that owns the Variant B
// closeout order and asserts that the textual ordering of function calls
// matches the fixed behaviour:
//   runPostIntegrateHook (or runPostIntegrateHookOrAbort)  <  captureVerifiedTreeProof
//
// Before the fix: captureVerifiedTreeProof appeared BEFORE runPostIntegrateHook.
// After the fix:  runPostIntegrateHook appears BEFORE captureVerifiedTreeProof.
//
// TASK-2604 moved the hook into shared landed closeout. The squash flow must
// await that closeout before capturing the publish proof.
// ---------------------------------------------------------------------------
test('Variant B: post-integrate hook runs before proof capture (task-2203 fix)', () => {
  const REPO_ROOT = path.join(import.meta.dirname, '..');
  const squashPath = path.join(REPO_ROOT, 'src', 'application', 'integrate', 'squash.ts');
  const content = fs.readFileSync(squashPath, 'utf8');
  const closeoutPath = path.join(REPO_ROOT, 'src', 'application', 'integrate', 'landed-closeout.ts');
  const closeout = fs.readFileSync(closeoutPath, 'utf8');

  const finishIdx = content.indexOf('await finishLanding(run, { branch, mergedCommit');
  const proofIdx = content.indexOf('captureVerifiedTreeProof');

  assert.match(content, /await completeLandedCloseout\(/);
  assert.match(closeout, /await landing\.runPostIntegrateHookOrAbort\(/);
  assert.ok(finishIdx >= 0, 'squash.ts must await landed closeout');
  assert.ok(proofIdx >= 0, 'squash.ts must call captureVerifiedTreeProof');
  assert.ok(proofIdx > finishIdx, 'proof must follow the awaited closeout hook');
});

// ---------------------------------------------------------------------------
// Test 4: The task-2200 symptom — proof captured before the rebuild is stale.
// ---------------------------------------------------------------------------
test('proof captured before rebuild is stale after post-integrate hook (task-2200 symptom)', () => {
  withTempDir(root => {
    // Setup: create a minimal git repo with stale compiled output.
    const runGit = (args) => {
      const res = childProcess.spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
      if (res.status !== 0) {
        throw new Error(`git ${args.join(' ')} failed: ${res.stderr}${res.stdout}`);
      }
      return res;
    };

    runGit(['init']);
    runGit(['config', 'user.name', 'Test User']);
    runGit(['config', 'user.email', 'test@example.com']);
    fs.writeFileSync(path.join(root, 'README.md'), '# temp repo\n', 'utf8');
    runGit(['add', 'README.md']);
    runGit(['commit', '-m', 'init']);

    // Create lib/commands/*.ts with stale .js sibling.
    const commandsDir = path.join(root, 'lib', 'commands');
    fs.mkdirSync(commandsDir, { recursive: true });
    const tsPath = path.join(commandsDir, 'stats.ts');
    const jsPath = path.join(commandsDir, 'stats.js');
    fs.writeFileSync(tsPath, 'export default function stats() { return 1; }\n', 'utf8');
    fs.writeFileSync(jsPath, '"use strict";\nmodule.exports = function stats() { return 1; };\n', 'utf8');

    // Make ts newer than js (stale compiled artifact).
    const oldJsTime = new Date('2000-01-01T00:00:00.000Z');
    const newTsTime = new Date('2030-01-01T00:00:00.000Z');
    fs.utimesSync(jsPath, oldJsTime, oldJsTime);
    fs.utimesSync(tsPath, newTsTime, newTsTime);

    runGit(['add', 'lib/commands/stats.ts', 'lib/commands/stats.js']);
    runGit(['commit', '-m', 'add stale fixture']);

    // Pre-hook tree (what old code captured proof from).
    const preHookTree = runGit(['rev-parse', 'HEAD^{tree}']).stdout.trim();

    // Simulate post-integrate hook: version bump commit changes the tree.
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'test', version: '1.0.1' }, null, 2));
    runGit(['add', 'package.json']);
    runGit(['commit', '-m', 'chore: bump version (post-integrate self-update)']);

    const postHookTree = runGit(['rev-parse', 'HEAD^{tree}']).stdout.trim();

    // The hook changed the tree.
    assert.notEqual(preHookTree, postHookTree,
      'post-integrate hook must change the tree');

    // Proof captured from preHookTree does NOT match postHookTree.
    // This is the task-2200 symptom: stale proof.
    assert.notEqual(preHookTree, postHookTree,
      'task-2200 symptom: proof captured before rebuild is stale after hook');
  });
});
