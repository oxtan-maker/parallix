import { missionId, type MissionId } from '../../src/domain/mission.js';
import { repositoryId } from '../../src/domain/repository.js';
import type { MissionOutcome } from '../../src/domain/usage.js';

/**
 * A completed-mission outcome with every required field populated.
 *
 * `MissionOutcome` carries the cohort dimensions and per-mission totals, so a
 * test that only cares about cycle time should not have to restate them. Pass
 * overrides for the fields the test is actually asserting on.
 */
export function missionOutcome(overrides: Partial<MissionOutcome> = {}): MissionOutcome {
  return {
    missionId: missionId('task-0001') as MissionId,
    repositoryId: repositoryId('parallix'),
    createdAt: '2026-07-22T08:00:00Z',
    closedAt: '2026-07-22T10:00:00Z',
    cycleTimeMinutes: 120,
    reviewFixRounds: 0,
    labels: [],
    implementer: null,
    modelsInvolved: [],
    totalInputAndOutputTokens: null,
    totalCostUsd: null,
    totalToolCalls: null,
    runs: [],
    ...overrides,
  };
}
