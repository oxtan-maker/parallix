/**
 * Declared verification gates: the exact commands handoff runs for a Mission.
 *
 * A replaceable attribute on `Mission`, following the precedent `src/domain/
 * README.md` sets for NEL: it describes the mission and has no identity or
 * lifecycle of its own, so it is not an entity. What makes it domain state
 * rather than configuration is that handoff executes exactly these commands —
 * a gate recorded here is a gate that runs.
 *
 * Each value is a runnable repository command and nothing else; the domain does
 * not interpret it, so there is no gate vocabulary to keep in sync.
 */

export class MissionGateViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MissionGateViolation';
  }
}

const COMMAND_LIMIT = 512;
const MAX_GATES = 16;

/**
 * An ordered list of trimmed, non-empty, bounded and distinct entries. Shared by
 * the Mission's list attributes so each states only its own name and bounds.
 */
export function distinctEntries(
  values: readonly string[],
  what: string,
  limits: { readonly length: number; readonly count: number },
  fail: (_message: string) => Error,
): readonly string[] {
  if (values.length > limits.count) { throw fail(`${what}s must contain at most ${limits.count} entries`); }
  const seen = new Set<string>();
  return values.map((value) => {
    if (!value || value !== value.trim() || value.length > limits.length) {
      throw fail(`${what} must be trimmed, non-empty and at most ${limits.length} characters`);
    }
    if (seen.has(value)) { throw fail(`${what} is already declared: ${value}`); }
    seen.add(value);
    return value;
  });
}

/** Validated declared gates, order preserved, duplicates rejected. */
export function declaredGates(values: readonly string[]): readonly string[] {
  return distinctEntries(values, 'gate', { length: COMMAND_LIMIT, count: MAX_GATES }, (message) => new MissionGateViolation(message));
}
