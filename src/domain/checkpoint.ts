import type { MissionId } from './mission.js';

/** One Goal Check evidence row. Handoff requires each row to cite a verifiable
 * reference (recognized command, test name, ADR, or test-file path; file:line is accepted when necessary). */
export interface GoalCheckRow {
  readonly criterion: string;
  readonly evidence: string;
}

export interface CheckpointData {
  readonly missionId: MissionId;
  /** Normalized name (e.g. "CP-2"). Used for board rendering and sorting. */
  readonly name: string;
  /** Original filename with .md extension (e.g. "CP-2.md"). Preserves legacy output contract.
   * Optional for backward compatibility; defaults to name when absent. */
  readonly rawFilename?: string;
  /** First line of the checkpoint file (e.g. "CP-2: Status Command Re-implemented"). Preserves legacy output contract.
   * Optional for backward compatibility; defaults to empty string when absent. */
  readonly firstLine?: string;
  readonly goalCheck: readonly GoalCheckRow[];
  /** Operator guidance rendered in checkpoint and board views; never executed. */
  readonly nextActionText: string;
}

const CP_NAME_PATTERN = /^CP-\d+$/;

export function isCheckpointName(value: string): boolean {
  return CP_NAME_PATTERN.test(value);
}

/** True when a checkpoint carries at least one Goal Check row and a
 * non-empty next action — the minimum handoff accepts. */
export function isHandoffReadyCheckpoint(cp: CheckpointData): boolean {
  return (
    isCheckpointName(cp.name) &&
    cp.goalCheck.length > 0 &&
    cp.nextActionText.trim().length > 0
  );
}

/**
 * Checkpoints are replaceable mission evidence. Re-recording CP-1 after a
 * mission is redone replaces the earlier CP-1 view; Git retains the revisions.
 */
export function recordCheckpoint(
  checkpoints: readonly CheckpointData[],
  replacement: CheckpointData,
): CheckpointData[] {
  if (!isHandoffReadyCheckpoint(replacement)) {
    throw new Error(`Checkpoint ${replacement.name} is not ready for handoff`);
  }
  assertGoalCheckRows(replacement.goalCheck);
  if (checkpoints.some((checkpoint) => checkpoint.missionId !== replacement.missionId)) {
    throw new Error('Cannot record checkpoint evidence from another mission');
  }
  // Recording evidence for a planned checkpoint keeps what it was planned to
  // deliver unless the evidence supplies its own description.
  const planned = checkpoints.find((checkpoint) => checkpoint.name === replacement.name);
  const recorded = replacement.firstLine || !planned?.firstLine ? replacement : { ...replacement, firstLine: planned.firstLine };
  return byNumber([...checkpoints.filter((checkpoint) => checkpoint.name !== replacement.name), recorded]);
}

function byNumber(checkpoints: CheckpointData[]): CheckpointData[] {
  return checkpoints.sort((left, right) => Number(left.name.slice(3)) - Number(right.name.slice(3)));
}

/**
 * Plan a checkpoint: its name and what it delivers, with no evidence yet.
 *
 * A checkpoint is planned at draft and evidenced during execution, and both
 * are the same `CheckpointData`: evidence recorded under the planned name
 * replaces it in place. The planned checkpoints without Goal Check rows are
 * where a relaunched agent resumes.
 */
export function planCheckpoint(
  checkpoints: readonly CheckpointData[],
  planned: { readonly missionId: CheckpointData['missionId']; readonly name: string; readonly description: string },
): CheckpointData[] {
  if (!isCheckpointName(planned.name)) { throw new Error(`Checkpoint name must look like CP-1: ${planned.name}`); }
  const description = planned.description.trim();
  if (!description || description.length > 512) { throw new Error('Checkpoint description must be non-empty and at most 512 characters'); }
  if (checkpoints.some((checkpoint) => checkpoint.name === planned.name)) { throw new Error(`Checkpoint ${planned.name} is already planned`); }
  return byNumber([...checkpoints, { missionId: planned.missionId, name: planned.name, firstLine: description, goalCheck: [], nextActionText: '' }]);
}

/**
 * Planned and not yet evidenced: no Goal Check rows and no checkpoint document.
 * A document read from a mission drafted before recorded checkpoints is real
 * progress even when its table did not parse, so it is never "only planned".
 */
export function isPlannedCheckpoint(checkpoint: CheckpointData): boolean {
  return checkpoint.goalCheck.length === 0 && !checkpoint.rawFilename;
}

/** The most recent checkpoint that is progress rather than only a plan. */
export function latestEvidencedCheckpoint(checkpoints: readonly CheckpointData[]): CheckpointData | null {
  return [...checkpoints].reverse().find((checkpoint) => !isPlannedCheckpoint(checkpoint)) ?? null;
}

/**
 * Goal Check rows the final checkpoint still lacks. Handoff requires the latest
 * recorded checkpoint to carry one row per success criterion; zero when covered.
 */
export function finalGoalCheckShortfall(rows: readonly GoalCheckRow[], successCriteriaCount: number): number {
  return Math.max(0, successCriteriaCount - rows.length);
}

/** Reject blank Goal Check text before it can reach persistence. */
export function assertGoalCheckRows(rows: readonly GoalCheckRow[]): void {
  for (const row of rows) {
    if (row.criterion.trim().length === 0) { throw new Error('Checkpoint goal criterion must not be empty'); }
    if (row.evidence.trim().length === 0) { throw new Error('Checkpoint goal evidence must not be empty'); }
  }
}
