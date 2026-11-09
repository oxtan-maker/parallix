import type { IntegrationGateDefinition } from '../ports/integration-records.js';
import type { IntegrationGateRunResult } from '../ports/integrate-workflow.js';

/** A passing integration run covers every selected gate with one exact green outcome. */
export function completeIntegrationGateRunReceipt(
  gates: readonly IntegrationGateDefinition[],
  result: IntegrationGateRunResult,
): boolean {
  if (!result.ok || result.phase !== 'integration' || result.dryRun || result.skipped || result.cancelled
    || result.executed !== gates.length || !Array.isArray(result.outcomes) || result.outcomes.length !== gates.length) {
    return false;
  }
  return gates.every(gate => result.outcomes!.some(outcome => outcome.key === gate.key
    && outcome.command === gate.command && outcome.exitCode === 0));
}
