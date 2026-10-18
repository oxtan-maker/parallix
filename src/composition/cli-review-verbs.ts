import { missionVersion, type MissionStore } from '../application/domain-ports.js';
import type { MissionLifecycleService } from '../application/mission-lifecycle-service.js';
import type { ParallixConfiguration } from '../application/ports/configuration.js';
import type { Command } from '../interfaces/cli/runtime.js';
import { createResolveCommand, createVerdictCommand, type ReviewVerbPorts } from '../interfaces/cli/review-verbs.js';
import { inferSlug } from '../adapters/filesystem/mission-paths.js';
import { resolveWorktree } from '../adapters/git/worktree.js';
import { readReviewState } from '../adapters/review/review-state.js';
import { bindReviewPersistence } from './review-persistence.js';
import { createMissionAuthority } from './mission-authority.js';

export function reviewVerbPorts(services: { mission?: { store: MissionStore; lifecycle: MissionLifecycleService } | null }): ReviewVerbPorts {
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
      persistence.consumeReviewerArtifacts(slug, reviewer, { worktree, output, expectedVersion: expectedVersion === undefined ? undefined : missionVersion(expectedVersion) }),
    consumeImplementerOutput: (slug, implementer, output, worktree, expectedVersion) =>
      persistence.consumeImplementerArtifacts(slug, implementer, { worktree, output, expectedVersion: expectedVersion === undefined ? undefined : missionVersion(expectedVersion) }),
  };
}

/** Child review verbs need the Mission authority, not execute or presentation capabilities. */
export function createReviewVerbCommands(rootDir: string, configuration: ParallixConfiguration): Record<string, Command> {
  const invoke = async (args: string[], create: typeof createVerdictCommand | typeof createResolveCommand) => {
    const mission = await createMissionAuthority(rootDir, { configuration });
    try { return await create(reviewVerbPorts({ mission }))(args); }
    finally { await mission.store.drain?.(); }
  };
  return { verdict: args => invoke(args, createVerdictCommand), resolve: args => invoke(args, createResolveCommand) };
}
