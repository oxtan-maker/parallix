const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SCRIPT_DIR = path.join(__dirname, '..', '..', 'scripts');
const INSTALLER = path.join(SCRIPT_DIR, 'install-workflow.sh');

// task-1302 (standalone extraction): install-workflow.sh is a WrGroceries monorepo
// script that lives outside the parallix tree and is NOT carried into the standalone
// repo (scope item 9 — the script stays in WrGroceries and is repointed to the
// global `px` runner). When it is absent we skip these host-coupled tests instead of
// failing; in the monorepo (where the script exists) they still run unchanged.
const INSTALLER_PRESENT = fs.existsSync(INSTALLER);
const hostTest = (name, fn) => test(name, {
  skip: INSTALLER_PRESENT ? false : 'requires monorepo scripts/install-workflow.sh (absent in standalone parallix — task-1302)'
}, fn);

function runInstaller(args, options = {}) {
  return spawnSync('bash', [INSTALLER, ...args], {
    timeout: 30000,
    env: { ...process.env },
    ...options,
  });
}

function cleanup(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

hostTest('installer exits 0 on fresh install', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'install-wf-'));
  try {
    const result = runInstaller([tmpDir, 'wf']);
    assert.equal(result.status, 0, `installer exited ${result.status}: ${result.stderr.toString()}`);
    assert.ok(fs.existsSync(path.join(tmpDir, 'parallix', 'index.js')), 'parallix/index.js copied');
    assert.ok(fs.existsSync(path.join(tmpDir, 'parallix', 'lib')), 'parallix/lib/ copied');
    assert.ok(fs.existsSync(path.join(tmpDir, 'wf')), 'executable shim created');
    assert.ok(fs.statSync(path.join(tmpDir, 'wf')).isFile(), 'shim is a file');
  } finally {
    cleanup(tmpDir);
  }
});

hostTest('installer with command-name parallix puts shim inside the parallix dir', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'install-wf-'));
  try {
    const result = runInstaller([tmpDir, 'parallix']);
    assert.equal(result.status, 0, `installer exited ${result.status}: ${result.stderr.toString()}`);
    assert.ok(fs.existsSync(path.join(tmpDir, 'parallix', 'index.js')), 'parallix/index.js copied');
    assert.ok(fs.existsSync(path.join(tmpDir, 'parallix', 'parallix')), 'executable shim created inside parallix dir');
    assert.ok(fs.statSync(path.join(tmpDir, 'parallix', 'parallix')).isFile(), 'shim is a file');

    // Verify it can actually run
    const wfResult = spawnSync(path.join(tmpDir, 'parallix', 'parallix'), [], {
      timeout: 10000,
      env: { ...process.env },
    });
    assert.equal(wfResult.status, 0, 'shim inside parallix dir runs successfully');
  } finally {
    cleanup(tmpDir);
  }
});

hostTest('installer copies agents.local.json.example but not agents.local.json', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'install-wf-'));
  try {
    const result = runInstaller([tmpDir, 'wf']);
    assert.equal(result.status, 0);
    assert.ok(fs.existsSync(path.join(tmpDir, 'parallix', 'config', 'agents.local.json.example')), 'agents.local.json.example included');
    assert.ok(!fs.existsSync(path.join(tmpDir, 'parallix', 'config', 'agents.local.json')), 'agents.local.json excluded');
  } finally {
    cleanup(tmpDir);
  }
});

hostTest('installer refuses to overwrite without --force', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'install-wf-'));
  try {
    // First install
    let result = runInstaller([tmpDir, 'wf']);
    assert.equal(result.status, 0);

    // Second install without --force should fail
    result = runInstaller([tmpDir, 'wf']);
    assert.equal(result.status, 1, 'installer should refuse to overwrite');
    assert.ok(result.stderr.toString().includes('already exists'), 'error message mentions already exists');
  } finally {
    cleanup(tmpDir);
  }
});

hostTest('installer overwrites with --force', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'install-wf-'));
  try {
    // First install
    let result = runInstaller([tmpDir, 'wf']);
    assert.equal(result.status, 0);

    // Second install with --force should succeed
    result = runInstaller(['--force', tmpDir, 'wf']);
    assert.equal(result.status, 0, `installer with --force exited ${result.status}: ${result.stderr.toString()}`);
    assert.ok(fs.existsSync(path.join(tmpDir, 'parallix', 'index.js')), 'parallix/index.js exists after force install');
  } finally {
    cleanup(tmpDir);
  }
});

hostTest('installer dry-run prints copy plan without creating files', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'install-wf-'));
  try {
    const result = runInstaller(['--dry-run', tmpDir, 'wf']);
    assert.equal(result.status, 0, `dry-run exited ${result.status}: ${result.stderr.toString()}`);
    const output = result.stdout.toString();
    assert.ok(output.includes('Would install workflow runtime'), 'dry-run mentions target');
    assert.ok(output.includes('Would copy'), 'dry-run lists files');
    // Files should not actually be created
    assert.ok(!fs.existsSync(path.join(tmpDir, 'parallix')), 'no parallix/ dir created in dry-run');
  } finally {
    cleanup(tmpDir);
  }
});

hostTest('installed workflow prints usage via node', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'install-wf-'));
  try {
    const result = runInstaller([tmpDir, 'wf']);
    assert.equal(result.status, 0);

    // Use node to invoke the installed workflow
    const wfResult = spawnSync('node', [path.join(tmpDir, 'parallix', 'index.js')], {
      timeout: 10000,
      env: { ...process.env },
    });

    assert.equal(wfResult.status, 0, `installed workflow exited ${wfResult.status}: ${wfResult.stderr.toString()}`);
    const output = wfResult.stdout.toString();
    assert.ok(output.includes('Usage: px'), 'usage mentions px');
    assert.ok(output.includes('mission-start'), 'usage lists core commands');
  } finally {
    cleanup(tmpDir);
  }
});

hostTest('installed shim prints usage via direct execution', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'install-wf-'));
  try {
    const result = runInstaller([tmpDir, 'wf']);
    assert.equal(result.status, 0);

    // Use the shim directly
    const shimPath = path.join(tmpDir, 'wf');
    const shimResult = spawnSync(shimPath, [], {
      timeout: 10000,
      env: { ...process.env },
    });

    assert.equal(shimResult.status, 0, `shim exited ${shimResult.status}: ${shimResult.stderr.toString()}`);
    const output = shimResult.stdout.toString();
    assert.ok(output.includes('Usage: px'), 'shim usage mentions px');
  } finally {
    cleanup(tmpDir);
  }
});

hostTest('installed workflow supports subcommands', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'install-wf-'));
  try {
    const result = runInstaller([tmpDir, 'wf']);
    assert.equal(result.status, 0);

    // Test the verify-env subcommand (no slug = diagnostic mode)
    const wfResult = spawnSync('node', [path.join(tmpDir, 'parallix', 'index.js'), 'verify-env'], {
      timeout: 10000,
      env: { ...process.env },
    });

    // verify-env runs preflight checks; exit code depends on environment
    const output = wfResult.stdout.toString();
    assert.ok(output.includes('[PASS]') || output.includes('[INFO]'), 'verify-env produces output');
  } finally {
    cleanup(tmpDir);
  }
});

hostTest('installer creates executable shim', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'install-wf-'));
  try {
    const result = runInstaller([tmpDir, 'mywf']);
    assert.equal(result.status, 0);

    const shimPath = path.join(tmpDir, 'mywf');
    const stats = fs.statSync(shimPath);
    assert.ok(stats.isFile(), 'shim is a file');
    assert.ok(stats.mode & 0o111, 'shim is executable');
  } finally {
    cleanup(tmpDir);
  }
});

hostTest('installer with default target creates installed-workflow directory', () => {
  const cwd = process.cwd();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'install-wf-'));
  try {
    const result = runInstaller([], { cwd: tmpDir });
    assert.equal(result.status, 0, `installer exited ${result.status}: ${result.stderr.toString()}`);
    assert.ok(fs.existsSync(path.join(tmpDir, 'installed-workflow', 'parallix', 'index.js')), 'parallix/index.js in default target');
  } finally {
    cleanup(tmpDir);
  }
});

hostTest('installer refuses to overwrite existing shim without --force', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'install-wf-'));
  try {
    // First install with a custom shim name
    let result = runInstaller([tmpDir, 'mywf']);
    assert.equal(result.status, 0, `first install exited ${result.status}: ${result.stderr.toString()}`);
    assert.ok(fs.existsSync(path.join(tmpDir, 'mywf')), 'shim created');

    // Second install with the same shim name without --force should fail
    result = runInstaller([tmpDir, 'mywf']);
    assert.equal(result.status, 1, 'installer should refuse to overwrite existing shim');
    assert.ok(result.stderr.toString().includes('already exists'), 'error message mentions already exists');

    // With --force it should succeed
    result = runInstaller(['--force', tmpDir, 'mywf']);
    assert.equal(result.status, 0, `force install exited ${result.status}: ${result.stderr.toString()}`);
  } finally {
    cleanup(tmpDir);
  }
});

hostTest('installer fallback copy (no rsync) produces correct directory structure', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'install-wf-'));
  
  try {
    const result = runInstaller([tmpDir, 'wf'], {
      env: { ...process.env, FORCE_NO_RSYNC: '1' }
    });
    assert.equal(result.status, 0, `installer exited ${result.status}: ${result.stderr.toString()}`);

    // Verify lib modules are at the correct depth (not nested under lib/lib/)
    assert.ok(fs.existsSync(path.join(tmpDir, 'parallix', 'lib', 'commands', 'active.js')), 'parallix/lib/commands/active.js exists');
    assert.ok(fs.existsSync(path.join(tmpDir, 'parallix', 'lib', 'agents', 'agents.js')), 'parallix/lib/agents/agents.js exists');

    // Verify no duplicated nesting
    assert.ok(!fs.existsSync(path.join(tmpDir, 'parallix', 'lib', 'lib')), 'no parallix/lib/lib/ nesting');

    // Verify the installed runtime can load modules and run a subcommand
    const wfResult = spawnSync('node', [path.join(tmpDir, 'parallix', 'index.js'), 'verify-env'], {
      timeout: 10000,
      env: { ...process.env },
    });
    const output = wfResult.stdout.toString();
    assert.ok(output.includes('[PASS]') || output.includes('[INFO]'), 'installed runtime runs subcommand');
  } finally {
    cleanup(tmpDir);
  }
});
