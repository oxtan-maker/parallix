import type { GateAdmissionPort, GateAdmissionRun } from '../../application/ports/gate-admission.js';
import type { RepositoryGate } from './repository-gate-schema.js';

interface ResourceRun {
  readonly remaining: Set<string>;
  ready?: Promise<GateAdmissionRun>;
  settled?: Promise<unknown>;
  release?: () => void;
}

/** A phase consumes one slot per resource, shared by all of its tagged gates. */
export class PhaseGateResources {
  private readonly resources = new Map<string, ResourceRun>();

  constructor(gates: RepositoryGate[], private readonly root: string,
    private readonly limits: Readonly<Record<string, number>>,
    private readonly admission: () => GateAdmissionPort, private readonly signal: AbortSignal) {
    for (const gate of gates) {
      if (!gate.resource) { continue; }
      let resource = this.resources.get(gate.resource);
      if (!resource) {
        resource = { remaining: new Set() };
        this.resources.set(gate.resource, resource);
      }
      resource.remaining.add(gate.key);
    }
  }

  async run<T>(name: string, invoke: (_slot: GateAdmissionRun) => T | Promise<T>): Promise<T> {
    const resource = this.resources.get(name)!;
    if (!resource.ready) {
      let ready!: (_slot: GateAdmissionRun) => void;
      let failed!: (_cause: unknown) => void;
      resource.ready = new Promise<GateAdmissionRun>((resolve, reject) => { ready = resolve; failed = reject; });
      const released = new Promise<void>(resolve => { resource.release = resolve; });
      resource.settled = Promise.resolve().then(() => this.admission().runOnResource(this.root, { name, capacity: this.limits[name] }, async slot => {
        ready(slot);
        await released;
      }, this.signal));
      // Every waiter sees acquisition failure; retain the original promise for cleanup errors.
      void resource.settled.catch(failed);
    }
    const slot = await resource.ready;
    slot.signal.throwIfAborted();
    return invoke(slot);
  }

  complete(gate: RepositoryGate): void {
    if (!gate.resource) { return; }
    const resource = this.resources.get(gate.resource)!;
    resource.remaining.delete(gate.key);
    if (resource.remaining.size === 0) { resource.release?.(); }
  }

  async close(): Promise<void> {
    for (const resource of this.resources.values()) { resource.release?.(); }
    await Promise.all([...this.resources.values()].map(resource => resource.settled));
  }
}
