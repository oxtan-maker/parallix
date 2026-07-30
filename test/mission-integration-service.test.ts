import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MissionIntegrationService } from '../src/application/mission-integration-service.js';
import { missionVersion, MissionStaleVersion, type MissionStore } from '../src/application/domain-ports.js';
import { agentFamily } from '../src/domain/agents.js';
import { missionId, missionLabels, type Mission } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';

const ID = missionId('task-2322-06-fixture');
const mission: Mission = {
  id: ID, repositoryId: repositoryId('parallix'), title: 'fixture', labels: missionLabels([]),
  assignee: agentFamily('codex'), checkpoints: [], review: null, netEngineeringLines: null,
  status: 'integration', closedAt: null,
};
const capabilities = new Set(['integration:decide', 'closure:record'] as const);

function store(overrides: Partial<MissionStore> = {}): MissionStore {
  return {
    load: async () => ({ kind: 'found', mission, version: missionVersion(3) } as const),
    save: async () => missionVersion(4),
    ...overrides,
  };
}
const fresh = <T>(value: T) => ({ source: 'git' as const, status: 'fresh' as const, value });

describe('MissionIntegrationService', () => {
  it('accepts explicit fresh merge and verification facts before integration persistence', async () => {
    let saved: Mission | null = null;
    const outcome = await new MissionIntegrationService(store({ save: async (next) => { saved = next; return missionVersion(4); } })).decideIntegration({
      operationId: 'integrate', missionId: ID, capabilities, expectedVersion: missionVersion(3),
      facts: { git: fresh({ merged: true }), verification: fresh({ passed: true }) },
    });
    assert.equal(outcome.status, 'completed');
    assert.equal(saved!.status, 'done');
  });

  it('rejects an absent observed verification fact before loading the Mission', async () => {
    let loaded = false;
    const outcome = await new MissionIntegrationService(store({ load: async () => { loaded = true; return { kind: 'found', mission, version: missionVersion(3) }; } })).decideIntegration({
      operationId: 'integrate', missionId: ID, capabilities,
      facts: { git: fresh({ merged: true }), verification: { source: 'git', status: 'unavailable' } },
    });
    assert.equal(outcome.error!.kind, 'validation');
    assert.equal(loaded, false);
  });

  it('returns a conflict when persistence rejects the observed Mission version', async () => {
    const outcome = await new MissionIntegrationService(store({ save: async () => { throw new MissionStaleVersion(ID, missionVersion(3), missionVersion(4)); } })).decideIntegration({
      operationId: 'integrate', missionId: ID, capabilities,
      facts: { git: fresh({ merged: true }), verification: fresh({ passed: true }) },
    });
    assert.equal(outcome.error!.kind, 'conflict');
  });

  it('rejects integration from a Mission outside the integration lane', async () => {
    const outcome = await new MissionIntegrationService(store({
      load: async () => ({ kind: 'found', mission: { ...mission, status: 'active' }, version: missionVersion(3) }),
    })).decideIntegration({
      operationId: 'integrate', missionId: ID, capabilities,
      facts: { git: fresh({ merged: true }), verification: fresh({ passed: true }) },
    });
    assert.equal(outcome.error!.kind, 'validation');
    assert.match(outcome.error!.message, /Cannot integrate while/);
  });

  it('reports a non-stale persistence failure after a valid integration decision', async () => {
    const outcome = await new MissionIntegrationService(store({
      save: async () => { throw new Error('disk unavailable'); },
    })).decideIntegration({
      operationId: 'integrate', missionId: ID, capabilities,
      facts: { git: fresh({ merged: true }), verification: fresh({ passed: true }) },
    });
    assert.equal(outcome.error!.kind, 'execution');
    assert.match(outcome.error!.message, /disk unavailable/);
  });

  it('records closure only from a fresh completed integration observation', async () => {
    const done = { ...mission, status: 'done' as const, closedAt: null };
    const outcome = await new MissionIntegrationService(store({ load: async () => ({ kind: 'found', mission: done, version: missionVersion(3) }) })).close({
      operationId: 'close', missionId: ID, capabilities, closedAt: '2026-07-30T07:00:00Z',
      integration: fresh({ completed: true }),
    });
    assert.equal(outcome.status, 'completed');
    assert.equal(outcome.value!.mission.closedAt, '2026-07-30T07:00:00Z');
  });
});
