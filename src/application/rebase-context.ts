import type { GitRunner, GitCommandResult, RebaseWorkflowPort } from './ports/rebase-workflow.js';

/** Everything the rebase phases share, resolved once at the command boundary. */
export interface RebaseContext {
  repairImplementer?: string;
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
  result.status === 0 || /up to date|Already up to date/i.test((result.stdout || '') + (result.stderr || ''));
export const hasConflictMarkers = (output: string) => /CONFLICT|KONFLIKT/i.test(output);
