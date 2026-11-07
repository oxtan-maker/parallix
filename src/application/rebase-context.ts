import type { GitRunner, GitCommandResult, RebaseWorkflowPort } from './ports/rebase-workflow.js';

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

export const combineOutput = (result: GitCommandResult) =>
  [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
export const continueSucceeded = (result: GitCommandResult) =>
  result.status === 0;
export const hasConflictMarkers = (result: GitCommandResult) => result.failureReason?.code === 'git-conflict';
