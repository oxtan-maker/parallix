/**
 * Success criteria: what must be true for a Mission to be done.
 *
 * A replaceable list attribute on `Mission`, like declared gates. Execution
 * derives its checkpoint Goal Check rows from these, and review checks the diff
 * against them; before they were recorded here they only existed as a section
 * of the retired mission document.
 */

import { distinctEntries } from './mission-gates.js';

export class MissionSuccessCriteriaViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MissionSuccessCriteriaViolation';
  }
}

/** Validated success criteria, order preserved, duplicates rejected. */
export function successCriteria(values: readonly string[]): readonly string[] {
  return distinctEntries(values, 'success criterion', { length: 512, count: 32 }, (message) => new MissionSuccessCriteriaViolation(message));
}

/**
 * Zero-based positions of the criteria marked complete: sorted, distinct and
 * within the criteria list. Completion is addressed by position, never by text.
 */
export function completedCriteria(indexes: readonly number[], criteriaCount: number): readonly number[] {
  for (const index of indexes) {
    if (!Number.isInteger(index) || index < 0 || index >= criteriaCount) {
      throw new MissionSuccessCriteriaViolation(`success criterion index ${index + 1} is out of range (1-${criteriaCount})`);
    }
  }
  return [...new Set(indexes)].sort((a, b) => a - b);
}

/** Completed positions after the criteria list changes: a criterion keeps its state only if its text survives. */
export function carryCompletion(before: readonly string[], completed: readonly number[], after: readonly string[]): readonly number[] {
  const done = new Set(completed.map((index) => before[index]));
  return after.flatMap((criterion, index) => (done.has(criterion) ? [index] : []));
}
