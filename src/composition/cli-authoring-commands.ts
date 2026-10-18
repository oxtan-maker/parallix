import { createReviewVerbCommands } from './cli-review-verbs.js';
import { createBriefWriteCommands } from './cli-brief-writes.js';

import { validateDeclaredGates } from '../adapters/cli/commands/handoff.js';

import { createRevokeReviewCommand } from '../interfaces/cli/revoke-review.js';
import { RevokeReviewDecisionUseCase } from '../application/revoke-review-decision-use-case.js';
import { createGitChangeIdentity } from '../adapters/git/change-identity.js';
import { dismissProviderApproval } from '../adapters/review/review-adapter.js';

import {
  createAssignCommand,
  createGateCommand,
  createCriterionCommand,
  createMissionCommand,
  createDependsCommand,
  createNelCommand,
  createReproCommand,
  createScopeCommand,
  type MissionWriteServices,
} from '../interfaces/cli/mission-writes.js';

import { type Command } from '../interfaces/cli/runtime.js';

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
    ...createBriefWriteCommands(rootDir, context.configuration),
    ...createReviewVerbCommands(rootDir, context.configuration),
    repro: (args) => withGraph(services => createReproCommand(missionWrites(services))(args)),
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
    assign: (args) => withGraph(services => createAssignCommand(missionWrites(services), false)(args)),
    'revoke-review': revokeReview,
    revoke: revokeReview,
    unassign: (args) => withGraph(services => createAssignCommand(missionWrites(services), true)(args))
  };
}
function missionWrites(services: { mission?: Omit<MissionWriteServices, 'resolveSlug'> | null }): MissionWriteServices {
  if (!services.mission) { throw new Error('mission services are unavailable'); }
  // Composition owns the adapter dependency; the interface module stays clean.
  return { ...services.mission, resolveSlug: (explicit) => inferSlug(explicit) };
}