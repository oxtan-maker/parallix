import test from 'node:test';
import assert from 'node:assert/strict';

import { blockedForMs, selectAgent, selectableAgents, type AgentSelectionSnapshot } from '../src/domain/agents.js';
import { agentFamily } from '../src/domain/agents.js';
import { PreparedAgentSelection } from '../src/application/services/agent-selection.js';

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
