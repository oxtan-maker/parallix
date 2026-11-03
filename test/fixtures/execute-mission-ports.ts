import { mergeFixturePort } from '../helpers/merge-fixture-port.js';
import { fixtureMission } from './mission-builders.js';
import { missionId, missionLabels } from '../../src/domain/mission.js';
import { repositoryId } from '../../src/domain/repository.js';
import { missionVersion } from '../../src/application/domain-ports.js';
import type { ExecuteMissionPorts } from '../../src/application/ports/execute-mission.js';

/**
 * In-memory execute-workflow mechanism ports (TASK-2332.04).
 *
 * Shared by the board controller and progress-event suites so both dispatch
 * through the real `ExecuteMissionService` while every effect stays in memory.
 * The default run needs no lifecycle synchronization (the launch deferred no
 * rebase and the task is already active), so `missionTransitions` stays untouched
 * unless a test asks for it.
 */
type ExecuteOverrides = { [K in keyof ExecuteMissionPorts]?: Partial<ExecuteMissionPorts[K]> };

export function makeExecutePorts(overrides: ExecuteOverrides = {}) {
  const calls: string[] = [];
  const missions = new Map<string, { mission: import('../../src/domain/mission.js').Mission; version: number }>();
  const base: ExecuteMissionPorts = {
    workspace: {
      async preflight(slug: string) { calls.push(`validate:${slug}`); return true; },
      async resolveWorktree() { return '/worktree'; },
      async resolveTaskFile() { return { ok: true as const, taskFile: '/worktree/task.md' }; },
      async readTaskStatus() { return 'active'; },
      async enforceCommitSafety() { /* traced by the adapter suites, not here */ },
    },
    agentExecution: {
      async eligible() { return true; },
      async select() { return 'codex'; },
      async prepare() { return { prompt: 'execute prompt', agentConfig: {} }; },
      async launch(request: { slug: string; preselectedAgent: string | null }) {
        calls.push(`launch:${request.slug}:${request.preselectedAgent ?? 'default'}`);
        return {
          agent: request.preselectedAgent ?? 'codex',
          rebaseDeferred: false,
          errored: false,
          errorMessage: null,
          exitStatus: 0,
          detail: null,
        };
      },
    },
    missionTransitions: {
      // A refined mission carries the contract draft settled: activation
      // refuses an incomplete one (mission-workflow.ts requireDraftedContract),
      // so a fixture without it is not a mission that could reach this port.
      async load(id) {
        const stored = missions.get(id);
        if (stored) { return { kind: 'found' as const, mission: stored.mission, version: missionVersion(stored.version) }; }
        return {
          kind: 'found' as const,
          mission: fixtureMission(id, {
            id, repositoryId: repositoryId('repo'), title: 'Fixture', labels: missionLabels([]), assignee: null,
            status: 'refined',
            brief: { goal: 'Fixture goal', why: 'Fixture why', scope: 'Fixture scope', outOfScope: [] },
            declaredGates: ['npm test'],
            successCriteria: ['The mission is done'],
            predictedNelBucket: 'Small',
            // A planned checkpoint with no evidence yet: draft plans, execution records.
            checkpoints: [{ missionId: id, name: 'CP-1', firstLine: 'Do the work', goalCheck: [], nextActionText: '' }],
            review: null, netEngineeringLines: null, closedAt: null,
          }),
          version: missionVersion(1),
        };
      },
      async save(mission, expected) { calls.push('synchronize'); const version = (expected ?? 0) + 1; missions.set(mission.id, { mission, version }); return missionVersion(version); },
      async saveWithTransition(mission, expected) { calls.push('synchronize'); const version = (expected ?? 0) + 1; missions.set(mission.id, { mission, version }); return missionVersion(version); },
    },
    telemetry: {
      async recordLaunchTelemetry(record: { slug: string; agent: string }) {
        calls.push(`record:${record.slug}:${record.agent}`);
      },
    },
    checkpointValidation: { async validateBeforeReviewPreparation() { return { ok: true as const }; } },
    reviewPreparationExecution: {
      async run(request: { slug: string; agent: string }) {
        calls.push(`review-preparation:${request.slug}:${request.agent}`);
        return { ok: true as const };
      },
      async repairHygiene() { return { repaired: false }; },
    },
    autonomousReview: { async start() {} },
    repairLaunch: { async launch() { throw new Error('Unexpected repair launch'); }, available() { return { supported: false }; }, readHead() { return null; } },
    output: { log() {}, error() {}, command(value: string) { return value; }, formatSlug(value: string) { return value; }, formatAgent(value: string) { return value; } },
  };
  const ports: ExecuteMissionPorts = {
    ...(overrides.integrationRepair?.resume ? { integrationRepair: { resume: overrides.integrationRepair.resume } } : {}),
    workspace: mergeFixturePort(base.workspace, overrides.workspace),
    agentExecution: mergeFixturePort(base.agentExecution, overrides.agentExecution),
    missionTransitions: mergeFixturePort(base.missionTransitions, overrides.missionTransitions),
    telemetry: mergeFixturePort(base.telemetry, overrides.telemetry),
    checkpointValidation: mergeFixturePort(base.checkpointValidation, overrides.checkpointValidation),
    reviewPreparationExecution: mergeFixturePort(base.reviewPreparationExecution, overrides.reviewPreparationExecution),
    autonomousReview: mergeFixturePort(base.autonomousReview, overrides.autonomousReview),
    repairLaunch: mergeFixturePort(base.repairLaunch, overrides.repairLaunch),
    output: mergeFixturePort(base.output, overrides.output),
  };
  return { ports, calls };
}
