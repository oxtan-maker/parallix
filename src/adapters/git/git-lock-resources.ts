import path from 'node:path';
import type { GitLockFamily, GitResourceScope } from '../../application/ports/git-contention.js';
import type { AdmissionWaitPolicy } from '../../application/admission-wait.js';

export interface GitLockFamilySpec { readonly family: GitLockFamily; readonly scope: GitResourceScope }
export interface GitLockDirs { readonly worktreeGitDir: string; readonly commonDir: string }

/** Preserve global Git arguments when locating metadata (including repeated -C). */
export function gitSubcommand(args: readonly string[]): { command: string; rest: readonly string[]; prefix: string[] } | null {
  let index = 0;
  while (index < args.length) {
    const token = args[index];
    if (['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--super-prefix', '--shallow-file', '--config-env'].includes(token)) { index += 2; continue; }
    if (token.startsWith('-')) { index++; continue; }
    return { command: token, rest: args.slice(index + 1), prefix: args.slice(0, index) };
  }
  return null;
}

function configObservation(rest: readonly string[]): boolean {
  return rest.some(arg => /^(--get(?:-all|-regexp|-urlmatch)?|--list|-l)$/.test(arg)) || ['get', 'list'].includes(rest[0]);
}

function isObservation(command: string, rest: readonly string[]): boolean {
  if (command === 'worktree' && rest[0] === 'list') { return true; }
  if (command === 'stash' && ['list', 'show'].includes(rest[0])) { return true; }
  if (command === 'config') { return configObservation(rest); }
  if (['branch', 'tag'].includes(command) && (rest.length === 0 || rest.some(arg => ['--list', '--show-current', '-l', '--contains', '--merged', '--no-merged'].includes(arg)))) { return true; }
  if (command === 'remote' && !['add', 'remove', 'rename', 'set-url', 'set-head', 'prune', 'update'].includes(rest[0])) { return true; }
  if (command === 'symbolic-ref' && !rest.includes('--delete') && rest.filter(a => !a.startsWith('-')).length < 2) { return true; }
  return false;
}

export function lockFamiliesFor(args: readonly string[]): GitLockFamilySpec[] | null {
  const found = gitSubcommand(args);
  if (!found) { return null; }
  const { command, rest } = found;
  if (isObservation(command, rest)) { return null; }
  const specs: GitLockFamilySpec[] = [];
  const add = (family: GitLockFamily, scope: GitResourceScope) => specs.push({ family, scope });
  if (['add', 'am', 'apply', 'checkout', 'cherry-pick', 'commit', 'merge', 'mv', 'pull', 'rebase', 'reset', 'restore', 'revert', 'rm', 'stash', 'switch', 'read-tree', 'update-index'].includes(command)) { add('index', 'worktree'); }
  if (['am', 'checkout', 'cherry-pick', 'commit', 'merge', 'pull', 'rebase', 'reset', 'revert', 'stash', 'switch', 'symbolic-ref'].includes(command)) { add('head', 'worktree'); }
  if (['config', 'init', 'remote', 'worktree'].includes(command)) { add('config', rest.includes('--worktree') ? 'worktree' : 'repository'); }
  if (['am', 'branch', 'checkout', 'cherry-pick', 'commit', 'fetch', 'gc', 'merge', 'pack-refs', 'pull', 'push', 'rebase', 'reset', 'revert', 'stash', 'switch', 'tag', 'update-ref', 'worktree'].includes(command)) {
    add('packed-refs', 'repository'); add('ref', 'repository');
  }
  if (command === 'worktree') { add('worktree-admin', 'repository'); }
  if (['clone', 'fetch', 'pull'].includes(command)) { add('fetch-metadata', 'repository'); }
  if (['commit-graph', 'gc', 'maintenance', 'repack'].includes(command)) { add('maintenance', 'repository'); }
  return specs.length ? specs : null;
}

/** Hooks/external Git have no provable duration. Cancellation owns the default bound. */
export function gitLockPolicyFor(scope: GitResourceScope, maxWaitMs: number | null = null): AdmissionWaitPolicy {
  return { resource: `git-${scope}-lock`, initialDelayMs: 25, maxDelayMs: 250, maxWaitMs, progressEveryMs: 2000 };
}
export const GIT_WORKTREE_LOCK_POLICY = gitLockPolicyFor('worktree');
export const GIT_REPOSITORY_LOCK_POLICY = gitLockPolicyFor('repository');

/** The `locked` worktree marker is deliberately absent: it is persistent user intent. */
export function lockPathsFor(dirs: GitLockDirs, family: GitLockFamily): { files: string[]; directories: string[] } {
  const { worktreeGitDir: local, commonDir: common } = dirs;
  const files = (...names: string[]) => ({ files: names, directories: [] as string[] });
  switch (family) {
    case 'index': return files(path.join(local, 'index.lock'));
    case 'head': return files(path.join(local, 'HEAD.lock'));
    case 'config': return files(path.join(common, 'config.lock'), path.join(local, 'config.worktree.lock'));
    case 'packed-refs': return files(path.join(common, 'packed-refs.lock'));
    case 'ref': return { files: [], directories: [path.join(common, 'refs'), path.join(local, 'refs')] };
    case 'reflog': return { files: [], directories: [path.join(local, 'logs'), path.join(common, 'logs')] };
    case 'worktree-admin': return files(path.join(common, 'worktrees.lock'));
    case 'fetch-metadata': return files(path.join(common, 'shallow.lock'), path.join(local, 'FETCH_HEAD.lock'));
    case 'maintenance': return files(path.join(common, 'gc.pid'), path.join(common, 'objects', 'info', 'commit-graph.lock'));
    default: return files();
  }
}
