import { setTimeout as pause } from 'node:timers/promises';
import type { GateAdmissionPort, GateAdmissionRun } from '../../application/ports/gate-admission.js';
import type { CustomAgentLeaseRepository } from '../../application/ports/custom-agent-admission.js';
import { isSameLiveProcess, processIdentity } from './process-liveness.js';
import { gateDescendants, isLiveProcessGroup } from './process-group-liveness.js';

type GateLeases = CustomAgentLeaseRepository & {
  bindProcessGroup(_lease: string, _identity: { pid: number; startId: string }): void;
};

export class SharedGateAdmission implements GateAdmissionPort {
  constructor(private readonly leases: (_resource: string) => Promise<GateLeases>, private readonly nested: boolean, private readonly maxConcurrent: (_root: string) => number) {}

  assertIndependent(): void {
    if (this.nested) { throw new Error('Nested verification gate invocation is not supported'); }
  }

  async run<T>(root: string, action: (_run: GateAdmissionRun) => Promise<T>, signal?: AbortSignal): Promise<T> {
    return this.admit(root, 'verification', this.maxConcurrent(root), action, signal);
  }

  /** Resource leases use their own lease partition, so independent resources never contend. */
  async runOnResource<T>(root: string, resource: { name: string; capacity: number }, action: (_run: GateAdmissionRun) => Promise<T>, signal?: AbortSignal): Promise<T> {
    return this.admit(root, `verification:${resource.name}`, resource.capacity, action, signal);
  }

  private async admit<T>(root: string, partition: string, capacity: number, action: (_run: GateAdmissionRun) => Promise<T>, signal?: AbortSignal): Promise<T> {
    this.assertIndependent();
    if (!Number.isFinite(capacity)) { throw new Error('Gate admission requires a configured finite maximum'); }
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    process.on('SIGINT', cancel);
    process.on('SIGTERM', cancel);
    if (signal?.aborted) { cancel(); }
    const groups: { pid: number; startId: string }[] = [];
    let lease: string | null = null;
    let leases: GateLeases | undefined;
    try {
      const owner = processIdentity(process.pid);
      if (!owner) { throw new Error('Cannot establish verification owner identity'); }
      leases = await this.leases(partition);
      while (!lease) {
        controller.signal.throwIfAborted();
        lease = await leases.acquire(root, capacity, owner);
        if (!lease) { await pause(25, undefined, { signal: controller.signal }); }
      }
      controller.signal.throwIfAborted();
      return await action({
        signal: controller.signal,
        environment: { PARALLIX_GATE_OWNER: lease },
        bindProcessGroup(pid) {
          const identity = processIdentity(pid);
          if (!identity?.startId) { throw new Error('Cannot establish gate child identity'); }
          leases!.bindProcessGroup(lease!, { pid, startId: identity.startId });
          groups.push({ pid, startId: identity.startId });
        },
      });
    } finally {
      try {
        await settleDescendants(lease, groups, controller.signal);
        if (lease) { leases!.release(lease); }
      } finally {
        signal?.removeEventListener('abort', cancel);
        process.removeListener('SIGINT', cancel);
        process.removeListener('SIGTERM', cancel);
      }
    }
  }
}

async function settleDescendants(lease: string | null, groups: { pid: number; startId: string }[], signal: AbortSignal): Promise<void> {
  // A background child can close its inherited output before exiting.
  // Group lifetime, rather than pipe lifetime, owns release.
  while (groups.some(group => isLiveProcessGroup(group.pid, group.startId)) || (lease && gateDescendants(lease).length > 0)) {
    if (signal.aborted) {
      for (const child of lease ? gateDescendants(lease) : []) {
        if (isSameLiveProcess(child.pid, child.startId)) {
          try { process.kill(child.pid, 'SIGKILL'); } catch { /* Settled. */ }
        }
      }
      for (const group of groups) {
        if (isLiveProcessGroup(group.pid, group.startId)) {
          try { process.kill(-group.pid, 'SIGKILL'); } catch { /* Settled. */ }
        }
      }
    }
    await pause(10);
  }
}
