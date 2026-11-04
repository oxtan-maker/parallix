import { synchronousInterruption, gitCancellation } from './git-interruption.js';
import { gitProcessContext } from '../../application/ports/git-process-context.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync, type SpawnSyncOptions, type SpawnSyncReturns } from 'node:child_process';
import type { GitOptions, GitResult } from './git.js';
import { waitForAdmission, waitForAdmissionSync, type AdmissionWaitPolicy, type AdmissionWaitState } from '../process/admission-wait.js';
import { gitLockPolicyFor, gitSubcommand, lockFamiliesFor } from './git-lock-resources.js';
import { heldGitLocks, reportGitWaiting, resolveLockDirs } from './git-contention.js';

type SequencerRefusal = Pick<SpawnSyncReturns<string>, 'status' | 'signal' | 'stdout' | 'stderr' | 'error'>;
type GitSyncExecutor = (_command: string, _args: string[], _options: SpawnSyncOptions) => SpawnSyncReturns<string | Buffer>;

/** Refuse only sequencer starts, keeping the runner result contract intact. */
function sequencerRefusal(args: string[], gitDir: string): SequencerRefusal | null {
  const invocation = gitSubcommand(args);
  if (!invocation || !['rebase', 'merge', 'cherry-pick', 'revert', 'am', 'pull'].includes(invocation.command)) { return null; }
  if (invocation.rest.some(a => ['--continue', '--abort', '--quit', '--skip'].includes(a))) { return null; }
  const activeState = ['rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'sequencer']
    .filter(name => fs.existsSync(path.join(gitDir, name)));
  if (!activeState.length) { return null; }
  return { status: 128, signal: null, stdout: '', error: undefined,
    stderr: `Git ${invocation.command} cannot start over active ${activeState.join(', ')} in ${gitDir}; inspect git status and use the operation owner to continue; original command not replayed` };
}

function mutationResource(args: string[], dirs: NonNullable<ReturnType<typeof resolveLockDirs>>) {
  const command = gitSubcommand(args)?.command;
  const families = lockFamiliesFor(args) ?? [];
  const scope = families.some(f => f.scope === 'worktree') ? dirs.worktreeGitDir : dirs.commonDir;
  const category = families.some(f => f.family === 'index' || f.family === 'head') ? 'checkout'
    : command === 'remote' || command === 'config' ? 'config' : command === 'worktree' ? 'registry' : 'refs';
  const slot = path.join(scope, `parallix-${category}.admission`);
  let inherited: Record<string, string> = {};
  try { inherited = gitProcessContext().inheritedMarkers; } catch { /* No inherited scope. */ }
  const active = Object.fromEntries(Object.entries(inherited).filter(([, marker]) => typeof marker === 'string' && fs.existsSync(marker)));
  return { slot, active };
}

interface AdmissionPlan {
  refusal: SequencerRefusal | null;
  scopeRoot?: string;
  command: string;
  args: string[];
  options: GitOptions;
  policy: AdmissionWaitPolicy;
  probe: () => boolean;
  progress: (_state: AdmissionWaitState) => void;
  diagnostic: () => string;
  busy: (_status: number | null) => boolean;
  close: () => void;
}

/** Kernel flock owns cooperating mutation lifetime, including inherited child
 * descriptors. There is no stale lease removal. Nested hooks may reuse only an
 * active inherited scope; a cross-scope nested wait refuses to avoid deadlock.
 * Admission retries only flock refusals before execution, never a Git failure.
 */
function prepare(args: string[], options: GitOptions, resolveDirs = resolveLockDirs): AdmissionPlan {
  const env: NodeJS.ProcessEnv = { ...process.env, ...options.env, GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' };
  const invocation = { cwd: String(options.cwd ?? process.cwd()), args };
  const families = lockFamiliesFor(args);
  const dirs = families ? resolveDirs(invocation, env) : null;
  const policy = gitLockPolicyFor('worktree', typeof options.gitWaitLimitMs === 'number' ? options.gitWaitLimitMs : null);
  const direct: AdmissionPlan = {
    refusal: dirs ? sequencerRefusal(args, dirs.worktreeGitDir) : null,
    command: 'git', args, options: { ...options, env, gitAdmissionGranted: true }, policy,
    probe: () => true, busy: () => false, progress: () => {}, diagnostic: () => invocation.cwd, close() {},
  };
  if (!dirs || direct.refusal) { return direct; }
  return coordinateMutation(direct, invocation, dirs);
}

/** Add only native-lock observation and the scope-specific cooperating lease. */
function coordinateMutation(direct: AdmissionPlan, invocation: { cwd: string; args: string[] }, dirs: NonNullable<ReturnType<typeof resolveLockDirs>>): AdmissionPlan {
  const { args } = invocation;
  const { options, policy } = direct;
  const env = options.env;
  const { slot, active } = mutationResource(args, dirs);
  let held: ReturnType<typeof heldGitLocks>[number] | undefined;
  const probe = () => {
    held = heldGitLocks(invocation, dirs)[0];
    if (held && Object.keys(active).length) { throw new Error(`Nested Git meets ${held.diagnostics}; refusing native-lock wait inside a hook; operation state preserved`); }
    return !held;
  };
  const progress = (state: AdmissionWaitState) => {
    if (held) { reportGitWaiting(held, state.waitedMs); }
    else { process.stderr.write(`Waiting for Git owned mutation ${slot} (${state.waitedMs}ms); cancel with Ctrl-C.\n`); }
  };
  if (active[slot]) { return { ...direct, policy, probe, progress, diagnostic: () => held?.diagnostics ?? slot, busy: (_status: number | null) => false, close() {} }; }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'px-git-admission-'));
  const marker = path.join(temporary, 'started');
  return {
    refusal: null, scopeRoot: dirs.worktreeGitDir, command: 'flock',
    // The fixed shell marks actual execution, distinguishing a hook's exit 75
    // from flock's contention code. All Git arguments remain positional data.
    args: ['-n', '-E', '75', slot, 'sh', '-c', 'printf started > "$1"; shift; exec "$@"', 'px-git', marker, 'git', ...args],
    options: { ...options, env: { ...env, PARALLIX_GIT_ADMISSION: JSON.stringify({ ...active, [slot]: marker }) } },
    policy, probe, progress, diagnostic: () => held?.diagnostics ?? slot,
    busy(status: number | null) {
      if (status !== 75 || fs.existsSync(marker)) { return false; }
      if (Object.keys(active).length) { throw new Error(`Nested Git admission would wait for ${slot}; refusing cross-resource hook wait to avoid deadlock; operation state preserved`); }
      return true;
    },
    close() { fs.rmSync(temporary, { recursive: true, force: true }); },
  };
}

export function spawnAdmittedGit(args: string[], options: SpawnSyncOptions & { gitWaitLimitMs?: number }, execute: GitSyncExecutor = spawnSync, resolveDirs = resolveLockDirs) {
  const plan = prepare(args, options as GitOptions, resolveDirs);
  if (plan.refusal) { return plan.refusal; }
  let interruption: ReturnType<typeof synchronousInterruption> | undefined;
  try {
    const result = waitForAdmissionSync(() => {
      interruption?.check();
      if (!plan.probe()) { return null; }
      const executed = execute(plan.command, plan.args, plan.options as SpawnSyncOptions);
      return plan.busy(executed.status) ? null : executed;
    }, plan.policy, { signal: options.signal, onWaiting: state => { interruption ??= synchronousInterruption(plan.scopeRoot); interruption.check(); plan.progress(state); } });
    if (!result.value) { throw new Error(`Git admission cancelled or explicit wait limit reached: ${plan.diagnostic()}; lock and operation state preserved`); }
    return result.value;
  } finally { interruption?.close(); plan.close(); }
}

export async function runAdmittedGitAsync(args: string[], options: GitOptions, execute: (_command: string, _args: string[], _options: GitOptions) => Promise<GitResult>, resolveDirs = resolveLockDirs): Promise<GitResult> {
  const plan = prepare(args, options, resolveDirs);
  if (plan.refusal) { return plan.refusal; }
  const cancellation = gitCancellation(options.signal as AbortSignal | undefined);
  try {
    const result = await waitForAdmission(async () => {
      if (!plan.probe()) { return null; }
      const executed = await execute(plan.command, plan.args, plan.options);
      return plan.busy(executed.status) ? null : executed;
    }, plan.policy, { signal: cancellation.signal, onWaiting: plan.progress });
    if (!result.value) { throw new Error(`Git admission cancelled or explicit wait limit reached: ${plan.diagnostic()}; lock and operation state preserved`); }
    return result.value;
  } finally { cancellation.close(); plan.close(); }
}
