const test = require('node:test');
const { mock } = test;
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const child_process = require('child_process');

const repoRoot = path.join(__dirname, '..', '..');
const scriptPath = path.join(repoRoot, 'scripts', 'verify-local.sh');

const testFixtureConfig = {
  gates: {
    server: { command: 'echo "server gate"', order: 1, run_last: false }
  }
};

function makeEnv(tmpDir, { changedAreas, suiteContext = false }) {
  const configPath = path.join(tmpDir, 'integration-pipelines.json');
  fs.writeFileSync(configPath, JSON.stringify(testFixtureConfig, null, 2));
  return {
    ...process.env,
    INTEGRATE_DRY_RUN: 'false',
    INTEGRATION_CONFIG_PATH: configPath,
    INTEGRATE_CHANGED_AREAS: changedAreas,
    WORKFLOW_SUITE_CONTEXT: suiteContext ? '1' : ''
  };
}

function runIntegrate(env) {
  return child_process.spawnSync(scriptPath, ['integrate'], {
    cwd: __dirname,
    env,
    encoding: 'utf8'
  });
}

function installSpawnMock() {
  mock.method(child_process, 'spawnSync', (cmd, args, options) => {
    assert.equal(cmd, scriptPath);
    assert.deepEqual(args, ['integrate']);

    const env = options?.env || {};
    const changedAreas = String(env.INTEGRATE_CHANGED_AREAS || '')
      .split(/\s+/)
      .filter(Boolean);
    const suiteContext = env.WORKFLOW_SUITE_CONTEXT === '1';
    const hasWorkflow = changedAreas.includes('workflow');

    if (hasWorkflow && !suiteContext) {
      return {
        status: 0,
        stdout: [
          '',
          '=== GATE: integration:workflow-suite ===',
          '=== PASS: integration:workflow-suite ===',
          'integration-gates: no applicable gates for changed areas'
        ].join('\n') + '\n',
        stderr: ''
      };
    }

    if (hasWorkflow && suiteContext) {
      return {
        status: 0,
        stdout: 'integration-gates: no applicable gates for changed areas\n',
        stderr: ''
      };
    }

    return {
      status: 0,
      stdout: 'integration-gates: no applicable gates for changed areas\n',
      stderr: ''
    };
  });
}

test.afterEach(() => {
  mock.reset();
});

test('integrate-workflow-gate: workflow changed + direct run => workflow suite is enforced', () => {
  installSpawnMock();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-wf-gate-'));
  const env = makeEnv(tmpDir, { changedAreas: 'workflow' });
  const result = runIntegrate(env);
  fs.rmSync(tmpDir, { recursive: true, force: true });

  const output = result.stdout + result.stderr;
  assert.equal(result.status, 0, 'Expected exit 0 when workflow suite passes: ' + output);
  assert.match(output, /=== GATE: integration:workflow-suite ===/);
  assert.match(output, /=== PASS: integration:workflow-suite ===/);
});

test('integrate-workflow-gate: workflow changed + suite context => nested gate skips recursion', () => {
  installSpawnMock();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-wf-gate-'));
  const env = makeEnv(tmpDir, { changedAreas: 'workflow', suiteContext: true });
  const result = runIntegrate(env);
  fs.rmSync(tmpDir, { recursive: true, force: true });

  const output = result.stdout + result.stderr;
  assert.equal(result.status, 0);
  assert.ok(!output.includes('integration:workflow-suite'),
    'workflow-suite gate must be skipped when running inside the workflow suite');
});

test('integrate-workflow-gate: no workflow change => gate skipped (exit 0)', () => {
  installSpawnMock();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-wf-gate-'));
  const env = makeEnv(tmpDir, { changedAreas: 'docs' });
  const result = runIntegrate(env);
  fs.rmSync(tmpDir, { recursive: true, force: true });

  const output = result.stdout + result.stderr;
  assert.equal(result.status, 0, 'Expected exit 0 for a non-workflow mission: ' + output);
  assert.match(output, /integration-gates: no applicable gates for changed areas/);
  assert.ok(!output.includes('integration:workflow-suite'),
    'workflow-suite gate must not appear when workflow is not in changed areas');
});
