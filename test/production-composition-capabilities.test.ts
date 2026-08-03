import test from 'node:test';
import assert from 'node:assert/strict';

import { composeProductionCapabilities } from '../src/composition/production-capabilities.js';
import type { ActivePort } from '../src/application/ports.js';

const repositories = {
  agentBlocklist: { async findAll() { return []; }, async findByAgent() { return undefined; }, async save() {}, async deleteByAgent() {}, async clear() {} },
  operationalHistory: { async findAll() { return []; }, async findByType() { return []; }, async append() {}, async clear() {} },
  boardLaneEvents: { async findAll() { return []; }, async findByMissionId() { return []; }, async append() { return true; }, async clear() {} },
  usage: { async findAll() { return []; }, async findWhere() { return []; }, async save() {}, async saveAll() {}, async clear() {} },
};

test('production composition gives CLI and TUI identical board and active capability instances', () => {
  const activePort: ActivePort = {
    async validateSlug() { return null; },
    async launch() { return { agent: 'codex', evidence: { id: 'test', source: 'task-markdown', detail: 'test' } }; },
    async recordLaunch() { return { id: 'test', source: 'task-markdown', detail: 'test' }; },
    async handoff() {},
  };

  const capabilities = composeProductionCapabilities('/fixture-repository', repositories, activePort);

  assert.strictEqual(capabilities.boardProjection, capabilities.tui.boardProjection);
  assert.strictEqual(capabilities.missionDetails, capabilities.tui.missionDetails);
  assert.strictEqual(capabilities.activePort, activePort);
});
