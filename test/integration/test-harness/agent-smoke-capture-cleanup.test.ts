

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolveConfiguration } from '../../../src/composition/config.js';
import { activeCustomCapacityCount, tryAcquireCustomCapacity } from '../../../src/adapters/agents/custom-capacity.js';
import { clearCustomAdmissionStateCache } from '../../../src/adapters/sqlite/custom-admission-state.js';
const originalOpenSync = fs.openSync;
const originalTmpdir = os.tmpdir;

// Import the smoke suite for its helpers only. The flag is set before the
// dynamic import so the smoke tests themselves do not register here.
process.env.PARALLIX_E2E_SMOKE_TEST_HELPERS = '1';
const smokeHelpers = await import('../../e2e/agents/real-agent-smoke.test.js');

function selectionOptions(overrides: Partial<Parameters<typeof smokeHelpers.selectRealAgentSmoke>[0]> = {}) {
  return {
    explicitAgent: null,
    explicitModel: null,
    configuredCustomModel: 'local/custom-model',
    configuredCustomRunner: 'pi',
    acquireCustomCapacity: async () => null,
    codexEligible: () => true,
    codexBlocked: () => false,
    codexAvailable: () => true,
    ...overrides,
  };
}

test('real-agent smoke keeps configured custom when production admission succeeds (PX-0049)', async () => {
  let releases = 0;
  let codexChecks = 0;
  const selection = await smokeHelpers.selectRealAgentSmoke(selectionOptions({
    acquireCustomCapacity: async () => ({ release: () => { releases += 1; } }),
    codexEligible: () => { codexChecks += 1; return true; },
  }));
  assert.deepEqual(selection, {
    agent: 'custom', runner: 'pi', model: 'local/custom-model', reasoningEffort: null, reason: 'custom-admitted',
  });
  assert.equal(releases, 1, 'the capacity probe must not consume the slot used by the real lifecycle');
  assert.equal(codexChecks, 0, 'admitted custom must not inspect or launch Codex');
});

test('real-agent smoke selects Luna low only when saturated custom can use Codex (PX-0049)', async () => {
  const selection = await smokeHelpers.selectRealAgentSmoke(selectionOptions());
  assert.deepEqual(selection, {
    agent: 'codex', runner: 'codex', model: 'gpt-6-luna', reasoningEffort: 'low', reason: 'custom-saturated-codex',
  });
});

test('real-agent smoke production capacity owner sees its shared disposable lease (PX-0049)', async () => {
  const root = fs.mkdtempSync(path.join(originalTmpdir(), 'px-0049-shared-admission-'));
  const policy = path.join(root, 'policy');
  fs.mkdirSync(policy);
  fs.writeFileSync(path.join(policy, 'workflow.config.json'), JSON.stringify({
    adapters: { agents: { maxConcurrentCustom: 1 } },
  }));
  const environment = {
    ...process.env,
    PARALLIX_HOME: path.join(root, 'operator'),
    PARALLIX_E2E_CUSTOM_ADMISSION_HOME: path.join(root, 'admission'),
    PARALLIX_CUSTOM_ADMISSION_REPOSITORY: policy,
  };
  smokeHelpers.configureRealAgentSmokeAdmissionHome(environment, root, 'test');
  const configuration = resolveConfiguration(environment);
  let held: Awaited<ReturnType<typeof tryAcquireCustomCapacity>> = null;
  try {
    held = await tryAcquireCustomCapacity(policy, configuration);
    assert.ok(held, 'fixture must occupy the configured custom slot');
    const selection = await smokeHelpers.selectRealAgentSmoke(selectionOptions({
      acquireCustomCapacity: () => tryAcquireCustomCapacity(policy, configuration),
    }));
    assert.equal(selection.reason, 'custom-saturated-codex');
    assert.equal(selection.agent, 'codex');
  } finally {
    held?.release();
    await clearCustomAdmissionStateCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('real-agent smoke preserves custom admission when Codex is ineligible, blocked, or unavailable (PX-0049)', async () => {
  for (const unavailable of [
    { codexEligible: () => false },
    { codexBlocked: () => true },
    { codexAvailable: () => false },
  ]) {
    const selection = await smokeHelpers.selectRealAgentSmoke(selectionOptions(unavailable));
    assert.equal(selection.agent, 'custom');
    assert.equal(selection.reason, 'custom-saturated-codex-unavailable');
  }
});

test('real-agent smoke explicit overrides stay supported and unsupported Codex models fail before launch (PX-0049)', async () => {
  const custom = await smokeHelpers.selectRealAgentSmoke(selectionOptions({
    explicitAgent: 'custom', explicitModel: 'operator/custom-model',
  }));
  assert.equal(custom.agent, 'custom');
  assert.equal(custom.model, 'operator/custom-model');

  const codex = await smokeHelpers.selectRealAgentSmoke(selectionOptions({
    explicitAgent: 'codex', explicitModel: 'gpt-6-luna',
  }));
  assert.equal(codex.agent, 'codex');
  assert.equal(codex.reasoningEffort, 'low');

  await assert.rejects(
    smokeHelpers.selectRealAgentSmoke(selectionOptions({ explicitAgent: 'codex', explicitModel: 'gpt-6-sol' })),
    /Codex smoke override requires model gpt-6-luna/,
  );
});

test('real-agent smoke selection is final before launch and a custom failure never retries with Codex (PX-0049)', async () => {
  let selections = 0;
  const launches: string[] = [];
  await assert.rejects(smokeHelpers.executeRealAgentSmoke(
    async () => {
      selections += 1;
      return smokeHelpers.selectRealAgentSmoke(selectionOptions({
        acquireCustomCapacity: async () => ({ release() {} }),
      }));
    },
    async selection => {
      launches.push(selection.agent);
      throw new Error('custom lifecycle failed');
    },
  ), /custom lifecycle failed/);
  assert.equal(selections, 1);
  assert.deepEqual(launches, ['custom']);
  assert.equal(launches.includes('codex'), false);
});

const KUB2_MODEL = '/models/gemma-4-26B-A4B-it-UD-Q4_K_M.gguf';

function writeKub2PiHome(root: string) {
  const agentHome = path.join(root, '.pi', 'agent');
  fs.mkdirSync(agentHome, { recursive: true });
  // Pi writes trailing commas; the route must tolerate them.
  fs.writeFileSync(path.join(agentHome, 'models.json'),
    `{"providers": {"gemma-kub2": {"baseUrl": "http://kub2:8080/v1/", "apiKey": "dummy-key", "models": [{"id": ${JSON.stringify(KUB2_MODEL)},},],},},}`);
  return agentHome;
}

test('real-agent smoke prefers a reachable kub2 pi route before admission and Codex (PX-0076)', async () => {
  let admissionProbes = 0;
  let codexChecks = 0;
  const selection = await smokeHelpers.selectRealAgentSmoke(selectionOptions({
    resolveKub2Route: async () => ({ provider: 'gemma-kub2', model: KUB2_MODEL }),
    acquireCustomCapacity: async () => { admissionProbes += 1; return null; },
    codexEligible: () => { codexChecks += 1; return true; },
  }));
  assert.deepEqual(selection, {
    agent: 'custom', runner: 'pi', model: KUB2_MODEL, reasoningEffort: null,
    piProvider: 'gemma-kub2', reason: 'kub2-pi',
  });
  assert.equal(admissionProbes, 0, 'kub2 route must not call production custom admission');
  assert.equal(codexChecks, 0, 'kub2 route must not inspect Codex');

  const explicit = await smokeHelpers.selectRealAgentSmoke(selectionOptions({
    explicitAgent: 'codex', explicitModel: 'gpt-6-luna',
    resolveKub2Route: async () => ({ provider: 'gemma-kub2', model: KUB2_MODEL }),
  }));
  assert.equal(explicit.reason, 'explicit-override');

  const explicitCustom = await smokeHelpers.selectRealAgentSmoke(selectionOptions({
    explicitAgent: 'custom', configuredCustomRunner: 'opencode',
    resolveKub2Route: async () => ({ provider: 'gemma-kub2', model: KUB2_MODEL }),
  }));
  assert.deepEqual(explicitCustom, {
    agent: 'custom', runner: 'opencode', model: 'local/custom-model', reasoningEffort: null,
    reason: 'explicit-override',
  });
});

test('real-agent smoke kub2 route resolves from pi models with a no-inference GET check (PX-0076)', async () => {
  const home = fs.mkdtempSync(path.join(originalTmpdir(), 'px-0076-pi-'));
  try {
    const agentHome = writeKub2PiHome(home);
    const requests: { url: string; method: string }[] = [];
    const reachable = (async (url: string, init?: RequestInit) => {
      requests.push({ url: String(url), method: init?.method ?? 'GET' });
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    assert.deepEqual(await smokeHelpers.resolveKub2SmokeRoute(agentHome, reachable),
      { provider: 'gemma-kub2', model: KUB2_MODEL });
    assert.deepEqual(requests, [{ url: 'http://kub2:8080/v1/models', method: 'GET' }]);

    const refused = (async () => { throw new Error('ECONNREFUSED'); }) as typeof fetch;
    assert.equal(await smokeHelpers.resolveKub2SmokeRoute(agentHome, refused), null);
    const unhealthy = (async () => new Response('', { status: 503 })) as typeof fetch;
    assert.equal(await smokeHelpers.resolveKub2SmokeRoute(agentHome, unhealthy), null);
    assert.equal(await smokeHelpers.resolveKub2SmokeRoute(path.join(home, 'absent'), reachable), null);

    fs.writeFileSync(path.join(agentHome, 'models.json'), '{"providers": {"vllm": {"baseUrl": "http://kub:8080/v1", "models": [{"id": "x"}]}}}');
    assert.equal(await smokeHelpers.resolveKub2SmokeRoute(agentHome, reachable), null);
    assert.equal(requests.length, 1, 'a missing models file or provider must not issue a request');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('real-agent smoke falls through to the unchanged order when kub2 is absent (PX-0076)', async () => {
  const absent = { resolveKub2Route: async () => null };
  const saturated = await smokeHelpers.selectRealAgentSmoke(selectionOptions(absent));
  assert.equal(saturated.reason, 'custom-saturated-codex');
  assert.equal(saturated.agent, 'codex');
  const admitted = await smokeHelpers.selectRealAgentSmoke(selectionOptions({
    ...absent, acquireCustomCapacity: async () => ({ release() {} }),
  }));
  assert.deepEqual(admitted, {
    agent: 'custom', runner: 'pi', model: 'local/custom-model', reasoningEffort: null, reason: 'custom-admitted',
  });
  const blocked = await smokeHelpers.selectRealAgentSmoke(selectionOptions({ ...absent, codexBlocked: () => true }));
  assert.equal(blocked.reason, 'custom-saturated-codex-unavailable');
});

test('kub2 smoke route owns a two-slot disposable lease pool independent of production admission (PX-0076)', async () => {
  const root = fs.mkdtempSync(path.join(originalTmpdir(), 'px-0076-kub2-admission-'));
  const productionPolicy = path.join(root, 'production-policy');
  fs.mkdirSync(productionPolicy);
  fs.writeFileSync(path.join(productionPolicy, 'workflow.config.json'), JSON.stringify({
    adapters: { agents: { maxConcurrentCustom: 1 } },
  }));
  const productionHome = path.join(root, 'production-admission');
  const base: NodeJS.ProcessEnv = { ...process.env, PARALLIX_HOME: path.join(root, 'operator') };
  delete base.PARALLIX_E2E_CUSTOM_ADMISSION_HOME;
  const productionEnvironment = {
    ...base, PARALLIX_CUSTOM_ADMISSION_HOME: productionHome, PARALLIX_CUSTOM_ADMISSION_REPOSITORY: productionPolicy,
  };
  const kub2Environment: NodeJS.ProcessEnv = { ...base };
  const { admissionHome, policyRoot } = smokeHelpers.configureKub2SmokeAdmission(kub2Environment, root, 'test');
  const held: Awaited<ReturnType<typeof tryAcquireCustomCapacity>>[] = [];
  try {
    assert.notEqual(admissionHome, productionHome);
    assert.equal(kub2Environment.PARALLIX_CUSTOM_ADMISSION_HOME, admissionHome);
    assert.equal(kub2Environment.PARALLIX_CUSTOM_ADMISSION_REPOSITORY, policyRoot);
    const configuration = resolveConfiguration(kub2Environment);
    held.push(await tryAcquireCustomCapacity(policyRoot, configuration));
    held.push(await tryAcquireCustomCapacity(policyRoot, configuration));
    assert.ok(held[0] && held[1], 'two concurrent smoke processes must each acquire a lease');
    assert.equal(await tryAcquireCustomCapacity(policyRoot, configuration), null, 'a third must be refused');
    assert.equal(await activeCustomCapacityCount(configuration), 2);

    // Production admission keeps its own pool and capacity: its slot is still free.
    const production = resolveConfiguration(productionEnvironment);
    assert.equal(await activeCustomCapacityCount(production), 0, 'no lease row in production admission state');
    const productionSlot = await tryAcquireCustomCapacity(productionPolicy, production);
    held.push(productionSlot);
    assert.ok(productionSlot, 'kub2 leases must not occupy the production custom slot');
    assert.equal(JSON.parse(fs.readFileSync(path.join(productionPolicy, 'workflow.config.json'), 'utf8')).adapters.agents.maxConcurrentCustom, 1);
  } finally {
    for (const reservation of held) reservation?.release();
    await clearCustomAdmissionStateCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('kub2 smoke fixture pins pi provider and model with isolated credentials and no family retry (PX-0076)', async () => {
  const home = fs.mkdtempSync(path.join(originalTmpdir(), 'px-0076-fixture-'));
  const originalHomedir = os.homedir;
  let fixture: ReturnType<typeof smokeHelpers.setupRepository> | undefined;
  try {
    const agentHome = writeKub2PiHome(home);
    fs.writeFileSync(path.join(agentHome, 'settings.json'), JSON.stringify({
      defaultProvider: 'vllm', defaultModel: 'operator-default', packages: ['x'], skills: ['y'],
    }));
    fs.writeFileSync(path.join(agentHome, 'auth.json'), 'operator-credential');
    os.homedir = () => home;
    fixture = smokeHelpers.setupRepository({
      slug: 'task-9002', title: 'Pinned', runner: 'pi', model: KUB2_MODEL, piProvider: 'gemma-kub2',
      runnerCommandPath: process.execPath,
    });
    const settings = JSON.parse(fs.readFileSync(path.join(fixture.piAgentHome, 'settings.json'), 'utf8'));
    assert.equal(settings.defaultProvider, 'gemma-kub2');
    assert.equal(settings.defaultModel, KUB2_MODEL);
    assert.deepEqual([settings.packages, settings.skills], [[], []]);
    assert.notEqual(fixture.piAgentHome, agentHome);
    fs.writeFileSync(path.join(fixture.piAgentHome, 'auth.json'), 'fixture-credential');
    assert.equal(fs.readFileSync(path.join(agentHome, 'auth.json'), 'utf8'), 'operator-credential');
    assert.equal(JSON.parse(fs.readFileSync(path.join(agentHome, 'settings.json'), 'utf8')).defaultProvider, 'vllm');

    const launches: string[] = [];
    await assert.rejects(smokeHelpers.executeRealAgentSmoke(
      async () => smokeHelpers.selectRealAgentSmoke(selectionOptions({
        resolveKub2Route: async () => ({ provider: 'gemma-kub2', model: KUB2_MODEL }),
      })),
      async selection => { launches.push(selection.reason); throw new Error('kub2 lifecycle failed'); },
    ), /kub2 lifecycle failed/);
    assert.deepEqual(launches, ['kub2-pi'], 'a kub2 failure must not retry on another family');
  } finally {
    os.homedir = originalHomedir;
    if (fixture) fs.rmSync(fixture.tmpRoot, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('smoke state snapshots read only agent configuration, never the operator database', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(originalTmpdir(), 'smoke-state-snapshot-'));
  const originalReadFileSync = fs.readFileSync;
  const homes = [path.join(tempRoot, 'linux'), path.join(tempRoot, 'fallback')];
  const configuration = '{"blocklist":{"custom":false}}';
  try {
    for (const home of homes) {
      fs.mkdirSync(home);
      fs.writeFileSync(path.join(home, 'parallix.db'), 'binary database');
    }
    const agentsPath = path.join(homes[0], 'agents.local.json');
    fs.writeFileSync(agentsPath, configuration);
    // Reproduce the failure at the read boundary without allocating a 512 MiB
    // database or string. Database contents are not part of this snapshot.
    t.mock.method(fs, 'readFileSync', (...args: Parameters<typeof originalReadFileSync>) => {
      const [file] = args;
      if (homes.some(home => String(file) === path.join(home, 'parallix.db'))) {
        throw Object.assign(new Error('Cannot create a string longer than 0x1fffffe8 characters'), { code: 'ERR_STRING_TOO_LONG' });
      }
      return originalReadFileSync(...args);
    });
    assert.deepEqual(smokeHelpers.snapshotDefaultParallixState(homes), new Map([[agentsPath, configuration]]));
    fs.writeFileSync(path.join(homes[1], 'agents.local.json'), '{}');
    assert.deepEqual(smokeHelpers.snapshotDefaultParallixState(homes), new Map([
      [agentsPath, configuration],
      [path.join(homes[1], 'agents.local.json'), '{}'],
    ]));
  } finally {
    fs.readFileSync = originalReadFileSync;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

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
      const error = Object.assign(new Error('ENOSPC: no space left while opening stderr capture'), { code: 'ENOSPC' });
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
  const output = { stdout: 'Implementation in progress', stderr: '', status: null, signal: 'SIGTERM' } satisfies Partial<NonNullable<Parameters<typeof classifyFailure>[0]>>;
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
    const progressWrite: (line: string) => void = (chunk) => {
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
