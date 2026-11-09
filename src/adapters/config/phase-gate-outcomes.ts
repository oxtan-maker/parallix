import type { VerificationMeasurement } from '../../application/ports/verification-observation.js';
import type { IntegrationGateEvidenceOutcome } from '../../application/ports/integration-verification-evidence.js';
import type { RepositoryGate } from './repository-gate-schema.js';
import type { GateLog, GatePhase } from './repository-gates.js';

/** Result of running a configured gate. */
export interface GateRunOutcome {
  cpu?: VerificationMeasurement['cpu'];
  reused?: boolean;
  failureReason?: import('../../domain/failure-reason.js').FailureReason;
  signal?: string | null;
  key: string;
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs?: number;
}

/** A gate that never ran because a prerequisite failed or was itself blocked. */
export interface BlockedGate {
  key: string;
  command: string;
  /** The failed or blocked prerequisites that prevented the launch. */
  blockedBy: string[];
}

/** Result of running a phase's gates. */
export interface PhaseGateRunResult {
  /** True when every configured gate passed (or no gates were configured). */
  ok: boolean;
  phase: GatePhase;
  /** Gates that were configured for this phase. */
  gates: RepositoryGate[];
  /** Number of gates actually executed. */
  executed: number;
  /** True when no gates were configured (nothing ran). */
  skipped: boolean;
  /** True when the run was a plan-only dry run that executed nothing. */
  dryRun: boolean;
  /** Operator cancelled the active gate process groups. */
  cancelled?: boolean;
  /** The first failing gate, if any. Compatible singular projection of `failures`. */
  failedGate: GateRunOutcome | null;
  /** Every actual failure in settle order; integration continues past failures, other phases stop at the first. */
  failures?: GateRunOutcome[];
  /** Integration gates that did not run because a prerequisite failed. */
  blocked?: BlockedGate[];
  /** Integration gates stopped or never started by operator cancellation. */
  cancelledGates?: string[];
  /** Complete captured output for every gate that ran. */
  outcomes?: GateRunOutcome[];
  /** Whether the complete phase minted reusable integration proof. */
  proofReusable?: boolean;
  error: string | null;
}

const DIAGNOSTIC_TAIL = 4000;

/** Moves pending gates whose prerequisites failed or were blocked into `blocked`, transitively. */
export function blockDependents(pending: RepositoryGate[], failed: readonly GateRunOutcome[], blocked: BlockedGate[]): void {
  for (let moved = true; moved;) {
    moved = false;
    const unmet = new Set([...failed.map(outcome => outcome.key), ...blocked.map(gate => gate.key)]);
    for (let index = pending.length - 1; index >= 0; index--) {
      const blockedBy = (pending[index].after ?? []).filter(dependency => unmet.has(dependency));
      if (blockedBy.length === 0) { continue; }
      const [gate] = pending.splice(index, 1);
      blocked.push({ key: gate.key, command: gate.command, blockedBy });
      moved = true;
    }
  }
}

/** Distinct per-gate evidence: passes, failures with diagnostics, blocked and cancelled parts. */
export function evidenceOutcomes(gates: readonly RepositoryGate[], outcomes: readonly GateRunOutcome[], blocked: readonly BlockedGate[],
  cancelledKeys: ReadonlySet<string>): IntegrationGateEvidenceOutcome[] {
  return gates.flatMap((gate): IntegrationGateEvidenceOutcome[] => {
    const ran = outcomes.find(outcome => outcome.key === gate.key);
    const stopped = blocked.find(item => item.key === gate.key);
    if (stopped) { return [{ key: gate.key, command: gate.command, exitCode: null, result: 'blocked', blockedBy: stopped.blockedBy }]; }
    if (!ran) { return cancelledKeys.has(gate.key) ? [{ key: gate.key, command: gate.command, exitCode: null, result: 'cancelled' }] : []; }
    const base = { key: ran.key, command: ran.command, exitCode: ran.exitCode };
    if (cancelledKeys.has(ran.key)) { return [{ ...base, result: 'cancelled', signal: ran.signal ?? null }]; }
    if (ran.exitCode === 0) { return [{ ...base, result: 'passed' }]; }
    const diagnostics = [ran.stdout, ran.stderr].filter(text => text?.trim()).join('\n').trim().slice(-DIAGNOSTIC_TAIL);
    return [{ ...base, result: 'failed', signal: ran.signal ?? null, diagnostics }];
  });
}

/** One aggregate line plus a line per failed, blocked, and cancelled part. */
export function phaseSummary(phase: GatePhase, failures: readonly GateRunOutcome[], blocked: readonly BlockedGate[], cancelledKeys: readonly string[]): string[] {
  const counts = `${failures.length} failed, ${blocked.length} blocked, ${cancelledKeys.length} cancelled`;
  return [`Repository gates (${phase}) did not pass: ${counts}.`,
    ...failures.map(outcome => `  ✗ ${outcome.key} failed (exit ${outcome.exitCode ?? 'unknown'}${outcome.signal ? `, signal ${outcome.signal}` : ''}): ${outcome.command}`),
    ...blocked.map(gate => `  ⊘ ${gate.key} blocked by ${gate.blockedBy.join(', ')}: not run`),
    ...cancelledKeys.map(key => `  × ${key} cancelled`)];
}

export function renderGateOutput(phase: GatePhase, outcome: GateRunOutcome, log: GateLog): void {
  log(`\n--- Repository gate (${phase}): ${outcome.key} output (exit ${outcome.exitCode ?? 'unknown'}) ---`);
  log(`Command: ${outcome.command}`);
  if (outcome.stdout) { log(outcome.stdout.trimEnd()); }
  if (outcome.stderr) { log(outcome.stderr.trimEnd()); }
  log(`--- End repository gate (${phase}): ${outcome.key} ---`);
}
