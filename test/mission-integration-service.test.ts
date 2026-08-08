import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MissionIntegrationService } from '../src/application/mission-integration-service.js';
import {
  missionVersion,
  MissionStaleVersion,
  type MissionStore,
  type MissionTransitionStore,
} from '../src/application/domain-ports.js';
import type { LaneTransitionEvent } from '../src/domain/board-event.js';
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

/**
 * Integration and closure both commit through `saveWithTransition`
 * (TASK-2347.02), so the fake routes it to whichever `save` a test supplied and
 * collects the lane events the service emitted.
 */
function store(
  overrides: Partial<MissionTransitionStore> = {},
  events: LaneTransitionEvent[] = [],
): MissionTransitionStore {
  const base: MissionStore = {
    load: async () => ({ kind: 'found', mission, version: missionVersion(3) } as const),
    save: async () => missionVersion(4),
    ...overrides,
  };
  return {
    ...base,
    saveWithTransition: overrides.saveWithTransition
      ?? (async (next, expectedVersion, event) => {
        events.push(event);
        return base.save(next, expectedVersion);
      }),
  };
}
const fresh = <T>(value: T) => ({ source: 'git' as const, status: 'fresh' as const, value });

describe('MissionIntegrationService', () => {
  it('accepts explicit fresh merge and verification facts before integration persistence', async () => {
    let saved: Mission | null = null;
    const events: LaneTransitionEvent[] = [];
    const outcome = await new MissionIntegrationService(store({ save: async (next) => { saved = next; return missionVersion(4); } }, events)).decideIntegration({
      operationId: 'integrate', missionId: ID, capabilities, expectedVersion: missionVersion(3),
      occurredAt: '2026-07-30T06:00:00Z',
      facts: { git: fresh({ merged: true }), verification: fresh({ passed: true }) },
    });
    assert.equal(outcome.status, 'completed');
    assert.equal(saved!.status, 'done');
    // The lane event commits with the aggregate: throughput is derived from it.
    assert.deepEqual(events.map((event) => ({ from: event.from, to: event.to, trigger: event.trigger, key: event.idempotencyKey })), [
      { from: 'integration', to: 'done', trigger: 'integrate', key: `${ID}:integrate:2026-07-30T06:00:00Z` },
    ]);
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
    const events: LaneTransitionEvent[] = [];
    const outcome = await new MissionIntegrationService(store({ load: async () => ({ kind: 'found', mission: done, version: missionVersion(3) }) }, events)).close({
      operationId: 'close', missionId: ID, capabilities, closedAt: '2026-07-30T07:00:00Z',
      integration: fresh({ completed: true }),
    });
    assert.equal(outcome.status, 'completed');
    assert.equal(outcome.value!.mission.closedAt, '2026-07-30T07:00:00Z');
    // Closure ends the final lane dwell, so it is its own event at `closedAt`.
    assert.deepEqual(events.map((event) => ({ to: event.to, trigger: event.trigger, occurredAt: event.occurredAt })), [
      { to: 'done', trigger: 'close', occurredAt: '2026-07-30T07:00:00Z' },
    ]);
  });
});
