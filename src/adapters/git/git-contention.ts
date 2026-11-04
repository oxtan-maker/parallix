import { gitCancellation } from './git-interruption.js';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { GitContentionPort, GitInvocation, GitLockEvidence } from '../../application/ports/git-contention.js';
import type { GitCommandResult } from '../../application/ports/rebase-workflow.js';
import { waitForAdmission } from '../process/admission-wait.js';
import { gitLockPolicyFor, gitSubcommand, lockFamiliesFor, lockPathsFor, type GitLockDirs } from './git-lock-resources.js';

/** Raw metadata reads avoid recursively entering admission. No optional index refresh. */
export function resolveLockDirs(invocation: GitInvocation, env: NodeJS.ProcessEnv = { ...process.env }): GitLockDirs | null {
  const prefix = gitSubcommand(invocation.args)?.prefix ?? [];
  const read = (flag: string) => {
    const result = spawnSync('git', [...prefix, 'rev-parse', '--path-format=absolute', flag], {
      cwd: invocation.cwd, encoding: 'utf8', env: { ...env, GIT_OPTIONAL_LOCKS: '0' }, timeout: 5000,
    });
    return result.status === 0 ? result.stdout.trim() : '';
  };
  const worktreeGitDir = read('--git-dir');
  const commonDir = read('--git-common-dir');
  return worktreeGitDir && commonDir ? { worktreeGitDir, commonDir } : null;
}

function scan(directory: string): string[] {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(directory, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') { return []; } throw error; }
  return entries.flatMap(entry => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) { return scan(target); }
    return entry.name.endsWith('.lock') ? [target] : [];
  });
}

/** Resolve only the ref being changed; a lock on another mission is independent. */
function refLocks(invocation: GitInvocation, dirs: GitLockDirs): string[] {
  const found = gitSubcommand(invocation.args);
  if (!found) { return []; }
  const { command, rest, prefix } = found;
  const positional = rest.filter(a => !a.startsWith('-'));
  if (command === 'update-ref' && positional[0]) { return [path.join(dirs.commonDir, positional[0] + '.lock')]; }
  if (command === 'tag' && positional[0]) { return [path.join(dirs.commonDir, 'refs/tags', positional[0] + '.lock')]; }
  if (command === 'branch' && positional[0]) { return [path.join(dirs.commonDir, 'refs/heads', positional[0] + '.lock')]; }
  if (['fetch', 'pull', 'push', 'pack-refs', 'gc', 'worktree'].includes(command)) { return scan(path.join(dirs.commonDir, 'refs')); }
  const head = spawnSync('git', [...prefix, 'symbolic-ref', '--quiet', 'HEAD'], {
    cwd: invocation.cwd, encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, timeout: 5000,
  });
  const ref = head.status === 0 ? head.stdout.trim() : '';
  return ref.startsWith('refs/') ? [path.join(dirs.commonDir, ref + '.lock')] : [];
}

/** Filesystem facts, command/resource mapping and exit state jointly identify contention. */
export function heldGitLocks(invocation: GitInvocation, dirs: GitLockDirs): GitLockEvidence[] {
  return (lockFamiliesFor(invocation.args) ?? []).flatMap(spec => {
    const targets = spec.family === 'ref' ? { files: refLocks(invocation, dirs), directories: [] } : lockPathsFor(dirs, spec.family);
    if (spec.family === 'config') {
      targets.files = targets.files.filter(file => spec.scope === 'worktree' ? file.endsWith('config.worktree.lock') : file.endsWith('/config.lock'));
    }
    return [...new Set([...targets.files, ...targets.directories.flatMap(scan)])].flatMap(lockPath => {
      let stat: fs.Stats;
      try { stat = fs.lstatSync(lockPath); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') { return []; } throw error; }
      // The config map includes both scopes; derive the actual scope from the path.
      const scope = spec.family === 'config' && lockPath.endsWith('config.worktree.lock') ? 'worktree' : spec.scope;
      return [{ kind: 'lock-contention' as const, lockPath, family: spec.family, scope,
        owner: 'external-or-unknown' as const, ownerPid: null, ageMs: Math.max(0, Date.now() - stat.mtimeMs), removable: false,
        diagnostics: `${scope} ${spec.family} resource ${lockPath}; owner external or unknown; lock preserved` }];
    });
  });
}

export function inspectGitContention(result: GitCommandResult, invocation: GitInvocation, dirs = resolveLockDirs(invocation)): GitLockEvidence | null {
  if (result.status === 0 || !dirs) { return null; }
  // A coincident lock does not explain an unrelated failure. Require the failed
  // command to name the observed resource and report acquisition, not remote/CAS.
  const output = result.stderr + '\n' + result.stdout;
  if (/remote:|expected [0-9a-f]+|Permission denied|No space left|Read-only file system/i.test(output)) { return null; }
  return heldGitLocks(invocation, dirs).find(lock => output.includes(lock.lockPath) && /File exists|Unable to create|cannot lock/i.test(output)) ?? null;
}

export function reportGitWaiting(evidence: GitLockEvidence, waitedMs: number): void {
  process.stderr.write(`Waiting for Git ${evidence.diagnostics} (${waitedMs}ms). Cancel with Ctrl-C.\n`);
}

export function createGitContentionPort(maxWaitMs: number | null = null): GitContentionPort {
  return {
    inspect: inspectGitContention,
    async waitForRelease(evidence, options = {}) {
      const cancellation = gitCancellation(options.signal);
      try {
        const waiting = await waitForAdmission(() => !fs.existsSync(evidence.lockPath) ? true : null,
          gitLockPolicyFor(evidence.scope, maxWaitMs), {
            signal: cancellation.signal,
            onWaiting: state => options.onWaiting?.({ ...state, lockPath: evidence.lockPath, scope: evidence.scope, owner: evidence.owner }),
          });
        return { released: waiting.acquired, attempts: waiting.attempts, waitedMs: waiting.waitedMs, evidence,
          stopReason: waiting.acquired ? 'released' : cancellation.signal.aborted ? 'cancelled' : 'wait-limit' };
      } finally { cancellation.close(); }
    },
  };
}
