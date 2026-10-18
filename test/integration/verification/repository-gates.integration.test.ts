import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verifyActiveUnits } from '../../../scripts/verify-active-units.js';
import { spawn } from 'node:child_process';
import { runPhaseGates, runGateCommand } from '../../../src/adapters/config/repository-gates.js';
import { MAX_GATE_OUTPUT_CHARS } from '../../../src/adapters/config/gate-dashboard.js';
import { createIntegrationVerificationEvidencePort } from '../../../src/adapters/verification/integration-verification-proof.js';
import { VerificationGateEvidenceReader } from '../../../src/adapters/verification/gate-evidence-reader.js';
import { VerificationGateObserver } from '../../../src/application/projections/gate-observation.js';
import { resolveConfiguration } from '../../../src/composition/config.js';
import type { ParallixConfiguration } from '../../../src/application/ports/configuration.js';
import type { Mission } from '../../../src/domain/mission.js';
import { missionId } from '../../../src/domain/mission.js';
import { repositoryId } from '../../../src/domain/repository.js';
import type { WorkflowOperation } from '../../../src/domain/workflow-operation.js';
import { setTimeout as delay } from 'node:timers/promises';
import { initCommittedRepository } from '../../fixtures/git-repository.js';

test('configured parallel integration gates run real commands through the phase boundary', async () => {
  const checkout = fs.mkdtempSync(path.join(os.tmpdir(), 'px-gates-integration-'));
  try {
    fs.writeFileSync(path.join(checkout, 'workflow.config.json'), JSON.stringify({ adapters: { gates: {
      parallel: { preIntegration: 2 },
      preIntegration: [
        { key: 'producer', command: 'sleep 0.05; printf artifact > artifact.txt', order: 1 },
        { key: 'independent', command: 'sleep 0.05; printf independent', order: 2 },
        { key: 'consumer', command: 'test "$(cat artifact.txt)" = artifact && printf consumed', order: 3, after: ['producer'] },
      ],
    } } }));
    const output: string[] = [];
    const result = await runPhaseGates('integration', { slug: 'task-2558', checkoutPath: checkout, log: line => output.push(line) });
    assert.equal(result.ok, true);
    assert.equal(result.executed, 3);
    assert.doesNotMatch(output.join('\n'), /consumed/, 'successful child output stays off the parent console');
    assert.equal(result.outcomes?.find(outcome => outcome.key === 'consumer')?.stdout, 'consumed');
    assert.equal(fs.readFileSync(path.join(checkout, 'artifact.txt'), 'utf8'), 'artifact');
  } finally { fs.rmSync(checkout, { recursive: true, force: true }); }
});

test('parallel failure terminates an active process group and preserves rebound evidence', async () => {
  const checkout = fs.mkdtempSync(path.join(os.tmpdir(), 'px-gates-fail-fast-'));
  try {
    const started = Date.now();
    const result = await runPhaseGates('integration', {
      slug: 'task-2586', checkoutPath: checkout, maxParallel: 2, log: () => {}, error: () => {},
      gates: [
        { key: 'red', command: 'while [ ! -f ready ]; do sleep 0.01; done; printf defect >&2; exit 7', order: 1 },
        { key: 'peer', command: 'touch ready; sleep 30; touch leaked', order: 2 },
        { key: 'queued', command: 'touch queued', order: 3 },
      ],
    });
    assert.equal(result.ok, false);
    assert.equal(result.cancelled, false);
    assert.equal(result.failedGate?.key, 'red');
    assert.equal(result.failedGate?.exitCode, 7);
    assert.equal(result.failedGate?.stderr, 'defect');
    assert.equal(result.executed, 2);
    assert.ok(Date.now() - started < 5000, 'peer termination avoids its 30-second wait');
    assert.equal(fs.existsSync(path.join(checkout, 'leaked')), false);
    assert.equal(fs.existsSync(path.join(checkout, 'queued')), false);
  } finally { fs.rmSync(checkout, { recursive: true, force: true }); }
});

test('a stale coverage report cannot release the dependent Sonar gate', async () => {
  const checkout = fs.mkdtempSync(path.join(os.tmpdir(), 'px-coverage-gate-'));
  try {
    fs.mkdirSync(path.join(checkout, 'coverage'));
    fs.writeFileSync(path.join(checkout, 'coverage/lcov.info'), 'stale');
    const result = await runPhaseGates('integration', {
      slug: 'task-2558', checkoutPath: checkout, maxParallel: 2,
      gates: [
        { key: 'coverage-merge', command: 'rm -f coverage/lcov.info && false && test -s coverage/lcov.info', order: 1 },
        { key: 'quality-gate', command: 'printf scanned > scan.txt', order: 2, after: ['coverage-merge'] },
      ],
    });
    assert.equal(result.failedGate?.key, 'coverage-merge');
    assert.equal(fs.existsSync(path.join(checkout, 'coverage/lcov.info')), false);
    assert.equal(fs.existsSync(path.join(checkout, 'scan.txt')), false);
  } finally { fs.rmSync(checkout, { recursive: true, force: true }); }
});

test('cancel escalates from TERM to KILL when a gate ignores TERM', async () => {
  const controller = new globalThis.AbortController();
  const started = Date.now();
  const result = await runGateCommand("trap '' TERM; printf ready; while :; do sleep 1; done", [], {
    cwd: process.cwd(), env: process.env, stdio: 'pipe', signal: controller.signal, terminationGraceMs: 30,
    onOutput: chunk => { if (chunk.includes('ready')) controller.abort(); },
  });
  assert.equal(result.status, null);
  assert.match(result.stdout, /ready/);
  assert.ok(Date.now() - started < 1000, 'the watchdog resolves a TERM-resistant gate');
});

test('gate output retention keeps a bounded tail', async () => {
  const result = await runGateCommand(`${process.execPath} -e 'process.stdout.write("x".repeat(1100000))'`, [], {
    cwd: process.cwd(), env: process.env, stdio: 'pipe',
  });
  assert.equal(result.status, 0);
  assert.ok(result.stdout.length <= MAX_GATE_OUTPUT_CHARS);
  assert.match(result.stdout, /^\[Earlier gate output truncated\]/);
  assert.match(result.stdout, /x+$/);
});

test('serial non-TTY gate output arrives before the gate finishes', async () => {
  const script = `import { runPhaseGates } from './src/adapters/config/repository-gates.ts';
    await runPhaseGates('integration', { slug: 'task-2558', checkoutPath: process.cwd(),
      gates: [{ key: 'slow', command: 'printf ready; sleep 0.2; printf done', order: 1 }], maxParallel: 1 });`;
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
    cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'],
  });
  let sawReadyWhileRunning = false;
  let output = '';
  child.stdout.on('data', chunk => {
    output += String(chunk);
    if (output.includes('ready') && !output.includes('done') && child.exitCode === null) { sawReadyWhileRunning = true; }
  });
  const exitCode = await new Promise<number | null>(resolve => child.once('close', resolve));
  assert.equal(exitCode, 0);
  assert.equal(sawReadyWhileRunning, true);
  assert.match(output, /done/);
});

for (const scenario of ['fresh', 'reuse', 'build-failure']) {
test('repository active verifier real shell ' + scenario + ' contract (TASK-2715)', async () => {
  const reuse = scenario === 'reuse';
  const { initCommittedRepository } = await import('../../fixtures/git-repository.js');
  const { spawnSync } = await import('node:child_process');
  const repoRoot = path.resolve(import.meta.dirname, '../../..');
  const checkout = fs.mkdtempSync(path.join(os.tmpdir(), 'px-active-verifier-'));
  try {
    const repo = initCommittedRepository(checkout, {
      '.gitignore': 'node_modules\n',
      'bin/npm': '#!/bin/sh\nif [ "$FAIL_BUILD" = 1 ]; then exit 7; fi\nif [ "$1" = test ]; then\n  test "$PARALLIX_TEST_COVERAGE" = 0 && test -z "$NODE_V8_COVERAGE" && test -z "$NODE_OPTIONS" || exit 8\n  printf "uncovered\\n" >> .git/unit-count\nfi\n',
      'package.json': '{"type":"module","version":"1.0.0"}',
      'scripts/verify-local.sh': fs.readFileSync(path.join(repoRoot, 'scripts/verify-local.sh'), 'utf8'),
    });
    fs.chmodSync(path.join(checkout, 'bin/npm'), 0o755);
    fs.symlinkSync(process.execPath, path.join(checkout, 'bin/node'));
    fs.symlinkSync(path.join(repoRoot, 'scripts/verify-active-units.ts'), path.join(checkout, 'scripts/verify-active-units.ts'));
    repo.git('add', '.'); repo.git('commit', '-m', 'verifier');
    fs.symlinkSync(path.join(repoRoot, 'node_modules'), path.join(checkout, 'node_modules'));
    const home = path.join(checkout, '.git', 'home');
    const previousHome = process.env.PARALLIX_HOME;
    const previousPath = process.env.PATH;
    if (reuse) {
      try {
        process.env.PARALLIX_HOME = home;
        process.env.PATH = path.join(checkout, 'bin') + ':' + previousPath;
        assert.equal(verifyActiveUnits({ root: checkout, log: () => {}, runUnits: () => {
          fs.writeFileSync(path.join(checkout, '.git/unit-count'), 'uncovered\n');
          return 0;
        } }), 0);
      } finally {
        if (previousHome === undefined) delete process.env.PARALLIX_HOME;
        else process.env.PARALLIX_HOME = previousHome;
        process.env.PATH = previousPath;
      }
    }
    {
      const result = spawnSync('sh', ['scripts/verify-local.sh', 'all'], { cwd: checkout, encoding: 'utf8', timeout: 5000,
        env: { ...process.env, PATH: `${path.join(checkout, 'bin')}:${process.env.PATH}`, PARALLIX_EXECUTION_ROOT: checkout, PARALLIX_HOME: path.join(checkout, '.git', 'home'),
          FAIL_BUILD: scenario === 'build-failure' ? '1' : '0', PARALLIX_TEST_COVERAGE: 'true', NODE_V8_COVERAGE: path.join(checkout, '.git', 'raw') } });
      if (scenario === 'build-failure') {
        assert.notEqual(result.status, 0, 'a build failure must not be masked by successful or cached units');
        assert.equal(fs.existsSync(path.join(checkout, '.git/unit-count')), false);
        return;
      }
      assert.equal(result.status, 0, result.stdout + result.stderr);
      if (reuse) { assert.match(result.stdout, /reused successful uncovered proof/); }
    }
    assert.equal(fs.readFileSync(path.join(checkout, '.git/unit-count'), 'utf8'), 'uncovered\n');
    assert.equal(fs.existsSync(path.join(checkout, 'coverage')), false);
    assert.equal(fs.existsSync(path.join(checkout, '.git/raw')), false);
  } finally { fs.rmSync(checkout, { recursive: true, force: true }); }
});

}

// The integration gate phase is the authority for its own execution: the board
// reads the executor's run record, never a workflow phase guess (TASK-2775).
const GATE_BOARD_MISSION: Mission = {
  id: missionId('task-2775-gate'), repositoryId: repositoryId('task-2775-repository'), title: 'Gate board', labels: [],
  assignee: null, checkpoints: [], review: null, netEngineeringLines: null, status: 'integration', closedAt: null,
  declaredGates: ['./scripts/verify-local.sh all'],
};
const GATE_BOARD_ATTEMPT: WorkflowOperation = {
  id: 'op-7', repositoryId: repositoryId('task-2775-repository'), missionId: missionId('task-2775-gate'), requestKey: 'integrate-1',
  command: 'integrate:merge', generation: 1, phase: 'checking', providerStarted: true, agent: null, reviewer: null,
  originalStatus: 'review', previousAssignee: null, owner: { pid: 1, identity: 'p' },
  createdAt: '2026-10-18T08:00:00.000Z', updatedAt: '2026-10-18T08:00:00.000Z', reason: null,
};

function gateBoardCheckout(commands: readonly string[]): string {
  const checkout = fs.mkdtempSync(path.join(os.tmpdir(), 'px-gates-board-'));
  initCommittedRepository(checkout, {
    'workflow.config.json': JSON.stringify({ adapters: { gates: { preIntegration:
      commands.map((command, index) => ({ key: index === 0 ? 'unit' : `gate-${index}`, command, order: index + 1 })) } } }),
  });
  return checkout;
}

function gateBoardObserver(checkout: string): { observer: VerificationGateObserver; configuration: ParallixConfiguration } {
  const base = resolveConfiguration({ ...process.env, PARALLIX_HOME: path.join(checkout, '.git', 'home') });
  const configuration = { ...base, runtime: { ...base.runtime, workflowOperation: GATE_BOARD_ATTEMPT.id, workflowGeneration: GATE_BOARD_ATTEMPT.generation } };
  return { configuration, observer: new VerificationGateObserver(new VerificationGateEvidenceReader({
    configuration, resolveWorktree: () => checkout, integrationValidation: async () => null,
  })) };
}

test('the integration gate executor is observable on the board from start to result (TASK-2775)', async () => {
  const checkout = gateBoardCheckout(['touch .git/started; for i in $(seq 1 75); do [ -f .git/go ] && break; sleep 0.02; done; printf ok']);
  let running: ReturnType<typeof runPhaseGates> | undefined;
  try {
    const { configuration, observer } = gateBoardObserver(checkout);
    const evidence = () => createIntegrationVerificationEvidencePort(configuration);
    assert.equal(await observer.observeGate(GATE_BOARD_MISSION, GATE_BOARD_ATTEMPT), 'not-run', 'before the gate phase runs');
    running = runPhaseGates('integration', { slug: 'task-2775', checkoutPath: checkout, log: () => {}, error: () => {},
      configuration, verificationEvidence: evidence() });
    for (let waited = 0; waited < 2000 && !fs.existsSync(path.join(checkout, '.git/started')); waited += 20) { await delay(20); }
    assert.equal(await observer.observeGate(GATE_BOARD_MISSION, GATE_BOARD_ATTEMPT), 'running', 'the executor records the run it started');
    assert.equal(await observer.observeGate(GATE_BOARD_MISSION, { ...GATE_BOARD_ATTEMPT, generation: 2 }), 'not-run', 'a later attempt does not inherit the run');
    fs.writeFileSync(path.join(checkout, '.git/go'), '');
    assert.equal((await running).ok, true);
    assert.equal(await observer.observeGate(GATE_BOARD_MISSION, GATE_BOARD_ATTEMPT), 'passed', 'the settled run is the board result');
  } finally { fs.writeFileSync(path.join(checkout, '.git/go'), ''); await running; fs.rmSync(checkout, { recursive: true, force: true }); }
});

test('a failing integration gate settles the board run instead of leaving it running (TASK-2775)', async () => {
  const checkout = gateBoardCheckout(['printf ok', 'printf defect >&2; exit 7']);
  try {
    const { configuration, observer } = gateBoardObserver(checkout);
    const result = await runPhaseGates('integration', { slug: 'task-2775', checkoutPath: checkout, log: () => {}, error: () => {},
      configuration, verificationEvidence: createIntegrationVerificationEvidencePort(configuration) });
    assert.equal(result.ok, false);
    assert.equal(await observer.observeGate(GATE_BOARD_MISSION, GATE_BOARD_ATTEMPT), 'failed');
  } finally { fs.rmSync(checkout, { recursive: true, force: true }); }
});


test('cancelled and interrupted integration attempts cannot inherit a prior pass (TASK-2775)', async () => {
  const checkout = gateBoardCheckout(['true']);
  try {
    const { configuration, observer } = gateBoardObserver(checkout);
    const port = createIntegrationVerificationEvidencePort(configuration);
    const gates = [{ key: 'unit', command: 'true' }];
    const passed = port.start(checkout, gates)!;
    passed.complete([{ ...gates[0], exitCode: 0 }], 'passed');
    assert.equal(await observer.observeGate(GATE_BOARD_MISSION, GATE_BOARD_ATTEMPT), 'passed');
    const retry = port.start(checkout, gates)!;
    assert.equal(await observer.observeGate(GATE_BOARD_MISSION, GATE_BOARD_ATTEMPT), 'running');
    assert.equal(await observer.observeGate(GATE_BOARD_MISSION, { ...GATE_BOARD_ATTEMPT, phase: 'interrupted' }), 'not-run');
    retry.complete([{ ...gates[0], exitCode: null }], 'cancelled');
    assert.equal(await observer.observeGate(GATE_BOARD_MISSION, GATE_BOARD_ATTEMPT), 'failed');
    const repair = port.start(checkout, gates)!;
    repair.complete([{ ...gates[0], exitCode: 0 }], 'passed');
    assert.equal(await observer.observeGate(GATE_BOARD_MISSION, GATE_BOARD_ATTEMPT), 'passed');
    const { spawnSync } = await import('node:child_process');
    assert.equal(spawnSync('git', ['-C', checkout, 'checkout', '-b', 'mission/other'], { encoding: 'utf8' }).status, 0);
    assert.equal(await observer.observeGate(GATE_BOARD_MISSION, GATE_BOARD_ATTEMPT), 'stale', 'another mission branch cannot inherit the result');
    assert.equal(spawnSync('git', ['-C', checkout, 'checkout', 'main'], { encoding: 'utf8' }).status, 0);
    fs.writeFileSync(path.join(checkout, 'changed'), 'new input');
    assert.equal(await observer.observeGate(GATE_BOARD_MISSION, GATE_BOARD_ATTEMPT), 'stale');
  } finally { fs.rmSync(checkout, { recursive: true, force: true }); }
});
