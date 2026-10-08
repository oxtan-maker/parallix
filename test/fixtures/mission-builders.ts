import type { MissionVersion } from '../../src/application/domain-ports.js';
import { agentFamily } from '../../src/domain/agents.js';
import { DuplicateLaneEventError, type LaneTransitionEvent } from '../../src/domain/board-event.js';
import { missionId, missionLabels, type Mission, type MissionId } from '../../src/domain/mission.js';
import { repositoryId } from '../../src/domain/repository.js';
import type { Review } from '../../src/domain/review.js';

/**
 * Typed Mission, review-round and in-memory store builders (TASK-2622.04).
 *
 * Every call returns fresh objects: a builder never hands two test cases the
 * same mutable aggregate or store.
 */

/**
 * A Mission with one evidenced checkpoint and an empty drafted contract.
 * Callers override only the fields their scenario is about (status, review,
 * assignee, brief, ...).
 */
export function fixtureMission(slug: string, overrides: Partial<Mission> = {}): Mission {
  const status = overrides.status ?? 'active';
  return {
    id: missionId(slug),
    repositoryId: repositoryId('parallix'),
    title: `Mission ${slug}`,
    labels: missionLabels([]),
    status,
    rawStatus: status,
    checkpoints: [{
      missionId: missionId(slug),
      name: 'CP-1',
      rawFilename: 'CP-1.md',
      firstLine: 'CP-1',
      goalCheck: [{ criterion: 'criterion', evidence: 'evidence' }],
      nextActionText: 'hand off',
    }],
    brief: null,
    declaredGates: [],
    successCriteria: [],
    dependencies: [],
    predictedNelBucket: null,
    reproductionTest: null,
    assignee: null,
    externalTaskRef: null,
    intakeTrace: null,
    review: null,
    netEngineeringLines: null,
    closedAt: null,
    ...overrides,
  } as unknown as Mission;
}

/**
 * The classified, codex-implemented Mission the `px integrate` command suites
 * drive with injected Git, gate and provider seams.
 */
export function integrateCommandMission(slug: string, status: Mission['status'], review: Review | null = null): Mission {
  return fixtureMission(slug, {
    title: 'fixture', labels: missionLabels(['ai_sdlc']), assignee: agentFamily('codex'), checkpoints: [], status, review,
  });
}

/**
 * A one-round Review that `claude` approved for `codex` on the mission
 * branch: the approval source integrate reads when no provider is reachable.
 */
export function approvedReview(slug: string): Review {
  return {
    rounds: [{
      number: 1,
      subject: {
        change: { kind: 'local-branch', sourceBranch: `mission/${slug}`, targetBranch: 'main' },
        revision: 'fixture-revision',
      },
      reviewer: 'claude', implementer: 'codex', startedAt: '2026-08-04T10:00:00Z',
      decision: { kind: 'approved', decidedAt: '2026-08-04T10:30:00Z', comment: null, source: { kind: 'local' } },
      response: null, phase: 'approved', disposition: 'APPROVED', reviewerRetryCount: 0, implementerRetryCount: 0,
    }],
    intervention: null, stageLaunches: [], reviewEvents: [],
  } as unknown as Review;
}

export interface InMemoryTransitionStore {
  /** Lane events committed through saveWithTransition, in order. */
  readonly events: LaneTransitionEvent[];
  mission(): Mission;
  load(_missionId?: MissionId): Promise<{ kind: 'found'; mission: Mission; version: MissionVersion }>;
  save(_mission: Mission, _expectedVersion?: MissionVersion | null): Promise<MissionVersion>;
  saveWithTransition(_mission: Mission, _expectedVersion: MissionVersion | null, _event: LaneTransitionEvent): Promise<MissionVersion>;
}

/**
 * An in-memory MissionTransitionStore holding one Mission.
 *
 * `persist: true` (default) commits writes, bumps the version and records
 * lane events, refusing a duplicate idempotency key as the SQLite store does.
 * `persist: false` is a fixed snapshot: writes are acknowledged with the
 * unchanged version and leave the Mission as built, for scenarios whose lane
 * must not move under them.
 */
export function inMemoryTransitionStore(
  initial: Mission,
  options: { persist?: boolean; version?: number } = {},
): InMemoryTransitionStore {
  const persist = options.persist ?? true;
  let current = initial;
  let version = options.version ?? 1;
  const events: LaneTransitionEvent[] = [];
  const keys = new Set<string>();
  const commit = (next: Mission) => {
    if (persist) { current = next; version += 1; }
    return version as MissionVersion;
  };
  return {
    events,
    mission: () => current,
    async load() { return { kind: 'found', mission: current, version: version as MissionVersion }; },
    async save(next) { return commit(next); },
    async saveWithTransition(next, _expectedVersion, event) {
      if (persist) {
        if (event.idempotencyKey && keys.has(event.idempotencyKey)) {
          throw new DuplicateLaneEventError(event.idempotencyKey);
        }
        if (event.idempotencyKey) { keys.add(event.idempotencyKey); }
        events.push(event);
      }
      return commit(next);
    },
  };
}
