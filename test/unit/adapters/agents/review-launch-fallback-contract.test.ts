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
import { agentFamily } from '../../../../src/domain/agents.js';
import type { SessionMarkerPort } from '../../../../src/application/domain-ports.js';
import type { AgentLauncherInput } from '../../../../src/adapters/agents/agent-process-types.js';
import type { StartAgentOptions } from '../../../../src/adapters/agents/agent-launch-context.js';

// Regression provenance: TASK-1036.

test('fresh conflict launches preserve the normal session on success and failure (px-0021)', async () => {
  const worktree = registeredMkdtemp('fresh-conflict-session-');
  const calls = { resume: 0, find: 0, save: 0, delete: 0 };
  const marker = { missionId: 'px-0021', role: 'implementer', agent: agentFamily('claude'),
    lastLaunched: '2026-10-01T00:00:00Z', sessionId: 'original-implementation-session' };
  const sessionMarkerPort: SessionMarkerPort = {
    shouldResume: async () => (++calls.resume, true),
    find: async (id, role) => (++calls.find, { ...marker, missionId: id, role }),
    save: async () => { calls.save++; },
    delete: async () => { calls.delete++; },
  };
  const launches: AgentLauncherInput[] = [];
  let status = 0;
  const common = { configuration: resolveConfiguration(environment), worktree, slug: 'px-0021',
    role: 'implementer', agent: 'claude', pinnedAgent: true, prompt: 'current mission and Git context',
    sessionMarkerPort, isAgentBlockedFn: () => false, assertAgentSupportedFn: () => {},
    resolveAgentModelFn: () => null, detectLimitHitFn: () => null, log: () => {},
    launchAgentFn: (input: AgentLauncherInput) => {
      launches.push(input);
      return { invocation: { command: 'claude', args: [], options: {} },
        resultPromise: Promise.resolve({ status, stdout: '', stderr: '', sessionId: 'ephemeral-session' }) };
    },
  };
  setBubblewrapProbeForTest(() => true);
  try {
    for (status of [0, 1, 0]) {
      await startAgent('conflict-resolution', { ...common, sessionPolicy: 'fresh-ephemeral' });
      assert.deepEqual(calls, { resume: 0, find: 0, save: 0, delete: 0 });
    }
    for (const launch of launches) {
      assert.equal(launch.resume, false);
      assert.equal(launch.sessionId, null);
      assert.equal(launch.prompt, common.prompt, 'no prior transcript is injected');
    }
    await startAgent('execute', common);
    assert.equal(launches[3].resume, true);
    assert.equal(launches[3].sessionId, marker.sessionId);
    assert.deepEqual(calls, { resume: 1, find: 1, save: 1, delete: 0 });
  } finally {
    setBubblewrapProbeForTest(null);
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

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

for (const pinned of [false, true]) {
  test(`observed Claude limit persists its reason before ${pinned ? 'pinned refusal' : 'eligible review fallback'} (px-0026)`, async () => {
    const { detectLimitHit } = await import('../../../../src/application/services/agent-limit.js');
    const { resolveBlockContext } = await import('../../../../src/adapters/agents/agent-block-selection.js');
    const blocks = new Map<string, { until: string; reason?: string }>();
    const launched: string[] = [];
    const options: StartAgentOptions = {
      configuration: resolveConfiguration(environment), prompt: 'Review', agent: 'claude', pinnedAgent: pinned,
      isAgentBlockedFn: (family: string) => blocks.has(family),
      assertAgentSupportedFn: () => {}, resolveAgentModelFn: () => null, log: () => {},
      runtimeBlockContextFn: async (_step: string, tried: ReadonlySet<string>) => resolveBlockContext(['claude', 'vibe'], tried, new Set(blocks.keys())),
      selectAgentFn: (_step, opts) => {
        assert.ok(blocks.has('claude'), 'selection follows the checked write');
        assert.ok(new Set(opts?.exclude).has('claude'), 'blocked family cannot be retried');
        return 'vibe';
      },
      detectLimitHitFn: (input) => {
        assert.ok(input, 'launch outcome supplies detector input');
        return detectLimitHit({ ...input, now: new Date('2026-11-02T08:00:00Z') });
      },
      updateAgentBlockFn: (family: string, until: string, options?: { reason?: string }) => {
        blocks.set(family, { until, reason: options?.reason }); return { reason: options?.reason };
      },
      launchAgentFn: (input: AgentLauncherInput) => {
        const family = input.env!.FORGEJO_USER!;
        launched.push(family);
        return { invocation: { command: family, args: [] }, result: {
          status: family === 'claude' ? 1 : 0,
          stderr: family === 'claude' ? 'You’ve hit your 5-hour limit · resets 10:50am (Europe/Stockholm)' : '',
        } };
      },
    };
    if (pinned) {
      await assert.rejects(startAgent('review', options), /Pinned agent.*usage limit hit/);
      assert.deepEqual(launched, ['claude']);
    } else {
      assert.equal((await startAgent('review', options)).agent, 'vibe');
      assert.deepEqual(launched, ['claude', 'vibe']);
    }
    assert.equal(blocks.size, 1);
    assert.match(blocks.get('claude')!.reason!, /^parsed:.*5-hour limit/);
    assert.match(blocks.get('claude')!.until, /^2026-11-02 \d{2}$/);
  });
}
