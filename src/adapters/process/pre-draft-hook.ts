import child_process from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { loadAdapterConfig } from '../config/product-config.js';

// A mission worktree is a fresh checkout: nothing the repository installs or
// generates exists in it. A repository opts into preparing it (for example
// installing dependencies) by declaring adapters.draft.preDraftCommand in
// workflow.config.json. It runs once the worktree exists and before any agent
// or gate runs there. Repositories that omit it get no behavior change.

export interface PreDraftHookResult {
  ran: boolean;
  ok: boolean;
  command?: string;
  output?: string;
  exitCode?: number | null;
  durationMs?: number;
  storeState?: StoreState;
  /** Bounded tail of the output, set only when the command failed. */
  failureTail?: string;
}

export type StoreState = 'cold' | 'warm' | 'unknown';

export const FAILURE_TAIL_MAX_CHARS = 2048;

type RunFn = (_cmd: string, _args: string[], _options: Record<string, unknown>) => { status: number | null; stdout: string; stderr: string };

export function resolvePreDraftCommand(rootDir: string): string | null {
  const value = ((loadAdapterConfig(rootDir).draft as Record<string, unknown>) || {}).preDraftCommand;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Cold/warm state of the package store, read from the installer's own summary
 * ("reused N, downloaded M"): any download means the store was cold for this
 * install. Commands that print no such summary report `unknown`.
 */
export function storeStateFromOutput(output: string): StoreState {
  const summaries = [...output.matchAll(/reused (\d+), downloaded (\d+)/g)];
  const last = summaries.at(-1);
  if (!last) { return 'unknown'; }
  return last[2] === '0' ? 'warm' : 'cold';
}

/** Run the configured pre-draft command in the mission worktree. */
export function runPreDraftHook(params: {
  slug: string; worktree: string; runFn?: RunFn;
  /** Monotonic millisecond clock; injectable for tests. */
  nowFn?: () => number;
  logFn?: (_line: string) => void;
}): PreDraftHookResult {
  const command = resolvePreDraftCommand(params.worktree);
  if (!command) { return { ran: false, ok: true }; }
  const runFn = params.runFn || ((cmd: string, args: string[], options: Record<string, unknown>) =>
    child_process.spawnSync(cmd, args, options as child_process.SpawnSyncOptions) as unknown as ReturnType<RunFn>);
  const { nowFn = () => performance.now(), logFn = () => undefined } = params;
  logFn(`pre-draft hook start: slug=${params.slug} command=\`${command}\``);
  const startedAt = nowFn();
  const result = runFn('bash', ['-lc', command], {
    cwd: params.worktree,
    env: { ...process.env, PRE_DRAFT_HOOK_SLUG: params.slug, PRE_DRAFT_HOOK_WORKTREE: params.worktree },
    encoding: 'utf8',
  });
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
  const durationMs = Math.round(nowFn() - startedAt);
  const storeState = storeStateFromOutput(output);
  const ok = result.status === 0;
  logFn(`pre-draft hook end: exit=${result.status} duration=${durationMs}ms store=${storeState}`);
  return { ran: true, ok, command, output, exitCode: result.status, durationMs, storeState, ...(ok ? {} : { failureTail: output.slice(-FAILURE_TAIL_MAX_CHARS) }) };
}
