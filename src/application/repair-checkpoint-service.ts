import type { MissionStore } from './domain-ports.js';
import type { RepairCheckpointPort } from './ports/repair-checkpoint.js';
import { missionId, type Mission } from '../domain/mission.js';
import { assertInvalidContractBlocker, type InvalidContractBlocker } from '../domain/rebound-policy.js';
import { loadForCommand, isLoaded, writeFailure, type MissionCommandRequest } from './mission-command-support.js';
import { completed, failure, type ApplicationOutcome } from './contracts.js';
import type { CheckpointData } from '../domain/checkpoint.js';

/** Writes through MissionStore CAS; no legacy documents and no agent-authored proof. */
export class RepairCheckpointService implements RepairCheckpointPort {
  constructor(private readonly _store: MissionStore) {}

  private async load(slug: string) {
    const loaded = await this._store.load(missionId(slug));
    if (loaded.kind !== 'found') { throw new Error(`Cannot persist repair checkpoint: Mission ${slug} is ${loaded.kind}`); }
    return loaded;
  }

  async open(request: { slug: string; incidentId: string; command: string; attempt: number }) {
    const loaded = await this.load(request.slug);
    if (!loaded.mission.brief) { return null; } // Historical document authority remains separate.
    const checkpoints = loaded.mission.checkpoints;
    if (checkpoints.some(cp => cp.repair?.blocker)) { throw new Error('Invalid locked contract awaits operator decision'); }
    const prior = checkpoints.find(cp => cp.repair?.incidentId === request.incidentId);
    const number = Math.max(0, ...checkpoints.map(cp => Number(cp.name.slice(3)))) + 1;
    if (prior?.repair && (JSON.stringify(prior.repair.authorizedGates) !== JSON.stringify(loaded.mission.declaredGates ?? [])
      || JSON.stringify(prior.repair.authorizedCriteria) !== JSON.stringify(loaded.mission.successCriteria ?? []))) {
      throw new Error('Authorized required checks changed during repair; operator decision required');
    }
    const name = prior?.name ?? `CP-${number}`;
    const checkpoint: CheckpointData = {
      missionId: loaded.mission.id, name,
      firstLine: `Repair incident ${request.incidentId}: ${request.command}`,
      goalCheck: prior?.goalCheck ?? [],
      nextActionText: 'Record authorized repair evidence, complete remaining checkpoints and rerun the authorized required check.',
      repair: { incidentId: request.incidentId, command: request.command, authorizedGates: loaded.mission.declaredGates ?? [], authorizedCriteria: loaded.mission.successCriteria ?? [], attempt: request.attempt, evidenceRecorded: false, verified: false },
    };
    const version = await this._store.save({ ...loaded.mission,
      checkpoints: [...checkpoints.filter(cp => cp.name !== name), checkpoint],
    } as Mission, loaded.version);
    return { name, version };
  }

  async readBlocker(slug: string, name: string): Promise<InvalidContractBlocker | undefined> {
    const loaded = await this.load(slug);
    return loaded.mission.checkpoints.find(cp => cp.name === name)?.repair?.blocker;
  }

  async verify(slug: string, name: string): Promise<void> {
    const loaded = await this.load(slug);
    const checkpoint = loaded.mission.checkpoints.find(cp => cp.name === name);
    if (!checkpoint?.repair || checkpoint.repair.blocker || !checkpoint.repair.evidenceRecorded || !checkpoint.goalCheck.length) {
      throw new Error(`Repair checkpoint ${name} needs fresh authorized evidence before repair success`);
    }
    if (JSON.stringify(checkpoint.repair.authorizedGates) !== JSON.stringify(loaded.mission.declaredGates ?? [])
      || JSON.stringify(checkpoint.repair.authorizedCriteria) !== JSON.stringify(loaded.mission.successCriteria ?? [])) {
      throw new Error('Authorized required checks changed during repair; unrelated success is not repair proof');
    }
    await this._store.save({ ...loaded.mission, checkpoints: loaded.mission.checkpoints.map(cp => cp.name === name
      ? { ...cp, repair: { ...checkpoint.repair!, verified: true } } : cp) } as Mission, loaded.version);
  }

  async report(request: MissionCommandRequest & { name: string; blocker: InvalidContractBlocker }): Promise<ApplicationOutcome<{ version: number }>> {
    if (!request.capabilities.has('checkpoint:record')) { return failure('capability', 'checkpoint:record capability is required'); }
    const loaded = await loadForCommand<{ version: number }>(this._store, request);
    if (!isLoaded(loaded)) { return loaded; }
    try {
      assertInvalidContractBlocker(request.blocker);
      const checkpoint = loaded.mission.checkpoints.find(cp => cp.name === request.name);
      if (!checkpoint?.repair) { throw new Error('Invalid-contract report requires a harness-created repair checkpoint'); }
      if (checkpoint.repair.command !== request.blocker.command) { throw new Error('Blocker command must equal the authorized required check'); }
      const version = await this._store.save({ ...loaded.mission, checkpoints: loaded.mission.checkpoints.map(cp => cp.name === request.name
        ? { ...cp, repair: { ...checkpoint.repair!, blocker: request.blocker, verified: false } } : cp) } as Mission, loaded.version);
      return completed({ version }, []);
    } catch (cause) { return writeFailure(cause); }
  }
}

/** Shared by both handoff paths: plans and incident freshness remain visible. */
export function repairCheckpointFailure(checkpoints: readonly CheckpointData[], gates?: readonly string[], criteria?: readonly string[]): string | null {
  const blocked = checkpoints.find(cp => cp.repair?.blocker);
  if (blocked) { return `Invalid locked contract requires human review: ${JSON.stringify(blocked.repair!.blocker)}`; }
  if (gates && checkpoints.some(cp => cp.repair && !cp.repair.verified && JSON.stringify(cp.repair.authorizedGates) !== JSON.stringify(gates))) {
    return 'Authorized required checks changed during repair; operator decision required before handoff.';
  }
  if (criteria && checkpoints.some(cp => cp.repair && !cp.repair.verified && JSON.stringify(cp.repair.authorizedCriteria) !== JSON.stringify(criteria))) {
    return 'Authorized success criteria changed during repair; operator decision required before handoff.';
  }
  const missing = checkpoints.filter(cp => !cp.goalCheck.length || (cp.repair && !cp.repair.evidenceRecorded));
  return missing.length ? `Planned checkpoint evidence is missing before handoff: ${missing.map(cp => cp.name).join(', ')}. Record fresh evidence with px checkpoint record before handoff.` : null;
}
