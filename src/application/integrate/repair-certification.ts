import { StructuredFailure, failureReason, recognizedFailureReason } from '../../domain/failure-reason.js';
import type { VerifyResult } from '../rebound-kernel.js';
import { missionId, type Mission } from '../../domain/mission.js';
import { effectiveRepairObligations } from '../../domain/repair-coverage.js';
import { RepairCheckpointService, repairCheckpointFailure } from '../repair-checkpoint-service.js';
import { runCheckpointVerification } from '../rebound-checkpoints.js';
import type { IntegrationMissionServices, IntegrationGateDefinition } from '../ports/integration-records.js';
import type { IntegrationGateRunResult } from '../ports/integrate-workflow.js';
import { completeIntegrationGateRunReceipt } from './integration-gate-receipt.js';

export function integrationRepairCertified(mission: Mission, worktree?: string): boolean {
  return !repairCheckpointFailure(mission.checkpoints, mission.declaredGates, mission.successCriteria)
    && effectiveRepairObligations(mission.checkpoints, mission.declaredGates, mission.successCriteria, worktree).length === 0;
}

/** Restart uses the same certification owner as an uninterrupted integration rebound. */
export async function verifyRestartedRepair(input: {
  slug: string; services: IntegrationMissionServices; worktree: string; revision: string;
  gates: readonly IntegrationGateDefinition[]; head(): string | null; run(): Promise<IntegrationGateRunResult>;
  exact?: () => Promise<VerifyResult>;
}): Promise<boolean> {
  const loaded = await input.services.store.load(missionId(input.slug));
  if (loaded.kind !== 'found') { throw new Error('Integration repair mission is unavailable'); }
  const obligations = effectiveRepairObligations(loaded.mission.checkpoints, loaded.mission.declaredGates, loaded.mission.successCriteria, input.worktree);
  const checkpoint = obligations.at(-1);
  const commands = [...new Set(obligations.map(cp => cp.repair!.command))];
  if (checkpoint && commands.some(command => !input.gates.some(gate => gate.command === command))) {
    throw new Error('Outstanding repair requires its original authorized verifier before integration');
  }
  const verify = () => verifyPinnedRepair(input, commands, loaded.version);
  if (!checkpoint) { return (await verify()).ok; }
  const checked = await runCheckpointVerification({ slug: input.slug, worktree: input.worktree,
    implementer: loaded.mission.assignee ?? '', verify, readHead: input.head,
    startAgent: () => { throw new Error('Restart certification does not launch an agent'); } },
  { fixPrompt: '', repairPort: new RepairCheckpointService(input.services.store),
    repairCheckpoint: { name: obligations[0].name, version: loaded.version },
    repairCheckpointRefs: obligations.length > 1 ? obligations.map(cp => ({ gateKey: cp.repair!.gateKey ?? cp.name,
      command: cp.repair!.command, name: cp.name, version: loaded.version })) : [] }, checkpoint.repair!.attempt);
  await checked.certify();
  return checked.verified.ok;
}

async function verifyPinnedRepair(input: Parameters<typeof verifyRestartedRepair>[0], commands: readonly string[], version: number): Promise<VerifyResult> {
  const command = commands[0] ?? '';
  const exact = input.exact;
  assertRestartVerifier(exact, commands);
  const result = exact ? await exact() : await input.run();
  const latest = await input.services.store.load(missionId(input.slug));
  const unchanged = latest.kind === 'found' && latest.version === version && input.head() === input.revision;
  if (exact) { return exactRepairResult(result as VerifyResult, command, input.worktree, unchanged); }
  return phaseRepairResult(input, result as IntegrationGateRunResult, commands, command, unchanged);
}

function assertRestartVerifier(exact: (() => Promise<VerifyResult>) | undefined, commands: readonly string[]): void {
  if (exact && commands.length > 1) {
    throw new StructuredFailure('Aggregate repair restart requires the authoritative configured gate rerun', failureReason('incomplete-evidence', 'verification'));
  }
}

function phaseRepairResult(input: Parameters<typeof verifyRestartedRepair>[0], phase: IntegrationGateRunResult,
  commands: readonly string[], command: string, unchanged: boolean): VerifyResult {
  if (commands.length > 1) {
    const complete = unchanged && completeIntegrationGateRunReceipt(input.gates, phase);
    return { ok: complete, command, diagnostic: complete ? '' : phase.error ?? 'Aggregate integration rerun coverage is incomplete',
      ...(complete ? { exactExecutions: commands.map(item => ({ command: item, worktree: input.worktree, exitCode: 0 as const })) } : {}) };
  }
  // Legacy single-command phase results remain valid without an exact receipt.
  return { ok: Boolean(phase.ok && !phase.cancelled && !phase.skipped && unchanged), command, diagnostic: phase.error ?? '' };
}

function exactRepairResult(result: VerifyResult, command: string, worktree: string, unchanged: boolean): VerifyResult {
  const receipt = result.exactExecution;
  const complete = receipt?.command === command && receipt.worktree === worktree && receipt.exitCode === 0;
  if (result.ok && complete && unchanged) { return { ...result, command }; }
  const prior = result.reason && 'failureReason' in result.reason ? recognizedFailureReason(result.reason.failureReason) : null;
  const code = !unchanged ? 'state-machine' : result.ok ? 'incomplete-evidence' : 'gate-failed';
  throw new StructuredFailure(result.diagnostic?.trim() || `Exact repair verification failed: ${command}`, prior ?? failureReason(code, 'verification'));
}
