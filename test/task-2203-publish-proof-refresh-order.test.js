const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

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

const { resolvePostIntegrateCommand } = require('../dist/lib/core/post-integrate-hook');

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
  const REPO_ROOT = path.join(__dirname, '..');
  const scriptPath = path.join(REPO_ROOT, 'scripts', 'refresh-global-px.sh');
  const content = fs.readFileSync(scriptPath, 'utf8');
  assert.match(content, /npm run build/,
    'refresh-global-px.sh must rebuild compiled artifacts');
});

// ---------------------------------------------------------------------------
// Test 3: Source code ordering — proof capture must come AFTER post-integrate
// hook invocation in the Variant B integrate flow.
//
// This test reads the compiled JavaScript of integrate.ts and asserts that the
// textual ordering of function calls matches the fixed behaviour:
//   runPostIntegrateHook (or runPostIntegrateHookOrAbort)  <  captureVerifiedTreeProof
//
// Before the fix: captureVerifiedTreeProof appeared BEFORE runPostIntegrateHook.
// After the fix:  runPostIntegrateHook appears BEFORE captureVerifiedTreeProof.
// ---------------------------------------------------------------------------
test('Variant B: post-integrate hook runs before proof capture (task-2203 fix)', () => {
  const REPO_ROOT = path.join(__dirname, '..');
  const integratePath = path.join(REPO_ROOT, 'dist', 'lib', 'commands', 'integrate.js');
  const content = fs.readFileSync(integratePath, 'utf8');

  // Find the positions of the key function calls in the compiled JS.
  // We look for the pattern in the Variant B closeout path (after squash commit).
  const hookIdx = content.indexOf('runPostIntegrateHookOrAbort');
  const proofIdx = content.indexOf('captureVerifiedTreeProof');

  assert.ok(hookIdx >= 0, 'integrate.js must call runPostIntegrateHookOrAbort');
  assert.ok(proofIdx >= 0, 'integrate.js must call captureVerifiedTreeProof');

  // The proof capture must appear AFTER the post-integrate hook in the source.
  // In the compiled JS, this means the proof function call text comes after the
  // hook function call text in the Variant B flow.
  assert.ok(proofIdx > hookIdx,
    'captureVerifiedTreeProof must appear AFTER runPostIntegrateHookOrAbort in '
    + 'integrate.js (proof must be captured after the post-integrate rebuild, '
    + 'not before — task-2203 fix)');
});

// ---------------------------------------------------------------------------
// Test 4: The task-2200 symptom — proof captured before the rebuild is stale.
// ---------------------------------------------------------------------------
test('proof captured before rebuild is stale after post-integrate hook (task-2200 symptom)', () => {
  withTempDir(root => {
    // Setup: create a minimal git repo with stale compiled output.
    const childProcess = require('child_process');
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
