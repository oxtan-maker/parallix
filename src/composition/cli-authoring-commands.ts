import { createReviewDecisionRevocationUseCase, createReviewVerbCommands } from './cli-review-verbs.js';
import { createBriefWriteCommands } from './cli-brief-writes.js';

import { validateDeclaredGates } from "../adapters/cli/commands/review-preparation.js";

import { createRevokeReviewCommand } from '../interfaces/cli/revoke-review.js';
import { createRiskExceptionCommand, createSplitCommand } from '../interfaces/cli/mission-wave-command.js';

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
import type { FixedVerificationNextAction } from '../application/verification-policy/review-start-decision.js';
import { createDefectProvenanceCommand } from '../interfaces/cli/defect-provenance-write.js';
import { readDefectProvenanceBackfillEntries } from '../adapters/cli/commands/defect-provenance-input.js';

/** Return a recorded verdict through the owner selected for its exact next action. */
export async function continueVerdictThroughActionOwner(context: CliCommandContext, slug: string,
  action: FixedVerificationNextAction): Promise<void> {
  if (action.kind === 'repair' && action.reason === 'findings-pending') {
    await context.commands().active([slug], { operatorInvocation: false });
    return;
  }
  if (action.kind === 'agent-review' || (action.kind === 'repair' && action.reason === 'repair-pending')) {
    await context.commands().review([slug], { operatorInvocation: false });
  }
}

export function createAuthoringCommands(context: CliCommandContext): Record<string, Command> {
  const { rootDir, scope } = context;
  const { withGraph } = scope;
  const continueOperatorVerdict = context.operatorInvocation
    ? (slug: string, action: FixedVerificationNextAction) => continueVerdictThroughActionOwner(context, slug, action)
    : undefined;
  const revokeReview: Command = (args) => withGraph(services => {
    if (!services.mission) { throw new Error('mission services are unavailable'); }
    return createRevokeReviewCommand(
      createReviewDecisionRevocationUseCase(rootDir, services.mission.store, services.mission.lifecycle),
      (explicit) => inferSlug(explicit),
    )(args);
  });
  return {
    ...createBriefWriteCommands(rootDir, context.configuration),
    ...createReviewVerbCommands(rootDir, context.configuration, continueOperatorVerdict,
      context.operatorInvocation ?? false),
    repro: (args) => withGraph(services => createReproCommand(missionWrites(services))(args)),
    provenance: (args) => withGraph(services => {
      const mission = missionWrites(services);
      return createDefectProvenanceCommand({ ...mission,
        defectProvenanceBackfill: services.mission!.defectProvenanceBackfill,
        readBackfillEntries: readDefectProvenanceBackfillEntries })(args);
    }),
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
    split: (args) => withGraph(services => createSplitCommand(missionWrites(services), (command) => {
      const result = validateDeclaredGates([command], rootDir, { checkFiles: false });
      return result.ok ? null : result.error;
    })(args)),
    'risk-exception': (args) => withGraph(services => createRiskExceptionCommand(missionWrites(services), context.operatorInvocation ?? false)(args)),
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
