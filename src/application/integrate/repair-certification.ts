import { missionId, type Mission } from '../../domain/mission.js';
import { effectiveRepairObligations } from '../../domain/repair-coverage.js';
import { RepairCheckpointService, repairCheckpointFailure } from '../repair-checkpoint-service.js';
import { runCheckpointVerification } from '../rebound-checkpoints.js';
import type { IntegrationMissionServices, IntegrationGateDefinition } from '../ports/integration-records.js';
import type { IntegrationGateRunResult } from '../ports/integrate-workflow.js';

export function integrationRepairCertified(mission: Mission, worktree?: string): boolean {
  return !repairCheckpointFailure(mission.checkpoints, mission.declaredGates, mission.successCriteria)
    && effectiveRepairObligations(mission.checkpoints, mission.declaredGates, mission.successCriteria, worktree).length === 0;
}

/** Restart uses the same certification owner as an uninterrupted integration rebound. */
export async function verifyRestartedRepair(input: {
  slug: string; services: IntegrationMissionServices; worktree: string; revision: string;
  gates: readonly IntegrationGateDefinition[]; head(): string | null; run(): Promise<IntegrationGateRunResult>;
}): Promise<boolean> {
  const loaded = await input.services.store.load(missionId(input.slug));
  if (loaded.kind !== 'found') { throw new Error('Integration repair mission is unavailable'); }
  const obligations = effectiveRepairObligations(loaded.mission.checkpoints, loaded.mission.declaredGates, loaded.mission.successCriteria, input.worktree);
  const checkpoint = obligations.at(-1);
  const command = checkpoint?.repair?.command ?? '';
  if (checkpoint && (!input.gates.some(gate => gate.command === command) || obligations.some(cp => cp.repair!.command !== command))) {
    throw new Error('Outstanding repair requires its original authorized verifier before integration');
  }
  const verify = async () => {
    const result = await input.run();
    const latest = await input.services.store.load(loaded.mission.id);
    const unchanged = latest.kind === 'found' && latest.version === loaded.version;
    const ok = Boolean(result.ok && !result.cancelled && !result.skipped && unchanged && input.head() === input.revision);
    // A phase result is not a fresh command receipt; do not mint exact-check coverage.
    return { ok, command, diagnostic: result.error ?? '' };
  };
  if (!checkpoint) { return (await verify()).ok; }
  const checked = await runCheckpointVerification({ slug: input.slug, worktree: input.worktree,
    implementer: loaded.mission.assignee ?? '', verify, readHead: input.head,
    startAgent: () => { throw new Error('Restart certification does not launch an agent'); } },
  { fixPrompt: '', repairPort: new RepairCheckpointService(input.services.store),
    repairCheckpoint: { name: checkpoint.name, version: loaded.version } }, checkpoint.repair!.attempt);
  await checked.certify();
  return checked.verified.ok;
}
