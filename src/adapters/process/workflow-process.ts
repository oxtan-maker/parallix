import { readFile, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import type { WorkflowProcessPort } from '../../application/ports/workflow-operation.js';
import type { ParallixConfiguration } from '../../application/ports/configuration.js';
import type { WorkflowOperation } from '../../domain/workflow-operation.js';
import type { CliInvocation } from './cli-invocation.js';
import { processStartIdentity, probeProcessLiveness } from './process-liveness.js';

/** Native process boundary, replaceable by isolated unit doubles. */
export const workflowProcessSystem = { readFile, readdir, spawn, processStartIdentity, probeProcessLiveness,
  kill: (pid: number, signal: NodeJS.Signals | 0) => process.kill(pid, signal),
  pause: () => new Promise(resolve => setTimeout(resolve, 50)),
};

/** Detached owner has independent stdio and a process group scoped to its work. */
export class WorkflowProcessAdapter implements WorkflowProcessPort {
  constructor(private readonly _cli: CliInvocation, private readonly _root: string, private readonly _configuration: ParallixConfiguration, private readonly _effectsSettled: (_operation: WorkflowOperation) => Promise<boolean> = async () => false,
    private readonly _stopEffects: (_operation: WorkflowOperation) => Promise<boolean> = async () => true) {}
  stopEffects(operation: WorkflowOperation): Promise<boolean> { return this._stopEffects(operation); }
  effectsSettled(operation: WorkflowOperation): Promise<boolean> { return this._effectsSettled(operation); }
  identity(): { pid: number; identity: string } {
    const identity = workflowProcessSystem.processStartIdentity(process.pid);
    if (!identity) { throw new Error('Cannot establish a fenced workflow process identity'); }
    return { pid: process.pid, identity };
  }
  async launch(id: string): Promise<void> {
    const child = workflowProcessSystem.spawn(this._cli.command, [...this._cli.args, '--workflow-worker', id, this._root], {
      cwd: this._root, env: { ...this._configuration.forwardedEnvironment }, detached: true, stdio: 'ignore',
    });
    await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
  }
  async alive(owner: { pid: number; identity: string }): Promise<boolean | null> {
    let live = workflowProcessSystem.probeProcessLiveness(owner.pid, owner.identity);
    if (live === true && process.platform === 'linux') {
      try {
        const stat = await workflowProcessSystem.readFile(`/proc/${owner.pid}/stat`, 'utf8');
        if (stat.slice(stat.lastIndexOf(')') + 2).startsWith('Z')) { live = false; }
      } catch { return false; }
    }
    if (live === false && await groupHasLivingProcesses(owner.pid)) { return null; }
    return live;
  }
  async stop(owner: { pid: number; identity: string }): Promise<boolean> {
    const live = await this.alive(owner);
    if (live === false) { return true; }
    if (process.platform !== 'linux') { return false; }
    // Never signal a recycled PID. A workflow executor leads its own group.
    const observed = workflowProcessSystem.processStartIdentity(owner.pid);
    if (observed !== null && observed !== owner.identity) { return false; }
    const tree: Array<{ pid: number; identity: string }> = [];
    try {
      if (live === true) { await this.freezeTree(owner, tree); }
      const members = await livingGroupMembers(owner.pid, Number(owner.identity));
      if (!members) { return false; }
      for (const member of members) {
        if (!tree.some(entry => entry.pid === member.pid)) { await this.freezeTree(member, tree); }
      }
      this.signalTree([...tree].reverse(), 'SIGTERM');
    } catch { /* confirmation below decides whether replacement is permitted */ }
    finally { this.signalTree(tree, 'SIGCONT'); }
    if (await this.confirmStopped([owner, ...tree])) { return true; }
    // Escalate only the identities captured before termination. A reused PID
    // must never inherit a signal intended for the workflow's former process.
    this.signalTree([...tree].reverse(), 'SIGKILL');
    return this.confirmStopped([owner, ...tree]);
  }
  private async confirmStopped(tree: Array<{ pid: number; identity: string }>): Promise<boolean> {
    for (let index = 0; index < 40; index++) {
      await workflowProcessSystem.pause();
      const alive = await Promise.all(tree.map(entry => this.alive(entry)));
      if (alive.every(value => value === false)) { return true; }
    }
    return false;
  }
  private signalTree(tree: Array<{ pid: number; identity: string }>, signal: NodeJS.Signals): void {
    for (const entry of tree) {
      if (workflowProcessSystem.processStartIdentity(entry.pid) !== entry.identity) { continue; }
      try { workflowProcessSystem.kill(entry.pid, signal); } catch { /* exited during signalling */ }
    }
  }
  private async freezeTree(owner: { pid: number; identity: string }, tree: Array<{ pid: number; identity: string }>): Promise<void> {
    if (workflowProcessSystem.processStartIdentity(owner.pid) !== owner.identity) { return; }
    workflowProcessSystem.kill(owner.pid, 'SIGSTOP');
    tree.push(owner);
    const children = await workflowProcessSystem.readFile(`/proc/${owner.pid}/task/${owner.pid}/children`, 'utf8');
    for (const token of children.trim().split(/\s+/).filter(Boolean)) {
      const pid = Number(token); const identity = workflowProcessSystem.processStartIdentity(pid);
      if (identity) { await this.freezeTree({ pid, identity }, tree); }
    }
  }

}


async function groupHasLivingProcesses(group: number): Promise<boolean> {
  if (process.platform === 'win32') { return false; }
  try { workflowProcessSystem.kill(-group, 0); } catch { return false; }
  if (process.platform !== 'linux') { return true; }
  for await (const _pid of livingGroupPids(group)) { return true; }
  return false;
}

/** Process-group membership survives reparenting; every member is identity checked. */
async function livingGroupMembers(group: number, minimumStart: number): Promise<Array<{ pid: number; identity: string }> | null> {
  const members: Array<{ pid: number; identity: string }> = [];
  for await (const pid of livingGroupPids(group)) {
    const identity = workflowProcessSystem.processStartIdentity(pid);
    if (!identity || Number(identity) < minimumStart) { return null; }
    members.push({ pid, identity });
  }
  return members;
}

/** Bound inspection concurrency; serial /proc reads delay every stop on busy hosts. */
async function* livingGroupPids(group: number): AsyncGenerator<number> {
  const processes = (await workflowProcessSystem.readdir('/proc')).filter(value => /^\d+$/.test(value));
  for (let offset = 0; offset < processes.length; offset += 32) {
    const batch = await Promise.all(processes.slice(offset, offset + 32).map(async token => {
      try {
        const stat = await workflowProcessSystem.readFile(`/proc/${token}/stat`, 'utf8');
        const fields = stat.slice(stat.lastIndexOf(')') + 2).split(/\s+/);
        return Number(fields[2]) === group && fields[0] !== 'Z' ? Number(token) : null;
      } catch { return null; } // Exited during inspection.
    }));
    for (const pid of batch) { if (pid !== null) { yield pid; } }
  }
}
