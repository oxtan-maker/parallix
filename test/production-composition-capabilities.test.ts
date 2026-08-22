import test from 'node:test';
import assert from 'node:assert/strict';

import { composeProductionCapabilities } from '../src/composition/production-capabilities.js';
import { repositoryId } from '../src/domain/repository.js';
import { makeExecutePorts } from './fixtures/execute-mission-ports.js';
import { NO_CURRENT_WORK_PORT } from '../src/application/recording/current-work-recorder.js';

const repositories = {
  agentBlocklist: { async findAll() { return []; }, async findByAgent() { return undefined; }, async save() {}, async deleteByAgent() {}, async clear() {} },
  operationalHistory: { async findAll() { return []; }, async findByType() { return []; }, async append() {}, async clear() {} },
  boardLaneEvents: { async findAll() { return []; }, async findByMissionId() { return []; }, async findByRepositoryId() { return []; }, async append() { return true; }, async clear() {} },
  usage: { async findAll() { return []; }, async findWhere() { return []; }, async save() {}, async saveAll() {}, async clear() {} },
};

test('production composition gives CLI and TUI identical board and active capability instances', () => {
  const { ports } = makeExecutePorts();

  const capabilities = composeProductionCapabilities('/fixture-repository', repositoryId('fixture-repository'), repositories, ports, null, NO_CURRENT_WORK_PORT);

  assert.strictEqual(capabilities.boardProjection, capabilities.tui.boardProjection);
  assert.strictEqual(capabilities.missionDetails, capabilities.tui.missionDetails);
  assert.strictEqual(capabilities.executePorts, ports);
});
