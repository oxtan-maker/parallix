


import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
const repoRoot = path.resolve(import.meta.dirname, '..');
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

test('verify-local Git shim handles init flags without mistaking them for the target directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-local-git-shim-'));
  const shim = path.join(repoRoot, 'scripts', 'git');
  const env = { ...process.env, PARALLIX_REAL_GIT: '/usr/bin/git' };
  try {
    const bare = childProcess.spawnSync(shim, ['init', '-q', '-b', 'main'], { cwd: root, env, encoding: 'utf8' });
    assert.equal(bare.status, 0, bare.stderr);

    const explicit = path.join(root, 'explicit');
    const targeted = childProcess.spawnSync(shim, ['init', '-q', '-b', 'main', explicit], { env, encoding: 'utf8' });
    assert.equal(targeted.status, 0, targeted.stderr);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('verify-local integrate fails closed when integration config is missing (task-2300)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-local-missing-'));
  try {
    const result = runScript(['integrate'], {
      INTEGRATION_CONFIG_PATH: path.join(tmpDir, 'missing', 'integration-pipelines.json')
    });
    const output = `${result.stdout}${result.stderr}`;

    assert.notEqual(result.status, 0, output);
    assert.match(output, /mandatory integration gate plan is unavailable/);
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
        workflow: { command: 'node --import tsx test/e2e-mission-lifecycle.test.ts', order: 50, run_last: true }
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
    assert.match(output, /workflow: node --import tsx test\/e2e-mission-lifecycle.test.ts/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('verify-local integrate fails closed when no mandatory gate applies (task-2300)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-local-no-match-'));
  const configPath = path.join(tmpDir, 'integration-pipelines.json');
  try {
    fs.writeFileSync(configPath, JSON.stringify({
      gates: {
        lib: { command: './scripts/verify-local.sh static-analysis', order: 1, run_last: false },
        workflow: { command: 'node --import tsx test/e2e-mission-lifecycle.test.ts', order: 50, run_last: true }
      }
    }, null, 2));

    const result = runScript(['integrate'], {
      INTEGRATION_CONFIG_PATH: configPath,
      INTEGRATE_CHANGED_AREAS: 'docs'
    });
    const output = `${result.stdout}${result.stderr}`;

    assert.notEqual(result.status, 0, output);
    assert.match(output, /mandatory integration suite is unavailable/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('verify-local integrate resolves the unconditional integration suite for every required area class (task-2292)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-local-always-gate-'));
  const configPath = path.join(tmpDir, 'integration-pipelines.json');
  try {
    fs.writeFileSync(configPath, JSON.stringify({
      gates: {
        'integration-suite': { command: 'npm run test:integration', order: 3, run_last: false, always: true },
        workflow: { command: 'node --import tsx test/e2e-mission-lifecycle.test.ts', order: 50, run_last: true },
        'custom-agent-smoke': { command: 'node --import tsx test/e2e-real-agent-smoke.test.ts', order: 51, run_last: true }
      }
    }, null, 2));

    for (const [label, changedAreas, expectsE2E] of [
      ['lib', 'lib', true],
      ['workflow', 'workflow', true],
      ['docs', 'docs', false],
      ['backlog-only', 'backlog', false],
      ['mission-artifact-only', 'missions', false],
      ['unknown-path', 'unrecognized-boundary', false],
      ['no-area', '', false]
    ]) {
      const result = runScript(['integrate'], {
        INTEGRATE_DRY_RUN: 'true',
        INTEGRATION_CONFIG_PATH: configPath,
        INTEGRATE_CHANGED_AREAS: changedAreas
      });
      const output = `${result.stdout}${result.stderr}`;
      assert.equal(result.status, 0, `${label}: ${output}`);
      assert.match(output, /integration-suite: npm run test:integration/, `${label} must include the suite gate`);
      assert.equal(output.includes('workflow: node --import tsx test/e2e-mission-lifecycle.test.ts'), expectsE2E, `${label} workflow selection`);
      assert.equal(output.includes('custom-agent-smoke: node --import tsx test/e2e-real-agent-smoke.test.ts'), expectsE2E, `${label} smoke selection`);
      if (expectsE2E) {
        const suiteIndex = output.indexOf('integration-suite: npm run test:integration');
        const workflowIndex = output.indexOf('workflow: node --import tsx test/e2e-mission-lifecycle.test.ts');
        const smokeIndex = output.indexOf('custom-agent-smoke: node --import tsx test/e2e-real-agent-smoke.test.ts');
        assert.ok(suiteIndex < workflowIndex, `${label} suite must run before workflow E2E`);
        assert.ok(workflowIndex < smokeIndex, `${label} workflow E2E must run before smoke`);
      }
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('verify-local integrate aborts after an integration-suite failure before a later command (task-2292)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-local-suite-failure-'));
  const configPath = path.join(tmpDir, 'integration-pipelines.json');
  const laterCommandMarker = path.join(tmpDir, 'later-command-ran');
  try {
    fs.writeFileSync(configPath, JSON.stringify({
      gates: {
        'integration-suite': { command: 'exit 23', order: 3, run_last: false, always: true },
        'simulated-squash-merge': { command: `touch ${laterCommandMarker}`, order: 4, run_last: false, always: true }
      }
    }, null, 2));
    const result = runScript(['integrate'], {
      INTEGRATION_CONFIG_PATH: configPath,
      INTEGRATE_CHANGED_AREAS: 'docs'
    });
    const output = `${result.stdout}${result.stderr}`;
    assert.notEqual(result.status, 0, output);
    assert.match(output, /=== FAIL: integration:integration-suite ===/);
    assert.equal(fs.existsSync(laterCommandMarker), false, 'later command must not run after suite failure');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('verify-local integrate forwards the Codex override only to custom-agent-smoke', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-local-real-agent-'));
  const configPath = path.join(tmpDir, 'integration-pipelines.json');
  const libOutput = path.join(tmpDir, 'lib-env.txt');
  const smokeOutput = path.join(tmpDir, 'smoke-env.txt');
  try {
    fs.writeFileSync(configPath, JSON.stringify({
      gates: {
        lib: { command: `printf '%s:%s' "${'${PARALLIX_REAL_AGENT-}"'} "${'${PARALLIX_REAL_AGENT_MODEL-}"'} > ${libOutput}`, order: 1 },
        'custom-agent-smoke': { command: `printf '%s:%s' "${'${PARALLIX_REAL_AGENT-}"'} "${'${PARALLIX_REAL_AGENT_MODEL-}"'} > ${smokeOutput}`, order: 2, run_last: true }
      }
    }));
    const result = runScript(['integrate', '--real-agent', 'codex', '--real-agent-model', 'gpt-5.6-luna'], {
      INTEGRATION_CONFIG_PATH: configPath,
      INTEGRATE_CHANGED_AREAS: 'lib workflow'
    });
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.equal(fs.readFileSync(libOutput, 'utf8'), ':');
    assert.equal(fs.readFileSync(smokeOutput, 'utf8'), 'codex:gpt-5.6-luna');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('verify-local integrate rejects incomplete or unsupported real-agent overrides', () => {
  for (const args of [
    ['integrate', '--real-agent', 'codex'],
    ['integrate', '--real-agent', 'claude', '--real-agent-model', 'gpt-5.6-luna'],
    ['integrate', '--real-agent', 'codex', '--real-agent-model', 'not-gpt'],
    ['integrate', '--real-agent-model']
  ]) {
    const result = runScript(args, { INTEGRATE_CHANGED_AREAS: 'workflow' });
    assert.notEqual(result.status, 0);
  }
});

test('verify-local integrate does not source login-shell startup files for gates', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-local-non-login-'));
  const configPath = path.join(tmpDir, 'integration-pipelines.json');
  const outputPath = path.join(tmpDir, 'gate-output.txt');
  const bashEnvPath = path.join(tmpDir, 'bash-env');
  try {
    fs.writeFileSync(path.join(tmpDir, '.bash_profile'), `echo sourced > ${outputPath}`);
    fs.writeFileSync(bashEnvPath, `echo sourced > ${outputPath}`);
    fs.writeFileSync(configPath, JSON.stringify({
      gates: { workflow: { command: `test ! -f ${outputPath}`, order: 1 } }
    }));
    const result = runScript(['integrate'], {
      HOME: tmpDir,
      BASH_ENV: bashEnvPath,
      INTEGRATION_CONFIG_PATH: configPath,
      INTEGRATE_CHANGED_AREAS: 'workflow'
    });
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.equal(fs.existsSync(outputPath), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
