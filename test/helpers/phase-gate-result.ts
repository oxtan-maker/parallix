import type { GateRunOutcome, PhaseGateRunResult } from '../../src/adapters/config/repository-gates.js';

/** Complete simulated gate receipts for workflow and adapter contracts. */
export function phaseGateResult(
  overrides: Partial<Omit<PhaseGateRunResult, 'failedGate'>> & { failedGate?: Partial<GateRunOutcome> | null } = {},
): PhaseGateRunResult {
  const failedGate = overrides.failedGate ? {
    key: 'fixture-gate', command: 'false', exitCode: 1, stdout: '', stderr: '', ...overrides.failedGate,
  } : null;
  return {
    ok: failedGate === null,
    phase: 'integration',
    gates: failedGate ? [{ key: failedGate.key, command: failedGate.command, order: 0 }] : [],
    executed: failedGate ? 1 : 0,
    skipped: false,
    dryRun: false,
    error: null,
    ...overrides,
    failedGate,
  };
}
