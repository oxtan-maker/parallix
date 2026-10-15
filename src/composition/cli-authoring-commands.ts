

import { validateDeclaredGates } from '../adapters/cli/commands/handoff.js';

import { resolveWorktree } from '../adapters/git/worktree.js';

import { createResolveCommand, createVerdictCommand, type ReviewVerbPorts } from '../interfaces/cli/review-verbs.js';
import { createRevokeReviewCommand } from '../interfaces/cli/revoke-review.js';
import { RevokeReviewDecisionUseCase } from '../application/revoke-review-decision-use-case.js';
import { createGitChangeIdentity } from '../adapters/git/change-identity.js';
import { dismissProviderApproval } from '../adapters/review/review-adapter.js';

import { readReviewState } from '../adapters/review/review-state.js';
import {
  createAssignCommand,
  createCheckpointCommand,
  createGateCommand,
  createCriterionCommand,
  createMissionCommand,
  createDependsCommand,
  createNelCommand,
  createGoalCommand,
  createReproCommand,
  createScopeCommand,
  createClassificationCommand,
  type MissionWriteServices,
} from '../interfaces/cli/mission-writes.js';

import { type Command } from '../interfaces/cli/runtime.js';

import { bindReviewPersistence } from './review-persistence.js';

import { inferSlug } from '../adapters/filesystem/mission-paths.js';
import type { CliCommandContext } from './cli-service-scope.js';

export function createAuthoringCommands(context: CliCommandContext): Record<string, Command> {
  const { rootDir, scope } = context;
  const { withGraph } = scope;
  const revokeReview: Command = (args) => withGraph(services => {
    if (!services.mission) { throw new Error('mission services are unavailable'); }
    return createRevokeReviewCommand(
      new RevokeReviewDecisionUseCase(services.mission.store, services.mission.lifecycle, {
        async dismissApproval(mission, round, reason) {
          const decision = mission.review?.rounds.find((entry) => entry.number === round)?.decision;
          if (decision?.kind !== 'approved') { throw new Error('matching approval is not recorded'); }
          dismissProviderApproval(`mission/${mission.id}`, decision.decidedAt, reason, { rootDir });
        },
      }, createGitChangeIdentity(rootDir)),
      (explicit) => inferSlug(explicit),
    )(args);
  });
  return {
    goal: (args) => withGraph(services => createGoalCommand(missionWrites(services))(args)),
    repro: (args) => withGraph(services => createReproCommand(missionWrites(services))(args)),
    classification: (args) => withGraph(services => createClassificationCommand(missionWrites(services))(args)),
    scope: (args) => withGraph(services => createScopeCommand(missionWrites(services))(args)),
    gate: (args) => withGraph(services => createGateCommand(missionWrites(services), (command) => {
      const result = validateDeclaredGates([command], rootDir, { checkFiles: false });
      return result.ok ? null : result.error;
    })(args)),
    criterion: (args) => withGraph(services => createCriterionCommand(missionWrites(services))(args)),
    mission: (args) => withGraph(services => createMissionCommand(missionWrites(services), (command) => {
      const result = validateDeclaredGates([command], rootDir, { checkFiles: false });
      return result.ok ? null : result.error;
    })(args)),
    depends: (args) => withGraph(services => createDependsCommand(missionWrites(services))(args)),
    nel: (args) => withGraph(services => createNelCommand(missionWrites(services))(args)),
    checkpoint: (args) => withGraph(services => createCheckpointCommand(missionWrites(services).checkpoints, (explicit) => inferSlug(explicit), rootDir)(args)),
    assign: (args) => withGraph(services => createAssignCommand(missionWrites(services), false)(args)),
    verdict: (args) => withGraph(services => createVerdictCommand(reviewVerbPorts(services))(args)),
    resolve: (args) => withGraph(services => createResolveCommand(reviewVerbPorts(services))(args)),
    'revoke-review': revokeReview,
    revoke: revokeReview,
    unassign: (args) => withGraph(services => createAssignCommand(missionWrites(services), true)(args))
  };
}
function reviewVerbPorts(services: { mission?: { store: import('../application/domain-ports.js').MissionStore; lifecycle: import('../application/mission-lifecycle-service.js').MissionLifecycleService } | null }): ReviewVerbPorts {
  const missionStore = services.mission?.store ?? null;
  const lifecycleService = services.mission?.lifecycle ?? null;
  const persistence = bindReviewPersistence(missionStore, lifecycleService);
  return {
    resolveSlug: (explicit) => inferSlug(explicit),
    resolveWorktree: (slug) => resolveWorktree(slug),
    readReviewState: async (slug, worktree) => {
      const state = await Promise.resolve(readReviewState(slug, worktree, missionStore));
      return state ? { round: state.round, phase: state.phase } : null;
    },
    consumeReviewerOutput: (slug, reviewer, output, worktree, expectedVersion) =>
      persistence.consumeReviewerArtifacts(slug, reviewer, { worktree, output, expectedVersion }),
    consumeImplementerOutput: (slug, implementer, output, worktree, expectedVersion) =>
      persistence.consumeImplementerArtifacts(slug, implementer, { worktree, output, expectedVersion }),
  };
}

function missionWrites(services: { mission?: Omit<MissionWriteServices, 'resolveSlug'> | null }): MissionWriteServices {
  if (!services.mission) { throw new Error('mission services are unavailable'); }
  // Composition owns the adapter dependency; the interface module stays clean.
  return { ...services.mission, resolveSlug: (explicit) => inferSlug(explicit) };
}