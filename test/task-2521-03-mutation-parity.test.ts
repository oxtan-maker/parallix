/** TASK-2521.03 parity evidence: legacy agent writes must have a named home. */

import assert from 'node:assert/strict';
import test from 'node:test';

import { KNOWN_COMMANDS } from '../src/interfaces/cli/runtime.js';
import { missionBrief } from '../src/domain/mission-brief.js';
import {
  ASSIGN_HELP, CHECKPOINT_HELP, CRITERION_HELP, GATE_HELP, GOAL_HELP, NEL_HELP, SCOPE_HELP,
} from '../src/interfaces/cli/mission-writes.js';

/** Every typed write help, concatenated: the agent-facing write surface. */
const WRITE_SURFACE = [GOAL_HELP, SCOPE_HELP, CRITERION_HELP, GATE_HELP, NEL_HELP, CHECKPOINT_HELP, ASSIGN_HELP].join('\n');

type Mapping = readonly [legacyMutation: string, replacement: string, authority: 'px' | 'existing' | 'unsupported'];

/**
 * Every brief field, read off a real value rather than restated. A field added
 * to the domain with no parity row fails here, which is what keeps this audit
 * from decaying into a list someone once wrote.
 */
const BRIEF_FIELDS = Object.keys(missionBrief({
  goal: 'g', why: 'w', scope: 's', outOfScope: [],
})).sort();

/** Which parity row owns each brief field. */
const FIELD_OWNER: Readonly<Record<string, string>> = {
  goal: 'goal and why',
  why: 'goal and why',
  scope: 'scope and out-of-scope',
  outOfScope: 'scope and out-of-scope',
};

const MUTATION_PARITY: readonly Mapping[] = [
  ['task creation/title/description/labels', 'existing px draft Mission intake: the Mission aggregate is the only task record (TASK-2521.04)', 'existing'],
  ['task priority', 'unsupported: the Mission aggregate carries no priority and no consumer orders work by it', 'unsupported'],
  ['assignment/unassignment', 'px assign / px unassign', 'px'],
  ['dependency addition/removal', 'unsupported: Mission-to-Mission references, TASK-2521.04', 'unsupported'],
  ['goal and why', 'px goal set', 'px'],
  ['scope and out-of-scope', 'px scope set', 'px'],
  ['predicted NEL bucket', 'px nel set', 'px'],
  ['confidence/selection note/drivers', 'unsupported: no consumer reads them; the predicted NEL bucket is the sizing signal handoff calibrates', 'unsupported'],
  ['success criteria', 'px criterion add / px criterion remove', 'px'],
  ['checkpoint plan', 'px checkpoint plan / px checkpoint unplan', 'px'],
  ['mission gates', 'px gate add / px gate remove', 'px'],
  ['mission activation/state transitions', 'existing px active / px review / px integrate transitions', 'existing'],
  ['checkpoint creation/correction/Goal Check evidence', 'px checkpoint record', 'px'],
  ['review findings/decisions', 'existing px review workflow', 'existing'],
  ['implementer finding resolutions', 'existing px review workflow', 'existing'],
  ['review intervention/escalation', 'existing review workflow; no generic review patch', 'existing'],
  ['mission closeout', 'existing px integrate', 'existing'],
  ['follow-up/bug task creation', 'existing px draft Mission intake of a new Mission', 'existing'],
];

/**
 * Pull `px <command>` tokens out of a text. Anchored on KNOWN_COMMANDS so a
 * parity row or a help line naming a command the CLI does not dispatch fails
 * here rather than rotting silently.
 */
function pxCommands(text: string): Set<string> {
  const seen = new Set<string>();
  const re = /px ([a-z-]+)\b/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) { seen.add(match[1] as string); }
  return seen;
}

test('task-2521.03: every command the write helps name is actually dispatchable', () => {
  for (const command of pxCommands(WRITE_SURFACE)) {
    assert.ok(
      KNOWN_COMMANDS.includes(command),
      `write help names \`px ${command}\`, which is not in KNOWN_COMMANDS`,
    );
  }
});

test('task-2521.03: mutation-parity audit gives every legacy write a reachable authority', () => {
  for (const [legacy, replacement, authority] of MUTATION_PARITY) {
    assert.ok(legacy && replacement, `${legacy} needs a replacement`);
    assert.ok(['px', 'existing', 'unsupported'].includes(authority));
    // AC #3: an unsupported mutation must state the architectural reason, not just decline.
    if (authority === 'unsupported') { assert.match(replacement, /^unsupported: \S/, `${legacy} must give an architectural reason`); }
    // A row claiming a `px` command must name one the CLI dispatches.
    for (const command of pxCommands(replacement)) {
      assert.ok(
        KNOWN_COMMANDS.includes(command),
        `parity row "${legacy}" references unknown command: px ${command}`,
      );
    }
  }
});

test('task-2521.03: every typed write verb appears in the parity audit', () => {
  // Bidirectional: a write command that no parity row claims is an unaudited
  // mutation path, which is exactly what the audit exists to prevent.
  const claimed = new Set(MUTATION_PARITY.flatMap(([, replacement]) => [...pxCommands(replacement)]));
  for (const command of ['goal', 'scope', 'criterion', 'gate', 'nel', 'checkpoint', 'assign', 'unassign']) {
    assert.ok(claimed.has(command), `px ${command} is dispatchable but no parity row claims it`);
  }
});

test('task-2521.03: the write surface exposes no SQL, blob or patch-anything path', () => {
  assert.doesNotMatch(WRITE_SURFACE, /sql|patch-anything|db set/i);
  // AC #11/#13: typed flags only — a JSON request blob is the shape this
  // mission replaced, so its reappearance is a regression.
  assert.doesNotMatch(WRITE_SURFACE, /--data\b|--data-stdin/);
});

test('task-2521.03: every brief field is owned by a parity row', () => {
  const rows = new Set(MUTATION_PARITY.map(([legacy]) => legacy));
  for (const field of BRIEF_FIELDS) {
    const owner = FIELD_OWNER[field];
    assert.ok(owner, `execution-context field \`${field}\` has no parity row; add one or state why it is unsupported`);
    assert.ok(rows.has(owner), `parity row "${owner}" named by field \`${field}\` no longer exists`);
  }
});

