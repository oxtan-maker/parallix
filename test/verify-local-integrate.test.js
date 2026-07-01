const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const scriptPath = path.join(repoRoot, 'scripts', 'verify-local.sh');

function runScript(args, env = {}) {
  const stdoutPath = path.join(os.tmpdir(), `verify-local-stdout-${process.pid}-${Date.now()}.log`);
  const stderrPath = path.join(os.tmpdir(), `verify-local-stderr-${process.pid}-${Date.now()}.log`);
  const stdoutFd = fs.openSync(stdoutPath, 'w');
  const stderrFd = fs.openSync(stderrPath, 'w');
  let result;
  try {
    result = childProcess.spawnSync(scriptPath, args, {
      cwd: repoRoot,
      env: { ...process.env, ...env },
      encoding: 'utf8',
      stdio: ['ignore', stdoutFd, stderrFd]
    });
  } finally {
    fs.closeSync(stdoutFd);
    fs.closeSync(stderrFd);
  }
  result.stdout = fs.existsSync(stdoutPath) ? fs.readFileSync(stdoutPath, 'utf8') : '';
  result.stderr = fs.existsSync(stderrPath) ? fs.readFileSync(stderrPath, 'utf8') : '';
  fs.rmSync(stdoutPath, { force: true });
  fs.rmSync(stderrPath, { force: true });
  if (result.error && result.status === null) {
    throw result.error;
  }
  return result;
}

test('verify-local integrate skips cleanly when integration config is missing', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-local-missing-'));
  try {
    const result = runScript(['integrate'], {
      INTEGRATION_CONFIG_PATH: path.join(tmpDir, 'missing', 'integration-pipelines.json')
    });
    const output = `${result.stdout}${result.stderr}`;

    assert.equal(result.status, 0, output);
    assert.match(output, /integration-gates: no config present, skipping/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('verify-local integrate prints the resolved dry-run plan for workflow gates', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-local-dry-run-'));
  const configPath = path.join(tmpDir, 'integration-pipelines.json');
  try {
    fs.writeFileSync(configPath, JSON.stringify({
      gates: {
        lib: { command: './scripts/verify-local.sh static-analysis', order: 1, run_last: false },
        workflow: { command: 'node test/e2e-mission-lifecycle.test.js', order: 50, run_last: true }
      }
    }, null, 2));

    const result = runScript(['integrate'], {
      INTEGRATE_DRY_RUN: 'true',
      INTEGRATION_CONFIG_PATH: configPath,
      INTEGRATE_CHANGED_AREAS: 'lib workflow'
    });
    const output = `${result.stdout}${result.stderr}`;

    assert.equal(result.status, 0, output);
    assert.match(output, /integration-gates: resolved gate plan:/);
    assert.match(output, /lib: \.\/scripts\/verify-local\.sh static-analysis/);
    assert.match(output, /workflow: node test\/e2e-mission-lifecycle\.test\.js/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('verify-local integrate reports no applicable gates when changed areas do not match', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-local-no-match-'));
  const configPath = path.join(tmpDir, 'integration-pipelines.json');
  try {
    fs.writeFileSync(configPath, JSON.stringify({
      gates: {
        lib: { command: './scripts/verify-local.sh static-analysis', order: 1, run_last: false },
        workflow: { command: 'node test/e2e-mission-lifecycle.test.js', order: 50, run_last: true }
      }
    }, null, 2));

    const result = runScript(['integrate'], {
      INTEGRATION_CONFIG_PATH: configPath,
      INTEGRATE_CHANGED_AREAS: 'docs'
    });
    const output = `${result.stdout}${result.stderr}`;

    assert.equal(result.status, 0, output);
    assert.match(output, /integration-gates: no applicable gates for changed areas/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
