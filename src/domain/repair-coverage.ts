import { freshGoalCheckRows, type CheckpointData } from './checkpoint.js';

/** A failure occurrence, never reconstructed from checkpoint order or command equality. */
export interface RepairOccurrence {
  readonly openedMissionRevision: number;
  readonly worktree: string;
  readonly failureRevision: string;
  readonly failureEvidenceId: string;
}

export interface CoveredRepairOccurrence extends RepairOccurrence {
  readonly checkpoint: string;
  readonly incidentId: string;
  readonly attempt: number;
}

/** Receipt produced by the harness around its exact verifier, not agent evidence. */
export interface ExactSuccessCoverage {
  readonly producer: 'harness-exact-check';
  readonly missionId: string;
  readonly worktree: string;
  readonly command: string;
  readonly authorizedGates: readonly string[];
  readonly authorizedCriteria: readonly string[];
  readonly executionRevision: string;
  readonly executionMissionRevision: number;
  readonly checkpointEvidenceRevision: number;
  readonly verifiedMissionRevision: number;
  readonly execution: {
    readonly id: string;
    readonly producer: 'rebound-exact-verifier';
    readonly startedAt: string;
    readonly completedAt: string;
    readonly exitCode: 0;
  };
  readonly verifiedOccurrence: CoveredRepairOccurrence;
  readonly coveredOccurrences: readonly CoveredRepairOccurrence[];
}

export const sameRepairAuthority = (left: readonly string[], right: readonly string[]) =>
  JSON.stringify(left) === JSON.stringify(right);

export function repairOccurrence(checkpoint: CheckpointData): CoveredRepairOccurrence | undefined {
  const repair = checkpoint.repair;
  const occurrence = repair?.occurrence;
  if (!repair || !occurrence || !Number.isSafeInteger(occurrence.openedMissionRevision)
    || occurrence.openedMissionRevision < 1 || !occurrence.worktree || !occurrence.failureRevision || !occurrence.failureEvidenceId) { return undefined; }
  return { ...occurrence, checkpoint: checkpoint.name, incidentId: repair.incidentId, attempt: repair.attempt };
}

export function sameRepairOccurrence(left: CoveredRepairOccurrence, right: CoveredRepairOccurrence): boolean {
  return left.checkpoint === right.checkpoint && left.incidentId === right.incidentId && left.attempt === right.attempt
    && left.openedMissionRevision === right.openedMissionRevision && left.worktree === right.worktree
    && left.failureRevision === right.failureRevision && left.failureEvidenceId === right.failureEvidenceId;
}

export function validExactExecution(execution: ExactSuccessCoverage['execution']): boolean {
  return execution?.producer === 'rebound-exact-verifier' && Boolean(execution.id) && execution.exitCode === 0
    && Number.isFinite(Date.parse(execution.startedAt)) && Number.isFinite(Date.parse(execution.completedAt))
    && Date.parse(execution.completedAt) >= Date.parse(execution.startedAt);
}

/** Evidence and occurrence links must still describe the certified source. */
function acceptedCoverageSource(source: CheckpointData): ExactSuccessCoverage | undefined {
  const repair = source.repair;
  const proof = repair?.exactSuccessCoverage;
  const own = repairOccurrence(source);
  if (!repair?.verified || repair.blocker || !repair.evidenceRecorded || !freshGoalCheckRows(source.goalCheck).length || !proof || !own) { return undefined; }
  return validCoverageLinks(source, proof, own) ? proof : undefined;
}

function validCoverageLinks(source: CheckpointData, proof: ExactSuccessCoverage, own: CoveredRepairOccurrence): boolean {
  return proof.producer === 'harness-exact-check' && proof.missionId === source.missionId
    && proof.worktree === own.worktree && proof.command === source.repair!.command && Boolean(proof.executionRevision)
    && Boolean(proof.verifiedOccurrence) && sameRepairOccurrence(proof.verifiedOccurrence, own)
    && source.recording?.missionRevision === proof.checkpointEvidenceRevision
    && validCoverageRevisions(proof, own) && validExactExecution(proof.execution);
}

function validCoverageRevisions(proof: ExactSuccessCoverage, own: CoveredRepairOccurrence): boolean {
  return proof.checkpointEvidenceRevision >= own.openedMissionRevision
    && proof.executionMissionRevision >= proof.checkpointEvidenceRevision
    && proof.verifiedMissionRevision > proof.executionMissionRevision;
}

function compatibleCoverageAuthority(proof: ExactSuccessCoverage, source: CheckpointData, target: CheckpointData,
  gates?: readonly string[], criteria?: readonly string[]): boolean {
  return sameRepairAuthority(proof.authorizedGates, source.repair!.authorizedGates)
    && sameRepairAuthority(proof.authorizedCriteria, source.repair!.authorizedCriteria)
    && sameRepairAuthority(proof.authorizedGates, target.repair!.authorizedGates)
    && sameRepairAuthority(proof.authorizedCriteria, target.repair!.authorizedCriteria)
    && (!gates || sameRepairAuthority(proof.authorizedGates, gates))
    && (!criteria || sameRepairAuthority(proof.authorizedCriteria, criteria));
}

/** Invalid or incomplete receipts supply no coverage. Blockers always remain visible. */
export function isExplicitlyCovered(checkpoint: CheckpointData, checkpoints: readonly CheckpointData[],
  gates?: readonly string[], criteria?: readonly string[], worktree?: string): boolean {
  const target = repairOccurrence(checkpoint);
  if (!target || checkpoint.repair?.blocker || (worktree && target.worktree !== worktree)) { return false; }
  return checkpoints.some(source => {
    const proof = acceptedCoverageSource(source);
    if (!proof || source.missionId !== checkpoint.missionId || proof.worktree !== target.worktree
      || proof.command !== checkpoint.repair?.command || !compatibleCoverageAuthority(proof, source, checkpoint, gates, criteria)) { return false; }
    return proof.coveredOccurrences?.some(item => sameRepairOccurrence(item, target)
      && item.openedMissionRevision <= proof.executionMissionRevision) ?? false;
  });
}

/** One selection rule for continuation, contract validation and evidence readiness. */
export function effectiveRepairObligations(checkpoints: readonly CheckpointData[], gates?: readonly string[],
  criteria?: readonly string[], worktree?: string): readonly CheckpointData[] {
  return checkpoints.filter(cp => cp.repair && !cp.repair.verified && !isExplicitlyCovered(cp, checkpoints, gates, criteria, worktree));
}
