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
  if (checkpoints.some((checkpoint) => checkpoint.missionId !== replacement.missionId)) {
    throw new Error('Cannot record checkpoint evidence from another mission');
  }
  const retained = checkpoints.filter((checkpoint) => checkpoint.name !== replacement.name);
  return [...retained, replacement].sort(
    (left, right) => Number(left.name.slice(3)) - Number(right.name.slice(3)),
  );
}
