import { failureReason, normalizeProcessFailure } from '../../domain/failure-reason.js';
export { inspectGitContention } from './git-contention.js';
import { runAdmittedGitAsync, spawnAdmittedGit } from './git-mutation-admission.js';
import { spawn, spawnSync } from 'node:child_process';
import type { SpawnOptions, SpawnSyncOptions } from 'node:child_process';
import * as fsMod from 'node:fs';
import * as pathMod from 'node:path';
import * as osMod from 'node:os';
import { withAsyncCommandProgress, withCommandProgress } from './command-progress.js';
import { commandProgressLabel } from './command-identity.js';

export interface GitOptions {
  /** Explicit wall bound for admission; default waits until release/cancellation. */
  gitWaitLimitMs?: number;
  signal?: AbortSignal;
  progressLabel?: string;
  encoding?: BufferEncoding;
  stdio?: import('node:child_process').StdioOptions;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  maxBuffer?: number;
  [key: string]: unknown;
}

export interface GitResult {
  failureReason?: import('../../domain/failure-reason.js').FailureReason;
  status: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  error?: Error | null;
}

// spawnSync reports a capture overflow as ENOBUFS and can still hand back exit 0 with the
// stdout it managed to read, so `status === 0` never proves the output is complete.
const OUTPUT_LIMIT_CODES = new Set(['ENOBUFS', 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER']);
/** Node's spawnSync default when the caller does not declare one. */
const DEFAULT_CAPTURE_LIMIT = 1024 * 1024;
const NARROW_RECOVERY = 'the incomplete output was rejected instead of accepted; narrow the query or read it in bounded parts';

/** The child produced more than the capture allows; the retained output is incomplete. */
export class CommandOutputLimitError extends Error {
  readonly code: string;
  readonly operation: string;
  readonly limitBytes: number | null;
  constructor(operation: string, code: string, limitBytes: number | null, recovery: string) {
    super(`${operation} produced more output than its ${limitBytes ?? 'unknown'} byte capture limit allows (${code}); ${recovery}`);
    this.name = 'CommandOutputLimitError';
    this.code = code;
    this.operation = operation;
    this.limitBytes = limitBytes;
  }
}

/** Subcommand only. Global `-C`/`-c` values are worktree paths and config, never shown. */
function subcommandLabel(command: string, args: readonly string[]): string {
  const executable = pathMod.basename(command);
  if (executable !== 'git') { return executable; }
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '-C' || arg === '-c') { index++; continue; }
    if (arg.startsWith('-')) { continue; }
    return `git ${arg}`;
  }
  return executable;
}

function rejectOutputLimit(error: Error | undefined, operation: string, limitBytes: number | null): void {
  const code = (error as { code?: string } | undefined)?.code ?? '';
  if (OUTPUT_LIMIT_CODES.has(code)) { throw new CommandOutputLimitError(operation, code, limitBytes, NARROW_RECOVERY); }
}

/** Name check, so a boundary can turn an output-limit failure into a structured result. */
export function isOutputLimitFailure(error: unknown): error is CommandOutputLimitError {
  return (error as { name?: string } | undefined)?.name === 'CommandOutputLimitError';
}

export function git(args: string[], options: GitOptions = {}): GitResult {
  const { progressLabel, ...processOptions } = options;
  const spawnOptions: SpawnSyncOptions = {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'] as const,
    ...processOptions,
    env: { ...process.env, ...processOptions.env, GIT_OPTIONAL_LOCKS: '0' },
  };
  // Never include remote URLs/arguments: authenticated Git URLs contain tokens.
  const operation = args.find(value => ['push', 'fetch', 'rebase', 'commit', 'merge'].includes(value));
  const execute = () => spawnAdmittedGit(args, spawnOptions, spawnSync);
  const result = operation
    ? withCommandProgress(progressLabel ?? `git ${operation}`, execute, {
      ...(options.stdio === 'inherit' ? { animate: false as const } : {}),
    }) : execute();
  rejectOutputLimit(result.error, subcommandLabel('git', args),
    typeof processOptions.maxBuffer === 'number' ? processOptions.maxBuffer : DEFAULT_CAPTURE_LIMIT);
  if (result.error && result.status === null) {
    throw result.error;
  }
  const reason = gitFailureIdentity(result, args, options, operation);
  return { status: result.status, signal: result.signal, stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? ''), error: result.error, failureReason: reason };
}

function gitFailureIdentity(result: Pick<ReturnType<typeof spawnSync>, 'status' | 'signal'>, args: string[], options: GitOptions, operation: string | undefined) {
  let reason = result.status === 0 && !result.signal ? undefined : failureReason('git-failed', 'git', { operation: subcommandLabel('git', args), exitCode: result.status });
  if (result.status !== 0 && (operation === 'rebase' || operation === 'merge')) {
    const state = spawnSync('git', [...(options.cwd ? [] : args.slice(0, args.indexOf(operation))), 'ls-files', '-u'], { encoding: 'utf8', cwd: options.cwd });
    if (state.status === 0 && String(state.stdout ?? '').trim()) { reason = failureReason('git-conflict', 'git', { operation }); }
    else if (operation === 'merge' && args.includes('--abort')) {
      const head = spawnSync('git', [...(options.cwd ? [] : args.slice(0, args.indexOf(operation))), 'rev-parse', '-q', '--verify', 'MERGE_HEAD'], { encoding: 'utf8', cwd: options.cwd });
      if (head.status === 1) { reason = failureReason('git-no-merge', 'git'); }
    }
  }
  return reason;
}

export function run(command: string, args: string[], options: GitOptions = {}): GitResult {
  const { progressLabel, ...processOptions } = options;
  const spawnOptions: SpawnSyncOptions = {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'] as const,
    ...processOptions,
    env: { ...process.env, ...processOptions.env, GIT_OPTIONAL_LOCKS: '0' },
  };
  // codeql[js/shell-command-injection-from-environment] -- `command` is the git executable and `args` are internal filesystem paths
  // (repo root, config dirs) resolved from trusted sources, never user input;
  // spawnSync runs with no shell, so there is no command-injection surface.
  const execute = () => pathMod.basename(command) === 'git' ? spawnAdmittedGit(args, spawnOptions, spawnSync) : spawnSync(command, args, spawnOptions);
  const result = options.stdio === 'ignore' || args.includes('--help')
    ? execute()
    : withCommandProgress(commandProgressLabel(command, args, progressLabel), execute, {
      ...(options.stdio === 'inherit' ? { animate: false as const } : {}),
    });
  rejectOutputLimit(result.error, subcommandLabel(command, args),
    typeof processOptions.maxBuffer === 'number' ? processOptions.maxBuffer : DEFAULT_CAPTURE_LIMIT);
  if (result.error && result.status === null) {
    throw result.error;
  }
  return { status: result.status, signal: result.signal, stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? ''), error: result.error, failureReason: normalizeProcessFailure({ status: result.status, signal: result.signal, error: result.error }) };
}

/** Node's spawnSync default, so a caller that never set maxBuffer keeps its bound. */
const DEFAULT_MAX_CAPTURE_BYTES = 1024 * 1024;
const CAPTURE_POLL_MS = 50;
const OVERFLOW_TERMINATION_GRACE_MS = 1000;

function readTail(file: string, maxBytes: number): string {
  const size = fsMod.statSync(file).size;
  if (size <= maxBytes) { return fsMod.readFileSync(file, 'utf8'); }
  const buffer = Buffer.alloc(maxBytes);
  const fd = fsMod.openSync(file, 'r');
  try { fsMod.readSync(fd, buffer, 0, maxBytes, size - maxBytes); } finally { fsMod.closeSync(fd); }
  return buffer.toString('utf8');
}

/** A command runner that may finish synchronously or on the event loop. */
export type CommandRunner = (_command: string, _args: string[], _options?: GitOptions) => GitResult | Promise<GitResult>;

/**
 * `run` with output captured through temporary files instead of pipes, so it
 * resolves when the command itself exits. Piped `spawnSync` also waits for every
 * descendant that inherited the pipes, so a background process left by a
 * finished check would block the caller for as long as it lives (TASK-2806).
 * Such a descendant is never signalled; it may keep writing to the unlinked files.
 * Like `spawnSync`'s `maxBuffer`, a stream that grows past the cap terminates
 * the command (SIGTERM, then SIGKILL after a grace) and throws ENOBUFS.
 */
export async function runToExit(command: string, args: string[], options: GitOptions = {}): Promise<GitResult> {
  if (pathMod.basename(command) === 'git' && !options.gitAdmissionGranted) { return runAdmittedGitAsync(args, options, runToExit); }
  const { progressLabel, maxBuffer = DEFAULT_MAX_CAPTURE_BYTES, encoding: _encoding, stdio: _stdio, ...spawnOptions } = options;
  const root = fsMod.mkdtempSync(pathMod.join(osMod.tmpdir(), 'px-exit-capture-'));
  const files = [pathMod.join(root, 'stdout'), pathMod.join(root, 'stderr')] as const;
  const fds = files.map(file => fsMod.openSync(file, 'w'));
  try {
    const result = await withAsyncCommandProgress(commandProgressLabel(command, args, progressLabel), () => new Promise<GitResult>(resolve => {
      let overflow: Error | null = null;
      let escalation: NodeJS.Timeout | undefined;
      let settled = false;
      // codeql[js/shell-command-injection-from-environment] -- same trusted command surface as run().
      const child = spawn(command, args, { ...(spawnOptions as SpawnOptions), env: { ...process.env, ...spawnOptions.env, GIT_OPTIONAL_LOCKS: '0' }, stdio: ['ignore', fds[0], fds[1]] });
      const exceeded = () => fds.some(fd => fsMod.fstatSync(fd).size > maxBuffer);
      const overflowError = () => new CommandOutputLimitError(subcommandLabel(command, args), 'ENOBUFS', maxBuffer, NARROW_RECOVERY);
      const poll = setInterval(() => {
        if (overflow || !exceeded()) { return; }
        overflow = overflowError();
        child.kill('SIGTERM');
        escalation = setTimeout(() => child.kill('SIGKILL'), OVERFLOW_TERMINATION_GRACE_MS);
      }, CAPTURE_POLL_MS);
      const finish = (status: number | null, signal: string | null, error: Error | null) => {
        if (settled) { return; }
        settled = true;
        clearInterval(poll);
        clearTimeout(escalation);
        resolve({ status, signal, stdout: readTail(files[0], maxBuffer), stderr: readTail(files[1], maxBuffer), error });
      };
      child.once('error', cause => finish(null, null, cause));
      // A command may outgrow the cap and exit between polls.
      child.once('exit', (code, signal) => finish(code, signal, overflow ?? (exceeded() ? overflowError() : null)));
    }));
    // A capped capture is never evidence of a passing check.
    if (result.error && (result.status === null || (result.error as NodeJS.ErrnoException).code === 'ENOBUFS')) { throw result.error; }
    return result;
  } finally {
    for (const fd of fds) { fsMod.closeSync(fd); }
    fsMod.rmSync(root, { recursive: true, force: true });
  }
}

export function getCurrentBranch(cwd: string = process.cwd(), runner: (args: string[]) => Pick<GitResult, 'stdout'> = git): string {
  const result = runner(['-C', cwd, 'branch', '--show-current']);
  return result.stdout.trim();
}

export function getWorktreeStatus(cwd: string = process.cwd()): string[] {
  const result = git(['-C', cwd, 'status', '--porcelain']);
  return result.stdout
    .split('\n')
    .map(line => line.trimEnd())
    .filter(Boolean);
}

const SOURCE_EXTENSIONS = /(?:\.(?:c|m)?js|\.ts|\.tsx|\.jsx)$/;
const IGNORED_GENERATED_DIRS = new Set(['node_modules', 'build', 'dist', 'coverage', 'graphify-out', '.workflow']);

/**
 * Find source files that exist in a worktree but are ignored and therefore
 * cannot enter a commit. This deliberately runs against the selected
 * worktree; it does not inspect or build the primary checkout.
 */
export function findIgnoredSourceFiles(cwd: string = process.cwd(), gitFn: typeof git = git): string[] {
  const candidates: string[] = [];
  const visit = (absoluteDir: string, relativeDir: string): void => {
    let entries: fsMod.Dirent[];
    try { entries = fsMod.readdirSync(absoluteDir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const relative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      if (IGNORED_GENERATED_DIRS.has(entry.name) || entry.name === '.git') { continue; }
      const absolute = pathMod.join(absoluteDir, entry.name);
      if (entry.isDirectory()) { visit(absolute, relative); }
      else if (entry.isFile() && SOURCE_EXTENSIONS.test(relative)) { candidates.push(relative); }
    }
  };
  visit(cwd, '');
  return candidates.filter(entry => gitFn(['-C', cwd, 'check-ignore', '-q', '--', entry]).status === 0);
}

export function isDirty(cwd: string = process.cwd()): boolean {
  const result = git(['-C', cwd, 'status', '--porcelain']);
  return result.stdout.trim().length > 0;
}

export function getUncommittedCount(cwd: string = process.cwd()): number {
  const result = git(['-C', cwd, 'status', '--porcelain']);
  if (!result.stdout.trim()) {return 0;}
  return result.stdout.trim().split('\n').length;
}

export function parseUnmergedFiles(output: string = ''): string[] {
  return Array.from(new Set(
    output
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => line.split('\t')[1])
      .filter(Boolean)
  ));
}

interface RebaseStateResult {
  branch?: string | null;
  otherOperation?: string | null;
  inProgress: boolean;
  rebaseHead: string;
  detached: boolean;
  unmergedFiles: string[];
  rebaseDir: string | null;
}

interface GitRunner {
  (_args: string[]): GitResult;
}

interface DetectRebaseOptions {
  gitRunner?: GitRunner;
  fsModule?: { existsSync(_path: string): boolean; readFileSync?: typeof fsMod.readFileSync };
  pathModule?: Pick<typeof pathMod, 'isAbsolute' | 'join'>;
}

function sequencerMetadata(gitDir: string, rebaseDir: string | null, fsModule: NonNullable<DetectRebaseOptions['fsModule']>, pathModule: NonNullable<DetectRebaseOptions['pathModule']>) {
  let branch: string | null = null;
  if (rebaseDir) {
    try { branch = String(fsModule.readFileSync?.(pathModule.join(rebaseDir, 'head-name'), 'utf8') ?? '').trim().replace(/^refs\/heads\//, '') || null; } catch { /* Unknown origin must not authorize continuation. */ }
  }
  const otherOperation = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'sequencer'].find(name => fsModule.existsSync(pathModule.join(gitDir, name))) ?? null;
  return { branch, otherOperation };
}

export function detectRebaseState(cwd: string = process.cwd(), options: DetectRebaseOptions = {}): RebaseStateResult {
  const { gitRunner = git, fsModule = fsMod, pathModule = pathMod } = options;
  const gitDirResult = gitRunner(['-C', cwd, 'rev-parse', '--git-dir']);
  const resolvedGitDir = gitDirResult.status === 0
    ? gitDirResult.stdout.trim()
    : '.git';
  const gitDir = pathModule.isAbsolute(resolvedGitDir)
    ? resolvedGitDir
    : pathModule.join(cwd, resolvedGitDir);
  const rebaseMergeDir = pathModule.join(gitDir, 'rebase-merge');
  const rebaseApplyDir = pathModule.join(gitDir, 'rebase-apply');
  const rebaseDir = fsModule.existsSync(rebaseMergeDir)
    ? rebaseMergeDir
    : (fsModule.existsSync(rebaseApplyDir) ? rebaseApplyDir : null);

  const headResult = gitRunner(['-C', cwd, 'symbolic-ref', '--quiet', '--short', 'HEAD']);
  const detached = headResult.status !== 0;

  // TASK-2828: `git rebase --show-current` is git's unambiguous-prefix match for
  // `--show-current-patch`, so it buffers the whole current commit patch (2,320,623 bytes on
  // task-2822) and spawnSync fails with ENOBUFS past the default 1 MiB maxBuffer. REBASE_HEAD is
  // git's own metadata ref for the commit being replayed; it exists for both the merge and the
  // apply backend and costs a fixed-size read. It stays resolvable after `rebase --continue`
  // finishes, so it names the replayed commit but never proves a live operation by itself.
  const rebaseHeadResult = gitRunner(['-C', cwd, 'rev-parse', '-q', '--verify', 'REBASE_HEAD']);
  const rebaseHead = rebaseHeadResult.status === 0 ? rebaseHeadResult.stdout.trim() : '';

  const unmergedResult = gitRunner(['-C', cwd, 'ls-files', '-u']);
  const unmergedFiles = unmergedResult.status === 0 ? parseUnmergedFiles(unmergedResult.stdout) : [];

  const inProgress = Boolean(rebaseDir || unmergedFiles.length > 0);

  const { branch, otherOperation } = sequencerMetadata(gitDir, rebaseDir, fsModule, pathModule);
  return {
    branch, otherOperation,
    inProgress,
    rebaseHead,
    detached,
    unmergedFiles,
    rebaseDir
  };
}

export function getLastCommit(): { sha: string; date: string; subject: string } {
  const result = git(['log', '-1', '--format=%H|%ad|%s']);
  const [sha, date, subject] = result.stdout.trim().split('|');
  return { sha, date, subject };
}

export function getLastThreeCommits(): string[] {
  const result = git(['log', '-3', '--format=%s']);
  return result.stdout.trim().split('\n');
}
