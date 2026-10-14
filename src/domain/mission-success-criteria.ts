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

export interface SuccessCriterion { readonly id: string; readonly text: string }

/** IDs are mission-scoped, monotonically allocated and never reused. Text-only
 * replacements retain exact matches; text edits must carry the existing ID. */
export function replaceSuccessCriteria(
  mission: import('./mission.js').Mission, texts: readonly string[], ids?: readonly (string | null)[],
): import('./mission.js').Mission {
  const before = mission.successCriteria ?? [];
  let next = mission.nextSuccessCriterionId ?? 1;
  const previousIds = mission.successCriterionIds ?? before.map(() => `sc-${next++}`);
  if (ids && ids.length !== texts.length) { throw new MissionSuccessCriteriaViolation('Criterion IDs must pair with criterion texts'); }
  const assigned = texts.map((text, index) => {
    const requested = ids?.[index];
    if (typeof requested === 'string' && !previousIds.includes(requested)) { throw new MissionSuccessCriteriaViolation(`Unknown criterion ID: ${requested}`); }
    return requested ?? (ids ? null : previousIds[before.indexOf(text)]) ?? `sc-${next++}`;
  });
  if (new Set(assigned).size !== assigned.length) { throw new MissionSuccessCriteriaViolation('Criterion IDs must be distinct'); }
  const completed = new Set((mission.completedSuccessCriteria ?? []).map(index => previousIds[index]));
  return { ...mission, successCriteria: texts, successCriterionIds: assigned, nextSuccessCriterionId: next,
    completedSuccessCriteria: assigned.flatMap((id, index) => completed.has(id) ? [index] : []) };
}

export function criterionContract(mission: Pick<import('./mission.js').Mission, 'successCriteria' | 'successCriterionIds'>): readonly SuccessCriterion[] {
  return (mission.successCriteria ?? []).map((text, index) => ({ id: mission.successCriterionIds?.[index] ?? '', text }));
}

/** Exact matching only; an explicit null is retained as unknown legacy identity. */
export function identifyGoalCheckRows(rows: readonly import('./checkpoint.js').GoalCheckRow[], criteria: readonly SuccessCriterion[]) {
  return rows.map(row => ({ ...row, criterionId: row.criterionId !== undefined ? row.criterionId
    : criteria.find(criterion => criterion.text === row.criterion)?.id || null }));
}
