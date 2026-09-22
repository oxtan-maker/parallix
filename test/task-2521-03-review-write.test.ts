/** TASK-2521.03 — direct review decisions and resolutions stay domain-checked.

 * Exercises the same path the `px mission review` facade takes: the existing
 * Review domain commands (applyReviewerCommand/applyImplementerCommand) plus the
 * lifecycle transition for a decision and a versioned store save for a
 * resolution. No separate review service reimplements that sequence.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { MissionLifecycleService } from '../src/application/mission-lifecycle-service.js';
import { loadForCommand, isLoaded } from '../src/application/mission-command-support.js';
import { missionVersion, type MissionLoadResult, type MissionTransitionStore, type MissionVersion } from '../src/application/domain-ports.js';
import { agentFamily } from '../src/domain/agents.js';
import { applyImplementerCommand, applyReviewerCommand, changeRevision, ConfiguredReviewerEligibility, reviewFindingId, startReview } from '../src/domain/review.js';
import { intakeMission, missionId, type Mission } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';

const ID = missionId('task-2521-03-review-write');
const capabilities = new Set(['mission:transition'] as const);

class Store implements MissionTransitionStore {
  public mission: Mission;
  private version: MissionVersion;
  constructor(mission: Mission, version = missionVersion(1)) { this.mission = mission; this.version = version; }
  async load(): Promise<MissionLoadResult> { return { kind: 'found', mission: this.mission, version: this.version }; }
  async save(mission: Mission, expected: MissionVersion | null): Promise<MissionVersion> {
    if (expected !== this.version) { throw new Error(`expected ${expected}, got ${this.version}`); }
    this.mission = mission;
    this.version = missionVersion(this.version + 1);
    return this.version;
  }
  async saveWithTransition(mission: Mission, expected: MissionVersion | null): Promise<MissionVersion> { return this.save(mission, expected); }
}

async function decide(store: Store, lifecycle: MissionLifecycleService, command: Parameters<typeof applyReviewerCommand>[1], decidedAt: string): Promise<Mission> {
  const review = applyReviewerCommand(store.mission.review!, command);
  const result = await lifecycle.transition({
    operationId: 'decision', missionId: ID, expectedVersion: missionVersion(1),
    capabilities,
    command: command.type === 'approve' ? { type: 'approve', review } : { type: 'request-changes', review },
    actor: 'reviewer', occurredAt: decidedAt,
  });
  if (result.status !== 'completed') { throw new Error(result.error?.message ?? 'decision failed'); }
  return result.value.mission;
}

async function resolve(store: Store, expectedVersion: MissionVersion, command: Parameters<typeof applyImplementerCommand>[1]): Promise<ReturnType<typeof applyImplementerCommand>> {
  const loaded = await loadForCommand(store, { operationId: 'resolution', missionId: ID, capabilities, expectedVersion });
  if (!isLoaded(loaded)) { throw new Error(loaded.error?.message ?? 'resolution failed'); }
  const review = applyImplementerCommand(loaded.mission.review!, command);
  await store.save({ ...loaded.mission, review }, loaded.version);
  return review;
}

test('review decision then resolution is versioned and immediately readable', async () => {
  const reviewer = agentFamily('reviewer');
  const implementer = agentFamily('implementer');
  const eligibility = ConfiguredReviewerEligibility.fromReviewStep({ eligible: [reviewer], strategy: 'random' });
  const review = startReview({ change: { kind: 'local-branch', sourceBranch: 'mission/task-2521-03-review-write', targetBranch: 'main' }, revision: changeRevision('base') }, reviewer, implementer, '2026-09-18T00:00:00Z', eligibility);
  const mission = {
    ...intakeMission({ id: ID, repositoryId: repositoryId('parallix'), title: 'Review write fixture', assignee: implementer }),
    status: 'review', review,
  } as Mission;
  const store = new Store(mission);
  const lifecycle = new MissionLifecycleService(store);

  const decided = await decide(store, lifecycle, {
    type: 'request-changes', decidedAt: '2026-09-18T01:00:00Z', comment: null, findings: [{ id: reviewFindingId('F1'), summary: 'Add direct write coverage', location: null }],
  }, '2026-09-18T01:00:00Z');
  assert.equal(decided.status, 'active');

  const resolved = await resolve(store, missionVersion(2), {
    type: 'submit-resolution', respondedAt: '2026-09-18T02:00:00Z', resultingRevision: changeRevision('fixed'), resolutions: [{ findingId: reviewFindingId('F1'), kind: 'fixed', evidence: 'test/task-2521-03-review-write.test.ts' }],
  });
  assert.equal(resolved.rounds[0].response?.resultingRevision, 'fixed');

  // A stale resolution (expected version 2 but the store is now at 3) fails
  // closed at the version check rather than overwriting the decision.
  await assert.rejects(
    () => resolve(store, missionVersion(2), {
      type: 'submit-resolution', respondedAt: '2026-09-18T03:00:00Z', resultingRevision: changeRevision('ignored'), resolutions: [{ findingId: reviewFindingId('F1'), kind: 'fixed', evidence: 'ignored' }],
    }),
    /expected version 2, found 3/,
  );
});
