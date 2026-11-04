import type { GateAdmissionPort, GateAdmissionRun } from '../../application/ports/gate-admission.js';
import type { RepositoryGate } from './repository-gate-schema.js';

/**
 * Per-command named-resource admission coordinated with phase capacity.
 * Parallel phases admit tagged gates before they claim phase capacity, leaving
 * room for ready producers. Serial phases preserve declared order by claiming
 * their only phase slot while admission is pending.
 */
export class PhaseGateResources {
  private readonly executing = new Set<string>();
  private readonly queued: { key: string; resume: () => void }[] = [];

  constructor(private readonly capacity: number, private readonly root: string,
    private readonly limits: Readonly<Record<string, number>>,
    private readonly admission: () => GateAdmissionPort, private readonly signal: AbortSignal) {}

  get active(): number { return this.executing.size; }

  launchable(gate: RepositoryGate): boolean {
    return this.waitsOutsidePhase(gate) || this.executing.size < this.capacity;
  }

  launch(gate: RepositoryGate): boolean {
    if (this.waitsOutsidePhase(gate)) { return false; }
    this.executing.add(gate.key);
    return true;
  }

  async run<T>(gate: RepositoryGate, invoke: (_slot?: GateAdmissionRun, _queued?: boolean) => Promise<T>): Promise<T> {
    if (!gate.resource) { return invoke(); }
    return this.admission().runOnResource(this.root, { name: gate.resource, capacity: this.limits[gate.resource] }, async slot => {
      const queued = !this.executing.has(gate.key);
      if (queued) { await this.claim(gate.key, slot.signal); }
      return invoke(slot, queued);
    }, this.signal);
  }

  complete(gate: RepositoryGate): void {
    if (!this.executing.delete(gate.key)) { return; }
    const next = this.queued.shift();
    if (next) { this.executing.add(next.key); next.resume(); }
  }

  private waitsOutsidePhase(gate: RepositoryGate): boolean { return Boolean(gate.resource) && this.capacity > 1; }

  private claim(key: string, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (this.executing.size < this.capacity) { this.executing.add(key); return Promise.resolve(); }
    return new Promise((resolve, reject) => {
      const abort = () => { this.queued.splice(this.queued.indexOf(entry), 1); reject(signal.reason); };
      const entry = { key, resume: () => { signal.removeEventListener('abort', abort); resolve(); } };
      this.queued.push(entry);
      signal.addEventListener('abort', abort, { once: true });
    });
  }
}
