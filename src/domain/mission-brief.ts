/**
 * The mission brief: what this mission is for.
 *
 * ADR 0053 requires Parallix to persist the goal, the reason the mission
 * exists, its scope and what it leaves out, so a fresh agent can understand the
 * work without reaching the external task provider. This is that state,
 * modelled directly as ADR 0053 asks — not as rows in a generic item bag, and
 * not as prose copied out of the external task.
 *
 * It is deliberately only the four fields the ADR names. Sizing signals belong
 * with NEL and declared gates are a Mission attribute of their own; neither is
 * a brief. Predecessor references have no home yet: Mission-to-Mission
 * references are TASK-2521.04's to model.
 *
 * `goal` and `why` are the brief. `scope` and `outOfScope` bound it and are
 * optional, so a drafting agent can record intent with `px goal set` before it
 * has bounded the work.
 */

export interface MissionBrief {
  readonly goal: string;
  /** Why the mission exists. A goal with no stated reason is not a brief. */
  readonly why: string;
  /** What the mission covers, once bounded. Null while it is not. */
  readonly scope: string | null;
  /**
   * What this mission deliberately does not do.
   *
   * Not the same thing as a constraint on how the work is done: this is the
   * boundary a reviewer checks a diff against, and the wording the drafting and
   * review prompts have always used.
   */
  readonly outOfScope: readonly string[];
}

export class MissionBriefViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MissionBriefViolation';
  }
}

const TEXT_LIMIT = 4_000;
const ITEM_LIMIT = 512;
const MAX_OUT_OF_SCOPE = 16;

function text(value: string, name: string, limit: number): string {
  if (!value || value !== value.trim() || value.length > limit) {
    throw new MissionBriefViolation(`${name} must be trimmed, non-empty and at most ${limit} characters`);
  }
  return value;
}

/** Validated mission brief. Omitted scope stays null rather than becoming empty text. */
export function missionBrief(value: MissionBrief): MissionBrief {
  if (value.outOfScope.length > MAX_OUT_OF_SCOPE) {
    throw new MissionBriefViolation(`out-of-scope must contain at most ${MAX_OUT_OF_SCOPE} items`);
  }
  return {
    goal: text(value.goal, 'goal', TEXT_LIMIT),
    why: text(value.why, 'why', TEXT_LIMIT),
    scope: value.scope === null ? null : text(value.scope, 'scope', TEXT_LIMIT),
    outOfScope: value.outOfScope.map((entry) => text(entry, 'out-of-scope entry', ITEM_LIMIT)),
  };
}
