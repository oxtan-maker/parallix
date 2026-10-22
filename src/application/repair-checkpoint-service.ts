import type { CheckpointEvidenceReferences } from './mission-checkpoint-service.js';
import { findUnverifiableRecordedRow } from './static-evidence.js';
import type { MissionStore } from './domain-ports.js';
import type { OpenRepairCheckpoint, OperatorResumeVerdict, RepairCheckpointPort, RepairVerificationProof } from './ports/repair-checkpoint.js';
import { effectiveRepairObligations, repairOccurrence, sameRepairAuthority, sameRepairOccurrence, validExactExecution } from '../domain/repair-coverage.js';
import { missionId, type Mission } from '../domain/mission.js';
import { assertInvalidContractBlocker, type InvalidContractBlocker } from '../domain/rebound-policy.js';
import { loadForCommand, isLoaded, writeFailure, type MissionCommandRequest } from './mission-command-support.js';
import { completed, failure, type ApplicationOutcome, type Capability } from './contracts.js';
import { carriedGoalCheckRows, freshGoalCheckRows, missingCheckpointEvidence, type CheckpointData } from '../domain/checkpoint.js';

/** Writing an acknowledged stop is a checkpoint write; the same authority as recording over it. */
const RESUME_CAPABILITY: Capability = 'checkpoint:record';

/** Writes through MissionStore CAS; no legacy documents and no agent-authored proof. */
export class RepairCheckpointService implements RepairCheckpointPort {
  constructor(private readonly _store: MissionStore) {}

  private async load(slug: string) {
    const loaded = await this._store.load(missionId(slug));
    if (loaded.kind !== 'found') { throw new Error(`Cannot persist repair checkpoint: Mission ${slug} is ${loaded.kind}`); }
    return loaded;
  }

  async open(request: OpenRepairCheckpoint) {
    const loaded = await this.load(request.slug);
    if (!loaded.mission.brief) { return null; } // Historical document authority remains separate.
    const checkpoints = loaded.mission.checkpoints;
    if (checkpoints.some(cp => cp.repair?.blocker)) { throw new Error('Invalid locked contract awaits operator decision'); }
    const prior = checkpoints.find(cp => cp.repair?.incidentId === request.incidentId);
    const priorRepair = prior?.repair;
    const number = Math.max(0, ...checkpoints.map(cp => Number(cp.name.slice(3)))) + 1;
    if (priorRepair && (JSON.stringify(priorRepair.authorizedGates) !== JSON.stringify(loaded.mission.declaredGates ?? [])
      || JSON.stringify(priorRepair.authorizedCriteria) !== JSON.stringify(loaded.mission.successCriteria ?? []))) {
      throw new Error('Authorized required checks changed during repair; operator decision required');
    }
    const name = prior?.name ?? `CP-${number}`;
    const occurrence = newFailureOccurrence(request, loaded.version + 1);
    const checkpoint: CheckpointData = {
      missionId: loaded.mission.id, name,
      firstLine: `Repair incident ${request.incidentId}: ${request.command}`,
      // Reopening keeps its rows and provenance; a new incident carries accepted coverage.
      goalCheck: prior?.goalCheck ?? carriedGoalCheckRows(checkpoints),
      nextActionText: 'Record authorized repair evidence, complete remaining checkpoints and rerun the authorized required check.',
      repair: { ...priorRepair, incidentId: request.incidentId, command: request.command, authorizedGates: loaded.mission.declaredGates ?? [], authorizedCriteria: loaded.mission.successCriteria ?? [], attempt: request.attempt, evidenceRecorded: false, verified: false,
        occurrence },
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

  /**
   * The operator resume write (TASK-2756).
   *
   * An explicit `px active` acknowledges a retained human-only contract stop:
   * the blocker moves to `acknowledgedBlocker` with its proposal, the
   * acknowledgment names its actor and time, and that checkpoint's repair
   * authorization is refreshed to the current recorded success criteria and
   * declared gates so the resumed work is authorized against the corrected
   * contract. It records no evidence, marks no criterion complete and leaves
   * `verified` as it was: clearing a stop is not a claim that the repair works.
   *
   * A Mission with no aggregate has no stop to clear, so it yields an empty
   * verdict instead of failing the invocation that asked.
   */
  async acknowledgeOperatorResume(request: MissionCommandRequest & { actor: string; occurredAt: string }): Promise<OperatorResumeVerdict> {
    if (!request.capabilities.has(RESUME_CAPABILITY)) { throw new Error(`${RESUME_CAPABILITY} capability is required to acknowledge a recorded execution stop`); }
    const loaded = await this._store.load(request.missionId);
    if (loaded.kind !== 'found') { return { cleared: [], refreshed: [], priorBlockers: [] }; }
    const gates = loaded.mission.declaredGates ?? [];
    const criteria = loaded.mission.successCriteria ?? [];
    const cleared: string[] = [];
    const refreshed: string[] = [];
    const priorBlockers: InvalidContractBlocker[] = [];
    const checkpoints = loaded.mission.checkpoints.map(checkpoint => {
      const repair = checkpoint.repair;
      // A settled repair is history: only an open one owes refreshed authorization.
      if (!repair || repair.verified) { return checkpoint; }
      const staleAuthorization = JSON.stringify(repair.authorizedGates) !== JSON.stringify(gates)
        || JSON.stringify(repair.authorizedCriteria) !== JSON.stringify(criteria);
      if (!repair.blocker && !staleAuthorization) { return checkpoint; }
      if (repair.blocker) {
        const { blocker, ...rest } = repair;
        cleared.push(checkpoint.name);
        priorBlockers.push(blocker);
        return { ...checkpoint, repair: { ...rest, acknowledgedBlocker: blocker, acknowledgedBy: request.actor, acknowledgedAt: request.occurredAt, authorizedGates: gates, authorizedCriteria: criteria } };
      }
      refreshed.push(checkpoint.name);
      return { ...checkpoint, repair: { ...repair, authorizedGates: gates, authorizedCriteria: criteria } };
    });
    if (cleared.length === 0 && refreshed.length === 0) { return { cleared, refreshed, priorBlockers }; }
    await this._store.save({ ...loaded.mission, checkpoints } as Mission, loaded.version);
    return { cleared, refreshed, priorBlockers };
  }

  /** Correct a false stop without manufacturing implementation or gate proof. */
  async correct(request: MissionCommandRequest & { name: string; operator: string; decision: string; evidence: string },
    references: CheckpointEvidenceReferences | undefined, occurredAt: string): Promise<ApplicationOutcome<{ version: number }>> {
    if (!request.capabilities.has('checkpoint:correct')) { return failure('capability', 'checkpoint:correct operator capability is required'); }
    const loaded = await loadForCommand<{ version: number }>(this._store, request);
    if (!isLoaded(loaded)) { return loaded; }
    const checkpoint = loaded.mission.checkpoints.find(cp => cp.name === request.name);
    if (!checkpoint?.repair?.blocker) { return failure('validation', 'Correction requires an unresolved repair blocker'); }
    if (![request.operator, request.decision, request.evidence].every(value => value?.trim())) {
      return failure('validation', 'Correction requires an explicit operator, decision and verifiable evidence');
    }
    const root = references?.rootFor(request.missionId);
    if (!references || !root) { return failure('unavailable', 'Correction evidence reference checkout is unavailable'); }
    const invalid = findUnverifiableRecordedRow(references.fileSystem, [{ criterion: request.decision, evidence: request.evidence }], root);
    if (invalid) { return failure('validation', invalid.message); }
    const corrected = correctRepairBlocker(checkpoint, request.operator, request.decision, request.evidence, occurredAt, loaded.version + 1, loaded.mission.successCriteria ?? []);
    try {
      const version = await this._store.save({ ...loaded.mission,
        checkpoints: loaded.mission.checkpoints.map(cp => cp === checkpoint ? corrected : cp) } as Mission, loaded.version);
      return completed({ version }, []);
    } catch (cause) { return writeFailure(cause); }
  }

  async prepareVerification(slug: string, name: string, scope: { worktree: string; executionRevision: string | null }) {
    const loaded = await this.load(slug);
    const checkpoint = loaded.mission.checkpoints.find(cp => cp.name === name);
    const own = checkpoint && repairOccurrence(checkpoint);
    if (!checkpoint?.repair || !own || !scope.executionRevision || own.worktree !== scope.worktree) { return undefined; }
    const contractFailure = repairContractFailure(loaded.mission.checkpoints, loaded.mission.declaredGates, loaded.mission.successCriteria);
    if (contractFailure) { throw new Error(contractFailure); }
    // Coverage is optional; missing evidence cannot consume a gate rerun or retry.
    // Certification still refuses success without fresh authorized evidence.
    if (!checkpoint.repair.evidenceRecorded || !freshGoalCheckRows(checkpoint.goalCheck).length || !checkpoint.recording) { return undefined; }
    return { missionId: slug, command: checkpoint.repair.command, ...scope, executionRevision: scope.executionRevision,
      executionMissionRevision: loaded.version,
      checkpointEvidenceRevision: checkpoint.recording.missionRevision,
      authorizedGates: [...checkpoint.repair.authorizedGates], authorizedCriteria: [...checkpoint.repair.authorizedCriteria],
      verifiedOccurrence: own,
      coveredOccurrences: effectiveRepairObligations(loaded.mission.checkpoints, loaded.mission.declaredGates, loaded.mission.successCriteria, scope.worktree)
        .filter(cp => cp.name !== name && cp.repair?.command === checkpoint.repair!.command
          && sameRepairAuthority(cp.repair.authorizedGates, checkpoint.repair!.authorizedGates)
          && sameRepairAuthority(cp.repair.authorizedCriteria, checkpoint.repair!.authorizedCriteria))
        .flatMap(cp => { const occurrence = repairOccurrence(cp); return occurrence?.worktree === scope.worktree ? [occurrence] : []; }),
    };
  }

  async verify(slug: string, name: string, proof?: RepairVerificationProof): Promise<void> {
    const loaded = await this.load(slug);
    const checkpoint = loaded.mission.checkpoints.find(cp => cp.name === name);
    if (!checkpoint?.repair || checkpoint.repair.blocker || !checkpoint.repair.evidenceRecorded || !freshGoalCheckRows(checkpoint.goalCheck).length) {
      throw new Error(`Repair checkpoint ${name} needs fresh authorized evidence before repair success`);
    }
    if (JSON.stringify(checkpoint.repair.authorizedGates) !== JSON.stringify(loaded.mission.declaredGates ?? [])
      || JSON.stringify(checkpoint.repair.authorizedCriteria) !== JSON.stringify(loaded.mission.successCriteria ?? [])) {
      throw new Error('Authorized required checks changed during repair; unrelated success is not repair proof');
    }
    if (proof) { this.assertCoverageProof(loaded.mission, checkpoint, proof); }
    const exactSuccessCoverage = proof ? { ...proof.snapshot, producer: 'harness-exact-check' as const,
      verifiedMissionRevision: loaded.version + 1, execution: proof.execution } : undefined;
    await this._store.save({ ...loaded.mission, checkpoints: loaded.mission.checkpoints.map(cp => cp.name === name
      ? { ...cp, repair: { ...checkpoint.repair!, verified: true, ...(exactSuccessCoverage ? { exactSuccessCoverage } : {}) } } : cp) } as Mission, loaded.version);
  }

  private assertCoverageProof(mission: Mission, checkpoint: CheckpointData, proof: RepairVerificationProof): void {
    const { snapshot, execution } = proof;
    const own = repairOccurrence(checkpoint);
    if (snapshot.missionId !== mission.id || proof.command !== checkpoint.repair!.command || proof.command !== snapshot.command
      || !snapshot.worktree || !snapshot.executionRevision || proof.revisionAfter !== snapshot.executionRevision
      || checkpoint.recording?.missionRevision !== snapshot.checkpointEvidenceRevision || !own
      || snapshot.worktree !== own.worktree || !sameRepairOccurrence(snapshot.verifiedOccurrence, own)
      || !this.verificationAuthorityUnchanged(mission, proof)
      || !validExactExecution(execution)
      || !this.coveredOccurrencesUnchanged(mission, proof)) { throw new Error('Exact verification coverage authority, occurrence, revision or provenance changed'); }
  }

  private verificationAuthorityUnchanged(mission: Mission, { snapshot }: RepairVerificationProof): boolean {
    return sameRepairAuthority(snapshot.authorizedGates, mission.declaredGates ?? [])
      && sameRepairAuthority(snapshot.authorizedCriteria, mission.successCriteria ?? [])
      && !repairContractFailure(mission.checkpoints, mission.declaredGates, mission.successCriteria);
  }

  private coveredOccurrencesUnchanged(mission: Mission, { snapshot }: RepairVerificationProof): boolean {
    return !snapshot.coveredOccurrences.some(item => {
        const current = mission.checkpoints.find(cp => cp.name === item.checkpoint);
        const occurrence = current && repairOccurrence(current);
        return !occurrence || !sameRepairOccurrence(item, occurrence) || item.worktree !== snapshot.worktree
          || current!.repair!.command !== snapshot.command
          || !sameRepairAuthority(current!.repair!.authorizedGates, snapshot.authorizedGates)
          || !sameRepairAuthority(current!.repair!.authorizedCriteria, snapshot.authorizedCriteria);
      });
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
export function repairContractFailure(checkpoints: readonly CheckpointData[], gates?: readonly string[], criteria?: readonly string[]): string | null {
  const blocked = checkpoints.find(cp => cp.repair?.blocker);
  if (blocked) { return `Invalid locked contract requires human review: ${JSON.stringify(blocked.repair!.blocker)}`; }
  const obligations = effectiveRepairObligations(checkpoints, gates, criteria);
  if (gates && obligations.some(cp => JSON.stringify(cp.repair!.authorizedGates) !== JSON.stringify(gates))) {
    return 'Authorized required checks changed during repair; operator decision required before handoff.';
  }
  if (criteria && obligations.some(cp => JSON.stringify(cp.repair!.authorizedCriteria) !== JSON.stringify(criteria))) {
    return 'Authorized success criteria changed during repair; operator decision required before handoff.';
  }
  return null;
}

export function repairCheckpointFailure(checkpoints: readonly CheckpointData[], gates?: readonly string[], criteria?: readonly string[]): string | null {
  const contractFailure = repairContractFailure(checkpoints, gates, criteria);
  if (contractFailure) { return contractFailure; }
  const missing = missingCheckpointEvidence(checkpoints, gates, criteria);
  return missing.length ? `Planned checkpoint evidence is missing before handoff: ${missing.map(cp => cp.name).join(', ')}. Record fresh evidence with px checkpoint record before handoff.` : null;
}

/** Shared durable correction fact for a dedicated correction or combined forced evidence write. */
export function correctRepairBlocker(checkpoint: CheckpointData, operator: string, decision: string, evidence: string,
  occurredAt: string, missionRevision: number, currentCriteria: readonly string[]): CheckpointData {
  const { blocker, ...repair } = checkpoint.repair!;
  if (!blocker) { throw new Error('Correction requires an unresolved repair blocker'); }
  return { ...checkpoint, repair: { ...repair, authorizedCriteria: [...currentCriteria],
    acknowledgedBlocker: blocker, acknowledgedBy: operator, acknowledgedAt: occurredAt,
    corrections: [...(repair.corrections ?? []), { blocker, operator, decision, evidence, occurredAt, missionRevision,
      authorizedCriteria: [...repair.authorizedCriteria], authorizedGates: [...repair.authorizedGates] }],
  } };
}

function newFailureOccurrence(request: OpenRepairCheckpoint, openedMissionRevision: number) {
  if (!request.worktree || !request.failureRevision || !request.failureEvidenceId) { return undefined; }
  return { openedMissionRevision, worktree: request.worktree, failureRevision: request.failureRevision, failureEvidenceId: request.failureEvidenceId };
}
