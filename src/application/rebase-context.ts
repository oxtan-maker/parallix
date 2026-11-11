import type { GitRunner, GitCommandResult, RebaseWorkflowPort } from './ports/rebase-workflow.js';
import { liveMissionExecutionContext } from './ports/mission-execution-context.js';

/** Everything the rebase phases share, resolved once at the command boundary. */
export interface RebaseContext {
  repairImplementer?: string;
  rebaseConflicts?: string[];
  rebaseObservationId?: string;
  rebaseAttempt?: number;
  rebaseObservationPredecessor?: string;
  rebaseTerminalObserved?: boolean;
  /** Base tip resolved immediately before the current fresh `git rebase`. */
  rebaseTargetRevision?: string;
  readonly args: string[];
  readonly port: RebaseWorkflowPort;
  readonly gitFn: GitRunner;
  readonly slug: string;
  readonly branch: string;
  readonly area: string;
  readonly executionRoot: string;
  readonly baseBranch: string;
  readonly isPush: boolean;
  readonly recordedImplementer: string | null;
  /** Mission HEAD before the rebase, when the port records branch moves. */
  readonly movedFrom: string | null;
}

/** Resolve once on entry; recursive conflict rounds retain the original pair. */
export function resolveRebaseLocation(slug: string, launchRoot: string, port: RebaseWorkflowPort,
  context?: RebaseContext): { ok: true; executionRoot: string; baseBranch: string } | { ok: false; reason: string } {
  if (context) { return { ok: true, executionRoot: context.executionRoot, baseBranch: context.baseBranch }; }
  const resolved = liveMissionExecutionContext(slug, port.resolveExecutionContext(slug, launchRoot));
  return resolved.ok
    ? { ok: true, executionRoot: resolved.context.missionWorktree, baseBranch: resolved.context.baseBranch }
    : resolved;
}

export const combineOutput = (result: GitCommandResult) =>
  [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
export const continueSucceeded = (result: GitCommandResult) =>
  result.status === 0;
export const hasConflictMarkers = (result: GitCommandResult) => result.failureReason?.code === 'git-conflict';
