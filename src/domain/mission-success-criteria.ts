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
