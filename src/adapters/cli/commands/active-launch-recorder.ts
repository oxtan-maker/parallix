/** Mirror an actual launch to Backlog; Mission activation belongs to the use case. */
import type { LaunchOptions, Log } from './active-adapter-types.js';
import * as fmt from '../../../application/presentation/cli-format.js';
interface LaunchRecordBindings extends Pick<LaunchOptions, 'taskResolution' | 'onAgentLaunched'> {
  slug: string; worktree: string; preselected: string;
  transitionTaskFn: NonNullable<LaunchOptions['transitionTaskFn']>; log: Log;
}
export class ActiveLaunchRecorder {
  private _launchTransitionFailed = false;
  private _rebaseDeferred = false;
  private _launchedAgent: string | null = null;
  constructor(private readonly bindings: LaunchRecordBindings) {}
  get launchTransitionFailed(): boolean { return this._launchTransitionFailed; }
  get rebaseDeferred(): boolean { return this._rebaseDeferred; }
  get launchedAgent(): string | null { return this._launchedAgent; }
  async record({ agent }: { agent: string }): Promise<void> {
    const { slug, worktree, preselected, taskResolution, onAgentLaunched, transitionTaskFn, log } = this.bindings;
    this._launchedAgent = agent;
    await onAgentLaunched?.(agent);
    if (!taskResolution?.ok) { return; }
    const fallback = agent !== preselected ? ` (selected ${fmt.agent(preselected)}; fallback)` : '';
    log(fmt.status('INFO', `Implementer: ${fmt.agent(agent)}${fallback}`));
    if (!await transitionTaskFn(slug, 'active', { implementer: agent, rootDir: worktree,
      log: message => { if (!/^\[PASS\] Task .* transitioned to .* and committed\./.test(fmt.stripAnsi(message))) { log(message); } },
    })) { this._launchTransitionFailed = true; return; }
    this._rebaseDeferred = true;
  }
}
