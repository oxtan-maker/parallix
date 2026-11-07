import type { BoardLane } from './projections/mission-board.js';
import { integrationPrevalidationDecision, type SupervisorPort } from './recovery-contract.js';

const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error);

/** Opportunistically pre-validate one human-owned integration candidate. */
export async function prevalidateIntegration(
  port: SupervisorPort,
  missionId: string,
  lane: BoardLane,
  signal?: AbortSignal,
): Promise<string | null> {
  if (lane !== 'integration' || !port.observeIntegrationPrevalidation || !port.runIntegrationDryRun) { return null; }
  try {
    const observation = await port.observeIntegrationPrevalidation(missionId);
    const decision = integrationPrevalidationDecision(observation);
    if (decision === 'already-validated') { return 'integration dry-run not needed: current successful gate evidence covers the candidate'; }
    if (decision === 'cpu-unavailable') { return 'integration dry-run not admitted: machine CPU utilization is unavailable'; }
    if (decision === 'cpu-busy') {
      return `integration dry-run not admitted: machine CPU utilization is ${(observation.cpuUtilization! * 100).toFixed(1)}% (must be below 30%)`;
    }
    const release = await port.claimRecovery(missionId);
    if (!release) { return 'integration dry-run not admitted: another supervisor run holds the mission claim'; }
    try {
      const beforeDispatch = await port.liveness(missionId);
      if (signal?.aborted) { throw new Error('supervision was interrupted before dry-run admission'); }
      if (beforeDispatch.working) {
        return `integration dry-run not admitted: ${beforeDispatch.detail ?? 'current work is live'}`;
      }
      await port.runIntegrationDryRun(missionId, signal);
      return `ran px integrate ${missionId} --dry-run at ${(observation.cpuUtilization! * 100).toFixed(1)}% machine CPU; landing remains human-owned`;
    } finally {
      await release();
    }
  } catch (error) {
    return `integration dry-run pre-validation failed: ${errorText(error)}; landing remains human-owned`;
  }
}
