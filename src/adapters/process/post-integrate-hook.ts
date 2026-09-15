import child_process from 'node:child_process';
import { loadAdapterConfig } from '../config/product-config.js';

// parallix targets arbitrary repositories. A repo opts into post-success
// integrate maintenance (e.g. keeping a self-hosted global runner current) by
// declaring adapters.integrate.postIntegrateCommand in workflow.config.json.
// Repos that omit it get no post-integrate behavior change, mirroring the
// adapters.verification.command opt-in pattern.

export interface PostIntegrateHookParams {
  slug: string;
  baseWorktree: string;
  baseBranch: string;
  variant: string;
  /** Directory to resolve config from and run in; defaults to baseWorktree. */
  cwd?: string;
  processEnv?: NodeJS.ProcessEnv;
  runFn?: (_cmd: string, _args: string[], _options: Record<string, unknown>) => { status: number | null; stdout: string; stderr: string };
  resolveCommandFn?: (_rootDir: string) => string | null;
}

export interface PostIntegrateHookResult {
  ran: boolean;
  ok: boolean;
  command?: string;
  output?: string;
  exitCode?: number | null;
}

function resolveIntegrateCommand(rootDir: string, key: 'preCommitCommand' | 'postIntegrateCommand'): string | null {
  const config = loadAdapterConfig(rootDir);
  const value = ((config.integrate as Record<string, unknown>) || {})[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function resolvePostIntegrateCommand(rootDir: string = process.cwd()): string | null {
  return resolveIntegrateCommand(rootDir, 'postIntegrateCommand');
}

// adapters.integrate.preCommitCommand runs before the landed squash commit is
// created, so repo-owned metadata (e.g. a version bump) lands inside it.
export function resolvePreCommitCommand(rootDir: string = process.cwd()): string | null {
  return resolveIntegrateCommand(rootDir, 'preCommitCommand');
}

export function buildPostIntegrateHookEnv(params: PostIntegrateHookParams): NodeJS.ProcessEnv {
  return {
    ...(params.processEnv || process.env),
    INTEGRATE_HOOK_SLUG: params.slug,
    INTEGRATE_HOOK_BASE_WORKTREE: params.baseWorktree,
    INTEGRATE_HOOK_BASE_BRANCH: params.baseBranch,
    INTEGRATE_HOOK_VARIANT: params.variant,
  };
}

// Runs at most once per call site. Callers are responsible for invoking this
// exactly once per successful integrate path (Variant B and the resumed-from-
// existing-squash-commit path each call it from their own single success seam,
// so no shared invocation counter is needed).
export function runPostIntegrateHook(params: PostIntegrateHookParams): PostIntegrateHookResult {
  const resolveCommandFn = params.resolveCommandFn || resolvePostIntegrateCommand;
  const cwd = params.cwd || params.baseWorktree;
  const command = resolveCommandFn(cwd);
  if (!command) {
    return { ran: false, ok: true };
  }

  const runFn = params.runFn || ((cmd: string, args: string[], options: Record<string, unknown>) => child_process.spawnSync(cmd, args, options as child_process.SpawnSyncOptions) as unknown as { status: number | null; stdout: string; stderr: string });
  const env = buildPostIntegrateHookEnv(params);
  const result = runFn('bash', ['-lc', command], {
    cwd,
    env,
    encoding: 'utf8'
  });

  const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
  const exitCode = result.status;
  return { ran: true, ok: exitCode === 0, command, output, exitCode };
}

export function runPreCommitHook(params: PostIntegrateHookParams): PostIntegrateHookResult {
  return runPostIntegrateHook({ ...params, resolveCommandFn: params.resolveCommandFn || resolvePreCommitCommand });
}
