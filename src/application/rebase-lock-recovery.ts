import * as fmt from './presentation/cli-format.js';
import { failureReason } from '../domain/failure-reason.js';
import type { GitCommandResult } from './ports/rebase-workflow.js';
import type { RebaseContext } from './rebase-context.js';

/** Lock waiting is admission, never a resolver attempt. Git state owns the next
 * command; only a confirmed paused rebase may continue. No generic replay. */
export async function recoverRebaseLock(ctx: RebaseContext, first: GitCommandResult, args: string[]): Promise<GitCommandResult | null> {
  const contention = ctx.port.gitContention;
  if (!contention) { return first; }
  let result = first;
  let invocation = { cwd: ctx.executionRoot, args };
  for (;;) {
    const evidence = contention.inspect(result, invocation);
    if (!evidence || evidence.kind !== 'lock-contention') { return result; }
    fmt.log.info(`Waiting for Git ${evidence.scope} resource ${evidence.lockPath}; owner ${evidence.owner}.`);
    try {
      const waited = await contention.waitForRelease(evidence, {
        onWaiting: state => fmt.log.info(`Waiting for Git ${state.scope} resource ${state.lockPath}; owner ${state.owner}; ${state.waitedMs}ms.`),
      });
      if (!waited.released) {
        fmt.log.fail(`Git wait stopped (${waited.stopReason}): ${evidence.diagnostics}; owner ${evidence.owner}. Lock and sequencer preserved. Inspect git status before continuing.`);
        ctx.port.exit(1); return null;
      }
    } catch (error) {
      fmt.log.fail(`Git wait cancelled or failed: ${String(error)}; ${evidence.diagnostics}. Lock and sequencer preserved.`);
      ctx.port.exit(1); return null;
    }
    // HEAD/ref/config failures can follow hooks or ref updates. Their effects
    // are not proven by a paused sequencer, so leave reconciliation to its owner.
    if (evidence.family !== 'index') {
      fmt.log.fail(`Git lock released (${evidence.family}), but prior hook/ref effects are uncertain. Inspect git status and refs before continuing; original command was not replayed.`);
      ctx.port.exit(1); return null;
    }
    const state = ctx.port.detectRebaseState(ctx.executionRoot);
    if (state.unmergedFiles.length) {
      return { ...result, failureReason: failureReason('git-conflict', 'git', { operation: 'rebase' }), status: 1,
        stderr: state.unmergedFiles.map(file => `CONFLICT (content): Merge conflict in ${file}`).join('\n') };
    }
    if (!state.inProgress || state.otherOperation || ('branch' in state && state.branch !== ctx.branch)) {
      fmt.log.fail(`Git lock released but rebase progress cannot be safely continued (${evidence.diagnostics}). Inspect git status and refs; original command was not replayed.`);
      ctx.port.exit(1); return null;
    }
    invocation = { cwd: ctx.executionRoot, args: ['-C', ctx.executionRoot, '-c', 'core.editor=true', '-c', 'merge.autoedit=no', 'rebase', '--continue'] };
    result = ctx.gitFn(invocation.args);
  }
}
