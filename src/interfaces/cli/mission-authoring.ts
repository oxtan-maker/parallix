import type { MissionAuthoringFields, MissionClassification } from '../../domain/mission-authoring.js';
import type { NelBucketLabel } from '../../domain/net-engineering-lines.js';

export const AUTHOR_HELP = `
  px mission author [--slug <slug>] --goal <text> --why <text> --scope <text>
    [--out-of-scope <text> ...] --criterion <text> [--criterion <text> ...]
    --checkpoint <CP-N> --checkpoint-text <text> [--checkpoint ... --checkpoint-text ...]
    --gate <command> [--gate <command> ...] --predicted <Small|Medium|Large>
    --classification <ai_sdlc|user_value|unknown> [--expected-version <n>]

Record the complete draft in one atomic write before execution. Lists replace
recorded lists; checkpoint names and descriptions pair in the order supplied.
Read back with px status. Single-concept commands remain available for edits.
`;

/** Strict typed flags: no request blob, arbitrary patch, or execution fields. */
export function parseMissionAuthoring(args: readonly string[], validateGate: (_command: string) => string | null): MissionAuthoringFields {
  const repeatable = new Set(['--out-of-scope', '--criterion', '--checkpoint', '--checkpoint-text', '--gate']);
  const allowed = new Set([...repeatable, '--slug', '--goal', '--why', '--scope', '--predicted', '--classification', '--expected-version']);
  const values = new Map<string, string[]>();
  for (let index = 1; index < args.length; index += 2) {
    const name = args[index];
    if (!name || !allowed.has(name)) { throw new Error(`Unknown mission author flag: ${name}`); }
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) { throw new Error(`${name} needs a value`); }
    const previous = values.get(name) ?? [];
    if (previous.length && !repeatable.has(name)) { throw new Error(`${name} must be supplied only once`); }
    values.set(name, [...previous, value]);
  }
  const one = (name: string) => {
    const value = values.get(name)?.[0];
    if (value === undefined) { throw new Error(`${name} <value> is required`); }
    return value;
  };
  const many = (name: string) => values.get(name) ?? [];
  const names = many('--checkpoint');
  const descriptions = many('--checkpoint-text');
  if (names.length !== descriptions.length) { throw new Error('--checkpoint and --checkpoint-text must pair up'); }
  const gates = many('--gate');
  for (const gate of gates) {
    const invalid = validateGate(gate);
    if (invalid) { throw new Error(invalid); }
  }
  return {
    brief: { goal: one('--goal'), why: one('--why'), scope: one('--scope'), outOfScope: many('--out-of-scope') },
    criteria: many('--criterion'), checkpoints: names.map((name, index) => ({ name, description: descriptions[index]! })),
    gates, predictedNelBucket: one('--predicted') as NelBucketLabel,
    classification: one('--classification') as MissionClassification,
  };
}
