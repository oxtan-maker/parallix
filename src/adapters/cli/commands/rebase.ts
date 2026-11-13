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
import * as fmt from '../../../application/presentation/cli-format.js';
import { liveMissionExecutionContext, type MissionExecutionContextResolution } from '../../../application/ports/mission-execution-context.js';
import { inferSlug } from '../../filesystem/mission-utils.js';
import { resolveMissionExecutionContext } from '../../git/mission-execution-context.js';
import {
  classifyHookFailure,
  parseConflictFilesFromGitStatus,
} from '../../../application/rebase-workflow.js';
import {
  buildRebasePrompt,
  createRebaseWorkflowPort,
  type RebaseCommandOptions,
} from '../../rebase/rebase-workflow-adapter.js';

export type RebaseEntryOptions = Omit<RebaseCommandOptions, 'cwd' | 'executionContext'> & {
  rootDir?: string;
  resolveExecutionContextFn?: (_slug: string, _root: string) => MissionExecutionContextResolution;
};

async function rebase(args: string[], options: RebaseEntryOptions = {}): Promise<void> {
  const explicitSlug = args.find(arg => !arg.startsWith('--'));
  const slug = (options.inferSlugFn ?? inferSlug)(explicitSlug);
  if (!slug) {
    fmt.log.fail('Usage: px rebase [<slug>] [--push]');
    (options.exitFn ?? process.exit)(1);
    return;
  }
  const launchRoot = options.rootDir ?? process.cwd();
  const resolution = options.resolveExecutionContextFn
    ? options.resolveExecutionContextFn(slug, launchRoot)
    : options.configuration
      ? resolveMissionExecutionContext(slug, launchRoot, options.configuration, options.gitFn)
      : { ok: false as const, reason: `Mission ${slug}: mutation configuration is unavailable; composition must resolve the execution context.` };
  const live = liveMissionExecutionContext(slug, resolution);
  if (!live.ok) {
    fmt.log.fail(live.reason);
    (options.exitFn ?? process.exit)(1);
    return;
  }
  const { rootDir: _rootDir, resolveExecutionContextFn: _resolveExecutionContextFn, ...mutationOptions } = options;
  return new RebaseCommandUseCase(createRebaseWorkflowPort({
    ...mutationOptions,
    cwd: launchRoot,
    executionContext: live.context,
  })).execute(args);
}

const rebaseWithHelpers = Object.assign(rebase, { buildRebasePrompt, parseConflictFilesFromGitStatus, classifyHookFailure });
export default rebaseWithHelpers;
export {
  rebase,
  buildRebasePrompt,
  parseConflictFilesFromGitStatus,
  classifyHookFailure,
};
