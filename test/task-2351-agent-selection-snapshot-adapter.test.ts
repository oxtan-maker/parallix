import test from 'node:test';
import assert from 'node:assert/strict';

import { agentFamily, selectableAgents } from '../src/domain/agents.js';
import { SqliteAgentSelectionSnapshotAdapter } from '../src/adapters/agents/agent-selection-snapshot.js';

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
