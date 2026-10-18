import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mkdtemp } from '../../helpers/temp-dir.js';
import { resolvePostIntegrateCommand } from '../../../src/adapters/process/post-integrate-hook.js';
describe("refresh-global-px script", () => {

  const REPO_ROOT = path.join(import.meta.dirname, '..', '..', '..');
  const SCRIPT_PATH = path.join(REPO_ROOT, 'scripts', 'refresh-global-px.sh');

  // These tests prove script wiring, command ordering and documented inputs.
  // They do not execute the script: it
  // runs `npm pack` and `npm install -g`, which would mutate the operator's actual
  // global npm install.

  test('workflow.config.json wires the generic post-integrate hook to the checked-in script', () => {
    const command = resolvePostIntegrateCommand(REPO_ROOT);
    assert.equal(command, './scripts/refresh-global-px.sh && npm run sonar:delete-branch');
  });

  test('the post-integrate hook chain runs the global px refresh before the SonarQube mission branch deletion', () => {
    const command = resolvePostIntegrateCommand(REPO_ROOT) || '';
    const refreshIndex = command.indexOf('./scripts/refresh-global-px.sh');
    const deleteIndex = command.indexOf('npm run sonar:delete-branch');
    assert.ok(refreshIndex !== -1, `refresh step missing from: ${command}`);
    assert.ok(deleteIndex !== -1, `deletion step missing from: ${command}`);
    assert.ok(refreshIndex < deleteIndex, 'refresh-global-px.sh must complete before the deletion step starts');
    // The `&&` chain means a refresh failure aborts the hook before any
    // SonarQube call; the deletion step itself never fails the hook because the
    // delete-branch subcommand always exits 0 (ADR 0060).
    assert.match(command, /&&/);
  });

  test('no product code path invokes the SonarQube mission branch deletion', () => {
    // The deletion is reachable only through the post-integrate hook, which runs
    // solely from the confirmed-integration landing path after the landed
    // integration is persisted. Failed, closed, and review-only missions never
    // run postIntegrateCommand, and no code under src/ may invoke the deletion
    // directly (ADR 0060 product boundary).
    const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? walk(full) : entry.name.endsWith('.ts') ? [full] : [];
    });
    const offenders = walk(path.join(REPO_ROOT, 'src')).filter(file => {
      const content = fs.readFileSync(file, 'utf8');
      return content.includes('sonar:delete-branch') || content.includes('deleteMissionBranch') || content.includes('deleteSonarBranch');
    });
    assert.deepEqual(offenders, [], 'the SonarQube branch deletion must be wired only through workflow.config.json postIntegrateCommand');
  });

  test('scripts/refresh-global-px.sh exists and is executable', () => {
    assert.ok(fs.existsSync(SCRIPT_PATH), 'refresh-global-px.sh should be checked in under scripts/');
    const mode = fs.statSync(SCRIPT_PATH).mode;
    assert.ok(mode & 0o111, 'refresh-global-px.sh should have an executable bit set');
  });


  test('scripts/refresh-global-px.sh rebuilds and reinstalls from a packed tarball without allocating a version', () => {
    const content = fs.readFileSync(SCRIPT_PATH, 'utf8');
    assert.match(content, /px-install\.sh/);
    assert.match(content, /npm run build/);
    assert.match(content, /npm pack --ignore-scripts/);
    assert.match(content, /npm install -g/);
    assert.doesNotMatch(content, /npm version/);
    assert.doesNotMatch(content, /git commit/);
    // Uses the hook-provided env vars documented in lib/core/post-integrate-hook.ts.
    assert.match(content, /INTEGRATE_HOOK_SLUG/);
  });

  test('scripts/refresh-global-px.sh builds the landed distributable exactly once and packing cannot rebuild it (TASK-2714)', () => {
    const content = fs.readFileSync(SCRIPT_PATH, 'utf8');
    // Count commands, not prose: the script's own comments name the commands it avoids.
    const code = content.split('\n').filter(line => !/^\s*#/.test(line)).join('\n');
    // One explicit build of the landed tree. `prepack` is `npm run build`, so a pack
    // that runs lifecycle scripts would compile the same bundle a second time.
    const buildCalls = code.match(/^npm run build\s*$/gm) || [];
    assert.equal(buildCalls.length, 1, 'the refresh must contain exactly one `npm run build`');
    const packCalls = code.match(/npm pack --/g) || [];
    assert.equal(packCalls.length, 1, 'the refresh must pack exactly once');
    assert.match(code, /npm pack --ignore-scripts/, 'packing must not trigger the prepack build');
    assert.doesNotMatch(code, /npm pack --pack-destination/, 'no pack without --ignore-scripts');
    // The build stays before the pack, so the tarball carries the one built tree.
    assert.ok(code.indexOf('npm run build') < code.indexOf('npm pack --ignore-scripts'),
      'the single build must precede packing');
    // package.json still declares prepack, so a standalone `npm pack` (release
    // publication, package-content audit) keeps building normally (ADR 0044).
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    assert.equal(pkg.scripts.prepack, 'npm run build');
  });

  test('scripts/refresh-global-px.sh cleans up the packed tarball on both success and failure', () => {
    const content = fs.readFileSync(SCRIPT_PATH, 'utf8');
    // A trap-based cleanup fires on EXIT regardless of whether a later step fails,
    // so no tarball is left behind in the repo root either way (task-1424).
    assert.match(content, /trap\s+'rm -rf "\$\{PACK_DIR\}"'\s+EXIT/);
  });

  test('workflow.config.json wires local version allocation as the integrate pre-commit hook', () => {
    const config = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'workflow.config.json'), 'utf8'));
    assert.equal(config.adapters.integrate.preCommitCommand, './scripts/bump-version.sh');
    assert.ok(fs.statSync(path.join(REPO_ROOT, 'scripts', 'bump-version.sh')).mode & 0o111, 'bump-version.sh must be executable');
  });
});

describe("publish proof follows the post-integrate rebuild", () => {
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

  function withTempDir(fn: (_root: string) => void) {
    const dir = mkdtemp('px-proof-order-');
    try { fn(dir); }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }

  function writeWorkflowConfig(root: string) {
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
    const REPO_ROOT = path.join(import.meta.dirname, '..', '..', '..');
    const scriptPath = path.join(REPO_ROOT, 'scripts', 'refresh-global-px.sh');
    const content = fs.readFileSync(scriptPath, 'utf8');
    assert.match(content, /npm run build/,
      'refresh-global-px.sh must rebuild compiled artifacts');
  });

  // ---------------------------------------------------------------------------
  // Test 3: Source ordering — the post-integrate rebuild must not be followed by a
  // proof captured from the pre-hook tree in the Variant B integrate flow.
  //
  // Before the fix: captureVerifiedTreeProof appeared BEFORE runPostIntegrateHook,
  // so the proof described a tree the hook had already rebuilt (task-2200/2203).
  // TASK-2604 moved the hook into shared landed closeout, and the publish-proof
  // capture moved out of the squash flow entirely. The invariant that remains: the
  // squash flow awaits the closeout that runs the hook, and no proof capture is
  // left in the squash flow that could observe a pre-hook tree.
  // ---------------------------------------------------------------------------
  test('Variant B: post-integrate hook runs inside the awaited landed closeout and no proof is captured from a pre-hook tree (task-2203 fix)', () => {
    const REPO_ROOT = path.join(import.meta.dirname, '..', '..', '..');
    const squashPath = path.join(REPO_ROOT, 'src', 'application', 'integrate', 'squash.ts');
    const content = fs.readFileSync(squashPath, 'utf8');
    const closeoutPath = path.join(REPO_ROOT, 'src', 'application', 'integrate', 'landed-closeout.ts');
    const closeout = fs.readFileSync(closeoutPath, 'utf8');

    const finishIdx = content.indexOf('await this.finishLanding(run, { branch, mergedCommit');

    assert.match(content, /await completeLandedCloseout\(/);
    assert.match(closeout, /await landing\.runPostIntegrateHookOrAbort\(/);
    assert.ok(finishIdx >= 0, 'squash.ts must await landed closeout');
    assert.doesNotMatch(content, /captureVerifiedTreeProof/,
      'the squash flow must not capture a tree proof before the awaited closeout rebuilds the tree');
    // The hook stays inside the closeout the squash flow awaits, so the rebuild
    // completes before anything downstream reads the landed tree.
    const hookIdx = closeout.indexOf('await landing.runPostIntegrateHookOrAbort(');
    const closeIdx = closeout.indexOf('await landing.closeLandedIntegrationOrAbort(');
    assert.ok(hookIdx >= 0 && closeIdx > hookIdx, 'the hook must run before the closeout closes the mission');
  });

  // ---------------------------------------------------------------------------
});
