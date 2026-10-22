import { resolveConfiguration } from '../../../../src/composition/config.js';
const environment: NodeJS.ProcessEnv = { ...process.env };
// review launch fallback contract.
// Related scenarios share imports; each contract keeps its own hooks and mutable fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fakeLauncher } from '../../../lib/agent-mock.js';
import { eligibleAgentsForStep, startAgent } from '../../../../src/adapters/agents/agents.js';
import { setBubblewrapProbeForTest } from '../../../../src/adapters/process/bubblewrap.js';
import { mkdtemp as registeredMkdtemp } from '../../../helpers/temp-dir.js';

// Regression provenance: TASK-1036.

// ---------- TASK-1036: review/act-on-review fallback pool tracks current launchers ----------

test('review requires explicit eligibility instead of a generic launcher fallback (TASK-2788)', () => {
  assert.throws(() => eligibleAgentsForStep('review', { config: { steps: { active: { eligible: ['vibe'] } } } }), /review requires explicit/);
});

test('eligibleAgentsForStep returns all current launchers when act-on-review step is missing from config (TASK-1036)', () => {
  const configWithoutActOnReview = {
    steps: {
      draft: { eligible: ['vibe', 'codex', 'custom'], selection: 'random' },
      active: { eligible: ['codex', 'claude', 'vibe', 'custom'], selection: 'random' }
    }
  } satisfies import("../../../../src/adapters/agents/agent-config.js").AgentConfig;
  const eligible = eligibleAgentsForStep('act-on-review', { config: configWithoutActOnReview });
  assert.ok(eligible.includes('vibe'), 'mistral must be in fallback pool when act-on-review step is absent');
});

test('startAgent review fallback selects configured vibe when claude hits limit (TASK-1036 transcript)', async () => {
  // Current behavior: pinned reviewer=claude, implementer=codex, claude limit-hit,
  // fallback selects vibe from explicit review eligibility.
  const tmpRoot = registeredMkdtemp('task-1036-review-fallback-');
  try {
    const order = ['claude', 'vibe'];
    const selectAgentFn: NonNullable<NonNullable<Parameters<typeof startAgent>[1]>["selectAgentFn"]> = (step, opts = {}) => {
      const exclude = opts.exclude instanceof Set ? opts.exclude : new Set();
      const selected = order.find(a => !exclude.has(a));
      assert.ok(selected, 'a fixture launcher must remain eligible');
      return selected;
    };

    const detectLimitHitFn: NonNullable<NonNullable<Parameters<typeof startAgent>[1]>["detectLimitHitFn"]> = ({ agent } = { agent: '' }) => {
      if (agent === 'claude') return { until: '2026-05-01 18', source: 'parsed', reason: 'fixture usage limit' };
      return null;
    };

    const blocks: { agent: string; until: string; }[] = [];
    const updateAgentBlockFn: NonNullable<NonNullable<Parameters<typeof startAgent>[1]>["updateAgentBlockFn"]> = (agent, until) => {
      blocks.push({ agent, until });
      return { reason: null };
    };

    const previousAgent = environment.WORKFLOW_AGENT;
    delete environment.WORKFLOW_AGENT;

    try {
      // Retain the provider-limit fallback assertions under explicit review policy.
      const configuredReview = {
        steps: {
          review: { eligible: ['claude', 'vibe'], selection: 'random' },
          draft: { eligible: ['vibe', 'codex', 'custom'], selection: 'random' },
          active: { eligible: ['codex', 'claude', 'vibe', 'custom'], selection: 'random' }
        }
      };

      assert.ok(eligibleAgentsForStep('review', { config: configuredReview }).includes('vibe'));
      const result = await startAgent('review', { configuration: resolveConfiguration(environment),
        prompt: 'Execute the mission.',
        worktree: tmpRoot,
        agent: 'claude',
        exclude: ['codex'], // implementer excluded for family separation
        
        detectLimitHitFn,
        updateAgentBlockFn,
        selectAgentFn,
        launchAgentFn: fakeLauncher(),
        assertAgentSupportedFn: () => {},
        isAgentBlockedFn: () => false,
        log: () => {}
      });

      assert.equal(result.agent, 'vibe', 'mistral should be selected as fallback when claude hits limit within configured review eligibility');
      assert.ok(blocks.length <= 1, `expected at most one block write, got ${blocks.length}`);
      if (blocks.length === 1) {
        assert.deepEqual(blocks[0], { agent: 'claude', until: '2026-05-01 18' });
      }
    } finally {
      if (previousAgent !== undefined) environment.WORKFLOW_AGENT = previousAgent;
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('startAgent act-on-review fallback selects vibe when implementer hits limit and act-on-review step is missing (TASK-1036)', async () => {
  const tmpRoot = registeredMkdtemp('task-1036-act-on-review-fallback-');
  try {
    const order = ['custom', 'vibe'];
    const selectAgentFn: NonNullable<NonNullable<Parameters<typeof startAgent>[1]>["selectAgentFn"]> = (step, opts = {}) => {
      const exclude = opts.exclude instanceof Set ? opts.exclude : new Set();
      const selected = order.find(a => !exclude.has(a));
      assert.ok(selected, 'a fixture launcher must remain eligible');
      return selected;
    };

    const detectLimitHitFn: NonNullable<NonNullable<Parameters<typeof startAgent>[1]>["detectLimitHitFn"]> = ({ agent } = { agent: '' }) => {
      if (agent === 'custom') return { until: '2026-05-01 18', source: 'parsed', reason: 'fixture usage limit' };
      return null;
    };

    const blocks: { agent: string; until: string; }[] = [];
    const updateAgentBlockFn: NonNullable<NonNullable<Parameters<typeof startAgent>[1]>["updateAgentBlockFn"]> = (agent, until) => {
      blocks.push({ agent, until });
      return { reason: null };
    };

    const previousAgent = environment.WORKFLOW_AGENT;
    delete environment.WORKFLOW_AGENT;
    // act-on-review is a mutating launch, so the task-2513 confinement gate
    // blocks `custom`/`vibe` on hosts without bwrap (e.g. GitHub runners).
    // Pin the probe so this fallback test does not depend on the host.
    setBubblewrapProbeForTest(() => true);

    try {
      const configWithoutActOnReview = {
        steps: {
          draft: { eligible: ['vibe', 'codex', 'custom'], selection: 'random' },
          active: { eligible: ['codex', 'claude', 'vibe', 'custom'], selection: 'random' }
        }
      };

      const result = await startAgent('act-on-review', { configuration: resolveConfiguration(environment),
        prompt: 'Address review.',
        worktree: tmpRoot,
        agent: 'custom',
        exclude: ['claude'], // reviewer excluded for family separation
        
        detectLimitHitFn,
        updateAgentBlockFn,
        selectAgentFn,
        launchAgentFn: fakeLauncher(),
        assertAgentSupportedFn: () => {},
        isAgentBlockedFn: () => false,
        log: () => {}
      });

      assert.equal(result.agent, 'vibe', 'mistral should be selected as fallback in act-on-review when custom hits limit and step is missing');
      assert.equal(blocks.length, 1);
    } finally {
      setBubblewrapProbeForTest(null);
      if (previousAgent !== undefined) environment.WORKFLOW_AGENT = previousAgent;
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
