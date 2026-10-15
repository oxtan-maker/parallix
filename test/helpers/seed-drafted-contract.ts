import assert from 'node:assert/strict';
import type { MissionStore, MissionVersion } from '../../src/application/domain-ports.js';
import type { MissionId } from '../../src/domain/mission.js';
import { MissionBriefService } from '../../src/application/mission-brief-service.js';
import { MissionCheckpointService } from '../../src/application/mission-checkpoint-service.js';

/** Seed the activation contract through its owning application services. */
export async function seedDraftedContract(store: MissionStore, mission: MissionId): Promise<MissionVersion> {
  const briefService = new MissionBriefService(store);
  await briefService.update({
    operationId: 'op-brief', missionId: mission,
    capabilities: new Set(['mission:context']),
    patch: { goal: 'Fixture goal', why: 'Fixture why', scope: 'Fixture scope' },
  });
  await briefService.setGates({
    operationId: 'op-gates', missionId: mission,
    capabilities: new Set(['mission:context']), gates: ['npm test'],
  });
  await briefService.setSuccessCriteria({
    operationId: 'op-criteria', missionId: mission,
    capabilities: new Set(['mission:context']), criteria: ['The fixture mission is done'],
  });
  await briefService.setPredictedNelBucket({
    operationId: 'op-nel', missionId: mission,
    capabilities: new Set(['mission:context']), bucket: 'Small',
  });
  const plan = await new MissionCheckpointService(store).plan({
    operationId: 'op-plan', missionId: mission,
    capabilities: new Set(['mission:context']), name: 'CP-1', description: 'Do the fixture work',
  });
  // Recording the contract advances the Mission, so the caller activates
  // against the version the seeding produced rather than the one before it.
  assert.equal(plan.status, 'completed');
  assert.ok(plan.value, 'the fixture checkpoint plan must return its write version');
  return plan.value.version;
}
