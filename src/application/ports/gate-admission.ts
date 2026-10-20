/** A run owns exclusion until its children and their process groups settle. */
export interface GateAdmissionRun {
  readonly signal: AbortSignal;
  readonly environment: Readonly<Record<string, string>>;
  bindProcessGroup(_pid: number): void;
}
export interface GateAdmissionPort {
  assertIndependent(): void;
  run<T>(_root: string, _action: (_run: GateAdmissionRun) => Promise<T>, _signal?: AbortSignal): Promise<T>;
}

let admission: GateAdmissionPort | null = null;
/** Composition binds the process capability before any command effects. */
export function configureGateAdmission(port: GateAdmissionPort | null): void { admission = port; }
export function gateAdmission(): GateAdmissionPort {
  if (!admission) { throw new Error('Verification admission is not bound by composition'); }
  return admission;
}

export function assertIndependentGateInvocation(): void { admission?.assertIndependent(); }
