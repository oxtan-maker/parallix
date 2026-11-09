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
import { normalizeProviderFailure } from '../../../../src/adapters/process/failure-normalization.js';

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
  // Preferred reviewer=claude, implementer=codex, claude limit-hit; fallback
  // selects vibe from explicit review eligibility.
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

const preferredReviewerFailureCases = [
  ['typed quota', { status: 1, failureReason: { version: 1, code: 'agent-quota', source: 'provider', context: { resetAt: '2026-11-04T08:00:00Z' } } }, true],
  ['provider unavailable', { status: 1, failureReason: { version: 1, code: 'provider-unavailable', source: 'provider' } }, true],
  ['provider entitlement', { status: 1, failureReason: { version: 1, code: 'provider-entitlement', source: 'provider' } }, false],
  ['missing launcher', { status: null, error: Object.assign(new Error('missing launcher'), { code: 'ENOENT' }) }, false],
  ['liveness timeout', { status: null, error: Object.assign(new Error('no output'), { code: 'NO_OUTPUT_TIMEOUT' }) }, false],
  ['unambiguous nonzero exit without artifacts', { status: 2, stdout: '', stderr: 'controlled failure' }, false],
] as const;

for (const [cause, failedResult, writesBlock] of preferredReviewerFailureCases) {
  test(`preferred reviewer falls back after ${cause} (TASK-2837)`, async () => {
    const launched: string[] = [];
    const blocked: string[] = [];
    const result = await startAgent('review', {
      configuration: resolveConfiguration(environment),
      prompt: 'Review',
      agent: 'claude',
      preferredAgent: true,
      exclude: ['codex'],
      isAgentBlockedFn: family => blocked.includes(family),
      assertAgentSupportedFn: () => {},
      resolveAgentModelFn: () => null,
      updateAgentBlockFn: family => { blocked.push(family); return { reason: cause }; },
      selectAgentFn: (_step, options) => {
        const excluded = new Set(options?.exclude);
        assert.equal(blocked.includes('claude'), writesBlock, 'checked provider block is written before reselection only for positive evidence');
        assert.ok(excluded.has('claude'), 'failed preferred family is bounded out of the retry');
        assert.ok(excluded.has('codex'), 'implementer stays excluded');
        return 'vibe';
      },
      launchAgentFn: input => {
        const family = input.env!.FORGEJO_USER!;
        launched.push(family);
        return { invocation: { command: family, args: [] }, result: family === 'claude' ? failedResult : { status: 0, stdout: '', stderr: '' } };
      },
      log: () => {},
    });

    assert.equal(result.agent, 'vibe');
    assert.deepEqual(launched, ['claude', 'vibe']);
    assert.deepEqual(blocked, writesBlock ? ['claude'] : []);
  });
}

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
  test(`normalized Claude limit persists its reason before ${pinned ? 'pinned refusal' : 'eligible review fallback'} (TASK-2838)`, async () => {
    const { detectLimitHit, formatBlockUntil, ceilToNextHour } = await import('../../../../src/application/services/agent-limit.js');
    const { resolveBlockContext } = await import('../../../../src/adapters/agents/agent-block-selection.js');
    const blocks = new Map<string, { until: string; reason?: string }>();
    const launched: string[] = [];
    const claudeStdout = fs.readFileSync(new URL('../../../fixtures/claude-quota-rejected.jsonl', import.meta.url), 'utf8');
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
        return detectLimitHit({ ...input, now: new Date('2026-11-03T18:00:00Z') });
      },
      updateAgentBlockFn: (family: string, until: string, options?: { reason?: string }) => {
        blocks.set(family, { until, reason: options?.reason }); return { reason: options?.reason };
      },
      launchAgentFn: (input: AgentLauncherInput) => {
        const family = input.env!.FORGEJO_USER!;
        launched.push(family);
        return { invocation: { command: family, args: [] }, result: {
          failureReason: family === 'claude' ? normalizeProviderFailure({ status: 1, stdout: claudeStdout }) : undefined,
          status: family === 'claude' ? 1 : 0,
          stdout: family === 'claude' ? claudeStdout : '',
          stderr: '',
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
    assert.match(blocks.get('claude')!.reason!, /^typed: agent-quota/);
    assert.equal(blocks.get('claude')!.until, formatBlockUntil(ceilToNextHour(new Date('2026-11-03T20:50:00.000Z'))));
  });
}

// ---------- px-0051: a saturated custom pool reroutes to another eligible agent instead of waiting ----------

import { tryAcquireCustomCapacity, activeCustomCapacityCount } from '../../../../src/adapters/agents/custom-capacity.js';
import { clearCustomAdmissionStateCache } from '../../../../src/adapters/sqlite/custom-admission-state.js';
import { admitCustomCapacity } from '../../../../src/adapters/agents/agent-launch-preparation.js';
import type { StartAgentLoopDeps } from '../../../../src/adapters/agents/agent-launch-context.js';
import { resolveBlockContext } from '../../../../src/adapters/agents/agent-block-selection.js';

type CapacityFixture = {
  options: StartAgentOptions; launched: string[]; logs: string[]; configuration: ReturnType<typeof resolveConfiguration>;
  holder: { release(): void } | null;
};

/** One custom slot (maxConcurrentCustom 1), optionally held, with a recording launcher and ordered selection. */
async function capacityFixture(t: { after(fn: () => Promise<void> | void): void }, order: string[], eligible: string[], opts: {
  held?: boolean; unlimited?: boolean; exclude?: string[]; blocked?: string[]; failing?: string[]; pinned?: boolean; agent?: string;
} = {}): Promise<CapacityFixture> {
  const root = registeredMkdtemp('px-0051-capacity-');
  fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { agents: opts.unlimited ? {} : { maxConcurrentCustom: 1 } } }));
  const configuration = resolveConfiguration({ ...environment, PARALLIX_CUSTOM_ADMISSION_HOME: root, PARALLIX_CUSTOM_ADMISSION_REPOSITORY: root });
  const holder = opts.held ? await tryAcquireCustomCapacity(root, configuration) : null;
  const fixture: CapacityFixture = { launched: [], logs: [], configuration, holder, options: {} as StartAgentOptions };
  t.after(async () => { fixture.holder?.release(); await clearCustomAdmissionStateCache(); });
  const blocked = new Set(opts.blocked ?? []);
  const failing = new Set(opts.failing ?? []);
  fixture.options = {
    configuration, worktree: root, prompt: 'Work', exclude: opts.exclude ?? [], pinnedAgent: opts.pinned, ...(opts.agent ? { agent: opts.agent } : {}),
    isAgentBlockedFn: family => blocked.has(family), assertAgentSupportedFn: () => {}, resolveAgentModelFn: () => null,
    detectLimitHitFn: () => null, updateAgentBlockFn: () => ({ reason: null }), log: (line: string) => { fixture.logs.push(line); },
    runtimeBlockContextFn: async (_step: string, tried: ReadonlySet<string>) => resolveBlockContext(eligible, tried, blocked),
    selectAgentFn: (_step, selection) => {
      const exclude = selection?.exclude instanceof Set ? selection.exclude : new Set<string>();
      const selected = order.find(family => !exclude.has(family));
      if (!selected) { throw new Error('No eligible agents are available: all eligible agents have been tried or are excluded.'); }
      return selected;
    },
    launchAgentFn: (input: AgentLauncherInput) => {
      const family = input.env!.FORGEJO_USER!;
      fixture.launched.push(family);
      return { invocation: { command: family, args: [] }, result: { status: failing.has(family) ? 1 : 0, stdout: '', stderr: failing.has(family) ? 'controlled failure' : '' } };
    },
  };
  return fixture;
}

for (const step of ['draft', 'active', 'act-on-review']) {
  test(`saturated custom reroutes an unpinned ${step} launch to another eligible agent (px-0051)`, async (t) => {
    const f = await capacityFixture(t, ['custom', 'codex'], ['custom', 'codex'], { held: true });
    const result = await startAgent(step, f.options);
    assert.equal(result.agent, 'codex');
    assert.deepEqual(f.launched, ['codex'], 'custom is never launched');
    assert.ok(f.logs.some(line => /saturated; switching step ".*" to .*codex.* instead of waiting/.test(line)));
    assert.ok(!f.logs.some(line => /waiting for an available slot/.test(line)), 'no capacity wait begins');
  });
}

test('saturated custom review switches to an independent agent and never to the implementer family (px-0051)', async (t) => {
  const f = await capacityFixture(t, ['custom', 'codex', 'vibe'], ['custom', 'codex', 'vibe'], { held: true, exclude: ['codex'] });
  assert.equal((await startAgent('review', f.options)).agent, 'vibe');
  assert.deepEqual(f.launched, ['vibe']);
});

test('free custom capacity launches custom immediately, passes the reservation to the launch and releases it on settle (px-0051)', async (t) => {
  const f = await capacityFixture(t, ['custom', 'codex'], ['custom', 'codex']);
  let heldDuringLaunch = -1;
  f.options.onLaunch = async () => { heldDuringLaunch = await activeCustomCapacityCount(f.configuration); };
  assert.equal((await startAgent('review', f.options)).agent, 'custom');
  assert.deepEqual(f.launched, ['custom']);
  assert.equal(await activeCustomCapacityCount(f.configuration), 0, 'settled launch releases its slot');
  assert.equal(heldDuringLaunch, 1, 'the acquired reservation is held while the launch runs');
  assert.ok(!f.logs.some(line => /saturated/.test(line)));
});

test('unset maxConcurrentCustom launches custom immediately (px-0051)', async (t) => {
  const f = await capacityFixture(t, ['custom', 'codex'], ['custom', 'codex'], { unlimited: true });
  assert.equal((await startAgent('draft', f.options)).agent, 'custom');
  assert.deepEqual(f.launched, ['custom']);
});

// Waiting decisions: the admission pause is a real 1 s timer, so the wait-versus-switch decision is asserted at its owner.
for (const [label, step, order, eligible, exclude] of [
  ['no alternative is eligible', 'draft', ['custom'], ['custom'], []],
  ['the only alternative is the implementer family', 'review', ['custom', 'codex'], ['custom', 'codex'], ['codex']],
  ['pinned custom is saturated', 'active', ['custom', 'codex'], ['custom', 'codex'], []],
  ['a step outside draft, active, act-on-review and review is saturated', 'conflict-resolution', ['custom', 'codex'], ['custom', 'codex'], []],
] as const) {
  test(`saturated custom still waits when ${label} (px-0051)`, async (t) => {
    const pinned = label.startsWith('pinned');
    const f = await capacityFixture(t, [...order], [...eligible], { held: true, exclude: [...exclude], pinned, agent: pinned ? 'custom' : undefined });
    const state = { chosen: 'custom', tried: new Set<string>(exclude), launched: new Set<string>(), agentErrors: new Map(), iteration: 1 };
    const deps = { configuration: f.configuration, step, opts: f.options, pinnedAgent: pinned, worktree: f.options.worktree,
      log: f.options.log!, selectAgentFn: f.options.selectAgentFn!, isAgentBlockedFn: f.options.isAgentBlockedFn!,
      assertAgentSupportedFn: f.options.assertAgentSupportedFn!, runtimeBlockContext: f.options.runtimeBlockContextFn! };
    assert.deepEqual(await admitCustomCapacity(state, deps as unknown as StartAgentLoopDeps), { kind: 'wait' });
    assert.equal(state.chosen, 'custom');
    assert.ok(!state.tried.has('custom') && !state.launched.has('custom'));
    assert.ok(!f.logs.some(line => /switching step/.test(line)), 'no reroute is logged');
  });
}

test('saturated custom review waits when every independent alternative is usage blocked (px-0051)', async (t) => {
  const f = await capacityFixture(t, ['custom', 'claude', 'codex'], ['custom', 'claude', 'codex'], {
    held: true, exclude: ['codex'], blocked: ['claude'],
  });
  const state = { chosen: 'custom', tried: new Set<string>(['codex']), launched: new Set<string>(), agentErrors: new Map(), iteration: 1 };
  const deps = { configuration: f.configuration, step: 'review', opts: f.options, pinnedAgent: false, worktree: f.options.worktree,
    log: f.options.log!, selectAgentFn: f.options.selectAgentFn!, isAgentBlockedFn: f.options.isAgentBlockedFn!, exclude: ['codex'],
    assertAgentSupportedFn: f.options.assertAgentSupportedFn!, runtimeBlockContext: f.options.runtimeBlockContextFn! };
  assert.deepEqual(await admitCustomCapacity(state, deps as unknown as StartAgentLoopDeps), { kind: 'wait' });
  assert.equal(state.chosen, 'custom');
  assert.ok(!f.logs.some(line => /switching step/.test(line)));
});

test('saturated custom returns to waiting when every alternative fails instead of exhausting the pool (px-0051)', async (t) => {
  const f = await capacityFixture(t, ['custom', 'codex'], ['custom', 'codex'], { held: true, failing: ['codex'] });
  const launchAgentFn = f.options.launchAgentFn!;
  // The failing alternative frees the slot, so the returned custom attempt is admitted without a wall-clock wait.
  f.options.launchAgentFn = (input: AgentLauncherInput) => { f.holder?.release(); f.holder = null; return launchAgentFn(input); };
  const result = await startAgent('draft', f.options);
  assert.equal(result.agent, 'custom');
  assert.deepEqual(f.launched, ['codex', 'custom'], 'custom launches after the alternative failed, not pool exhaustion');
  assert.ok(f.logs.some(line => /saturated; switching/.test(line)));
});
