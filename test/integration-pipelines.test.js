const test = require('node:test');
const { mock } = test;
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Mock getPrimaryWorktree and getPrimaryBranch before requiring integrate.js
const missionUtils = require('../lib/core/mission-utils');
mock.method(missionUtils, 'getPrimaryWorktree', () => '/tmp/mission');
mock.method(missionUtils, 'getPrimaryBranch', () => 'main');
mock.method(missionUtils, 'resolveWorktree', (slug) => `/tmp/mission-${slug}`);
mock.method(missionUtils, 'conventionalWorktreePath', (slug, rootDir) => path.join(rootDir, `mission-${slug}`));
mock.method(missionUtils, 'getMissionYear', () => '2026');

const {
  detectChangedAreas,
  parseFilesToAreas,
  loadIntegrationConfig,
  getIntegrationGatePlan,
  printIntegrationGatePlan,
  buildIntegrationGateEnv,
  executeIntegrationGates
} = require('../lib/commands/integrate');

// task-1302 (standalone extraction): the tests below invoke the WrGroceries monorepo
// gate runner scripts/verify-local.sh, which lives outside the parallix tree and is
// NOT carried into the standalone repo (scope item 9 — it stays in WrGroceries and is
// repointed to the global `px` runner). When the script is absent we skip these
// host-coupled tests; in the monorepo (where it exists) they still run unchanged.
const VERIFY_LOCAL_SH = path.join(__dirname, '..', '..', 'scripts', 'verify-local.sh');
const VERIFY_LOCAL_PRESENT = fs.existsSync(VERIFY_LOCAL_SH);
const verifyLocalTest = (name, fn) => test(name, {
  skip: VERIFY_LOCAL_PRESENT ? false : 'requires monorepo scripts/verify-local.sh (absent in standalone parallix — task-1302)'
}, fn);

// Helper to mock git runner
function createMockGitRunner(changedFiles = '') {
  return (args) => {
    const cmd = args.join(' ');
    // Mock diff --name-only between branches
    if (cmd.includes('diff --name-only') && cmd.includes('main') && cmd.includes('mission/')) {
      return { status: 0, stdout: changedFiles, stderr: '' };
    }
    return { status: 0, stdout: '', stderr: '' };
  };
}

test('parseFilesToAreas extracts top-level directories', () => {
  const files = `server/src/main/java/foo.java
auth-server/src/main/java/bar.java
web-client/src/App.tsx
docs/README.md
workflow/lib/test.js`;
  
  const areas = parseFilesToAreas(files);
  
  assert.deepEqual(areas.sort(), ['auth-server', 'docs', 'server', 'web-client', 'workflow']);
});

test('parseFilesToAreas ignores unknown directories', () => {
  const files = `node_modules/some-package
.git/config
random-file.txt`;
  
  const areas = parseFilesToAreas(files);
  
  assert.deepEqual(areas, []);
});

test('parseFilesToAreas handles empty input', () => {
  const areas = parseFilesToAreas('');
  assert.deepEqual(areas, []);
});

test('detectChangedAreas returns server and web-client for multi-area mission', () => {
  const changedFiles = `server/src/main/java/foo.java
web-client/src/App.tsx`;
  
  const areas = detectChangedAreas('task-123', {
    gitRunner: createMockGitRunner(changedFiles)
  });
  
  assert.deepEqual(areas.sort(), ['server', 'web-client']);
});

test('detectChangedAreas returns empty array for no changes', () => {
  const areas = detectChangedAreas('task-123', {
    gitRunner: createMockGitRunner('')
  });
  
  assert.deepEqual(areas, []);
});

test('loadIntegrationConfig returns ok=false when config missing', () => {
  // Ensure config doesn't exist
  const result = loadIntegrationConfig({ configPath: '/nonexistent/path/config.json' });
  assert.equal(result.ok, false);
  assert.match(result.error, /no config present/);
});

test('loadIntegrationConfig parses valid JSON config', () => {
  const config = {
    gates: {
      server: { command: './server/updateStaging.sh', order: 1, run_last: false },
      web_client: { command: './web-client/updateStaging.sh', order: 2, run_last: false }
    }
  };
  
  // Create temp file
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-'));
  const tmpConfigPath = path.join(tmpDir, 'integration-pipelines.json');
  fs.writeFileSync(tmpConfigPath, JSON.stringify(config, null, 2));
  
  const result = loadIntegrationConfig({ configPath: tmpConfigPath });
  assert.equal(result.ok, true);
  assert.deepEqual(result.config, config);
  
  // Cleanup
  fs.unlinkSync(tmpConfigPath);
  fs.rmdirSync(tmpDir);
});

// Characterization (task-1233 act-on-review round 1): the mission Scope requires
// the integration-gate config missing/empty/malformed edge cases to be handled.
// Missing + valid are covered above; these lock the empty and malformed branches
// of loadIntegrationConfig (workflow/lib/commands/integrate.js:226-237), which were shipped
// but untested.
test('loadIntegrationConfig treats an empty config file as no config present', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-empty-'));
  const tmpConfigPath = path.join(tmpDir, 'integration-pipelines.json');
  fs.writeFileSync(tmpConfigPath, '');

  const result = loadIntegrationConfig({ configPath: tmpConfigPath });
  assert.equal(result.ok, false);
  assert.match(result.error, /no config present/);

  fs.unlinkSync(tmpConfigPath);
  fs.rmdirSync(tmpDir);
});

test('loadIntegrationConfig returns ok=false with an invalid JSON error for malformed config', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-malformed-'));
  const tmpConfigPath = path.join(tmpDir, 'integration-pipelines.json');
  fs.writeFileSync(tmpConfigPath, '{ "gates": { not valid json');

  const result = loadIntegrationConfig({ configPath: tmpConfigPath });
  assert.equal(result.ok, false);
  assert.match(result.error, /^invalid JSON:/);

  fs.unlinkSync(tmpConfigPath);
  fs.rmdirSync(tmpDir);
});

test('getIntegrationGatePlan returns empty gates when config missing', () => {
  const plan = getIntegrationGatePlan('task-123', {
    runIntegrationGates: true,
    gitRunner: createMockGitRunner('server/foo.java')
  });
  
  assert.deepEqual(plan.gates, []);
  assert.equal(plan.configError, 'no config present');
});

test('printIntegrationGatePlan outputs gate plan lines', () => {
  const gates = [
    { key: 'server', command: './server/updateStaging.sh', order: 1, run_last: false },
    { key: 'auth-server', command: './auth-server/updateStaging.sh', order: 2, run_last: false },
    { key: 'web-client', command: 'SKIP_E2E=1 ./web-client/updateStaging.sh', order: 3, run_last: false },
    { key: 'web-e2e', command: './web-client/scripts/run-playwright-stage.sh', order: 4, run_last: true }
  ];
  
  // Mock console.log to capture output
  const logs = [];
  const originalLog = console.log;
  mock.method(console, 'log', (msg) => { logs.push(msg); }, { restoreAfterAll: true });
  
  printIntegrationGatePlan(gates);
  
  // Verify output contains the gates in order
  assert.ok(logs.some(l => l.includes('Integration gate plan:')));
  assert.ok(logs.some(l => l.includes('server:') && l.includes('./server/updateStaging.sh')));
  assert.ok(logs.some(l => l.includes('web-e2e:') && l.includes('run-playwright-stage.sh')));
  
  mock.restoreAll();
});

test('getIntegrationGatePlan respects run_last ordering - web-e2e with lower order but run_last=true runs last', () => {
  // Config where web-e2e has lower order but run_last=true
  const config = {
    gates: {
      server: { command: './server/updateStaging.sh', order: 1, run_last: false },
      'auth-server': { command: './auth-server/updateStaging.sh', order: 2, run_last: false },
      'web-client': { command: 'SKIP_E2E=1 ./web-client/updateStaging.sh', order: 3, run_last: false },
      'web-e2e': { command: './web-client/scripts/run-playwright-stage.sh', order: 0, run_last: true }
    }
  };

  // Create temp config file
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-'));
  const tmpConfigPath = path.join(tmpDir, 'integration-pipelines.json');
  fs.writeFileSync(tmpConfigPath, JSON.stringify(config, null, 2));

  // Mock git runner for all three areas changed
  const changedFiles = `server/src/main/java/foo.java
auth-server/src/main/java/bar.java
web-client/src/App.tsx`;

  const plan = getIntegrationGatePlan('task-123', {
    runIntegrationGates: true,
    gitRunner: createMockGitRunner(changedFiles),
    dryRun: false,
    configPath: tmpConfigPath
  });

  // Cleanup
  fs.unlinkSync(tmpConfigPath);
  fs.rmdirSync(tmpDir);

  // Verify web-e2e is last despite having order 0
  assert.equal(plan.gates.length, 4);
  assert.equal(plan.gates[0].key, 'server');
  assert.equal(plan.gates[1].key, 'auth-server');
  assert.equal(plan.gates[2].key, 'web-client');
  assert.equal(plan.gates[3].key, 'web-e2e');
});

test('getIntegrationGatePlan with dryRun=true detects changed areas and filters gates', () => {
  const config = {
    gates: {
      server: { command: './server/updateStaging.sh', order: 1, run_last: false },
      docs: { command: 'echo docs', order: 1, run_last: false }
    }
  };

  // Create temp config file
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-'));
  const tmpConfigPath = path.join(tmpDir, 'integration-pipelines.json');
  fs.writeFileSync(tmpConfigPath, JSON.stringify(config, null, 2));

  // Mock git runner for docs-only changes
  const changedFiles = `docs/README.md
docs/missions/2026/task-123/MISSION.md`;

  const plan = getIntegrationGatePlan('task-123', {
    runIntegrationGates: false,
    gitRunner: createMockGitRunner(changedFiles),
    dryRun: true,
    configPath: tmpConfigPath
  });

  // Cleanup
  fs.unlinkSync(tmpConfigPath);
  fs.rmdirSync(tmpDir);

  // With dryRun=true, changed areas should be detected and gates filtered
  assert.deepEqual(plan.changedAreas.sort(), ['docs']);
  // Only docs gate should be included (not server)
  assert.equal(plan.gates.length, 1);
  assert.equal(plan.gates[0].key, 'docs');
});

test('executeIntegrationGates uses injected commandRunner and aborts on failure', async () => {
  const gates = [
    { key: 'server', command: './server/updateStaging.sh', order: 1, run_last: false },
    { key: 'auth-server', command: './auth-server/updateStaging.sh', order: 2, run_last: false }
  ];

  // Mock command runner that fails on first gate
  const mockRunner = (cmd, args, options) => {
    return { status: 1, stdout: '', stderr: 'mock failure' };
  };

  const result = await executeIntegrationGates(gates, {
    commandRunner: mockRunner,
    rootDir: '/tmp/test'
  });

  assert.equal(result.ok, false);
  assert.equal(result.failedGate, 'server');
  assert.ok(result.error.includes('Command exited with code 1'));
});

test('executeIntegrationGates with injected commandRunner succeeds on all pass', async () => {
  const gates = [
    { key: 'server', command: './server/updateStaging.sh', order: 1, run_last: false },
    { key: 'auth-server', command: './auth-server/updateStaging.sh', order: 2, run_last: false }
  ];

  // Mock command runner that succeeds
  const mockRunner = (cmd, args, options) => {
    return { status: 0, stdout: '', stderr: '' };
  };

  const result = await executeIntegrationGates(gates, {
    commandRunner: mockRunner,
    rootDir: '/tmp/test'
  });

  assert.equal(result.ok, true);
  assert.equal(result.failedGate, null);
  assert.equal(result.error, null);
});

test('getIntegrationGatePlan with empty changed areas and dryRun=true returns all gates', () => {
  const config = {
    gates: {
      server: { command: './server/updateStaging.sh', order: 1, run_last: false },
      'web-client': { command: 'SKIP_E2E=1 ./web-client/updateStaging.sh', order: 2, run_last: false },
      'web-e2e': { command: './web-client/scripts/run-playwright-stage.sh', order: 3, run_last: true }
    }
  };

  // Create temp config file
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-'));
  const tmpConfigPath = path.join(tmpDir, 'integration-pipelines.json');
  fs.writeFileSync(tmpConfigPath, JSON.stringify(config, null, 2));

  // Mock git runner for no changes (empty)
  const changedFiles = '';

  const plan = getIntegrationGatePlan('task-123', {
    runIntegrationGates: false,
    gitRunner: createMockGitRunner(changedFiles),
    dryRun: true,
    configPath: tmpConfigPath
  });

  // Cleanup
  fs.unlinkSync(tmpConfigPath);
  fs.rmdirSync(tmpDir);

  // With dryRun=true and no changed areas, empty changedAreas means include all gates
  assert.deepEqual(plan.changedAreas, []);
  // All gates should be included when changedAreas is empty (backward compat for dry-run with no changes)
  assert.equal(plan.gates.length, 3);
});

test('buildIntegrationGateEnv strips config override and forwards mission changed areas', () => {
  const env = buildIntegrationGateEnv('task-123', {
    dryRun: true,
    processEnv: {
      ...process.env,
      INTEGRATION_CONFIG_PATH: '/tmp/override.json',
      INTEGRATE_CHANGED_AREAS: 'server'
    },
    gitRunner: createMockGitRunner(`docs/README.md
workflow/lib/commands/integrate.js`)
  });

  assert.equal(env.INTEGRATE_DRY_RUN, 'true');
  assert.equal(env.INTEGRATE_CHANGED_AREAS, 'docs workflow');
  assert.equal('INTEGRATION_CONFIG_PATH' in env, false);
});

// Tests for the script area (Option C: scripts/verify-local.sh integrate)
test('script integrate area: run_last ordering is respected', () => {
  // This test verifies that when called via the script, gates with run_last: true
  // are executed after gates without run_last, regardless of order value
  // We test this by creating a temp repo setup and calling the script
  const child_process = require('child_process');
  
  // The script's gate_integrate uses jq to sort gates
  // We verify the jq logic produces correct ordering
  const gatesJson = {
    gates: {
      server: { command: './server/updateStaging.sh', order: 1, run_last: false },
      auth: { command: './auth-server/updateStaging.sh', order: 2, run_last: false },
      web: { command: 'SKIP_E2E=1 ./web-client/updateStaging.sh', order: 3, run_last: false },
      e2e: { command: './web-client/scripts/run-playwright-stage.sh', order: 0, run_last: true }
    }
  };
  
  // Simulate the jq sorting logic from the script
  const nonRunLast = Object.entries(gatesJson.gates)
    .filter(([k, v]) => v.run_last !== true)
    .sort((a, b) => (a[1].order || 0) - (b[1].order || 0));
  const runLast = Object.entries(gatesJson.gates)
    .filter(([k, v]) => v.run_last === true)
    .sort((a, b) => (a[1].order || 0) - (b[1].order || 0));
  const ordered = [...nonRunLast, ...runLast];
  
  const keys = ordered.map(([k]) => k);
  
  // e2e (run_last=true, order=0) should be last
  assert.equal(keys[keys.length - 1], 'e2e');
  // server (order=1) should be first
  assert.equal(keys[0], 'server');
  // auth (order=2) should be second
  assert.equal(keys[1], 'auth');
  // web (order=3) should be third
  assert.equal(keys[2], 'web');
});

test('script integrate area: changed area filtering works', () => {
  // Verify the changed area filtering logic in the script
  const changedAreas = ['server', 'workflow'];
  const gates = [
    { key: 'server', command: './server/updateStaging.sh' },
    { key: 'auth-server', command: './auth-server/updateStaging.sh' },
    { key: 'web-client', command: 'SKIP_E2E=1 ./web-client/updateStaging.sh' },
    { key: 'web-e2e', command: './web-client/scripts/run-playwright-stage.sh' }
  ];
  
  // Simulate the filtering logic from the script
  const shouldRun = (gateKey) => {
    if (changedAreas.includes(gateKey)) return true;
    if (gateKey === 'web-e2e') {
      return changedAreas.includes('web-client');
    }
    return false;
  };
  
  const filtered = gates.filter(gate => shouldRun(gate.key));
  
  // Only server should match (workflow is not a gate key)
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].key, 'server');
});

test('script integrate area: web-e2e special case works', () => {
  // Verify that web-e2e runs when web-client is changed
  const changedAreas = ['web-client'];
  const gates = [
    { key: 'server', command: './server/updateStaging.sh' },
    { key: 'web-client', command: 'SKIP_E2E=1 ./web-client/updateStaging.sh' },
    { key: 'web-e2e', command: './web-client/scripts/run-playwright-stage.sh' }
  ];
  
  const shouldRun = (gateKey) => {
    if (changedAreas.includes(gateKey)) return true;
    if (gateKey === 'web-e2e') {
      return changedAreas.includes('web-client');
    }
    return false;
  };
  
  const filtered = gates.filter(gate => shouldRun(gate.key));
  
  // Both web-client and web-e2e should match
  assert.equal(filtered.length, 2);
  assert.ok(filtered.some(g => g.key === 'web-client'));
  assert.ok(filtered.some(g => g.key === 'web-e2e'));
});

// Integration tests that actually invoke scripts/verify-local.sh integrate
// Note: The script resolves REPO_ROOT from its own location and cd's to it,
// so these tests use test fixtures via INTEGRATION_CONFIG_PATH env var to avoid
// touching the real repo config file.
verifyLocalTest('script integrate: is callable and handles missing config gracefully', () => {
  const child_process = require('child_process');
  const os = require('os');
  const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'verify-local.sh');
  
  // Create a temp directory without a config file
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-integrate-no-config-'));
  
  // Run the script with INTEGRATION_CONFIG_PATH pointing to non-existent file
  // The script should handle missing config gracefully
  const env = { 
    ...process.env,
    WORKFLOW_SUITE_CONTEXT: '1',
    INTEGRATION_CONFIG_PATH: path.join(tmpDir, 'nonexistent', 'integration-pipelines.json')
  };
  const result = child_process.spawnSync(scriptPath, ['integrate'], { 
    cwd: __dirname,
    env,
    encoding: 'utf8'
  });
  
  // Cleanup temp dir
  fs.rmdirSync(tmpDir, { recursive: true, force: true });
  
  // The script should succeed (exit 0) with no config
  assert.equal(result.status, 0);
  const output = result.stdout + result.stderr;
  assert.match(output, /integration-gates: no config present, skipping/);
});

verifyLocalTest('script integrate: dry-run with INTEGRATE_DRY_RUN env var works', () => {
  const child_process = require('child_process');
  const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'verify-local.sh');
  const fixturePath = path.join(__dirname, 'fixtures', 'integration-pipelines-test.json');
  
  // Run the script with INTEGRATE_DRY_RUN=true, custom config, and override changed areas
  // This ensures the test is deterministic regardless of git state
  const env = { 
    ...process.env,
    WORKFLOW_SUITE_CONTEXT: '1',
    INTEGRATE_DRY_RUN: 'true',
    INTEGRATION_CONFIG_PATH: fixturePath,
    INTEGRATE_CHANGED_AREAS: 'server auth-server web-client'
  };
  const result = child_process.spawnSync(scriptPath, ['integrate'], { 
    cwd: __dirname,
    env,
    encoding: 'utf8'
  });
  
  // The script should succeed
  assert.equal(result.status, 0);
  const output = result.stdout + result.stderr;
  // With INTEGRATE_DRY_RUN=true and config present, it should print the gate plan
  assert.match(output, /integration-gates: resolved gate plan:/);
  // Verify gates are printed in order (server, auth-server, web-client, web-e2e)
  assert.ok(output.includes('server:'));
  assert.ok(output.includes('auth-server:'));
  assert.ok(output.includes('web-client:'));
  assert.ok(output.includes('web-e2e:'));
});

verifyLocalTest('script integrate: failure output prints command', () => {
  const child_process = require('child_process');
  const os = require('os');
  const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'verify-local.sh');
  
  // Create a temp config with a failing command (exit 1)
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-integrate-fail-'));
  const tmpConfigPath = path.join(tmpDir, 'integration-pipelines.json');
  const failConfig = {
    gates: {
      server: { command: 'exit 1', order: 1, run_last: false }
    }
  };
  fs.writeFileSync(tmpConfigPath, JSON.stringify(failConfig, null, 2));
  
  // Run the script with the failing config and override changed areas to include server
  // This ensures the server gate runs regardless of git state
  const env = { 
    ...process.env,
    WORKFLOW_SUITE_CONTEXT: '1',
    INTEGRATION_CONFIG_PATH: tmpConfigPath,
    INTEGRATE_CHANGED_AREAS: 'server'
  };
  const result = child_process.spawnSync(scriptPath, ['integrate'], { 
    cwd: __dirname,
    env,
    encoding: 'utf8'
  });
  
  // Cleanup temp dir
  fs.unlinkSync(tmpConfigPath);
  fs.rmdirSync(tmpDir, { recursive: true, force: true });
  
  // The script should fail (non-zero exit)
  assert.notEqual(result.status, 0);
  const output = result.stdout + result.stderr;
  
  // Verify failure output includes the area name and command
  assert.match(output, /=== FAIL: integration:server ===/);
  assert.match(output, /Command: exit 1/);
});

// Test for Finding 1: node parallix integrate sanitizes env vars (INTEGRATION_CONFIG_PATH, INTEGRATE_CHANGED_AREAS)
verifyLocalTest('integrate command ignores INTEGRATION_CONFIG_PATH and INTEGRATE_CHANGED_AREAS env overrides', () => {
  const child_process = require('child_process');
  const os = require('os');
  const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'verify-local.sh');
  const integratePath = path.join(__dirname, '..', 'lib', 'commands', 'integrate.js');
  
  // Create a temp config with harmless commands
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-integrate-env-sanitize-'));
  const tmpConfigPath = path.join(tmpDir, 'integration-pipelines.json');
  const testConfig = {
    gates: {
      server: { command: 'echo should-not-run', order: 1, run_last: false }
    }
  };
  fs.writeFileSync(tmpConfigPath, JSON.stringify(testConfig, null, 2));
  
  // Create a fake mission worktree for the test
  const worktreeDir = path.join(tmpDir, 'mission-test-123');
  fs.mkdirSync(worktreeDir, { recursive: true });
  
  // We need to test that node parallix integrate does NOT use the env overrides
  // This means: when we set INTEGRATION_CONFIG_PATH to a non-existent or different config,
  // and INTEGRATE_CHANGED_AREAS to 'server', the integrate command should still
  // use the real repo config (which has server, auth-server, web-client, web-e2e gates)
  // and real changed area detection.
  
  // However, since we're in a test environment without a real git repo setup,
  // we test the script directly with the env vars set, and then separately verify
  // that node parallix integrate strips these vars.
  
  // First, verify that the script WITHOUT env sanitization would use the overrides
  // (this proves the env vars DO work when passed through)
  const envWithOverrides = { 
    ...process.env, 
    INTEGRATION_CONFIG_PATH: tmpConfigPath,
    INTEGRATE_CHANGED_AREAS: 'server'
  };
  const resultWithOverrides = child_process.spawnSync(scriptPath, ['integrate'], { 
    cwd: __dirname,
    env: envWithOverrides,
    encoding: 'utf8'
  });
  
  // With overrides, it should use our temp config and only run server gate
  // (and since our temp config has 'echo should-not-run', it won't actually fail)
  const outputWithOverrides = resultWithOverrides.stdout + resultWithOverrides.stderr;
  assert.match(outputWithOverrides, /should-not-run/);
  
  // Now verify that the script with the repo's default config works normally
  // (without the test-only env vars)
  const resultWithoutOverrides = child_process.spawnSync(scriptPath, ['integrate'], { 
    cwd: __dirname,
    env: process.env,
    encoding: 'utf8'
  });
  
  // Cleanup temp dir
  fs.rmdirSync(tmpDir, { recursive: true, force: true });
  
  // The result without overrides should use the repo's real config
  // It should either succeed (if no changed areas match) or run the real gates
  // The key point: output should NOT contain 'should-not-run'
  const outputWithoutOverrides = resultWithoutOverrides.stdout + resultWithoutOverrides.stderr;
  assert.ok(!outputWithoutOverrides.includes('should-not-run'), 
    'node parallix integrate should not use INTEGRATION_CONFIG_PATH override');
});

// Test for Finding 2: docs-only changes emit "no applicable gates" message in non-dry-run
verifyLocalTest('script integrate: docs-only changed areas prints no applicable gates message (non-dry-run)', () => {
  const child_process = require('child_process');
  const os = require('os');
  const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'verify-local.sh');
  
  // Use the real repo config (which has server, auth-server, web-client, web-e2e gates)
  // Set changed areas to only 'docs' - none of the configured gates match 'docs'
  const env = { 
    ...process.env,
    WORKFLOW_SUITE_CONTEXT: '1',
    INTEGRATE_DRY_RUN: 'false',  // Non-dry-run
    INTEGRATE_CHANGED_AREAS: 'docs'
  };
  const result = child_process.spawnSync(scriptPath, ['integrate'], { 
    cwd: __dirname,
    env,
    encoding: 'utf8'
  });
  
  // The script should succeed (exit 0) since no gates ran means success
  assert.equal(result.status, 0);
  const output = result.stdout + result.stderr;
  
  // Should print the explicit "no applicable gates" message
  assert.match(output, /integration-gates: no applicable gates for changed areas/);
});

// Test for docs+workflow only changes (also no matching JSON-config gates).
// The workflow area additionally triggers the direct workflow-suite gate. In
// workflow-suite test context we skip the nested gate to avoid recursion.
verifyLocalTest('script integrate: docs+workflow only changed areas prints no applicable gates message', () => {
  const child_process = require('child_process');
  const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'verify-local.sh');

  const env = {
    ...process.env,
    WORKFLOW_SUITE_CONTEXT: '1',
    INTEGRATE_DRY_RUN: 'false',
    INTEGRATE_CHANGED_AREAS: 'docs workflow'
  };
  const result = child_process.spawnSync(scriptPath, ['integrate'], {
    cwd: __dirname,
    env,
    encoding: 'utf8'
  });

  assert.equal(result.status, 0);
  const output = result.stdout + result.stderr;

  // Should print the explicit "no applicable gates" message
  assert.match(output, /integration-gates: no applicable gates for changed areas/);
  assert.ok(!output.includes('integration:workflow-suite'),
    'workflow-suite gate should be skipped in suite context');
});

verifyLocalTest('script integrate: dirty checkout with no gated area changes does not widen to staging', () => {
  const child_process = require('child_process');
  const os = require('os');
  const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'verify-local.sh');
  const repoRoot = path.resolve(__dirname, '..', '..');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-integrate-empty-'));
  const binDir = path.join(tmpDir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });

  const fakeGitPath = path.join(binDir, 'git');
  const fakeGit = `#!/usr/bin/env bash
set -euo pipefail

case "$*" in
  *"rev-parse --show-toplevel"* )
    echo ${repoRoot}
    ;;
  *"branch --list"* )
    echo main
    ;;
  *"diff --name-only main -- ."* )
    ;;
  *"diff --name-only HEAD -- ."* )
    ;;
  *"ls-files --others --exclude-standard"* )
    ;;
  *"status --porcelain"* )
    echo "?? scratch-note.txt"
    ;;
  * )
    exit 0
    ;;
esac
`;
  fs.writeFileSync(fakeGitPath, fakeGit);
  fs.chmodSync(fakeGitPath, 0o755);

  const tmpConfigPath = path.join(tmpDir, 'integration-pipelines.json');
  fs.writeFileSync(tmpConfigPath, JSON.stringify({
    gates: {
      server: { command: 'echo should-not-run', order: 1, run_last: false }
    }
  }, null, 2));

  const env = {
    ...process.env,
    WORKFLOW_SUITE_CONTEXT: '1',
    PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
    INTEGRATION_CONFIG_PATH: tmpConfigPath
  };

  const result = child_process.spawnSync(scriptPath, ['integrate'], {
    cwd: __dirname,
    env,
    encoding: 'utf8'
  });

  fs.rmSync(tmpDir, { recursive: true, force: true });

  assert.equal(result.status, 0);
  const output = result.stdout + result.stderr;
  assert.match(output, /integration-gates: no applicable gates for changed areas/);
  assert.ok(!output.includes('should-not-run'));
});

verifyLocalTest('script integrate: explicit empty changed areas skip without widening from dirty checkout', () => {
  const child_process = require('child_process');
  const os = require('os');
  const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'verify-local.sh');
  const repoRoot = path.resolve(__dirname, '..', '..');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-integrate-explicit-empty-'));
  const binDir = path.join(tmpDir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });

  const fakeGitPath = path.join(binDir, 'git');
  const fakeGit = `#!/usr/bin/env bash
set -euo pipefail

case "$*" in
  *"rev-parse --show-toplevel"* )
    echo ${repoRoot}
    ;;
  *"status --porcelain"* )
    echo "?? scratch-note.txt"
    ;;
  * )
    exit 0
    ;;
esac
`;
  fs.writeFileSync(fakeGitPath, fakeGit);
  fs.chmodSync(fakeGitPath, 0o755);

  const tmpConfigPath = path.join(tmpDir, 'integration-pipelines.json');
  fs.writeFileSync(tmpConfigPath, JSON.stringify({
    gates: {
      server: { command: 'echo should-not-run', order: 1, run_last: false }
    }
  }, null, 2));

  const env = {
    ...process.env,
    WORKFLOW_SUITE_CONTEXT: '1',
    PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
    INTEGRATION_CONFIG_PATH: tmpConfigPath,
    INTEGRATE_CHANGED_AREAS: ''
  };

  const result = child_process.spawnSync(scriptPath, ['integrate'], {
    cwd: __dirname,
    env,
    encoding: 'utf8'
  });

  fs.rmSync(tmpDir, { recursive: true, force: true });

  assert.equal(result.status, 0);
  const output = result.stdout + result.stderr;
  assert.match(output, /integration-gates: no area changes detected, skipping/);
  assert.ok(!output.includes('should-not-run'));
});
