import type { CheckpointData } from '../../domain/checkpoint.js';
import { effectiveRepairObligations } from '../../domain/repair-coverage.js';

export interface RepairBudgetFacts {
  readonly attemptsUsed: number;
  readonly maxAttempts: number;
  readonly exhausted: boolean;
}

function usableRepair(repair: unknown): RepairBudgetFacts | null {
  if (!repair || typeof repair !== 'object') { return null; }
  const { attemptsUsed, maxAttempts } = repair as { attemptsUsed?: unknown; maxAttempts?: unknown };
  if (!Number.isSafeInteger(attemptsUsed) || Number(attemptsUsed) < 0
    || !Number.isSafeInteger(maxAttempts) || Number(maxAttempts) < 1
    || Number(attemptsUsed) > Number(maxAttempts)) { return null; }
  return {
    attemptsUsed: Number(attemptsUsed),
    maxAttempts: Number(maxAttempts),
    exhausted: attemptsUsed === maxAttempts,
  };
}

/** Latest unresolved retained repair budget; incomplete legacy facts stay absent. */
export function projectRepairBudget(checkpoints: readonly CheckpointData[]): RepairBudgetFacts | null {
  const checkpoint = effectiveRepairObligations(checkpoints).at(-1);
  if (!checkpoint) { return null; }
  return usableRepair(checkpoint.repair);
}
