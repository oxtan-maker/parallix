

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const originalOpenSync = fs.openSync;
const originalTmpdir = os.tmpdir;

// Import the smoke suite for its helpers only. The flag is set before the
// dynamic import so the smoke tests themselves do not register here.
process.env.PARALLIX_E2E_SMOKE_TEST_HELPERS = '1';
const smokeHelpers = await import('../../e2e/agents/real-agent-smoke.test.js');

function loadSmokeHelpers() {
  return {
    ...smokeHelpers,
    runWorkflowAllowFail: (root: string, env: NodeJS.ProcessEnv, args: string[], timeout: number,
      options: { directCommand?: boolean; keepCaptureArtifacts?: boolean; liveProgress?: boolean; progressWrite?: (line: string) => void } = {}) => {
      const childEnv = { ...env };
      // These direct commands are synthetic capture/timeout fixtures. Keep
      // coverage on this worker and the real helper, but never let a 30 ms
      // timeout interrupt a fixture's V8 write into the suite collector.
      if (options.directCommand) { delete childEnv.NODE_V8_COVERAGE; }
      return smokeHelpers.runWorkflowAllowFail(root, childEnv, args, timeout, options);
    },
  };
}

test('synthetic smoke-capture children leave the suite coverage directory untouched (TASK-2681)', async () => {
  const tempRoot = fs.mkdtempSync(path.join(originalTmpdir(), 'smoke-capture-coverage-'));
  const coverageRoot = path.join(tempRoot, 'coverage');
  fs.mkdirSync(coverageRoot);
  try {
    const { runWorkflowAllowFail } = loadSmokeHelpers();
    const result = await runWorkflowAllowFail(tempRoot, { ...process.env, NODE_V8_COVERAGE: coverageRoot },
      [process.execPath, '-e', 'process.stdout.write("synthetic capture fixture")'], 1000,
      { directCommand: true });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, 'synthetic capture fixture');
    assert.deepEqual(fs.readdirSync(coverageRoot), [],
      'synthetic scripts must not contribute raw payloads that timeout can truncate');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('real-agent smoke capture removes its first stdout file when stderr capture setup fails', async () => {
  const tempRoot = fs.mkdtempSync(path.join(originalTmpdir(), 'task-2241-repro-'));
  let openCalls = 0;
  try {
    os.tmpdir = () => tempRoot;
    fs.openSync = (filePath, ...args) => {
      openCalls += 1;
      if (openCalls === 1) {
        return originalOpenSync(filePath, ...args);
      }
      const error = new Error('ENOSPC: no space left while opening stderr capture');
// @ts-expect-error -- Legacy fixture intentionally accesses runtime-only `code` absent from its inferred mock shape.
      error.code = 'ENOSPC';
      throw error;
    };
    const { runWorkflowAllowFail } = loadSmokeHelpers();

    await assert.rejects(
      () => runWorkflowAllowFail(tempRoot, process.env, ['--version'], 100),
      { code: 'ENOSPC' }
    );
    assert.deepEqual(fs.readdirSync(tempRoot), [], 'owned capture must be removed after stderr setup failure');
  } finally {
    fs.openSync = originalOpenSync;
    os.tmpdir = originalTmpdir;
    delete process.env.PARALLIX_E2E_SMOKE_TEST_HELPERS;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('real-agent smoke captures clean up after normal, command-failure, and timeout runs', async () => {
  const tempRoot = fs.mkdtempSync(path.join(originalTmpdir(), 'task-2241-terminal-'));
  try {
    os.tmpdir = () => tempRoot;
    const { runWorkflowAllowFail } = loadSmokeHelpers();
    for (const script of [
      'process.stdout.write("ok")',
      'process.stderr.write("failed"); process.exit(7)',
      'setTimeout(() => {}, 1000)'
    ]) {
      const result = await runWorkflowAllowFail(tempRoot, process.env, [process.execPath, '-e', script], 30, { directCommand: true });
      assert.ok(result, 'each terminal path returns a child-process result');
      assert.deepEqual(fs.readdirSync(tempRoot), [], 'completed captures must not leave owned directories');
    }
  } finally {
    os.tmpdir = originalTmpdir;
    delete process.env.PARALLIX_E2E_SMOKE_TEST_HELPERS;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('real-agent smoke capture retention is opt-in and never deletes operator or concurrent paths', async () => {
  const tempRoot = fs.mkdtempSync(path.join(originalTmpdir(), 'task-2241-retention-'));
  const operatorFile = path.join(tempRoot, 'operator-diagnostics.log');
  const concurrentDir = path.join(tempRoot, 'parallix-real-agent-capture-concurrent');
  try {
    fs.writeFileSync(operatorFile, 'keep');
    fs.mkdirSync(concurrentDir);
    os.tmpdir = () => tempRoot;
    const { runWorkflowAllowFail } = loadSmokeHelpers();
    await runWorkflowAllowFail(tempRoot, process.env, [process.execPath, '-e', 'process.stdout.write("retain")'], 1000, {
      directCommand: true,
      keepCaptureArtifacts: true
    });
    const retained = fs.readdirSync(tempRoot).filter((entry) => entry.startsWith('parallix-real-agent-capture-') && entry !== path.basename(concurrentDir));
    assert.equal(retained.length, 1, 'only this invocation may retain one owned capture directory');
    assert.ok(fs.existsSync(path.join(tempRoot, retained[0], 'stdout.log')));
    assert.equal(fs.readFileSync(operatorFile, 'utf8'), 'keep');
    assert.ok(fs.existsSync(concurrentDir));
  } finally {
    os.tmpdir = originalTmpdir;
    delete process.env.PARALLIX_E2E_SMOKE_TEST_HELPERS;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('repeated real-agent smoke capture runs leave no Parallix-owned residue beneath the configured temporary root', async () => {
  const tempRoot = fs.mkdtempSync(path.join(originalTmpdir(), 'task-2241-residue-'));
  try {
    os.tmpdir = () => tempRoot;
    const { runWorkflowAllowFail } = loadSmokeHelpers();
    for (let run = 0; run < 5; run += 1) {
      const result = await runWorkflowAllowFail(tempRoot, process.env, [process.execPath, '-e', `process.stdout.write(${JSON.stringify(`run-${run}`)})`], 1000, { directCommand: true });
      assert.equal(result.status, 0);
    }
    assert.deepEqual(fs.readdirSync(tempRoot), [], 'completed runs must not accumulate Parallix-owned capture directories');
  } finally {
    os.tmpdir = originalTmpdir;
    delete process.env.PARALLIX_E2E_SMOKE_TEST_HELPERS;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('real-agent smoke preflight reports temporary-storage exhaustion before fixture creation', async () => {
  const { temporaryCapacityPreflight } = loadSmokeHelpers();
  const result = temporaryCapacityPreflight({
    tmpDir: '/owned-test-temp',
    requiredBytes: 1024,
// @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
    statfs: () => ({ bavail: 1, bsize: 512 })
  });
  assert.deepEqual(result, {
    ok: false,
    bucket: 'environment-resource',
    detail: 'temporary-storage exhaustion at /owned-test-temp: 512 bytes available, 1024 required'
  });
  delete process.env.PARALLIX_E2E_SMOKE_TEST_HELPERS;
});

test('real-agent smoke classifies ENOSPC and Git index/lock failures as environment resources', async () => {
  const { classifyFailure } = loadSmokeHelpers();
  for (const stderr of [
    'fatal: Unable to create .git/index.lock: No space left on device',
    'fatal: could not lock index file: ENOSPC',
    'error: ENOSPC while writing Git index'
  ]) {
    assert.deepEqual(classifyFailure({ stdout: '', stderr, status: 1, signal: null }), {
      bucket: 'environment-resource',
      detail: 'temporary-storage or Git index/lock creation failed; reclaim capacity and retry'
    });
  }
  delete process.env.PARALLIX_E2E_SMOKE_TEST_HELPERS;
});

test('real-agent smoke classifies a trapped SIGTERM as a runner or model failure', async () => {
  const { classifyFailure } = loadSmokeHelpers();
  assert.equal(classifyFailure({ stdout: '', stderr: '', status: 143, signal: null }).bucket, 'local-model-environment');
  delete process.env.PARALLIX_E2E_SMOKE_TEST_HELPERS;
});

test('real-agent smoke distinguishes active timeout from active workflow rejection', async () => {
  const { classifyFailure } = loadSmokeHelpers();
  const output = { stdout: 'Implementation in progress', stderr: '', status: null, signal: 'SIGTERM' };
  assert.equal(classifyFailure(output, 'active').bucket, 'local-model-environment');
  const rejected = classifyFailure({ ...output, status: 1, signal: null }, 'active');
  assert.equal(rejected.bucket, 'parallix-workflow-failure');
  assert.match(rejected.detail, /px active exited 1/);
});


test('smoke fixture commits AGENTS.md before mission worktree creation (TASK-2726)', async () => {
  const launcherRoot = fs.mkdtempSync(path.join(originalTmpdir(), 'smoke-launcher-'));
  const originalPath = process.env.PATH;
  let repo: ReturnType<typeof smokeHelpers.setupRepository> | undefined;
  try {
    // Fixture construction needs a launcher path, but this contract never runs it.
    fs.symlinkSync(process.execPath, path.join(launcherRoot, 'codex'));
    process.env.PATH = `${launcherRoot}${path.delimiter}${originalPath}`;
    repo = smokeHelpers.setupRepository({ slug: 'task-9003', title: 'Fixture contract', agent: 'codex' });
    const git = (args: string[]) => spawnSync('git', args, { cwd: repo!.repoRoot, encoding: 'utf8' });
    assert.equal(git(['show', 'HEAD:AGENTS.md']).status, 0);
    assert.equal(git(['ls-files', '--error-unmatch', 'AGENTS.md']).status, 0);
    assert.ok(fs.existsSync(path.join(repo.repoRoot, 'AGENTS.md')));
    const worktree = path.join(repo.tmpRoot, 'mission-worktree');
    assert.equal(git(['worktree', 'add', '-b', 'mission/task-9003', worktree]).status, 0);
    assert.ok(fs.existsSync(path.join(worktree, 'AGENTS.md')));
    assert.equal(spawnSync('git', ['ls-files', '--error-unmatch', 'AGENTS.md'], { cwd: worktree }).status, 0);
  } finally {
    process.env.PATH = originalPath;
    if (repo) { fs.rmSync(repo.tmpRoot, { recursive: true, force: true }); }
    fs.rmSync(launcherRoot, { recursive: true, force: true });
  }
});

test('smoke progress reaches integration output before child exit and clears tool state (TASK-2726)', async () => {
  const tempRoot = fs.mkdtempSync(path.join(originalTmpdir(), 'smoke-live-'));
  const released = path.join(tempRoot, 'released');
  const lines: string[] = [];
  let sawToolBeforeExit = false;
  try {
    const progressWrite = (chunk: string) => {
      lines.push(String(chunk));
      if (String(chunk).includes('state=tool')) {
        sawToolBeforeExit = !fs.existsSync(released);
        fs.writeFileSync(released, 'continue');
      }
      return true;
    };
    const script = `
      const fs = require('node:fs');
      process.stdout.write('Running custom to write the mission contract...\\n[INFO] Selected agent for step "active": custom (pi)\\n[INFO] Implementer: custom\\n[INFO] Round 1: launching reviewer (custom)...\\n⚒ echo token=abcdefghijklmnopqrstuvwxyz\\n');
      const timer = setInterval(() => {
        if (fs.existsSync(${JSON.stringify(released)})) {
          clearInterval(timer); process.stdout.write('  ✓ complete\\nRound 2: launching implementer (custom) for act-on-review...\\nRound 2: launching reviewer (custom)...\\n');
        }
      }, 10);
    `;
    const result = await loadSmokeHelpers().runWorkflowAllowFail(tempRoot, process.env,
      [process.execPath, '-e', script], 1000, { directCommand: true, liveProgress: true, progressWrite });
    assert.equal(result.status, 0);
    assert.ok(sawToolBeforeExit, 'the child cannot exit until integration receives tool progress');
    assert.deepEqual(lines, [
      '[agent-smoke] phase=drafting state=model\n',
      '[agent-smoke] phase=implementing state=model\n',
      '[agent-smoke] phase=implementing state=model\n',
      '[agent-smoke] phase=reviewing state=model\n',
      '[agent-smoke] phase=reviewing state=tool command=echo token=<redacted>\n',
      '[agent-smoke] phase=reviewing state=model\n',
      '[agent-smoke] phase=implementing state=model\n',
      '[agent-smoke] phase=reviewing state=model\n'
    ]);
    assert.doesNotMatch(lines.join(''), /abcdefghijklmnopqrstuvwxyz/);
    assert.match(result.stdout, /complete/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});


test('smoke capture isolates concurrent children and bounds inherited tool pipes (TASK-2726)', async () => {
  const tempRoot = fs.mkdtempSync(path.join(originalTmpdir(), 'smoke-concurrent-'));
  try {
    os.tmpdir = () => tempRoot;
    const { runWorkflowAllowFail } = loadSmokeHelpers();
    const results = await Promise.all(['first', 'second'].map(value => runWorkflowAllowFail(
      tempRoot, process.env, [process.execPath, '-e', `setTimeout(() => process.stdout.write(${JSON.stringify(value)}), 10)`],
      1000, { directCommand: true })));
    assert.deepEqual(results.map(result => result.stdout), ['first', 'second']);
    assert.ok(results.every(result => result.status === 0));
    const timed = await runWorkflowAllowFail(tempRoot, process.env, [process.execPath, '-e',
      `require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 10000)'], { stdio: 'inherit' }); setInterval(() => {}, 10000)`],
      100, { directCommand: true });
    assert.equal(timed.error?.code, 'ETIMEDOUT');
    assert.equal(timed.signal, 'SIGKILL');
    assert.deepEqual(fs.readdirSync(tempRoot), []);
  } finally {
    os.tmpdir = originalTmpdir;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('smoke repositories isolate credentials, sessions and mutable operator state (TASK-2727)', () => {
  const source = fs.mkdtempSync(path.join(originalTmpdir(), 'smoke-source-state-'));
  const originalConfig = process.env.XDG_CONFIG_HOME;
  const originalData = process.env.XDG_DATA_HOME;
  const fixtures: ReturnType<typeof smokeHelpers.setupRepository>[] = [];
  try {
    process.env.XDG_CONFIG_HOME = path.join(source, 'config');
    process.env.XDG_DATA_HOME = path.join(source, 'data');
    fs.mkdirSync(path.join(process.env.XDG_CONFIG_HOME, 'opencode'), { recursive: true });
    fs.mkdirSync(path.join(process.env.XDG_DATA_HOME, 'opencode'), { recursive: true });
    fs.writeFileSync(path.join(process.env.XDG_CONFIG_HOME, 'opencode', 'opencode.json'), '{}');
    const linkedConfig = path.join(source, 'linked-config.json');
    fs.writeFileSync(linkedConfig, 'operator-settings');
    fs.symlinkSync(linkedConfig, path.join(process.env.XDG_CONFIG_HOME, 'opencode', 'linked.json'));
    const auth = path.join(process.env.XDG_DATA_HOME, 'opencode', 'auth.json');
    fs.writeFileSync(auth, 'operator-credential');
    fs.writeFileSync(path.join(process.env.XDG_DATA_HOME, 'opencode', 'opencode.db'), 'operator-session');
    for (const slug of ['task-9001', 'task-9002']) {
      fixtures.push(smokeHelpers.setupRepository({ slug, title: 'Isolation', runnerCommandPath: process.execPath }));
    }
    assert.notEqual(fixtures[0].stateHome, fixtures[1].stateHome);
    for (const fixture of fixtures) {
      const taskDir = path.join(fixture.repoRoot, 'backlog', 'tasks');
      const taskText = fs.readFileSync(path.join(taskDir, fs.readdirSync(taskDir)[0]), 'utf8');
      assert.match(taskText, /Fix the typo in hello.sh so it prints Hello, World!/);
      assert.match(taskText, /px status --json/);
      assert.match(taskText, /workflow-owned metadata changes are expected/);
      assert.match(fs.readFileSync(path.join(fixture.repoRoot, 'AGENTS.md'), 'utf8'), /hello.sh/);
      const copiedAuth = path.join(fixture.opencodeDataHome, 'opencode', 'auth.json');
      assert.equal(fs.readFileSync(copiedAuth, 'utf8'), 'operator-credential');
      fs.writeFileSync(copiedAuth, 'fixture-credential');
      const copiedConfig = path.join(fixture.opencodeConfigHome, 'opencode', 'linked.json');
      assert.equal(fs.lstatSync(copiedConfig).isSymbolicLink(), false);
      fs.writeFileSync(copiedConfig, 'fixture-settings');
      assert.equal(fs.existsSync(path.join(fixture.opencodeDataHome, 'opencode', 'opencode.db')), false);
      fs.writeFileSync(path.join(fixture.stateHome, 'parallix.db'), 'fixture-missions');
      assert.ok(fs.existsSync(path.join(fixture.stateHome, 'agents.local.json')));
    }
    assert.equal(fs.readFileSync(auth, 'utf8'), 'operator-credential');
    assert.equal(fs.readFileSync(linkedConfig, 'utf8'), 'operator-settings');
    assert.equal(fs.readFileSync(path.join(process.env.XDG_DATA_HOME, 'opencode', 'opencode.db'), 'utf8'), 'operator-session');
    assert.equal(fs.existsSync(path.join(source, 'parallix.db')), false);
  } finally {
    if (originalConfig === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalConfig;
    if (originalData === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = originalData;
    for (const fixture of fixtures) fs.rmSync(fixture.tmpRoot, { recursive: true, force: true });
    fs.rmSync(source, { recursive: true, force: true });
  }
});
