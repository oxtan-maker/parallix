/**
 * `px rebase` command adapter (TASK-2332.12).
 *
 * A delegating shell: it hands the argv tail and the injected seams to
 * `RebaseCommandUseCase`, which owns every rebase policy decision. The concrete
 * adapters are bound in `src/adapters/rebase/rebase-workflow-adapter.ts`, so
 * this file imports no git, agents, forgejo, backlog, review, config,
 * filesystem or verification package of its own.
 *
 * Usage: px rebase [<slug>] [--push]
 */
import { RebaseCommandUseCase } from '../../../application/rebase-command-use-case.js';
import {
  classifyHookFailure,
  parseConflictFilesFromGitStatus,
  parseConflictFilesFromRebaseOutput,
} from '../../../application/rebase-workflow.js';
import {
  buildRebasePrompt,
  createRebaseWorkflowPort,
  handleHookFailureAutoBounce,
  type RebaseCommandOptions,
} from '../../rebase/rebase-workflow-adapter.js';

async function rebase(args: string[], options: RebaseCommandOptions = {}): Promise<void> {
  return new RebaseCommandUseCase(createRebaseWorkflowPort(options)).execute(args);
}

(rebase as any).buildRebasePrompt = buildRebasePrompt;
(rebase as any).parseConflictFilesFromRebaseOutput = parseConflictFilesFromRebaseOutput;
(rebase as any).parseConflictFilesFromGitStatus = parseConflictFilesFromGitStatus;
(rebase as any).classifyHookFailure = classifyHookFailure;
(rebase as any).handleHookFailureAutoBounce = handleHookFailureAutoBounce;
export default rebase;
export {
  rebase,
  buildRebasePrompt,
  parseConflictFilesFromRebaseOutput,
  parseConflictFilesFromGitStatus,
  classifyHookFailure,
  handleHookFailureAutoBounce,
};
