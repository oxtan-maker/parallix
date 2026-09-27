// @ts-nocheck -- repository-configured lifecycle gates (TASK-2457).
//
// Proves the two invariants the mission is built on:
//   1. An unconfigured fixture repository invokes no lifecycle gate.
//   2. A configured pre-handoff gate that exits non-zero blocks handoff.
//
// Red on the parent commit (the gate surface does not exist yet); green once
// the implementation lands. Hermetic: the command runner is injected, so no
// real process, Git, or worktree boundary is crossed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  type GateCommandRunner,
  buildGateEnv,
  loadPhaseGates,
  loadPhaseGateParallelism,
  loadRequirePreIntegration,
  runPhaseGates,
  validateRepositoryGates,
} from '../src/adapters/config/repository-gates.js';
import { loadEffectiveConfig, validateWorkflowConfig } from '../src/adapters/config/product-config.js';

/** Create a throwaway checkout directory that exists on disk. */
function makeCheckout(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'px-gates-'));
  fs.writeFileSync(path.join(dir, 'README.md'), '# fixture repo\n');
  return dir;
}

function makeCommittedCheckout(): string {
  const checkout = makeCheckout();
  const git = (args: string[]) => {
    const result = spawnSync('git', ['-C', checkout, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  };
  git(['init']); git(['checkout', '-b', 'main']);
  git(['config', 'user.name', 'Test User']); git(['config', 'user.email', 'test@example.com']);
  git(['add', 'README.md']); git(['commit', '-m', 'init']);
  return checkout;
}

test('clean-tree gates reuse only an exact successful proof and never cache failures', { concurrency: false }, async () => {
  const checkout = makeCommittedCheckout();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'px-proof-home-'));
  const previousHome = process.env.PARALLIX_HOME;
  process.env.PARALLIX_HOME = home;
  try {
    let runs = 0;
    const gate = [{ key: 'verify', command: 'true', order: 0, reuse: 'clean-tree' as const }];
    const runner = () => ({ status: ++runs === 2 ? 1 : 0, stdout: '', stderr: '' });
    assert.equal((await runPhaseGates('integration', { slug: 'task-1', checkoutPath: checkout, gates: gate, commandRunner: runner, log: () => {}, error: () => {} })).ok, true);
    assert.equal((await runPhaseGates('integration', { slug: 'task-1', checkoutPath: checkout, gates: gate, commandRunner: runner, log: () => {}, error: () => {} })).executed, 1, 'an exact proof skips the runner but remains a completed gate');
    assert.equal(runs, 1, 'the second exact invocation reuses the pass');
    fs.writeFileSync(path.join(checkout, 'next.txt'), 'next\n');
    assert.equal(spawnSync('git', ['-C', checkout, 'add', 'next.txt']).status, 0);
    assert.equal(spawnSync('git', ['-C', checkout, 'commit', '-m', 'next']).status, 0);
    assert.equal((await runPhaseGates('integration', { slug: 'task-1', checkoutPath: checkout, gates: gate, commandRunner: runner, log: () => {}, error: () => {} })).ok, false, 'a failed clean-tree gate must not create a reusable proof');
    assert.equal((await runPhaseGates('integration', { slug: 'task-1', checkoutPath: checkout, gates: gate, commandRunner: runner, log: () => {}, error: () => {} })).ok, true);
    assert.equal(runs, 3, 'the failed run was not cached and the next invocation executes');
    fs.writeFileSync(path.join(checkout, 'README.md'), 'dirty\n');
    assert.equal((await runPhaseGates('integration', { slug: 'task-1', checkoutPath: checkout, gates: gate, commandRunner: runner, log: () => {}, error: () => {} })).ok, true);
    assert.equal(runs, 4, 'dirty input executes and cannot reuse');
  } finally {
    if (previousHome === undefined) { delete process.env.PARALLIX_HOME; } else { process.env.PARALLIX_HOME = previousHome; }
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(checkout, { recursive: true, force: true });
  }
});

test('unconfigured repository runs no gate for the handoff phase', async () => {
  const checkout = makeCheckout();
  try {
    let launched = 0;
    const runner = () => {
      launched++;
      return { status: 0, stdout: '', stderr: '' };
    };

    const result = await runPhaseGates('handoff', {
      slug: 'task-2457',
      checkoutPath: checkout,
      gates: [], // explicitly unconfigured
      commandRunner: runner,
    });

    assert.equal(result.ok, true);
    assert.equal(result.skipped, true);
    assert.equal(result.executed, 0);
    assert.equal(result.failedGate, null);
    assert.equal(launched, 0, 'command runner must never fire for an unconfigured phase');
  } finally {
    fs.rmSync(checkout, { recursive: true, force: true });
  }
});

test('configured failing pre-handoff gate blocks handoff and receives the phase contract', async () => {
  const checkout = makeCheckout();
  try {
    let capturedEnv: NodeJS.ProcessEnv | null = null;
    let capturedCwd: string | null = null;
    const runner = (_command, _args, options) => {
      capturedEnv = options.env;
      capturedCwd = options.cwd;
      return { status: 1, stdout: 'nope', stderr: 'gate did not pass' };
    };

    const gates = [{ key: 'smoke', command: 'false', order: 0 }];
    const result = await runPhaseGates('handoff', {
      slug: 'task-2457',
      checkoutPath: checkout,
      gates,
      commandRunner: runner,
    });

    assert.equal(result.ok, false, 'a non-zero gate must block the phase');
    assert.equal(result.executed, 1);
    assert.equal(result.failedGate?.key, 'smoke');
    assert.equal(result.failedGate?.exitCode, 1);

    // Environment contract: mission slug, checkout path, and exact phase.
    assert.ok(capturedEnv, 'gate must run with an environment');
    assert.equal(capturedEnv?.PARALLIX_MISSION_SLUG, 'task-2457');
    assert.equal(capturedEnv?.PARALLIX_PHASE, 'handoff');
    assert.equal(capturedEnv?.PARALLIX_CHECKOUT_PATH, path.resolve(checkout));
    // The gate runs from the supplied checkout.
    assert.equal(capturedCwd, path.resolve(checkout));
  } finally {
    fs.rmSync(checkout, { recursive: true, force: true });
  }
});

// Every phase runs its configured gates from the checkout with the same
// environment contract, and a passing gate permits the phase. This exercises
// the execution path for all three phases hermetically (runner injected).
for (const phase of ['handoff', 'review', 'integration'] as const) {
  test(`configured passing gate for ${phase} executes once and receives the phase contract`, async () => {
    const checkout = makeCheckout();
    try {
      let launched = 0;
      let capturedEnv: NodeJS.ProcessEnv | null = null;
      const runner = (_command, _args, options) => {
        launched++;
        capturedEnv = options.env;
        return { status: 0, stdout: 'ok', stderr: '' };
      };

      const gates = [{ key: `${phase}-gate`, command: 'true', order: 0 }];
      const result = await runPhaseGates(phase, {
        slug: 'task-2457',
        checkoutPath: checkout,
        gates,
        commandRunner: runner,
      });

      assert.equal(result.ok, true, `${phase} gate must pass`);
      assert.equal(result.executed, 1, `${phase} must execute exactly one gate`);
      assert.equal(result.skipped, false);
      assert.equal(result.failedGate, null);
      assert.equal(launched, 1);
      assert.equal(capturedEnv?.PARALLIX_PHASE, phase);
      assert.equal(capturedEnv?.PARALLIX_MISSION_SLUG, 'task-2457');
      assert.equal(capturedEnv?.PARALLIX_CHECKOUT_PATH, path.resolve(checkout));
    } finally {
      fs.rmSync(checkout, { recursive: true, force: true });
    }
  });
}

// A configured gate that exits non-zero blocks the review and integration
// phases too, not just handoff — each phase's guard owns its boundary.
for (const phase of ['review', 'integration'] as const) {
  test(`configured failing ${phase} gate blocks the phase`, async () => {
    const checkout = makeCheckout();
    try {
      const runner = () => ({ status: 1, stdout: '', stderr: 'boom' });
      const gates = [{ key: `${phase}-smoke`, command: 'false', order: 0 }];
      const result = await runPhaseGates(phase, {
        slug: 'task-2457',
        checkoutPath: checkout,
        gates,
        commandRunner: runner,
      });

      assert.equal(result.ok, false, `a non-zero ${phase} gate must block`);
      assert.equal(result.executed, 1);
      assert.equal(result.failedGate?.key, `${phase}-smoke`);
      assert.equal(result.failedGate?.exitCode, 1);
    } finally {
      fs.rmSync(checkout, { recursive: true, force: true });
    }
  });
}

// TASK-2457 CP4: the runner executes and blocks for every phase, not just
// handoff. This parametrised test exercises the execution and failure paths
// for pre-handoff, pre-review, and pre-integration at the runner level.
for (const phase of ['handoff', 'review', 'integration'] as const) {
  test(`configured failing ${phase} gate blocks and receives the phase contract`, async () => {
    const checkout = makeCheckout();
    try {
      let launched = 0;
      let capturedEnv: NodeJS.ProcessEnv | null = null;
      const runner = (_command, _args, options) => {
        launched++;
        capturedEnv = options.env;
        return { status: 1, stdout: '', stderr: 'boom' };
      };

      const gates = [{ key: `${phase}-smoke`, command: 'false', order: 0 }];
      const result = await runPhaseGates(phase, {
        slug: 'task-2457',
        checkoutPath: checkout,
        gates,
        commandRunner: runner,
      });

      assert.equal(result.ok, false, `a non-zero ${phase} gate must block`);
      assert.equal(result.executed, 1);
      assert.equal(result.failedGate?.key, `${phase}-smoke`);
      assert.equal(launched, 1);
      assert.equal(capturedEnv?.PARALLIX_PHASE, phase);
      assert.equal(capturedEnv?.PARALLIX_MISSION_SLUG, 'task-2457');
      assert.equal(capturedEnv?.PARALLIX_CHECKOUT_PATH, path.resolve(checkout));
    } finally {
      fs.rmSync(checkout, { recursive: true, force: true });
    }
  });

  test(`configured passing ${phase} gate executes once and permits the phase`, async () => {
    const checkout = makeCheckout();
    try {
      let launched = 0;
      const runner = () => { launched++; return { status: 0, stdout: 'ok', stderr: '' };
      };

      const gates = [{ key: `${phase}-ok`, command: 'true', order: 0 }];
      const result = await runPhaseGates(phase, {
        slug: 'task-2457',
        checkoutPath: checkout,
        gates,
        commandRunner: runner,
      });

      assert.equal(result.ok, true, `a passing ${phase} gate must permit the phase`);
      assert.equal(result.executed, 1);
      assert.equal(result.skipped, false);
      assert.equal(result.failedGate, null);
      assert.equal(launched, 1);
    } finally {
      fs.rmSync(checkout, { recursive: true, force: true });
    }
  });
}

test('buildGateEnv inherits the invoking environment and sets the three contract keys', () => {
  const env = buildGateEnv('integration', 'task-9', '/tmp/checkout', { PATH: '/usr/bin', CUSTOM: 'x' });
  assert.equal(env.PATH, '/usr/bin');
  assert.equal(env.CUSTOM, 'x');
  assert.equal(env.PARALLIX_MISSION_SLUG, 'task-9');
  assert.equal(env.PARALLIX_PHASE, 'integration');
  assert.equal(env.PARALLIX_CHECKOUT_PATH, '/tmp/checkout');
});

test('loadPhaseGates returns [] when the workflow config declares no gates', () => {
  const checkout = makeCheckout();
  try {
    assert.deepEqual(loadPhaseGates(checkout, 'preHandoff'), []);
  } finally {
    fs.rmSync(checkout, { recursive: true, force: true });
  }
});

// task-2457 F11: the mandatory-gate invariant is repository-configured, not
// hardcoded product policy. Default off so an unconfigured repository completes
// the integration path with no lifecycle gate; opt-in via requirePreIntegration.
test('loadRequirePreIntegration defaults to false and honours the opt-in flag', () => {
  const unconfigured = makeCheckout();
  try {
    assert.equal(loadRequirePreIntegration(unconfigured), false);
  } finally {
    fs.rmSync(unconfigured, { recursive: true, force: true });
  }

  const optedIn = makeCheckout();
  try {
    fs.writeFileSync(
      path.join(optedIn, 'workflow.config.json'),
      JSON.stringify({ adapters: { gates: { requirePreIntegration: true, preIntegration: [{ key: 'b', command: 'true' }] } } }),
    );
    assert.equal(loadRequirePreIntegration(optedIn), true);
  } finally {
    fs.rmSync(optedIn, { recursive: true, force: true });
  }
});

test('validateRepositoryGates rejects an unknown gates key and a non-boolean requirePreIntegration', () => {
  const issues = validateRepositoryGates({ gates: { preIntegration: [], notAGateKey: {} } });
  assert.ok(issues.some((i) => /notAGateKey is not a recognised key/.test(i)), `expected unknown-key issue, got: ${issues.join('; ')}`);

  const badFlag = validateRepositoryGates({ gates: { requirePreIntegration: 'yes' } });
  assert.ok(badFlag.some((i) => /requirePreIntegration must be a boolean/.test(i)), `expected boolean issue, got: ${badFlag.join('; ')}`);

  const goodFlag = validateRepositoryGates({ gates: { requirePreIntegration: true } });
  assert.deepEqual(goodFlag, []);
});

test('workflow config surfaces configured gates through the effective config', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'px-gcfg-'));
  try {
    fs.writeFileSync(
      path.join(tmp, 'workflow.config.json'),
      JSON.stringify({ adapters: { gates: { preHandoff: [{ key: 'v', command: 'true' }], preIntegration: [{ key: 'b', command: 'npm run build', order: 5 }] } } }),
    );
    const eff = loadEffectiveConfig(tmp);
    assert.deepEqual(eff.adapters.gates.preHandoff, [{ key: 'v', command: 'true' }]);
    assert.deepEqual(eff.adapters.gates.preIntegration, [{ key: 'b', command: 'npm run build', order: 5 }]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('validateWorkflowConfig rejects a malformed gates block', () => {
  const issues = validateWorkflowConfig({ adapters: { gates: { preReview: { not: 'an array' } } } });
  assert.equal(issues.length > 0, true);
  assert.match(issues[0], /preReview.*array/);
});

test('validateRepositoryGates rejects a malformed gates block', () => {
  const issues = validateRepositoryGates({ gates: { preReview: { not: 'an array' } } });
  assert.equal(issues.length > 0, true);
  assert.match(issues[0], /preReview.*array/);

  const clean = validateRepositoryGates({ gates: { preHandoff: [{ key: 'a', command: 'true' }] } });
  assert.deepEqual(clean, []);
});

test('validateRepositoryGates rejects an unknown gate reuse policy', () => {
  const issues = validateRepositoryGates({ gates: { preIntegration: [{ key: 'verify', command: 'true', reuse: 'sometimes' }] } });
  assert.match(issues.join('; '), /reuse must be "never" or "clean-tree"/);
});

test('gate dependencies reject missing keys and cycles', () => {
  for (const gates of [
    [{ key: 'consumer', command: 'true', order: 1, after: ['missing'] }],
    [{ key: 'a', command: 'true', order: 1, after: ['b'] }, { key: 'b', command: 'true', order: 2, after: ['a'] }],
  ]) {
    assert.match(validateRepositoryGates({ gates: { preIntegration: gates } }).join('; '), /must depend on an earlier gate/);
  }
});

test('gate loading rejects an invalid dependency instead of selecting no gates', () => {
  const checkout = makeCheckout();
  try {
    fs.writeFileSync(path.join(checkout, 'workflow.config.json'), JSON.stringify({ adapters: { gates: {
      preIntegration: [{ key: 'consumer', command: 'true', after: ['missing'] }],
    } } }));
    assert.throws(() => loadPhaseGates(checkout, 'preIntegration'), /must depend on an earlier gate/);
  } finally { fs.rmSync(checkout, { recursive: true, force: true }); }
});

// F6 / TASK-2457: prove THIS repository explicitly selects its own gates.
// A later edit that deletes adapters.gates from workflow.config.json must be
// caught here (compounding F1), so the test reads the repo's own config from
// disk rather than a synthetic fixture. The repo integrates itself with px,
// so these gates must stay active while it develops.
// TASK-2519: CodeQL stays a manual scan (`npm run test:codeql`), not an
// automatic integration gate, so the plan is pinned to exactly these keys.
// Coverage produces the report consumed by the mandatory SonarQube gate.
test('this repository exposes the full independent gate width and orders Sonar after fresh coverage', () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const gates = loadPhaseGates(repoRoot, 'preIntegration');
  const keys = gates.map((g) => g.key);
  assert.deepEqual(keys, ['build', 'dependency-audit', 'verification', 'unit', 'integration-ci', 'integration-local', 'coverage-merge', 'workflow', 'agent-smoke', 'quality-gate']);
  assert.equal(loadPhaseGateParallelism(repoRoot, 'preIntegration'), 6);
  assert.deepEqual(gates.map(({ key, command, order }) => ({ key, command, order })), [
    { key: 'build', command: 'npm run build', order: 1 },
    { key: 'dependency-audit', command: 'npm audit --audit-level=high', order: 2 },
    { key: 'verification', command: './scripts/verify-local.sh static-analysis', order: 3 },
    { key: 'unit', command: 'PARALLIX_TEST_COVERAGE=1 npm test -- --unit-test-headroom', order: 4 },
    { key: 'integration-ci', command: 'PARALLIX_TEST_COVERAGE=1 npm run test:integration:ci:prebuilt', order: 5 },
    { key: 'integration-local', command: 'npm run test:integration:local', order: 6 },
    { key: 'coverage-merge', command: 'rm -f coverage/lcov.info && npm run coverage:merge && test -s coverage/lcov.info', order: 7 },
    { key: 'workflow', command: 'node --test --import tsx --import ./test/bootstrap-e2e-parallix-home.ts test/e2e-mission-lifecycle.test.ts', order: 8 },
    { key: 'agent-smoke', command: 'node --import tsx --import ./test/bootstrap-e2e-parallix-home.ts test/e2e-real-agent-smoke.test.ts', order: 9 },
    { key: 'quality-gate', command: 'npm run sonar', order: 10 },
  ]);
  assert.deepEqual(gates.find(g => g.key === 'coverage-merge')?.after, ['unit', 'integration-ci']);
  assert.deepEqual(gates.find(g => g.key === 'quality-gate')?.after, ['coverage-merge']);
  assert.equal(gates.find(g => g.key === 'verification')?.reuse, 'clean-tree');
  assert.ok(gates.filter(g => g.key !== 'verification').every(g => g.reuse === 'never'));
  assert.deepEqual(gates.filter(g => ['unit', 'integration-ci', 'integration-local', 'workflow', 'agent-smoke'].includes(g.key)).map(g => g.after),
    [['build'], ['build'], ['build'], ['build'], ['build']]);
  const runner = fs.readFileSync(path.join(repoRoot, 'test', 'run-default-tests.ts'), 'utf8');
  assert.match(runner, /mkdtempSync\(path\.join\(executionRoot, 'tmp', `coverage-v8-\$\{coverageTier\}-`\)\)/,
    'concurrent coverage producers own distinct tier- and process-specific V8 scratch directories');
  assert.doesNotMatch(runner, /path\.join\(executionRoot, 'tmp', 'coverage-v8'\)/,
    'coverage producers must not share one fixed V8 scratch directory');
  assert.ok(!gates.some((g) => g.command === 'npm run test:codeql'), 'preIntegration must not run CodeQL automatically');
  // The runner executes them from this checkout with the phase contract.
  const env = buildGateEnv('integration', 'task-2457', repoRoot);
  assert.equal(env.PARALLIX_PHASE, 'integration');
  assert.equal(env.PARALLIX_MISSION_SLUG, 'task-2457');
  assert.equal(env.PARALLIX_CHECKOUT_PATH, path.resolve(repoRoot));
  // BASH_ENV is scrubbed so an inherited startup hook cannot alter a gate.
  const withBash = buildGateEnv('integration', 'task-2457', repoRoot, { BASH_ENV: '/etc/profile.d/hook.sh' } as NodeJS.ProcessEnv);
  assert.equal('BASH_ENV' in withBash ? withBash.BASH_ENV : undefined, undefined);
});

test('this repository starts every independent check while Sonar waits for coverage', async () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const gates = loadPhaseGates(repoRoot, 'preIntegration');
  const active = new Set<string>();
  const launched: string[] = [];
  let peak = 0;
  const result = await runPhaseGates('integration', {
    slug: 'task-2558', checkoutPath: repoRoot, gates,
    maxParallel: loadPhaseGateParallelism(repoRoot, 'preIntegration'),
    log: () => {}, error: () => {},
    commandRunner: command => new Promise(resolve => {
      const key = gates.find(gate => gate.command === command)!.key;
      launched.push(key);
      active.add(key);
      peak = Math.max(peak, active.size);
      assert.ok(key !== 'quality-gate' || !active.has('coverage-merge'), 'Sonar starts after coverage merge completes');
      setTimeout(() => { active.delete(key); resolve({ status: 0, stdout: '', stderr: '' }); }, key === 'build' ? 2 : key === 'coverage-merge' ? 5 : 30);
    }),
  });
  assert.equal(result.ok, true);
  assert.equal(peak, 6);
  assert.equal(launched.length, gates.length);
});

test('buildGateEnv scrubs BASH_ENV and threads real-agent selection', () => {
  const env = buildGateEnv('integration', 'task-1', '/tmp/co', { BASH_ENV: '/x', PATH: '/usr/bin' } as NodeJS.ProcessEnv, { realAgent: 'codex', realAgentModel: 'gpt-5.6-luna' });
  assert.equal(env.PATH, '/usr/bin');
  assert.equal('BASH_ENV' in env ? env.BASH_ENV : undefined, undefined);
  assert.equal(env.PARALLIX_REAL_AGENT, 'codex');
  assert.equal(env.PARALLIX_REAL_AGENT_MODEL, 'gpt-5.6-luna');
});

test('dry run resolves the integration plan without executing any gate', async () => {
  const checkout = makeCheckout();
  try {
    let launched = 0;
    const runner = () => { launched++; return { status: 0, stdout: '', stderr: '' };
    };
    const gates = [{ key: 'build', command: 'npm run build', order: 1 }];
    const result = await runPhaseGates('integration', {
      slug: 'task-2457',
      checkoutPath: checkout,
      gates,
      commandRunner: runner,
      dryRun: true,
    });
    assert.equal(result.ok, true);
    assert.equal(result.dryRun, true);
    assert.equal(result.executed, 0, 'dry run must not execute any gate');
    assert.equal(launched, 0);
  } finally {
    fs.rmSync(checkout, { recursive: true, force: true });
  }
});

test('parallel gates overlap within the configured bound', async () => {
  const checkout = makeCheckout();
  try {
    const events: string[] = [];
    let active = 0;
    let peak = 0;
    const runner = async (command: string) => {
      events.push(`start:${command}`);
      peak = Math.max(peak, ++active);
      await Promise.resolve();
      events.push(`end:${command}`);
      active--;
      return { status: 0, stdout: command, stderr: '' };
    };
    const result = await runPhaseGates('integration', {
      slug: 'task-2558', checkoutPath: checkout, maxParallel: 2, commandRunner: runner,
      gates: [{ key: 'a', command: 'a', order: 1 }, { key: 'b', command: 'b', order: 2 }, { key: 'c', command: 'c', order: 3 }],
    });
    assert.equal(result.ok, true);
    assert.equal(peak, 2, 'the scheduler fills, but never exceeds, the parallel bound');
    assert.ok(events.indexOf('start:b') < events.indexOf('end:a'), 'the first two gates overlap');
    assert.ok(events.indexOf('start:c') > events.indexOf('end:a'), 'the third gate waits for capacity');
    assert.equal(active, 0, 'all launched gates finish');
  } finally { fs.rmSync(checkout, { recursive: true, force: true }); }
});

test('a parallel failure reports its key and does not launch queued gates', async () => {
  const checkout = makeCheckout();
  try {
    const launched: string[] = [];
    let peerStopped = false;
    const runner: GateCommandRunner = (command, _args, options) => new Promise(resolve => {
      launched.push(command);
      if (command === 'red') {
        setTimeout(() => resolve({ status: 7, stdout: '', stderr: 'original failure' }), 5);
      } else {
        const fallback = setTimeout(() => resolve({ status: 0, stdout: '', stderr: '' }), 100);
        options.signal?.addEventListener('abort', () => {
          clearTimeout(fallback);
          peerStopped = true;
          resolve({ status: null, stdout: '', stderr: 'stopped' });
        }, { once: true });
      }
    });
    const result = await runPhaseGates('integration', {
      slug: 'task-2558', checkoutPath: checkout, maxParallel: 2, commandRunner: runner,
      gates: [{ key: 'red', command: 'red', order: 1 }, { key: 'slow', command: 'slow', order: 2 }, { key: 'queued', command: 'queued', order: 3 }],
    });
    assert.equal(result.ok, false);
    assert.equal(result.failedGate?.key, 'red');
    assert.equal(peerStopped, true, 'active peers stop on the first failure');
    assert.equal(result.cancelled, false, 'failure remains eligible for rebound');
    assert.match(result.error!, /red.*code 7/);
    assert.deepEqual(launched.sort(), ['red', 'slow'], 'a failed gate prevents queued work from starting');
  } finally { fs.rmSync(checkout, { recursive: true, force: true }); }
});

test('a parallel gate waits for its declared artifact producer', async () => {
  const checkout = makeCheckout();
  try {
    const events: string[] = [];
    const runner = (command: string) => new Promise(resolve => {
      events.push(`start:${command}`);
      setTimeout(() => { events.push(`end:${command}`); resolve({ status: 0, stdout: '', stderr: '' }); }, command === 'build' ? 15 : 1);
    });
    const result = await runPhaseGates('integration', {
      slug: 'task-2558', checkoutPath: checkout, maxParallel: 2, commandRunner: runner,
      gates: [{ key: 'build', command: 'build', order: 1 }, { key: 'tests', command: 'tests', order: 2, after: ['build'] }, { key: 'audit', command: 'audit', order: 3 }],
    });
    assert.equal(result.ok, true);
    assert.ok(events.indexOf('end:build') < events.indexOf('start:tests'), 'consumer starts only after its producer completes');
  } finally { fs.rmSync(checkout, { recursive: true, force: true }); }
});

test('unresolved dependencies fail closed even for injected gates', async () => {
  const checkout = makeCheckout();
  try {
    const gates = [{ key: 'consumer', command: 'true', order: 1, after: ['missing'] }];
    const result = await runPhaseGates('integration', { slug: 'task-2558', checkoutPath: checkout, gates, maxParallel: 2, commandRunner: () => { throw new Error('must not run'); } });
    assert.equal(result.ok, false);
    assert.equal(result.failedGate?.key, 'consumer');
    assert.equal(result.executed, 0);
  } finally { fs.rmSync(checkout, { recursive: true, force: true }); }
});

test('parallel success output stays isolated while results retain each complete log', async () => {
  const checkout = makeCheckout();
  try {
    const output: string[] = [];
    const runner = (command: string) => Promise.resolve({ status: 0, stdout: `${command} stdout`, stderr: `${command} stderr` });
    const result = await runPhaseGates('integration', {
      slug: 'task-2558', checkoutPath: checkout, maxParallel: 2, commandRunner: runner, log: (line: string) => output.push(line),
      gates: [{ key: 'alpha', command: 'alpha', order: 1 }, { key: 'beta', command: 'beta', order: 2 }],
    });
    const rendered = output.join('\n');
    for (const key of ['alpha', 'beta']) {
      assert.match(rendered, new RegExp(`Repository gate \\(integration\\): ${key} started \\([12]\\/2 active\\)`));
      assert.doesNotMatch(rendered, new RegExp(`${key} stdout`));
      assert.equal(result.outcomes?.find(outcome => outcome.key === key)?.stdout, `${key} stdout`);
      assert.equal(result.outcomes?.find(outcome => outcome.key === key)?.stderr, `${key} stderr`);
    }
  } finally { fs.rmSync(checkout, { recursive: true, force: true }); }
});
