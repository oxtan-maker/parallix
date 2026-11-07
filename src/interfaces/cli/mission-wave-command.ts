import type { MissionWaveService } from '../../application/mission-wave-service.js';
import type { MissionWaveChildContract } from '../../domain/mission-wave.js';
import type { MissionClassification } from '../../domain/mission-authoring.js';
import type { NelBucketLabel } from '../../domain/net-engineering-lines.js';
import { fail, helped, output, request, required, requireOperator, unwrap } from './mission-write-support.js';

interface Services {
  readonly resolveSlug: (_explicit?: string) => string | null;
  readonly wave: MissionWaveService;
}

export const SPLIT_HELP = `
Usage: px split [--slug <slug>] [--expected-version <n>]
  --child <title> [--child-description <text>] --child-goal <text> --child-why <text> --child-scope <text>
    [--child-out-of-scope <text> ...] --child-criterion <text> [--child-criterion ...]
    --child-checkpoint <CP-N> --child-checkpoint-text <text>
    --child-gate <command> [--child-gate ...] --child-predicted <Small|Medium>
    --child-classification <ai_sdlc|user_value> [--child-depends-on <position> ...]
  --child <title> ...

Split one already-authored Large backlog Mission into at least two complete,
independently deliverable child Missions in one atomic write. Child identities
are assigned as parent.01 through parent.99. Read the result with px status.
`.trimStart();

export const RISK_EXCEPTION_HELP = `
Usage: px risk-exception [--slug <slug>] --reason <text> --operator <name>
                         [--expected-version <n>]

Record a direct operator decision to keep one Large Mission whole because
decomposition would be less safe. Nested or agent-hosted invocations are refused.
`.trimStart();

export function createSplitCommand(services: Services, validateGate: (_command: string) => string | null = () => null) {
  return async (args: string[] = []): Promise<void> => {
    if (helped(args, SPLIT_HELP)) { return; }
    const children = parseChildren(args, validateGate);
    output(unwrap(await services.wave.convert({ ...request(args, 'split', services.resolveSlug), children }), 'split'));
  };
}

export function createRiskExceptionCommand(services: Services, operatorInvocation = false) {
  return async (args: string[] = []): Promise<void> => {
    if (helped(args, RISK_EXCEPTION_HELP)) { return; }
    requireOperator(operatorInvocation, 'Large-mission risk approval');
    output(unwrap(await services.wave.approveRiskException({ ...request(args, 'risk-exception', services.resolveSlug),
      rationale: required(args, '--reason'), approvedBy: required(args, '--operator'), approvedAt: new Date().toISOString() }), 'risk-exception'));
  };
}

function parseChildren(args: readonly string[], validateGate: (_command: string) => string | null): readonly MissionWaveChildContract[] {
  const firstChild = args.indexOf('--child');
  if (firstChild < 0) { fail('split requires at least two --child groups'); }
  const prefix = args.slice(0, firstChild);
  for (let index = 0; index < prefix.length; index += 2) {
    const name = prefix[index]; const value = prefix[index + 1];
    if (name !== '--slug' && name !== '--expected-version') { fail(`Unknown split flag: ${name}`); }
    if (value === undefined || value.startsWith('--')) { fail(`${name} needs a value`); }
  }
  const groups: string[][] = [];
  for (const arg of args.slice(firstChild)) {
    if (arg === '--child') { groups.push([]); }
    groups.at(-1)!.push(arg);
  }
  if (groups.length < 2) { fail('split requires at least two --child groups'); }
  return groups.map((group, position) => parseChild(group, position, validateGate));
}

function parseChild(group: readonly string[], position: number, validateGate: (_command: string) => string | null): MissionWaveChildContract {
  const repeatable = new Set(['--child-out-of-scope', '--child-criterion', '--child-checkpoint', '--child-checkpoint-text', '--child-gate', '--child-depends-on']);
  const allowed = new Set([...repeatable, '--child', '--child-description', '--child-goal', '--child-why', '--child-scope', '--child-predicted', '--child-classification']);
  const values = new Map<string, string[]>();
  for (let index = 0; index < group.length; index += 2) {
    const name = group[index]; const value = group[index + 1];
    if (!name || !allowed.has(name)) { fail(`Unknown split child ${position + 1} flag: ${name}`); }
    if (value === undefined || value.startsWith('--')) { fail(`${name} needs a value`); }
    const prior = values.get(name) ?? [];
    if (prior.length && !repeatable.has(name)) { fail(`${name} must be supplied only once per child`); }
    values.set(name, [...prior, value]);
  }
  const one = (name: string) => {
    const value = values.get(name)?.[0];
    if (value === undefined) { fail(`${name} <value> is required for split child ${position + 1}`); }
    return value;
  };
  const many = (name: string) => values.get(name) ?? [];
  const checkpoints = many('--child-checkpoint'); const descriptions = many('--child-checkpoint-text');
  if (checkpoints.length !== descriptions.length) { fail(`Split child ${position + 1} checkpoint names and descriptions must pair up`); }
  const gates = many('--child-gate');
  for (const gate of gates) { const invalid = validateGate(gate); if (invalid) { fail(invalid); } }
  return {
    title: one('--child'), description: values.get('--child-description')?.[0] ?? null,
    brief: { goal: one('--child-goal'), why: one('--child-why'), scope: one('--child-scope'), outOfScope: many('--child-out-of-scope') },
    criteria: many('--child-criterion'), checkpoints: checkpoints.map((name, index) => ({ name, description: descriptions[index]! })),
    gates, predictedNelBucket: one('--child-predicted') as NelBucketLabel,
    classification: one('--child-classification') as MissionClassification,
    dependsOn: many('--child-depends-on').map(value => {
      const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed < 1) { fail(`--child-depends-on must be a positive child position, got: ${value}`); }
      return parsed;
    }),
  };
}
