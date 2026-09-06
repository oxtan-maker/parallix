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
import { fileURLToPath } from 'node:url';
import {
  buildGateEnv,
  loadPhaseGates,
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

// F6 / TASK-2457: prove THIS repository explicitly selects its own gates.
// A later edit that deletes adapters.gates from workflow.config.json must be
// caught here (compounding F1), so the test reads the repo's own config from
// disk rather than a synthetic fixture. The repo integrates itself with px,
// so these gates must stay active while it develops.
test('this repository selects its own build, verification, workflow, and agent-smoke gates', () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const gates = loadPhaseGates(repoRoot, 'preIntegration');
  const keys = gates.map((g) => g.key);
  for (const required of ['build', 'verification', 'workflow', 'agent-smoke']) {
    assert.ok(keys.includes(required), `preIntegration must select the "${required}" gate; found: ${keys.join(', ')}`);
  }
  // The runner executes them from this checkout with the phase contract.
  const env = buildGateEnv('integration', 'task-2457', repoRoot);
  assert.equal(env.PARALLIX_PHASE, 'integration');
  assert.equal(env.PARALLIX_MISSION_SLUG, 'task-2457');
  assert.equal(env.PARALLIX_CHECKOUT_PATH, path.resolve(repoRoot));
  // BASH_ENV is scrubbed so an inherited startup hook cannot alter a gate.
  const withBash = buildGateEnv('integration', 'task-2457', repoRoot, { BASH_ENV: '/etc/profile.d/hook.sh' } as NodeJS.ProcessEnv);
  assert.equal('BASH_ENV' in withBash ? withBash.BASH_ENV : undefined, undefined);
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
