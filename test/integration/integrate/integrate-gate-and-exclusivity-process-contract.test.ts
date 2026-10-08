// Behavior-owned suite (TASK-2622.09, integration-ci): integration-time gate scripting and cross-process
// exclusivity — verify-local integrate, workflow gate recursion, and the exclusive Mission claim across
// two processes. Legacy case names unchanged.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import child_process from 'node:child_process';
import childProcess, { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createIntegrateWorkflow } from '../../../src/application/integrate-workflow.js';
import { createIntegratePorts } from '../../../src/adapters/cli/commands/integrate.js';

// ---- verify-local integrate gate (consolidated from test/verify-local-integrate.test.ts, TASK-2622.09) ----
describe("verify-local integrate gate", () => {
  const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
  const scriptPath = path.join(repoRoot, 'scripts', 'verify-local.sh');

  function runScript(args, env = {}) {
    // These dry-run and stubbed-gate contracts keep output small. Capture it
    // directly instead of writing, reopening, reading, and deleting two files
    // for every invoked gate plan.
    const result = childProcess.spawnSync(scriptPath, args, {
      cwd: repoRoot,
      env: { ...process.env, ...env },
      encoding: 'utf8',
    });
    if (result.error && result.status === null) {
      throw result.error;
    }
    return result;
  }

  function staticAnalysisStubEnv(tmpDir, npxStatus = 0) {
    const binDir = path.join(tmpDir, 'bin');
    const nodePath = path.join(binDir, 'node');
    const eslintJsonPath = path.join(tmpDir, 'eslint.json');
    const baseline = JSON.parse(fs.readFileSync(path.join(repoRoot, 'config', 'lint-baseline.json'), 'utf8')) as Record<string, number>;
    const messages = Object.entries(baseline).flatMap(([ruleId, count]) => Array.from({ length: count }, () => ({ ruleId })));
    fs.mkdirSync(binDir);
    fs.writeFileSync(eslintJsonPath, JSON.stringify([{ messages }]));
    fs.writeFileSync(nodePath, `#!/bin/sh\nexec ${process.execPath} "$@"\n`);
    fs.writeFileSync(path.join(binDir, 'npx'), `#!/bin/sh\ncat ${eslintJsonPath}\nexit ${npxStatus}\n`);
    fs.writeFileSync(path.join(binDir, 'npm'), '#!/bin/sh\nexit 0\n');
    fs.chmodSync(nodePath, 0o755);
    fs.chmodSync(path.join(binDir, 'npx'), 0o755);
    fs.chmodSync(path.join(binDir, 'npm'), 0o755);
    return { PARALLIX_NODE: nodePath, PATH: `${binDir}:${process.env.PATH}` };
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
        INTEGRATE_DRY_RUN: 'true',
        INTEGRATION_CONFIG_PATH: path.join(tmpDir, 'missing', 'integration-pipelines.json')
      });
      const output = `${result.stdout}${result.stderr}`;

      assert.notEqual(result.status, 0, output);
      assert.match(output, /mandatory integration gate plan is unavailable/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('verify-local integrate runs static analysis before configured integration gates (task-2414)', () => {
    const source = fs.readFileSync(scriptPath, 'utf8');
    assert.match(source, /gate_static_analysis \|\| return 1[\s\S]*node --input-type=module --import tsx/);
  });

  test('verify-local integrate stops before configured gates when static analysis fails (task-2414)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-local-static-failure-'));
    const configPath = path.join(tmpDir, 'integration-pipelines.json');
    const marker = path.join(tmpDir, 'configured-gate-ran');
    try {
      fs.writeFileSync(configPath, JSON.stringify({ gates: { workflow: { command: `touch ${marker}`, order: 1 } } }));
      const result = runScript(['integrate'], {
        ...staticAnalysisStubEnv(tmpDir, 1),
        INTEGRATION_CONFIG_PATH: configPath,
        INTEGRATE_CHANGED_AREAS: 'workflow'
      });
      assert.notEqual(result.status, 0, `${result.stdout}${result.stderr}`);
      assert.equal(fs.existsSync(marker), false);
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
          workflow: { command: 'node --test --import tsx --import ./test/bootstrap-e2e-parallix-home.ts test/e2e/lifecycle/mission-lifecycle.test.ts', order: 50, run_last: true }
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
      assert.match(output, /workflow: node --test --import tsx --import \.\/test\/bootstrap-e2e-parallix-home\.ts test\/e2e\/lifecycle\/mission-lifecycle\.test\.ts/);
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
          workflow: { command: 'node --test --import tsx --import ./test/bootstrap-e2e-parallix-home.ts test/e2e/lifecycle/mission-lifecycle.test.ts', order: 50, run_last: true }
        }
      }, null, 2));

      const result = runScript(['integrate'], {
        INTEGRATE_DRY_RUN: 'true',
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
          workflow: { command: 'node --test --import tsx --import ./test/bootstrap-e2e-parallix-home.ts test/e2e/lifecycle/mission-lifecycle.test.ts', order: 50, run_last: true },
          'custom-agent-smoke': { command: 'node --import tsx --import ./test/bootstrap-e2e-parallix-home.ts test/e2e/agents/real-agent-smoke.test.ts', order: 51, run_last: true }
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
        assert.equal(output.includes('workflow: node --test --import tsx --import ./test/bootstrap-e2e-parallix-home.ts test/e2e/lifecycle/mission-lifecycle.test.ts'), expectsE2E, `${label} workflow selection`);
        assert.equal(output.includes('custom-agent-smoke: node --import tsx --import ./test/bootstrap-e2e-parallix-home.ts test/e2e/agents/real-agent-smoke.test.ts'), expectsE2E, `${label} smoke selection`);
        if (expectsE2E) {
          const suiteIndex = output.indexOf('integration-suite: npm run test:integration');
          const workflowIndex = output.indexOf('workflow: node --test --import tsx --import ./test/bootstrap-e2e-parallix-home.ts test/e2e/lifecycle/mission-lifecycle.test.ts');
          const smokeIndex = output.indexOf('custom-agent-smoke: node --import tsx --import ./test/bootstrap-e2e-parallix-home.ts test/e2e/agents/real-agent-smoke.test.ts');
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
        ...staticAnalysisStubEnv(tmpDir),
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
        ...staticAnalysisStubEnv(tmpDir),
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
        ...staticAnalysisStubEnv(tmpDir),
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
});

// ---- integrate workflow gate (consolidated from test/integrate-workflow-gate.test.ts, TASK-2622.09) ----
describe("integrate workflow gate", () => {
  const { mock } = test;

  const repoRoot = path.join(import.meta.dirname, '..', '..', '..', '..');
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
      cwd: import.meta.dirname,
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
});

// ---- exclusive integrate process claim (consolidated from test/integrate-exclusive-process.integration.test.ts, TASK-2622.09) ----
describe("exclusive integrate process claim", () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const firstRun = `
  import { createIntegrateWorkflow } from './src/application/integrate-workflow.ts';
  import { createIntegratePorts } from './src/adapters/cli/commands/integrate.ts';
  const slug = process.env.PARALLIX_CLAIM_TEST_SLUG;
  const ports = createIntegratePorts();
  const workflow = createIntegrateWorkflow({
    ...ports,
    process: { ...ports.process, terminate: () => {} },
    missionPaths: { ...ports.missionPaths, inferSlug: () => slug },
  });
  process.stdin.resume();
  await workflow.integrate([slug], {
    missionServicesFn: async () => {
      process.stdout.write('CLAIMED');
      await new Promise(resolve => process.stdin.once('end', resolve));
      throw new Error('fixture complete');
    },
    exitFn: () => {},
  });
`;

  test('two integrate processes cannot both read one Mission', async (t) => {
    const slug = `task-${Date.now()}-${process.pid}`;
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', firstRun], {
      cwd: repoRoot,
      env: { ...process.env, PARALLIX_CLAIM_TEST_SLUG: slug },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    t.after(() => { if (!child.killed) { child.kill(); } });

    await new Promise<void>((resolve, reject) => {
      let output = '';
      let errors = '';
      child.stderr.on('data', chunk => { errors += String(chunk); });
      const timeout = setTimeout(() => reject(new Error(`first integrate did not acquire its claim: stdout=${JSON.stringify(output)} stderr=${JSON.stringify(errors)}`)), 5000);
      child.stdout.on('data', chunk => {
        output += String(chunk);
        if (output.includes('CLAIMED')) { clearTimeout(timeout); resolve(); }
      });
      child.once('exit', code => { clearTimeout(timeout); reject(new Error(`first integrate exited before claim: ${code}`)); });
    });

    const ports = createIntegratePorts();
    let missionReads = 0;
    const workflow = createIntegrateWorkflow({
      ...ports,
      process: { ...ports.process, terminate: () => {} },
      missionPaths: { ...ports.missionPaths, inferSlug: () => slug },
    });
    const result = await workflow.integrate([slug], {
      missionServicesFn: async () => { missionReads++; throw new Error('must not read Mission'); },
      exitFn: () => {},
    });
    assert.deepEqual(result, { exitCode: 1 });
    assert.equal(missionReads, 0);

    child.stdin.end();
    await new Promise<void>(resolve => child.once('exit', () => resolve()));
  });
});
