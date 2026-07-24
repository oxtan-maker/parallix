import test from 'node:test';
import assert from 'node:assert/strict';

import { LEGACY_INVENTORY_AUTHORITY, MISSION_FIELD_AUTHORITY, missionMutationOwner, OPERATOR_CONCERN_AUTHORITY, reconcileMissionRead } from '../src/application/mission-authority.js';
import { agentFamily } from '../src/domain/agents.js';
import { missionId, missionLabels, type Mission } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';
import { MACHINE_WRITTEN_PATH_INVENTORY } from '../src/platform/runtime/lib/core/durable-state-inventory.js';

const repositoryMission: Mission = {
  id: missionId('task-2294'), repositoryId: repositoryId('parallix'), title: 'authoritative',
  labels: missionLabels(['user_value', 'bug']), status: 'active', rawStatus: 'active', closedAt: null, assignee: agentFamily('codex'),
  checkpoints: [], review: null, netEngineeringLines: 10,
};

test('authority is exhaustive over mission fields and covers the legacy path inventory', () => {
  assert.deepEqual(Object.keys(MISSION_FIELD_AUTHORITY).sort(), Object.keys(repositoryMission).sort());
  assert.equal(missionMutationOwner('status'), 'target-repository');
  assert.equal(OPERATOR_CONCERN_AUTHORITY.agentBlocks.owner, 'operator-local');
  assert.equal(OPERATOR_CONCERN_AUTHORITY.agentSelectionPolicy.owner, 'tool-owned-asset');
  const liveIds = MACHINE_WRITTEN_PATH_INVENTORY.map((entry) => entry.id).sort();
  assert.deepEqual(Object.keys(LEGACY_INVENTORY_AUTHORITY).sort(), liveIds);
});

test('mission reads prefer repository truth and label cache fallback stale', () => {
  const cached = { ...repositoryMission, title: 'cached', status: 'review' as const };
  assert.deepEqual(reconcileMissionRead(repositoryMission, cached), {
    mission: repositoryMission, source: 'target-repository', stale: false,
  });
  assert.deepEqual(reconcileMissionRead(null, cached), {
    mission: cached, source: 'operator-cache', stale: true,
  });
});
