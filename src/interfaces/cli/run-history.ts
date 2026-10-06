/**
 * `px history` and `px attach` argument parsing and rendering (TASK-2643).
 *
 * `history` is the bounded, citable retrieval surface agents and operators use
 * on a Mission's retained agent runs. `attach` is the operator's terminal
 * surface for a persistent mission terminal. Both are scoped to one Mission.
 */
import type { RunSearchResult, RunShowResult, RunSummary } from '../../application/run-history.js';
import type { RunStreamName } from '../../application/run-history-types.js';

export type HistoryCliRequest =
  | { readonly verb: 'list'; readonly slug?: string; readonly json: boolean }
  | { readonly verb: 'search'; readonly slug?: string; readonly json: boolean; readonly pattern: string; readonly regex: boolean; readonly runId?: string; readonly stream?: RunStreamName; readonly maxHits?: number }
  | { readonly verb: 'show'; readonly slug?: string; readonly json: boolean; readonly ref: string; readonly context: number };

export interface AttachCliRequest {
  readonly slug?: string;
  readonly readOnly: boolean;
  readonly list: boolean;
  readonly close?: boolean;
}

export const HISTORY_USAGE = [
  'Usage: px history [<slug>] list [--json]',
  '       px history [<slug>] search <pattern> [--regex] [--run <run-id>] [--stream stdout|stderr] [--max <n>] [--json]',
  '       px history [<slug>] show <run:...ref> [--context <bytes>] [--json]',
].join('\n');

export const ATTACH_USAGE = 'Usage: px attach [<slug>] [--read-only] [--list] [--close]';

const VERBS = new Set(['list', 'search', 'show']);
const VALUE_FLAGS = new Set(['--run', '--stream', '--max', '--context', '--role']);

function split(args: readonly string[]): { positionals: string[]; flags: Map<string, string | true> } {
  const positionals: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith('--')) { positionals.push(arg); continue; }
    if (VALUE_FLAGS.has(arg)) {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('--')) { throw new Error(`${arg} requires a value`); }
      flags.set(arg, value);
      i += 1;
    } else {
      flags.set(arg, true);
    }
  }
  return { positionals, flags };
}

function nonNegativeInt(value: string | true | undefined, flag: string): number | undefined {
  if (value === undefined) { return undefined; }
  const parsed = Number(value);
  if (value === true || !Number.isInteger(parsed) || parsed < 0) { throw new Error(`${flag} must be a non-negative integer`); }
  return parsed;
}

export function parseHistoryCliRequest(args: readonly string[]): HistoryCliRequest {
  const { positionals, flags } = split(args);
  const slug = positionals.length > 0 && !VERBS.has(positionals[0]) ? positionals.shift() : undefined;
  const verb = positionals.shift();
  const json = flags.get('--json') === true;
  const known = new Set(['--json', '--regex', ...VALUE_FLAGS]);
  for (const flag of flags.keys()) {
    if (!known.has(flag) || flag === '--role') { throw new Error(`unknown flag ${flag}\n${HISTORY_USAGE}`); }
  }
  if (verb === 'list' && positionals.length === 0) { return { verb, slug, json }; }
  if (verb === 'search' && positionals.length === 1) {
    const stream = flags.get('--stream');
    if (stream !== undefined && stream !== 'stdout' && stream !== 'stderr') { throw new Error('--stream must be stdout or stderr'); }
    const runId = flags.get('--run');
    return {
      verb, slug, json,
      pattern: positionals[0],
      regex: flags.get('--regex') === true,
      ...(typeof runId === 'string' ? { runId } : {}),
      ...(stream ? { stream: stream as RunStreamName } : {}),
      ...(flags.has('--max') ? { maxHits: nonNegativeInt(flags.get('--max'), '--max') } : {}),
    };
  }
  if (verb === 'show' && positionals.length === 1) {
    return { verb, slug, json, ref: positionals[0], context: nonNegativeInt(flags.get('--context'), '--context') ?? 0 };
  }
  throw new Error(HISTORY_USAGE);
}

export function parseAttachCliRequest(args: readonly string[]): AttachCliRequest {
  const { positionals, flags } = split(args);
  for (const flag of flags.keys()) {
    if (!['--read-only', '--list', '--close'].includes(flag)) { throw new Error(`unknown flag ${flag}\n${ATTACH_USAGE}`); }
  }
  if (positionals.length > 1) { throw new Error(ATTACH_USAGE); }
  if (flags.has('--close') && [...flags.keys()].some(flag => flag !== '--close')) { throw new Error('--close cannot be combined with attach selectors or watching flags'); }
  return {
    ...(positionals[0] ? { slug: positionals[0] } : {}),
    readOnly: flags.get('--read-only') === true,
    list: flags.get('--list') === true,
    ...(flags.has('--close') ? { close: true } : {}),
  };
}

export function renderRunList(runs: readonly RunSummary[]): string {
  if (runs.length === 0) { return 'No retained agent runs for this Mission.'; }
  return runs.map(({ record, state, coverage }) => [
    `${record.runId}  ${state}${record.exitCode !== null ? ` exit=${record.exitCode}` : ''}${record.signal ? ` signal=${record.signal}` : ''}  host=${record.terminalHost}  started=${record.startedAt}`,
    ...coverage.map(line => `  - ${line}`),
  ].join('\n')).join('\n');
}

export function renderSearch(result: RunSearchResult): string {
  const lines = [`${result.totalHits} match(es) in ${result.searchedRuns.length} run(s); showing ${result.hits.length}.`];
  for (const hit of result.hits) {
    lines.push(`${hit.ref}`, ...hit.preview.split('\n').map(line => `    ${line}`));
  }
  if (result.totalHits > result.hits.length) { lines.push(`(${result.totalHits - result.hits.length} more; narrow with --run, --stream or a longer pattern)`); }
  lines.push('Coverage:', ...result.coverage.map(line => `  - ${line}`));
  lines.push(...result.errors.map(error => `Error: ${error}`));
  return lines.join('\n');
}

export function renderShow(result: RunShowResult): string {
  if (!result.ok) { return `${result.error}: ${result.detail}`; }
  return [
    `${result.ref}${result.clamped ? ' (clamped to the show bound; request a later offset for more)' : ''}`,
    result.text ?? '',
    'Coverage:',
    ...(result.coverage ?? []).map(line => `  - ${line}`),
  ].join('\n');
}

/** What the history and attach commands need from the composition root. */
export interface RunHistoryCliPort {
  list(_slug: string | undefined): readonly RunSummary[];
  search(_slug: string | undefined, _query: Extract<HistoryCliRequest, { verb: 'search' }>): RunSearchResult;
  /** `null` when `ref` is not a run-history reference. */
  show(_slug: string | undefined, _ref: string, _context: number): RunShowResult | null;
  attach(_request: AttachCliRequest): void;
}

export function createHistoryCommand(port: RunHistoryCliPort, log: (_line: string) => void = console.log) {
  return async (args: string[]): Promise<void> => {
    const request = parseHistoryCliRequest(args);
    if (request.verb === 'list') {
      const runs = port.list(request.slug);
      log(request.json ? JSON.stringify(runs, null, 2) : renderRunList(runs));
      return;
    }
    if (request.verb === 'search') {
      const result = port.search(request.slug, request);
      log(request.json ? JSON.stringify(result, null, 2) : renderSearch(result));
      return;
    }
    const result = port.show(request.slug, request.ref, request.context);
    if (!result) { throw new Error(`Not a run-history reference: ${request.ref} (expected run:<run-id>:<stdout|stderr>@<offset>+<length>)`); }
    log(request.json ? JSON.stringify(result, null, 2) : renderShow(result));
    if (!result.ok) { process.exitCode = 1; }
  };
}

export function createAttachCommand(port: RunHistoryCliPort) {
  return async (args: string[]): Promise<void> => { port.attach(parseAttachCliRequest(args)); };
}
