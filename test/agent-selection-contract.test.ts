// Agent selection contract: pure selection over a materialized snapshot, the SQLite snapshot
// adapter, selection telemetry, launcher availability probing, and known-family resolution.
//
// Behavior-owned suite (TASK-2622.11). Legacy case names are unchanged; each section keeps its
// historical task provenance.
//   Domain agent selection: no task ID in the legacy file
//   SQLite snapshot adapter / reviewer nomination / selection telemetry: TASK-2351
//   Launcher availability: no task ID in the legacy file
//   Known agent family resolution: no task ID in the legacy file

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { blockedForMs, selectAgent, selectableAgents, type AgentSelectionSnapshot, agentFamily } from '../src/domain/agents.js';
import { PreparedAgentSelection } from '../src/application/services/agent-selection.js';
import { SqliteAgentSelectionSnapshotAdapter } from '../src/adapters/agents/agent-selection-snapshot.js';
import { resolveHandoffReviewAssignment } from '../src/adapters/cli/commands/handoff.js';
import { AGENT_SELECTION_OUTCOMES, recordAgentSelectionOutcome } from '../src/application/services/agent-selection-telemetry.js';
import fs from 'node:fs';
import { createLauncherProbe } from '../src/adapters/agents/launcher-availability.js';
import { ConcreteAgentReadAdapter } from '../src/adapters/backlog/concrete-agent-read-adapter.js';
import type { AgentBlockEntry, AgentBlocklistRepository } from '../src/application/ports/agent-blocklist.js';
import os from 'node:os';
import path from 'node:path';
import { resolveKnownAgentFamilies } from '../src/adapters/agents/known-agent-families.js';
import { mkdtemp as registeredMkdtemp } from './helpers/temp-dir.js';

describe('Domain agent selection', () => {
  const codex = agentFamily('codex');
  const custom = agentFamily('custom');
  const future = agentFamily('future-runner');

  function snapshot(): AgentSelectionSnapshot {
    return {
      capturedAtMs: 1_000,
      defaultPolicy: { eligible: [codex, custom, future], strategy: 'random' },
      steps: {},
      agents: [
        { family: codex, launcherAvailable: true, block: { kind: 'none' } },
        { family: custom, launcherAvailable: false, block: { kind: 'none' } },
        { family: future, launcherAvailable: true, block: { kind: 'until', untilMs: 2_000, reason: 'limit' } },
      ],
    };
  }

  test('selection uses only materialized availability and remains synchronous', () => {
    const eligible = selectableAgents(snapshot(), 'active');
    const chosen = selectAgent(snapshot(), 'active');
    assert.deepEqual(eligible, [codex]);
    assert.equal(chosen, codex);
    assert.equal((chosen as unknown as object) instanceof Promise, false);
  });

  test('preferred family and configured future families are supported', () => {
    const current = snapshot();
    const ready = {
      ...current,
      agents: current.agents.map((candidate) => candidate.family === future
        ? { ...candidate, block: { kind: 'none' as const } }
        : candidate),
    };
    assert.equal(selectAgent(ready, 'active', { preferred: future }), future);
  });

  test('unweighted selection is random rather than biased by eligible order', () => {
    const current = snapshot();
    const ready = {
      ...current,
      agents: current.agents.map((candidate) => candidate.family === future
        ? { ...candidate, block: { kind: 'none' as const } }
        : candidate),
    };
    assert.equal(selectAgent(ready, 'active', { random: () => 0 }), codex);
    assert.equal(selectAgent(ready, 'active', { random: () => 0.99 }), future);
  });

  test('block countdown is a projection of materialized time', () => {
    assert.equal(blockedForMs({ kind: 'until', untilMs: 2_000, reason: null }, 1_250), 750);
    assert.equal(blockedForMs({ kind: 'until', untilMs: 2_000, reason: null }, 2_500), 0);
    assert.equal(blockedForMs({ kind: 'indefinite', reason: null }, 2_500), Infinity);
  });

  test('async port is crossed once while prepared selection stays synchronous', async () => {
    let loads = 0;
    const prepared = await PreparedAgentSelection.prepare({
      async load() {
        loads += 1;
        return snapshot();
      },
    });
    const picks = ['active', 'review', 'draft'].map((step) => prepared.select(step));
    assert.equal(loads, 1);
    assert.deepEqual(picks, [codex, codex, codex]);
    assert.ok(picks.every((pick) => !((pick as unknown as object) instanceof Promise)));
  });
});

describe('SQLite agent selection snapshot adapter (TASK-2351)', () => {
  const families = [agentFamily('codex'), agentFamily('claude')];

  test('SQLite snapshot adapter materializes active blocks, launcher status, and step policy', async () => {
    let reads = 0;
    const adapter = new SqliteAgentSelectionSnapshotAdapter({
      knownAgentFamilies: families,
      blocklistRepo: { async findAll() { reads += 1; return [{ agent: 'codex', blocked: true, until: '2099-01-01 00', reason: 'limit' }]; }, async findByAgent() { return undefined; }, async save() {}, async deleteByAgent() {}, async clear() {} },
      readConfig: () => ({ blocklist: { claude: { blocked: true } }, steps: { review: { eligible: ['codex', 'claude'], selection: 'weighted', weights: { claude: 2 } } } }),
      launcherStatus: (family) => ({ supported: family === 'codex', reason: 'mocked missing launcher' }),
      now: () => 1_000,
    });

    const snapshot = await adapter.load();
    assert.equal(reads, 1);
    assert.equal(snapshot.agents[0].block.kind, 'until');
    assert.equal(snapshot.agents[0].block.reason, 'limit');
    assert.ok(snapshot.agents[0].block.kind !== 'until' || snapshot.agents[0].block.untilMs > snapshot.capturedAtMs);
    assert.equal(snapshot.agents[1].launcherAvailable, false);
    assert.deepEqual(snapshot.steps.review, { eligible: families, strategy: 'weighted', weights: { claude: 2 } });
    assert.deepEqual(selectableAgents(snapshot, 'review'), []);
  });

  test('SQLite snapshot adapter treats expired SQLite block as selectable without reading JSON blocklist', async () => {
    const adapter = new SqliteAgentSelectionSnapshotAdapter({
      knownAgentFamilies: families,
      blocklistRepo: { async findAll() { return [{ agent: 'codex', blocked: true, until: '2000-01-01 00' }]; }, async findByAgent() { return undefined; }, async save() {}, async deleteByAgent() {}, async clear() {} },
      readConfig: () => ({ blocklist: { codex: { blocked: true } }, steps: { review: { eligible: ['codex'] } } }),
      launcherStatus: () => ({ supported: true }),
      now: () => Date.parse('2001-01-01T00:00:00'),
    });

    assert.deepEqual(selectableAgents(await adapter.load(), 'review'), [agentFamily('codex')]);
  });
});

describe('Reviewer nomination with stale JSON blocklist (TASK-2351)', () => {
  test('SQLite-blocked reviewer is not nominated when JSON blocklist is stale (TASK-2351 repro)', async () => {
    const codex = agentFamily('codex');
    const claude = agentFamily('claude');
    const prepared = await PreparedAgentSelection.prepare({
      async load() {
        return {
          capturedAtMs: 1_000,
          defaultPolicy: { eligible: [codex, claude], strategy: 'random' },
          steps: { review: { eligible: [codex, claude], strategy: 'random' } },
          agents: [
            { family: codex, launcherAvailable: true, block: { kind: 'until', untilMs: 2_000, reason: 'usage limit' } },
            { family: claude, launcherAvailable: true, block: { kind: 'none' } },
          ],
        };
      },
    });
    const assignment = resolveHandoffReviewAssignment('vibe', {
      eligibleAgentsForStepFn: () => ['codex', 'claude'],
      preparedSelection: prepared,
    });
    assert.equal(assignment.reviewer, 'claude', 'SQLite-blocked codex must be excluded before nomination');
  });
});

describe('Agent selection telemetry outcomes (TASK-2351)', () => {
  test('selection telemetry records nominated, skipped-blocked, launch-failed, and fallback outcomes', () => {
    const lines: string[] = [];
    for (const outcome of AGENT_SELECTION_OUTCOMES) {
      recordAgentSelectionOutcome((line) => lines.push(line), outcome, { agent: 'codex', step: 'review' });
    }
    assert.deepEqual(lines.map((line) => JSON.parse(line).outcome), ['nominated', 'skipped-blocked', 'launch-failed', 'fallback']);
    assert.ok(lines.every((line) => JSON.parse(line).event === 'agent-selection'));
  });

  test('review flow emits skipped-blocked and launch-failed outcomes from production branches', () => {
    const fallbackSource = fs.readFileSync(new URL('../src/adapters/review/review-agent-fallback.ts', import.meta.url), 'utf8');
    const loopSource = fs.readFileSync(new URL('../src/adapters/review/review-loop.ts', import.meta.url), 'utf8');
    assert.ok(fallbackSource.includes("recordAgentSelectionOutcome(log, 'skipped-blocked'"));
    assert.ok(loopSource.includes("recordAgentSelectionOutcome(log, 'launch-failed'"));
  });
});

describe('Launcher availability', () => {
  // ---------------------------------------------------------------------------
  // The board's launcher probe. `workflowLauncherStatus` spawns per call, so the
  // probe caches; a board that never probes reports every configured family as
  // available even when its CLI is absent.
  // ---------------------------------------------------------------------------

  class EmptyBlocklistRepo implements AgentBlocklistRepository {
    async findAll(): Promise<readonly AgentBlockEntry[]> { return []; }
    async findByAgent(): Promise<AgentBlockEntry | undefined> { return undefined; }
    async save(): Promise<void> { /* no writes in these tests */ }
    async deleteByAgent(): Promise<void> { /* no writes in these tests */ }
    async clear(): Promise<void> { /* no writes in these tests */ }
  }

  test('createLauncherProbe reports a supported launcher as available with no detail', () => {
    const probe = createLauncherProbe({ probe: () => ({ supported: true }) });

    assert.deepEqual(probe(agentFamily('codex')), { available: true, detail: null });
  });

  test('createLauncherProbe reports a missing launcher with a short reason', () => {
    const probe = createLauncherProbe({ probe: () => ({ supported: false, health: 'missing' }) });

    assert.deepEqual(probe(agentFamily('vibe')), { available: false, detail: 'launcher missing' });
  });

  test('createLauncherProbe includes the probe failure reason', () => {
    const probe = createLauncherProbe({
      probe: () => ({ supported: false, health: 'probe-failed', reason: 'exit 1' }),
    });

    assert.deepEqual(probe(agentFamily('claude')), {
      available: false,
      detail: 'launcher probe-failed: exit 1',
    });
  });

  test('createLauncherProbe reports a throwing probe as unavailable instead of propagating', () => {
    const probe = createLauncherProbe({
      probe: () => { throw new Error('Unknown agent: "ghost"'); },
    });

    const result = probe(agentFamily('ghost'));
    assert.equal(result.available, false);
    assert.match(String(result.detail), /launcher probe failed: Unknown agent/);
  });

  test('createLauncherProbe caches per family until the ttl expires', () => {
    let calls = 0;
    let clock = 1_000;
    const probe = createLauncherProbe({
      ttlMs: 500,
      now: () => clock,
      probe: () => { calls += 1; return { supported: true }; },
    });

    probe(agentFamily('codex'));
    probe(agentFamily('codex'));
    assert.equal(calls, 1, 'a cached family must not re-spawn the probe');

    probe(agentFamily('claude'));
    assert.equal(calls, 2, 'the cache is keyed by family');

    clock += 501;
    probe(agentFamily('codex'));
    assert.equal(calls, 3, 'an expired entry must be re-probed');
  });

  test('ConcreteAgentReadAdapter reports a family whose launcher is missing as unavailable', async () => {
    const adapter = new ConcreteAgentReadAdapter({
      rootDir: '/tmp',
      blocklistRepo: new EmptyBlocklistRepo(),
      knownAgentFamilies: [agentFamily('codex'), agentFamily('vibe')],
      launcherAvailable: (family) => family === 'vibe'
        ? { available: false, detail: 'launcher missing' }
        : { available: true, detail: null },
      resolveTaskFile: () => ({ ok: false, matches: [] }),
    });

    const availability = await adapter.loadAgentAvailability();

    const vibe = availability.find((agent) => agent.family === 'vibe');
    assert.equal(vibe?.launcherAvailable, false, 'the probe result must reach the read model');
    assert.equal(vibe?.launcherDetail, 'launcher missing', 'the probe detail must reach the read model');
    assert.equal(vibe?.block.kind, 'none', 'a missing launcher is not a block');

    const codex = availability.find((agent) => agent.family === 'codex');
    assert.equal(codex?.launcherAvailable, true);
    assert.equal(codex?.launcherDetail, null);
  });
});

describe('Known agent family resolution', () => {
  // ---------------------------------------------------------------------------
  // resolveKnownAgentFamilies — family derivation for the board's agent strip.
  // Precedence: explicit `families` array, else the sorted union of
  // `steps.<step>.eligible`. Invalid entries are dropped; a missing or malformed
  // config yields an empty list without throwing.
  // ---------------------------------------------------------------------------

  /** Create a temp root, optionally writing raw config/agents.json contents. */
  function tempRoot(contents?: string): string {
    const root = registeredMkdtemp('agent-config-resolver-');
    if (contents !== undefined) {
      fs.mkdirSync(path.join(root, 'config'), { recursive: true });
      fs.writeFileSync(path.join(root, 'config', 'agents.json'), contents);
    }
    return root;
  }

  function withRoot(contents: string | undefined, assertions: (_root: string) => void): void {
    const root = tempRoot(contents);
    try {
      assertions(root);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  test('resolveKnownAgentFamilies returns the explicit families array when the config declares one', () => {
    withRoot(
      JSON.stringify({
        families: ['vibe', 'claude'],
        steps: { draft: { eligible: ['codex'] } },
      }),
      (root) => {
        assert.deepEqual(
          [...resolveKnownAgentFamilies(root)],
          ['vibe', 'claude'],
          'an explicit families array must take precedence over steps.*.eligible',
        );
      },
    );
  });

  test('resolveKnownAgentFamilies falls back to the sorted union of steps.*.eligible', () => {
    withRoot(
      JSON.stringify({
        steps: {
          draft: { eligible: ['codex', 'custom', 'vibe'], selection: 'random' },
          active: { eligible: ['codex', 'claude', 'custom', 'vibe'], selection: 'random' },
          review: { eligible: ['codex', 'claude'], selection: 'random' },
        },
      }),
      (root) => {
        assert.deepEqual(
          [...resolveKnownAgentFamilies(root)],
          ['claude', 'codex', 'custom', 'vibe'],
          'the fallback must be the de-duplicated, sorted union of every eligible list',
        );
      },
    );
  });

  test('resolveKnownAgentFamilies returns an empty list when config/agents.json is missing', () => {
    withRoot(undefined, (root) => {
      assert.deepEqual([...resolveKnownAgentFamilies(root)], [], 'a missing config must fail soft');
    });
  });

  test('resolveKnownAgentFamilies returns an empty list for non-JSON config contents', () => {
    withRoot('not json at all {', (root) => {
      assert.deepEqual([...resolveKnownAgentFamilies(root)], [], 'unparsable config must fail soft');
    });
  });

  test('resolveKnownAgentFamilies returns an empty list when the config has neither families nor steps', () => {
    withRoot(JSON.stringify({ overrides: { _comment: 'nothing useful here' } }), (root) => {
      assert.deepEqual(
        [...resolveKnownAgentFamilies(root)],
        [],
        'a config without families or steps must fail soft',
      );
    });
  });

  test('resolveKnownAgentFamilies drops entries that fail agentFamily() validation', () => {
    withRoot(
      JSON.stringify({ families: ['claude', 'Claude Opus', '', 'codex', 42, null, '-bad'] }),
      (root) => {
        assert.deepEqual(
          [...resolveKnownAgentFamilies(root)],
          ['claude', 'codex'],
          'invalid family values must be dropped rather than cast to AgentFamily',
        );
      },
    );

    withRoot(
      JSON.stringify({ steps: { draft: { eligible: ['vibe', 'Claude Opus', ''] } } }),
      (root) => {
        assert.deepEqual(
          [...resolveKnownAgentFamilies(root)],
          ['vibe'],
          'invalid eligible values must be dropped from the steps fallback too',
        );
      },
    );
  });

  test('resolveKnownAgentFamilies ignores steps whose eligible field is missing or not an array', () => {
    withRoot(
      JSON.stringify({
        steps: {
          draft: { selection: 'random' },
          active: { eligible: 'codex' },
          review: { eligible: ['codex'] },
        },
      }),
      (root) => {
        assert.deepEqual(
          [...resolveKnownAgentFamilies(root)],
          ['codex'],
          'malformed step entries must not break the union',
        );
      },
    );
  });
});
