import type { Mission } from '../../domain/mission.js';
import type { WorkflowOperation } from '../../domain/workflow-operation.js';
import type {
  GateEvidenceReader,
  GateEvidenceScope,
  GateOutcomeEvidence,
} from '../ports/gate-evidence.js';

/**
 * What the board can say about the gate that applies to a mission now.
 *
 *  - `unconfigured` — no gate is declared or configured for this stage, so
 *    none will run;
 *  - `not-run`      — gates apply but no result exists for them yet;
 *  - `running`      — the gate phase itself is observed in progress for the
 *    owning attempt, with no current result yet;
 *  - `passed` / `failed` — a recorded result covers the current inputs;
 *  - `stale`        — the only results cover an earlier revision or inputs;
 *  - `unavailable`  — the evidence could not be observed.
 */
export type GateState = 'unconfigured' | 'not-run' | 'running' | 'passed' | 'failed' | 'stale' | 'unavailable';

/**
 * One gate's own result. A failure recorded after the passing proof on the same
 * inputs is the newer observation and wins.
 */
function gateResultState(gate: GateOutcomeEvidence): GateState {
  const { proof, failure } = gate;
  const currentFailure = failure?.state === 'current' ? failure : null;
  if (proof.state === 'current' && (!currentFailure || currentFailure.observedAt <= proof.observedAt)) { return 'passed'; }
  if (currentFailure) { return 'failed'; }
  return proof.state === 'stale' || failure !== null ? 'stale' : 'not-run';
}

const PRECEDENCE: readonly GateState[] = ['failed', 'stale', 'not-run', 'passed'];

/** A gate set passes only when every gate does; any failure outranks the rest. */
export function combineGateStates(states: readonly GateState[]): GateState {
  return PRECEDENCE.find(state => states.includes(state)) ?? 'not-run';
}

/**
 * Derives a mission's gate state from typed verification facts and its owning
 * workflow. Lifecycle selects which gates apply and whether a checkout is
 * expected; it never supplies a result.
 */
export class VerificationGateObserver {
  constructor(private readonly _evidence: GateEvidenceReader) {}

  async observeGate(mission: Mission, operation: WorkflowOperation | null): Promise<GateState> {
    const scope: GateEvidenceScope = { repositoryId: mission.repositoryId, missionId: mission.id };
    // An approved mission may integrate from active or review.
    try {
      return mission.status === 'integration' || mission.status === 'done' || operation?.command === 'integrate:merge'
        ? await this.integration(scope, operation)
        : await this.declared(mission, scope);
    } catch {
      return 'unavailable';
    }
  }

  private async declared(mission: Mission, scope: GateEvidenceScope): Promise<GateState> {
    const commands = mission.declaredGates ?? [];
    if (commands.length === 0) { return 'unconfigured'; }
    const evidence = await this._evidence.readDeclaredGates(scope, commands);
    if (evidence.checkout.kind === 'absent') {
      return mission.status === 'backlog' || mission.status === 'refined' ? 'not-run' : 'unavailable';
    }
    const result = combineGateStates(commands.map(command => {
      const gate = evidence.gates.find(candidate => candidate.command === command);
      return gate ? gateResultState(gate) : 'not-run';
    }));
    return result;
  }

  /**
   * The configured plan is observed per gate, so a marker or run record that
   * covers only some hooks never passes the whole plan. Running comes from the
   * executor's own unsettled run record for the open attempt; the integrate
   * workflow's checking phase also covers preflight, rebase and landing, so it
   * cannot stand in for gate execution.
   */
  private async integration(scope: GateEvidenceScope, operation: WorkflowOperation | null): Promise<GateState> {
    const evidence = await this._evidence.readIntegrationGates(scope, operation);
    if (evidence.checkout.kind === 'absent') { return 'unavailable'; }
    if (evidence.configured.length === 0) { return 'unconfigured'; }
    if (evidence.running) { return 'running'; }
    return combineGateStates(evidence.configured.map(key => {
      const gate = evidence.gates.find(candidate => candidate.key === key);
      return gate ? gateResultState(gate) : 'not-run';
    }));
  }
}
