/** Own the Backlog mirror and rollback facts for one active agent launch. */
import type { LaunchOptions, Log } from './active-adapter-types.js';
import type { transitionTask } from '../../backlog/backlog.js';
import * as fmt from '../../../application/presentation/cli-format.js';
interface LaunchRecordBindings extends Pick<LaunchOptions, 'taskResolution' | 'onActivated' | 'onAgentLaunched'> {
  slug: string; worktree: string; preselected: string; priorStatus: string | null; priorImplementer: string | null;
  transitionTaskFn: NonNullable<LaunchOptions['transitionTaskFn']>; log: Log; authorityAlreadyActive: boolean;
}
export class ActiveLaunchRecorder {
  private _launchRecorded = false;
  private _authoritativeActivationCommitted: boolean;
  private _launchTransitionFailed = false;
  private _rebaseDeferred = false;
  private _launchedAgent: string | null = null;
  constructor(private readonly bindings: LaunchRecordBindings) { this._authoritativeActivationCommitted = bindings.authorityAlreadyActive; }
  get launchTransitionFailed(): boolean { return this._launchTransitionFailed; }
  get rebaseDeferred(): boolean { return this._rebaseDeferred; }
  get launchedAgent(): string | null { return this._launchedAgent; }
  async rollback({ throwOnFailure = true } = {}): Promise<void> {
    const { slug, worktree, priorStatus, priorImplementer, transitionTaskFn, log } = this.bindings;

    // A failed run does not undo a committed lifecycle transition. Keep the
    // mirror active so retry/resume sees the same lane as the Mission store.
    if (this._authoritativeActivationCommitted || !this._launchRecorded || !priorStatus) {
      return;
    }

    log(fmt.status('WARN', `Execute launch for ${fmt.slug(slug)} did not complete cleanly; rolling task state back to ${priorStatus} / ${priorImplementer || 'none'}.`));
    // The rollback transition commits a task-sync PASS too; suppress that
    // bookkeeping line exactly like the onLaunch transition does (F1) so the
    // normal active path never carries task-synchronization narration.

    const rollbackOpts: NonNullable<Parameters<typeof transitionTask>[2]> = { rootDir: worktree, log: suppressTaskSyncCommitLog(log) };
    if (priorImplementer) {
      rollbackOpts.implementer = priorImplementer;
    } else {
      rollbackOpts.clearAssignee = true;
    }
    if (!await transitionTaskFn(slug, priorStatus, rollbackOpts)) {
      const msg = `Failed to roll back task ${fmt.slug(slug)} to ${priorStatus} after execute launch failure.`;
      if (throwOnFailure) { throw new Error(msg); }
      log(fmt.status('WARN', msg));
    }
    this._launchRecorded = false;
  }
  async record({ agent, startedAtMs }: { agent: string; startedAtMs?: number }): Promise<void> {
    const { slug, worktree, preselected, taskResolution, onActivated, onAgentLaunched, transitionTaskFn, log } = this.bindings;

    this._launchedAgent = agent;
    // The authoritative active boundary lands here, as destination-state
    // work begins: the Mission state and its lane event persist before the
    // Backlog mirror moves and before any current-work publication
    // (TASK-2582). A failure stops the run: the Backlog task is not
    // written and no success output follows the agent's completion.
    if (onActivated) {
      try {
        await onActivated(agent, startedAtMs);
        this._authoritativeActivationCommitted = true;
      } catch (err) {
        // The authoritative active boundary refused to commit. Fail the
        // launch here, at the boundary — not after the agent exits: no
        // dependent work may run under an uncommitted transition, and the
        // operator sees the failure immediately (TASK-2582 review F1).
        // Throwing also stops the Backlog transition and current-work
        // publication below; startAgent stops the already-spawned agent
        // child and propagates the rejection without awaiting the agent
        // result (TASK-2582 review F4).
        const message = `Failed to persist the active lifecycle boundary for task ${fmt.slug(slug)}: ${err instanceof Error ? err.message : String(err)}`;
        log(fmt.status('FAIL', message));
        throw new Error(message);
      }
    }
    // Awaited: the caller publishes the mission's current work here, and
    // that write must land before the run reports its next state.
    await onAgentLaunched?.(agent);
    if (!(taskResolution && taskResolution.ok)) {
      return;
    }

    const fallback = agent !== preselected ? ` (selected ${fmt.agent(preselected)}; fallback)` : '';
    log(fmt.status('INFO', `Implementer: ${fmt.agent(agent)}${fallback}`));
    if (!await transitionTaskFn(slug, 'active', {
      implementer: agent,
      rootDir: worktree,
      log: suppressTaskSyncCommitLog(log),
    })) {
      this._launchTransitionFailed = true;
      return;
    }

    this._launchRecorded = true;
    this._rebaseDeferred = true;

  }
}

function suppressTaskSyncCommitLog(l: Log) {
  return (msg: string) => {
    if (/^\[PASS\] Task .* transitioned to .* and committed\./.test(fmt.stripAnsi(msg))) { return; }
    l(msg);
  };
}
