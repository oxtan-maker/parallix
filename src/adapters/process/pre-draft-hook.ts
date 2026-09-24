import child_process from 'node:child_process';
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
}

type RunFn = (_cmd: string, _args: string[], _options: Record<string, unknown>) => { status: number | null; stdout: string; stderr: string };

export function resolvePreDraftCommand(rootDir: string): string | null {
  const value = ((loadAdapterConfig(rootDir).draft as Record<string, unknown>) || {}).preDraftCommand;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Run the configured pre-draft command in the mission worktree. */
export function runPreDraftHook(params: { slug: string; worktree: string; runFn?: RunFn }): PreDraftHookResult {
  const command = resolvePreDraftCommand(params.worktree);
  if (!command) { return { ran: false, ok: true }; }
  const runFn = params.runFn || ((cmd: string, args: string[], options: Record<string, unknown>) =>
    child_process.spawnSync(cmd, args, options as child_process.SpawnSyncOptions) as unknown as ReturnType<RunFn>);
  const result = runFn('bash', ['-lc', command], {
    cwd: params.worktree,
    env: { ...process.env, PRE_DRAFT_HOOK_SLUG: params.slug, PRE_DRAFT_HOOK_WORKTREE: params.worktree },
    encoding: 'utf8',
  });
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
  return { ran: true, ok: result.status === 0, command, output, exitCode: result.status };
}
