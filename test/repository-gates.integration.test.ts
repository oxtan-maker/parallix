import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { runPhaseGates, runGateCommand } from '../src/adapters/config/repository-gates.js';
import { MAX_GATE_OUTPUT_CHARS } from '../src/adapters/config/gate-dashboard.js';

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
