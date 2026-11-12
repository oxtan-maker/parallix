import { missionVersion, type MissionStore } from '../application/domain-ports.js';
import type { MissionLifecycleService } from '../application/mission-lifecycle-service.js';
import type { ParallixConfiguration } from '../application/ports/configuration.js';
import type { Command } from '../interfaces/cli/runtime.js';
import { createResolveCommand, createVerdictCommand, type ReviewVerbPorts } from '../interfaces/cli/review-verbs.js';
import { inferSlug } from '../adapters/filesystem/mission-paths.js';
import { resolveMissionExecutionContext } from '../adapters/git/mission-execution-context.js';
import { readReviewState } from '../adapters/review/review-state.js';
import { bindReviewPersistence } from './review-persistence.js';
import { createMissionAuthority } from './mission-authority.js';
import { authorizeMissionWrite, authorizedOperationId } from '../application/ports/mission-write-authorization.js';
import { promptArtifacts } from '../adapters/agents/prompt-artifacts.js';
import { liveMissionExecutionContext } from '../application/ports/mission-execution-context.js';

export function reviewVerbPorts(services: { rootDir: string; configuration: ParallixConfiguration; mission?: { store: MissionStore; lifecycle: MissionLifecycleService } | null; sourceRound?: number }): ReviewVerbPorts {
  const missionStore = services.mission?.store ?? null;
  const lifecycleService = services.mission?.lifecycle ?? null;
  const persistence = bindReviewPersistence(missionStore, lifecycleService);
  return {
    retainRejectedVerdict: input => promptArtifacts(input.worktree).retain(JSON.stringify({
      kind: 'rejected-review-verdict', accepted: false, ...input,
      workflowId: authorizedOperationId(), retainedAt: new Date().toISOString(),
    }, null, 2)),
    resolveSlug: (explicit) => inferSlug(explicit),
    resolveExecutionContext: slug => liveMissionExecutionContext(slug, resolveMissionExecutionContext(slug, services.rootDir, services.configuration)),
    readReviewState: async (slug, worktree) => {
      const state = await Promise.resolve(readReviewState(slug, worktree, missionStore));
      return state ? { round: state.round, phase: state.phase, sourceRound: services.sourceRound } : null;
    },
    consumeReviewerOutput: async (slug, reviewer, output, executionContext, expectedVersion) => {
      await authorizeMissionWrite(slug);
      return persistence.consumeReviewerArtifacts(slug, reviewer, { configuration: services.configuration, executionContext, output, expectedVersion: expectedVersion === undefined ? undefined : missionVersion(expectedVersion) });
    },
    consumeImplementerOutput: (slug, implementer, output, executionContext, expectedVersion) =>
      persistence.consumeImplementerArtifacts(slug, implementer, { configuration: services.configuration, executionContext, output, expectedVersion: expectedVersion === undefined ? undefined : missionVersion(expectedVersion) }),
  };
}

/** Child review verbs need the Mission authority, not execute or presentation capabilities. */
export function createReviewVerbCommands(rootDir: string, configuration: ParallixConfiguration): Record<string, Command> {
  const invoke = async (args: string[], create: typeof createVerdictCommand | typeof createResolveCommand) => {
    const mission = await createMissionAuthority(rootDir, { configuration });
    const sourceRound = Number(configuration.forwardedEnvironment.PARALLIX_REVIEW_SOURCE_ROUND);
    try { return await create(reviewVerbPorts({ rootDir, configuration, mission,
      sourceRound: Number.isSafeInteger(sourceRound) && sourceRound > 0 ? sourceRound : undefined,
    }))(args); }
    finally { await mission.store.drain?.(); }
  };
  return { verdict: args => invoke(args, createVerdictCommand), resolve: args => invoke(args, createResolveCommand) };
}
