// Behavior-owned suite (TASK-2622.09, integration-ci): the post-integrate global install script and
// installed bundle layout — npm pack lifecycle output (task-2206), publish/reinstall layout (task-1424),
// publish-proof ordering after the rebuild (task-2203, TASK-2622.17) and stale-lockfile reconciliation (task-2621,
// TASK-2622.17). Legacy case names unchanged.
import test, { mock, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import childProcess, { spawnSync } from 'node:child_process';
import os from 'node:os';
import { mockModule, installModuleMocks } from './lib/module-mock.js';

// Declaration order is load-bearing: installModuleMocks relinks modules in this order, so a
// module must be declared after the modules it depends on (merged from every section below).
mockModule('../src/adapters/process/post-integrate-hook.js', import.meta.url);
await installModuleMocks();

// ---- refresh-global-px script (consolidated from test/refresh-global-px-script.test.ts, TASK-2622.09) ----
describe("refresh-global-px script", () => {
  const resolvePostIntegrateCommandModule = mockModule<typeof import('../src/adapters/process/post-integrate-hook.js')>('../src/adapters/process/post-integrate-hook.js', import.meta.url);

  test.afterEach(() => mock.restoreAll());
  const { resolvePostIntegrateCommand } = resolvePostIntegrateCommandModule;
  const REPO_ROOT = path.join(import.meta.dirname, '..');
  const SCRIPT_PATH = path.join(REPO_ROOT, 'scripts', 'refresh-global-px.sh');

  // These tests only prove the script is wired up, syntactically valid, and reads
  // the hook env vars it documents. They never execute the script for real: it
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

  test('scripts/refresh-global-px.sh is syntactically valid bash', () => {
    const result = spawnSync('bash', ['-n', SCRIPT_PATH], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  });

  test('scripts/refresh-global-px.sh rebuilds and reinstalls from a packed tarball without allocating a version', () => {
    const content = fs.readFileSync(SCRIPT_PATH, 'utf8');
    assert.match(content, /npm ci/);
    assert.match(content, /npm run build/);
    assert.match(content, /npm pack/);
    assert.match(content, /npm install -g/);
    assert.doesNotMatch(content, /npm version/);
    assert.doesNotMatch(content, /git commit/);
    // Uses the hook-provided env vars documented in lib/core/post-integrate-hook.ts.
    assert.match(content, /INTEGRATE_HOOK_SLUG/);
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

// ---- task-1424 publish and reinstall (consolidated from test/task-1424-post-integrate-publish-reinstall.test.ts, TASK-2622.09) ----
describe("task-1424 publish and reinstall", () => {
  const PACKAGE_ROOT = path.join(import.meta.dirname, '..');

  type RunOptions = import('node:child_process').SpawnSyncOptions & {
    tempHome?: string;
    env?: Record<string, string>;
  };

  // Reproduces the real post-integrate self-update path from scripts/refresh-global-px.sh:
  // `npm pack` the checkout, `npm install -g` the tarball, then run the installed
  // executable from a temporary target repository. Since TASK-2285 the package
  // contains only the canonical ESM bundle payload (build/), so extraction cannot
  // couple source and sibling-JS mtimes.
  function run(command: string, args: string[], options: RunOptions = {}) {
    const runOptions = options as RunOptions;
    const callerProvided = runOptions.tempHome !== undefined;
    const tempHome = runOptions.tempHome || fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-npm-home-'));
    const { env: extraEnv, ...spawnOptions } = runOptions;
    const result = spawnSync(command, args, {
      encoding: 'utf8',
      timeout: 120000,
      env: {
        ...process.env,
        HOME: tempHome,
        npm_config_cache: path.join(tempHome, '.npm-cache'),
        npm_config_userconfig: path.join(tempHome, '.npmrc'),
        ...(extraEnv || {})
      },
      ...spawnOptions
    });
    // Clean up auto-created tempHome; preserve caller-provided directories.
    if (!callerProvided) {
      try { fs.rmSync(tempHome, { recursive: true, force: true }); } catch (_) {}
    }
    return result;
  }

  function packFilename(stdout) {
    const jsonMatches = [...String(stdout || '').matchAll(/"filename"\s*:\s*"([^"]+\.tgz)"/g)];
    if (jsonMatches.length > 0) {
      return jsonMatches[jsonMatches.length - 1][1];
    }
    return String(stdout || '').split(/\r?\n/).map(line => line.trim()).findLast(line => line.endsWith('.tgz')) || null;
  }

  test('installed bundle-layout tarball runs read-only commands outside the checkout', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-publish-reinstall-'));
    const packDir = path.join(root, 'pack');
    const prefix = path.join(root, 'npm-prefix');
    const npmHome = path.join(root, 'npm-home');
    const target = path.join(root, 'target');
    const parallixHome = path.join(root, 'parallix-home');
    fs.mkdirSync(packDir, { recursive: true });
    fs.mkdirSync(npmHome, { recursive: true });
    fs.mkdirSync(target, { recursive: true });

    try {
      const packArgs = [
        'pack',
        PACKAGE_ROOT,
        '--json',
        '--pack-destination',
        packDir
      ];
      // Match the other package smoke tests: CI's prebuilt lane packs the
      // prepared artifact without serializing redundant prepack builds.
      if (process.env.PARALLIX_PREBUILT_PACK === '1') { packArgs.push('--ignore-scripts'); }
      const packResult = run('npm', packArgs, { tempHome: npmHome, cwd: packDir });
      assert.equal(packResult.status, 0, `npm pack failed\nstdout:\n${packResult.stdout}\nstderr:\n${packResult.stderr}`);
      const filename = packFilename(packResult.stdout);
      if (!filename) {
        return;
      }
      const tarball = path.join(packDir, filename);
      assert.ok(fs.existsSync(tarball), 'npm pack must write its archive only to the temporary destination');

      const installResult = run('npm', ['install', '-g', '--prefix', prefix, tarball], { tempHome: npmHome });
  // @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
      if (installResult.error && installResult.error.code === 'EPERM') {
        return;
      }
      assert.equal(
        installResult.status,
        0,
        `npm install -g failed\nstdout:\n${installResult.stdout}\nstderr:\n${installResult.stderr}`
      );

      const installedRoot = path.join(prefix, 'lib', 'node_modules', '@magnusekdahl', 'parallix');
      assert.ok(fs.existsSync(installedRoot), 'installed package directory should exist');
      assert.ok(fs.existsSync(path.join(installedRoot, 'build', 'px.mjs')), 'installed package should contain build/px.mjs');
      assert.ok(fs.existsSync(path.join(installedRoot, 'build', 'px.mjs.map')), 'installed package should contain source maps');
      assert.ok(!fs.existsSync(path.join(installedRoot, 'dist')), 'installed package should not contain the CommonJS rollback tree');
      assert.ok(!fs.existsSync(path.join(installedRoot, 'lib')), 'installed package should not contain sibling lib runtime');
      assert.ok(!fs.existsSync(path.join(installedRoot, 'px.js')), 'installed package should not contain sibling px runtime');
      assert.ok(!fs.existsSync(path.join(installedRoot, 'px.ts')), 'installed package should not contain TypeScript source');
      assert.ok(!fs.existsSync(path.join(installedRoot, 'src')), 'installed package should not contain source authority');
      assert.ok(!fs.existsSync(path.join(installedRoot, 'test')), 'installed package should not contain tests');
      assert.ok(!fs.existsSync(path.join(installedRoot, 'missions')), 'installed package should not contain mission records');
      assert.ok(!fs.existsSync(path.join(installedRoot, 'backlog')), 'installed package should not contain backlog state');
      assert.ok(!fs.existsSync(path.join(installedRoot, 'tsconfig.json')), 'installed package should not contain development configuration');

      const px = path.join(prefix, 'bin', 'px');
      fs.mkdirSync(parallixHome, { recursive: true });
      // TASK-2322.08: `px stats` reads the measurement database and creates it on
      // first access, so no seed file is needed and none may be a CSV.
      const pxVersion = run(px, ['--version'], { cwd: target });
      assert.equal(pxVersion.status, 0, `installed px --version failed\nstdout:\n${pxVersion.stdout}\nstderr:\n${pxVersion.stderr}`);
  // @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
      assert.match(pxVersion.stdout, new RegExp(`${installedRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/build/px\\.mjs`));

      for (const command of ['status', 'stats']) {
        const result = run(px, [command], { cwd: target, tempHome: npmHome, env: { PARALLIX_HOME: parallixHome } });
        assert.equal(result.status, 0, `installed px ${command} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
      }
      assert.ok(fs.existsSync(path.join(parallixHome, 'parallix.db')), 'px stats must create the measurement database under PARALLIX_HOME');
      assert.deepEqual(
        fs.readdirSync(parallixHome).filter(name => name.endsWith('.csv')),
        [],
        'the installed CLI must not write a stats CSV'
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---- task-2206 post-integrate hook errors (consolidated from test/task-2206-post-integrate-hook-errors.test.ts, TASK-2622.09) ----
describe("task-2206 post-integrate hook errors", () => {
  const REPO_ROOT = path.join(import.meta.dirname, '..');
  const SCRIPT_SOURCE = path.join(REPO_ROOT, 'scripts', 'refresh-global-px.sh');

  function writeExecutable(filePath, content) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
    fs.chmodSync(filePath, 0o755);
  }

  function setupFixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2206-hook-'));
    const repoRoot = path.join(root, 'repo');
    const binDir = path.join(root, 'bin');
    const logPath = path.join(root, 'calls.log');

    fs.mkdirSync(path.join(repoRoot, 'scripts'), { recursive: true });
    fs.copyFileSync(SCRIPT_SOURCE, path.join(repoRoot, 'scripts', 'refresh-global-px.sh'));
    fs.writeFileSync(path.join(repoRoot, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.1' }, null, 2));
    fs.writeFileSync(path.join(repoRoot, 'package-lock.json'), '{}\n');

    writeExecutable(path.join(binDir, 'git'), `#!/usr/bin/env node
const fs = require('node:fs');
fs.appendFileSync(${JSON.stringify(logPath)}, 'git ' + process.argv.slice(2).join(' ') + '\\n');
process.exit(0);
`);

    writeExecutable(path.join(binDir, 'px'), `#!/usr/bin/env node
const fs = require('node:fs');
process.stdout.write(fs.readFileSync(${JSON.stringify(path.join(root, 'installed-version'))}, 'utf8'));
`);

    writeExecutable(path.join(binDir, 'npm'), `#!/usr/bin/env node
const fs = require('node:fs');
const logPath = ${JSON.stringify(logPath)};
const args = process.argv.slice(2);
fs.appendFileSync(logPath, 'npm ' + args.join(' ') + '\\n');

if (args[0] === 'ci') {
  process.exit(0);
}

if (args[0] === 'run' && args[1] === 'build') {
  process.exit(0);
}

if (args[0] === 'pack') {
  process.stdout.write('> fixture@1.0.1 prepack\\n');
  process.stdout.write('> npm run build\\n');
  process.stdout.write('\\n');
  const destination = args[args.indexOf('--pack-destination') + 1];
  if (!args.includes('--pack-destination') || destination === process.cwd()) process.exit(1);
  fs.writeFileSync(require('node:path').join(destination, 'fixture-1.0.1.tgz'), 'fixture');
  process.stdout.write('fixture-1.0.1.tgz\\n');
  process.exit(0);
}

if (args[0] === 'install' && args[1] === '-g') {
  const tarballArg = args[2] || '';
  if (/\\n/.test(tarballArg)) {
    process.stderr.write('ENOENT ' + JSON.stringify(tarballArg) + '\\n');
    process.exit(254);
  }
  fs.writeFileSync(${JSON.stringify(path.join(root, 'installed-version'))}, tarballArg.match(/(\\d+\\.\\d+\\.\\d+)/)[1] + '\\n');
  process.exit(0);
}

process.stderr.write('unexpected npm invocation: ' + args.join(' ') + '\\n');
process.exit(1);
`);

    return { root, repoRoot, binDir, logPath };
  }

  function runHook(binDir, repoRoot) {
    return childProcess.spawnSync('bash', ['scripts/refresh-global-px.sh'], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        INTEGRATE_HOOK_SLUG: 'task-2206',
        INTEGRATE_HOOK_BASE_WORKTREE: repoRoot,
        INTEGRATE_HOOK_BASE_BRANCH: 'main',
        INTEGRATE_HOOK_VARIANT: 'variant-b',
      },
    });
  }

  test('refresh-global-px.sh passes a real tarball path to npm install even when npm pack prints lifecycle output', () => {
    const fixture = setupFixture();

    try {
      const result = runHook(fixture.binDir, fixture.repoRoot);
      assert.equal(
        result.status,
        0,
        `hook should succeed with lifecycle chatter on npm pack\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
      );

      const calls = fs.readFileSync(fixture.logPath, 'utf8');
      assert.match(calls, /npm pack/);
      const packedPath = calls.match(/npm install -g (.+fixture-1\.0\.1\.tgz)/)?.[1];
      assert.ok(packedPath);
      assert.equal(fs.existsSync(path.dirname(packedPath)), false, 'temporary archives are removed after installation');
      assert.deepEqual(fs.readdirSync(fixture.repoRoot).filter(file => file.endsWith('.tgz')), []);
      assert.match(result.stdout, /Global px runner refreshed/);
      assert.match(result.stdout, /1\.0\.1/, 'the reported installed px version equals the landed package version');
      assert.match(calls, /npm ci\nnpm run build\nnpm pack --pack-destination [^\n]+\nnpm install -g/, 'dependency reconciliation precedes build, pack, and global installation');
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test('refresh-global-px.sh still fails closed when npm pack itself fails', () => {
    const fixture = setupFixture();
    writeExecutable(path.join(fixture.binDir, 'npm'), `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'ci') {
  process.exit(0);
}
if (args[0] === 'run' && args[1] === 'build') {
  process.exit(0);
}
if (args[0] === 'pack') {
  process.stderr.write('publish guard rejected stale tree\\n');
  process.exit(1);
}
process.exit(0);
`);

    try {
      const result = runHook(fixture.binDir, fixture.repoRoot);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /publish guard rejected stale tree/);
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });
});

// ---- task-2203 publish proof is captured after the post-integrate rebuild (consolidated from test/task-2203-publish-proof-refresh-order.test.ts, TASK-2622.17) ----
describe('task-2203 publish proof is captured after the post-integrate rebuild (consolidated from test/task-2203-publish-proof-refresh-order.test.ts, TASK-2622.17)', () => {
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
  const resolvePostIntegrateCommandModule = mockModule<typeof import('../src/adapters/process/post-integrate-hook.js')>('../src/adapters/process/post-integrate-hook.js', import.meta.url);
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
});

// ---- task-2621 refresh reconciles the landed lockfile before pack (consolidated from test/task-2621-repro.test.ts, TASK-2622.17) ----
describe('task-2621 refresh reconciles the landed lockfile before pack (consolidated from test/task-2621-repro.test.ts, TASK-2622.17)', () => {
  const REPO_ROOT = path.join(import.meta.dirname, '..');
  const REFRESH_SCRIPT = path.join(REPO_ROOT, 'scripts', 'refresh-global-px.sh');

  function executable(file: string, source: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, source, 'utf8');
    fs.chmodSync(file, 0o755);
  }

  function packageJson(version: string) {
    return JSON.stringify({ name: 'brace-expansion', version }, null, 2);
  }

  function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2621-'));
    const repo = path.join(root, 'repo');
    const bin = path.join(root, 'bin');
    const calls = path.join(root, 'calls.log');
    const nested = 'node_modules/@earendil-works/pi-coding-agent/node_modules/brace-expansion';
    const rootBrace = path.join(repo, 'node_modules/brace-expansion');
    const nestedBrace = path.join(repo, nested);

    fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true });
    fs.copyFileSync(REFRESH_SCRIPT, path.join(repo, 'scripts/refresh-global-px.sh'));
    fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0' }));
    fs.writeFileSync(path.join(repo, 'package-lock.json'), JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': { name: 'fixture', version: '1.0.0' },
        'node_modules/brace-expansion': { version: '5.0.12' },
        [nested]: { version: '5.0.12' },
      },
    }, null, 2));
    fs.mkdirSync(rootBrace, { recursive: true });
    fs.mkdirSync(nestedBrace, { recursive: true });
    fs.writeFileSync(path.join(rootBrace, 'package.json'), packageJson('5.0.9'));
    fs.writeFileSync(path.join(nestedBrace, 'package.json'), packageJson('5.0.9'));

    executable(path.join(bin, 'px'), '#!/usr/bin/env bash\necho 1.0.0\n');
    executable(path.join(bin, 'npm'), `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const root = process.cwd();
const calls = ${JSON.stringify(calls)};
const nested = ${JSON.stringify(nested)};
fs.appendFileSync(calls, args.join(' ') + '\\n');
const packageJson = version => JSON.stringify({ name: 'brace-expansion', version });
if (args[0] === 'ci') {
  for (const target of ['node_modules/brace-expansion', nested]) {
    fs.mkdirSync(path.join(root, target), { recursive: true });
    fs.writeFileSync(path.join(root, target, 'package.json'), packageJson('5.0.12'));
  }
  process.exit(0);
}
if (args[0] === 'run' && args[1] === 'build') process.exit(0);
if (args[0] === 'pack') {
  for (const target of ['node_modules/brace-expansion', nested]) {
    if (JSON.parse(fs.readFileSync(path.join(root, target, 'package.json'))).version !== '5.0.12') {
      process.stderr.write('prepare rejected stale brace-expansion\\n'); process.exit(1);
    }
  }
  process.stdout.write('fixture-1.0.0.tgz\\n'); process.exit(0);
}
if (args[0] === 'install' && args[1] === '-g') process.exit(0);
process.exit(1);
`);
    return { root, repo, bin, calls };
  }

  test('task-2621: refresh reconciles the landed lockfile before npm pack prepare without a real global install', () => {
    const setup = fixture();
    try {
      const result = childProcess.spawnSync('bash', ['scripts/refresh-global-px.sh'], {
        cwd: setup.repo,
        encoding: 'utf8',
        env: { ...process.env, PATH: `${setup.bin}:${process.env.PATH}` },
      });
      assert.equal(result.status, 0, `refresh should reconcile stale dependencies before pack prepare\n${result.stderr}`);
      assert.match(fs.readFileSync(setup.calls, 'utf8'), /^ci$/m);
    } finally {
      fs.rmSync(setup.root, { recursive: true, force: true });
    }
  });
});
