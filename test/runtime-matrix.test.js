const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  launcherStatus,
  buildAutonomousReviewMatrix,
  formatMatrixSummary,
  runnableDifferentFamilyExists,
} = require('../lib/core/runtime-matrix');

const { selectAgent, setCommandPathProbe } = require('../lib/agents/agents');

// A launcher that exits 0 for any args (including the `--help` health probe used
// by workflowLauncherStatus), so an agent whose bare command resolves to it on
// PATH reads as "supported".
function createDummyLauncher() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-matrix-launcher-'));
  for (const name of ['claude', 'gemini', 'opencode', 'vibe']) {
    const launcher = path.join(dir, name);
    fs.writeFileSync(launcher, `#!${process.execPath}\nprocess.exit(0);\n`);
    fs.chmodSync(launcher, 0o755);
  }
  process.env.PATH = `${dir}${path.delimiter}${process.env.PATH}`;
  setCommandPathProbe(name => fs.existsSync(path.join(dir, name)));

  const launcherPath = path.join(dir, 'dummy-launcher');
  fs.writeFileSync(launcherPath, `#!${process.execPath}\nprocess.exit(0);\n`);
  fs.chmodSync(launcherPath, 0o755);
  return launcherPath;
}

function withPathLaunchers(entries, run) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-matrix-path-'));
  const binDir = path.join(tmpRoot, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  for (const [name, body] of Object.entries(entries)) {
    const file = path.join(binDir, name);
    fs.writeFileSync(file, `#!${process.execPath}\n${body}\n`);
    fs.chmodSync(file, 0o755);
  }

  const previousPath = process.env.PATH;
  process.env.PATH = `${binDir}${path.delimiter}${previousPath}`;
  setCommandPathProbe(name => fs.existsSync(path.join(binDir, name)));
  try {
    return run();
  } finally {
    process.env.PATH = previousPath;
    setCommandPathProbe(null);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

// ---------- launcherStatus delegates to agents.js discovery ----------

test('launcherStatus delegates to the injected workflowLauncherStatus (RESOLVERS-based discovery)', () => {
  const calls = [];
  const status = launcherStatus('codex', {
    workflowLauncherStatusFn: (agent) => {
      calls.push(agent);
      return { agent, supported: true, detail: '/custom/codex --help', health: 'ok' };
    }
  });

  assert.deepEqual(calls, ['codex']);
  assert.equal(status.supported, true);
  assert.equal(status.detail, '/custom/codex --help');
});

test('launcherStatus reports an agent as blocked when its launcher is missing', () => {
  const status = launcherStatus('mistral', {
    workflowLauncherStatusFn: (agent) => ({ agent, supported: false, detail: 'vibe', health: 'missing' })
  });

  assert.equal(status.supported, false);
  assert.equal(status.health, 'missing');
});

test('launcherStatus resolves bare agent names from PATH (SC 4)', () => {
  withPathLaunchers({ vibe: 'process.exit(0);' }, () => {
    const status = launcherStatus('mistral');
    assert.equal(status.agent, 'mistral');
    assert.equal(status.supported, true);
    assert.match(status.detail, /^vibe\b/);
  });
});

// ---------- buildAutonomousReviewMatrix ----------

test('buildAutonomousReviewMatrix derives agents from injected step eligibility and reports launcher support', () => {
  const matrix = buildAutonomousReviewMatrix({
    eligibleAgentsForStepFn: step => step === 'review' ? ['codex', 'claude', 'gemini'] : [],
    workflowLauncherStatusFn: agent => ({ agent, supported: agent !== 'gemini', detail: agent }),
    configPath: '/tmp/agents.json',
    existsSyncFn: () => true
  });

  assert.deepEqual(matrix.agents, ['codex', 'claude', 'gemini']);
  assert.equal(matrix.step, 'review');
  assert.equal(matrix.configPresent, true);
  assert.equal(matrix.launchers.codex.supported, true);
  assert.equal(matrix.launchers.claude.supported, true);
  assert.equal(matrix.launchers.gemini.supported, false);
  // No hardcoded implementer→reviewer routing survives.
  assert.equal(matrix.routes, undefined);
});

test('buildAutonomousReviewMatrix marks config missing when the config file does not exist', () => {
  const matrix = buildAutonomousReviewMatrix({
    eligibleAgentsForStepFn: () => ['codex', 'claude'],
    workflowLauncherStatusFn: agent => ({ agent, supported: true, detail: agent }),
    configPath: '/tmp/missing.json',
    existsSyncFn: () => false
  });

  assert.equal(matrix.configPresent, false);
  assert.equal(matrix.launchers.codex.supported, true);
});

test('buildAutonomousReviewMatrix supports future agent names without a hardcoded list', () => {
  const matrix = buildAutonomousReviewMatrix({
    eligibleAgentsForStepFn: step => step === 'review' ? ['future-agent'] : ['codex'],
    workflowLauncherStatusFn: agent => ({ agent, supported: false, detail: agent }),
    existsSyncFn: () => false
  });

  assert.deepEqual(matrix.agents, ['future-agent']);
  assert.equal(matrix.launchers['future-agent'].agent, 'future-agent');
});

// ---------- formatMatrixSummary ----------

test('formatMatrixSummary renders config and per-agent launcher support without hardcoded routing', () => {
  const lines = formatMatrixSummary({
    step: 'review',
    agents: ['codex', 'claude', 'gemini'],
    configPresent: true,
    configPath: '/tmp/agents.json',
    launchers: {
      codex: { supported: true, detail: '/bin/codex --help', health: 'ok' },
      claude: { supported: false, detail: 'claude', health: 'missing' },
      gemini: { supported: true, detail: 'gemini --help', health: 'ok' }
    }
  });

  assert.ok(lines.some(line => line.includes('Agent eligibility config: present')));
  assert.ok(lines.some(line => line.includes('codex: supported (/bin/codex --help, ok)')));
  assert.ok(lines.some(line => line.includes('claude: blocked (claude, missing)')));
  // The reviewer-routing note must describe runtime, config-driven selection.
  assert.ok(lines.some(line => line.includes('chosen at runtime from the eligible-and-supported pool')));
  // No biased "implementer -> reviewer" routing lines, no fallback rows.
  assert.ok(!lines.some(line => line.includes('->')));
  assert.ok(!lines.some(line => line.toLowerCase().includes('fallback')));
});

// ---------- runnableDifferentFamilyExists ----------

test('runnableDifferentFamilyExists returns true when a non-implementer agent has a supported launcher', () => {
  const result = runnableDifferentFamilyExists('codex', {
    eligibleAgentsForStepFn: () => ['codex', 'claude'],
    workflowLauncherStatusFn: agent => ({ agent, supported: agent === 'claude' })
  });
  assert.equal(result, true);
});

test('runnableDifferentFamilyExists returns false when only the implementer family has a supported launcher', () => {
  const result = runnableDifferentFamilyExists('codex', {
    eligibleAgentsForStepFn: () => ['codex', 'claude'],
    workflowLauncherStatusFn: agent => ({ agent, supported: agent === 'codex' })
  });
  assert.equal(result, false);
});

// ---------- Unbiased reviewer selection (mission Goal / SC) ----------

test('reviewer selection for a codex implementer is unbiased: drawn from remaining agents, no hardcoded claude preference', () => {
  // Point every reviewer candidate at a working launcher so support is uniform
  // and only config + exclusion drive the choice.
  const previousAgent = process.env.WORKFLOW_AGENT;
  delete process.env.WORKFLOW_AGENT;
  withPathLaunchers({
    claude: 'process.exit(0);',
    gemini: 'process.exit(0);',
    opencode: 'process.exit(0);',
    vibe: 'process.exit(0);'
  }, () => {
    const config = {
      steps: {
        review: { eligible: ['codex', 'claude', 'gemini', 'custom', 'mistral'], selection: 'random' }
      }
    };
    const seen = new Set();
    for (let i = 0; i < 40; i++) {
      const reviewer = selectAgent('review', { config, exclude: new Set(['codex']) });
      assert.notEqual(reviewer, 'codex', 'implementer must never be selected as its own reviewer');
      seen.add(reviewer);
    }
    // Unbiased random selection must reach more than one of the remaining agents,
    // and must not be hardwired to claude.
    assert.ok(seen.size > 1, `expected the reviewer to vary across remaining agents, saw: ${[...seen].join(', ')}`);
    assert.ok(seen.has('gemini') || seen.has('custom') || seen.has('mistral'),
      `expected a non-claude reviewer to be selectable, saw: ${[...seen].join(', ')}`);
  });
  if (previousAgent === undefined) delete process.env.WORKFLOW_AGENT;
  else process.env.WORKFLOW_AGENT = previousAgent;
});
