/**
 * Mission dependencies: the Missions this Mission is recorded as depending on.
 *
 * A replaceable list attribute on `Mission`, like declared gates and success
 * criteria. Each entry is a Mission id, so the reference points at the only
 * self-hosted task record there is — never at an external task key.
 *
 * Nothing enforces them. No lifecycle, activation or scheduling rule reads
 * them: they are recorded so an operator or agent reading `px status` knows
 * what came first. Ordering is the order they were recorded in and carries no
 * meaning beyond that.
 */

import { distinctEntries } from './mission-gates.js';
import { missionId, type MissionId } from './mission.js';

export class MissionDependencyViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MissionDependencyViolation';
  }
}

const SLUG_LIMIT = 128;
const MAX_DEPENDENCIES = 32;

function violation(message: string): Error {
  return new MissionDependencyViolation(message);
}

/**
 * Validated dependencies: Mission ids, order preserved, duplicates rejected.
 *
 * `owner` is the depending Mission, so a self-reference is refused here rather
 * than by a database constraint alone.
 */
export function missionDependencies(
  values: readonly string[],
  owner: MissionId,
): readonly MissionId[] {
  const entries = distinctEntries(
    values,
    'mission dependency',
    { length: SLUG_LIMIT, count: MAX_DEPENDENCIES },
    violation,
  );
  return entries.map((entry) => {
    if (entry === owner) { throw violation(`mission ${owner} cannot depend on itself`); }
    try {
      return missionId(entry);
    } catch {
      throw violation(`mission dependency is not a mission slug: ${entry}`);
    }
  });
}
