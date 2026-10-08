import type { MissionId } from './mission.js';

/** One Goal Check evidence row. Handoff requires each row to cite a verifiable
 * reference (recognized command, test name, ADR, or test-file path; file:line is accepted when necessary). */
export interface GoalCheckRow {
  readonly criterion: string;
  readonly evidence: string;
  /**
   * Review round current when the row was recorded; absent when the Mission had
   * no review yet. A repair round owes fresh rows stamped with its own number, so
   * a row kept from an earlier round is distinguishable from a repair's fix.
   */
  readonly recordedRound?: number;
  /** Integration gate (or command) this row was recorded to repair; keeps the criterion owed when that gate fails again. */
  readonly repairedGate?: string;
  /** All integration gates previously repaired by this criterion; retained across later updates. */
  readonly repairedGates?: readonly string[];
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
 * Success-criterion identities with no evidence row in any recorded checkpoint.
 * A row covers the criterion whose identity its `criterion` field equals, so
 * repeated rows for one criterion do not count as coverage for another: coverage
 * is the union of the identities the rows name, not a sum of row counts. Returns
 * the uncovered identities in `requiredCriteria` order; empty when every required
 * criterion is covered. Because coverage is the union across every recorded
 * checkpoint, a repair checkpoint that carries only its affected criteria does
 * not read as a shortfall while earlier evidence for the others is retained.
 */
export function uncoveredCriteria(
  checkpoints: readonly { readonly goalCheck: readonly GoalCheckRow[] }[],
  requiredCriteria: readonly string[],
): readonly string[] {
  const covered = new Set<string>();
  for (const checkpoint of checkpoints) {
    for (const row of checkpoint.goalCheck) {
      if (typeof row.criterion === 'string' && row.criterion.length > 0) {
        covered.add(row.criterion);
      }
    }
  }
  return requiredCriteria.filter((criterion) => !covered.has(criterion));
}

/**
 * When re-recording a checkpoint, retain prior rows for criteria the new record
 * does not touch so a repair records only its affected criteria without rewriting
 * the whole Goal Check table. New rows take precedence for a criterion they share
 * with earlier evidence; criteria introduced by the new record are appended.
 */
export function retainPriorGoalCheckRows(
  priorRows: readonly GoalCheckRow[],
  newRows: readonly GoalCheckRow[],
): GoalCheckRow[] {
  if (priorRows.length === 0) {
    return [...newRows];
  }
  const priorByCriterion = new Map(priorRows.map((row) => [row.criterion, row] as const));
  // New rows overwrite a shared criterion in place and append criteria the
  // earlier evidence did not cover, preserving order.
  for (const row of newRows) {
    priorByCriterion.set(row.criterion, row);
  }
  return [...priorByCriterion.values()];
}

/**
 * Success-criterion identities with no evidence row in any recorded checkpoint.
 * Handoff requires every completed criterion to be named by a row across the
 * recorded checkpoints; empty when all are covered. A row covers the criterion
 * whose identity its `criterion` field equals, so a repair row for one criterion
 * does not count as evidence for another.
 */
export function uncoveredCompletedCriteria(
  checkpoints: readonly { readonly goalCheck: readonly GoalCheckRow[] }[],
  successCriteria: readonly string[],
  completedSuccessCriteria: readonly number[],
): readonly string[] {
  const completed = successCriteria.filter((_, index) => completedSuccessCriteria.includes(index));
  return uncoveredCriteria(checkpoints, completed);
}

/** Reject blank Goal Check text before it can reach persistence. */
export function assertGoalCheckRows(rows: readonly GoalCheckRow[]): void {
  for (const row of rows) {
    if (row.criterion.trim().length === 0) { throw new Error('Checkpoint goal criterion must not be empty'); }
    if (row.evidence.trim().length === 0) { throw new Error('Checkpoint goal evidence must not be empty'); }
  }
}

/**
 * Fresh repair proof the open repair round still owes. `affected` names the
 * criteria the reviewer's findings pin down; when it is empty the repair context
 * does not say which criteria are affected, so at least one row must have been
 * recorded in the repair round. Returns the criteria lacking a fresh row, or
 * `['(any)']` when no criterion is named and no fresh row exists; empty when the
 * repair has supplied what it owes.
 */
export function staleRepairCriteria(
  checkpoints: readonly { readonly goalCheck: readonly GoalCheckRow[] }[],
  repair: { readonly round: number; readonly affected: readonly string[] },
): readonly string[] {
  const fresh = new Set<string>();
  for (const checkpoint of checkpoints) {
    for (const row of checkpoint.goalCheck) {
      if (row.recordedRound === repair.round) { fresh.add(row.criterion); }
    }
  }
  if (repair.affected.length === 0) { return fresh.size > 0 ? [] : ['(any)']; }
  return repair.affected.filter((criterion) => !fresh.has(criterion));
}
