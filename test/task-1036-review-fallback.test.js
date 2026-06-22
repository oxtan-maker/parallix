const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  eligibleAgentsForStep,
  setCommandPathProbe,
  startAgent,
  selectAgent
} = require('../lib/agents/agents');

const { createDummyLauncher } = require('./lib/agent-mock');

function withStubbedMathRandom(value, fn) {
  const previousRandom = Math.random;
  Math.random = () => value;
  const restore = () => {
    Math.random = previousRandom;
  };

  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.finally(restore);
    }
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

function writeAgentConfig(root, config) {
  const configDir = path.join(root, 'workflow', 'config');
  fs.mkdirSync(configDir, { recursive: true });
  const configPath = path.join(configDir, 'agents.json');
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return configPath;
}

function installPathLaunchers(tmpRoot) {
  const launcher = createDummyLauncher(tmpRoot);
  const binDir = path.join(tmpRoot, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  for (const name of ['codex', 'claude', 'opencode', 'vibe']) {
    fs.copyFileSync(launcher, path.join(binDir, name));
    fs.chmodSync(path.join(binDir, name), 0o755);
  }
  process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH}`;
  process.env.CODEX_HOME ||= path.join(tmpRoot, 'codex-home');
  setCommandPathProbe(name => fs.existsSync(path.join(binDir, name)));
}

// ---------- TASK-1036: review/act-on-review fallback pool tracks current launchers ----------

test('eligibleAgentsForStep returns all current launchers when review step is missing from config (TASK-1036)', () => {
  // Without a review step in agents.json, eligibleAgentsForStep falls back to
  // Object.keys(LAUNCHERS), which now reflects the current supported families.
  const configWithoutReview = {
    steps: {
      draft: { eligible: ['mistral', 'codex', 'qwen'], selection: 'random' },
      active: { eligible: ['codex', 'claude', 'mistral', 'qwen'], selection: 'random' }
    }
  };
  const eligible = eligibleAgentsForStep('review', { config: configWithoutReview });
  assert.ok(eligible.includes('mistral'), 'mistral must be in fallback pool when review step is absent');
  assert.ok(eligible.includes('claude'), 'claude must also be present');
  assert.ok(eligible.includes('codex'), 'codex must also be present');
});

test('eligibleAgentsForStep returns all current launchers when act-on-review step is missing from config (TASK-1036)', () => {
  const configWithoutActOnReview = {
    steps: {
      draft: { eligible: ['mistral', 'codex', 'qwen'], selection: 'random' },
      active: { eligible: ['codex', 'claude', 'mistral', 'qwen'], selection: 'random' }
    }
  };
  const eligible = eligibleAgentsForStep('act-on-review', { config: configWithoutActOnReview });
  assert.ok(eligible.includes('mistral'), 'mistral must be in fallback pool when act-on-review step is absent');
});

test('startAgent review fallback selects mistral when claude hits limit and review step is missing (TASK-1036 transcript)', async () => {
  // Current behavior: pinned reviewer=claude, implementer=codex, claude limit-hit,
  // fallback selects mistral because review step has no explicit eligibility config.
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'task-1036-review-fallback-'));
  try {
    const order = ['claude', 'mistral'];
    const selectAgentFn = (step, opts = {}) => {
      const exclude = opts.exclude instanceof Set ? opts.exclude : new Set();
      return order.find(a => !exclude.has(a));
    };

    const detectLimitHitFn = ({ agent }) => {
      if (agent === 'claude') return { until: '2026-05-01 18', source: 'parsed' };
      return null;
    };

    const blocks = [];
    const updateAgentBlockFn = (agent, until) => {
      blocks.push({ agent, until });
      return { path: path.join(tmpRoot, 'agents.local.json') };
    };

    installPathLaunchers(tmpRoot);
    const previousAgent = process.env.WORKFLOW_AGENT;
    delete process.env.WORKFLOW_AGENT;

    try {
      // Config without review step — gemini is in the fallback pool
      const configWithoutReview = {
        steps: {
          draft: { eligible: ['mistral', 'codex', 'qwen'], selection: 'random' },
          active: { eligible: ['codex', 'claude', 'mistral', 'qwen'], selection: 'random' }
        }
      };

      const result = await startAgent('review', {
        prompt: 'Execute the mission.',
        worktree: tmpRoot,
        agent: 'claude',
        exclude: ['codex'], // implementer excluded for family separation
        isAgentBlockedFn: () => false,
        detectLimitHitFn,
        updateAgentBlockFn,
        selectAgentFn,
        isAgentBlockedFn: () => false,
        config: configWithoutReview,
        log: () => {}
      });

      assert.equal(result.agent, 'mistral', 'mistral should be selected as fallback when claude hits limit and review step is missing');
      assert.ok(blocks.length <= 1, `expected at most one block write, got ${blocks.length}`);
      if (blocks.length === 1) {
        assert.deepEqual(blocks[0], { agent: 'claude', until: '2026-05-01 18' });
      }
    } finally {
      if (previousAgent !== undefined) process.env.WORKFLOW_AGENT = previousAgent;
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('startAgent act-on-review fallback selects mistral when implementer hits limit and act-on-review step is missing (TASK-1036)', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'task-1036-act-on-review-fallback-'));
  try {
    const order = ['qwen', 'mistral'];
    const selectAgentFn = (step, opts = {}) => {
      const exclude = opts.exclude instanceof Set ? opts.exclude : new Set();
      return order.find(a => !exclude.has(a));
    };

    const detectLimitHitFn = ({ agent }) => {
      if (agent === 'qwen') return { until: '2026-05-01 18', source: 'parsed' };
      return null;
    };

    const blocks = [];
    const updateAgentBlockFn = (agent, until) => {
      blocks.push({ agent, until });
      return { path: path.join(tmpRoot, 'agents.local.json') };
    };

    installPathLaunchers(tmpRoot);
    const previousAgent = process.env.WORKFLOW_AGENT;
    delete process.env.WORKFLOW_AGENT;

    try {
      const configWithoutActOnReview = {
        steps: {
          draft: { eligible: ['mistral', 'codex', 'qwen'], selection: 'random' },
          active: { eligible: ['codex', 'claude', 'mistral', 'qwen'], selection: 'random' }
        }
      };

      const result = await startAgent('act-on-review', {
        prompt: 'Address review.',
        worktree: tmpRoot,
        agent: 'qwen',
        exclude: ['claude'], // reviewer excluded for family separation
        isAgentBlockedFn: () => false,
        detectLimitHitFn,
        updateAgentBlockFn,
        selectAgentFn,
        isAgentBlockedFn: () => false,
        config: configWithoutActOnReview,
        log: () => {}
      });

      assert.equal(result.agent, 'mistral', 'mistral should be selected as fallback in act-on-review when qwen hits limit and step is missing');
      assert.equal(blocks.length, 1);
    } finally {
      if (previousAgent !== undefined) process.env.WORKFLOW_AGENT = previousAgent;
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
