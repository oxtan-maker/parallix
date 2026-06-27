import childProcess, { spawnSync } from 'node:child_process';
import type { SpawnSyncOptions } from 'node:child_process';
import * as fsMod from 'node:fs';
import * as pathMod from 'node:path';

interface GitOptions {
  encoding?: BufferEncoding;
  stdio?: import('node:child_process').StdioOptions;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  maxBuffer?: number;
  [key: string]: unknown;
}

interface GitResult {
  status: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  error?: Error | null;
}

export function git(args: string[], options: GitOptions = {}): GitResult {
  const spawnOptions: SpawnSyncOptions = {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'] as const,
    ...options
  };
  const result = spawnSync('git', args, spawnOptions);
  if (result.error && result.status === null) {
    throw result.error;
  }
  return { status: result.status, signal: result.signal, stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? ''), error: result.error };
}

export function run(command: string, args: string[], options: GitOptions = {}): GitResult {
  const spawnOptions: SpawnSyncOptions = {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'] as const,
    ...options
  };
  const result = spawnSync(command, args, spawnOptions);
  if (result.error && result.status === null) {
    throw result.error;
  }
  return { status: result.status, signal: result.signal, stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? ''), error: result.error };
}

export function getCurrentBranch(cwd: string = process.cwd()): string {
  const result = git(['-C', cwd, 'branch', '--show-current']);
  return result.stdout.trim();
}

export function getWorktreeStatus(cwd: string = process.cwd()): string[] {
  const result = git(['-C', cwd, 'status', '--porcelain']);
  return result.stdout
    .split('\n')
    .map(line => line.trimEnd())
    .filter(Boolean);
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
  inProgress: boolean;
  rebaseHead: string;
  detached: boolean;
  unmergedFiles: string[];
  rebaseDir: string | null;
}

interface GitRunner {
  (args: string[]): GitResult;
}

interface DetectRebaseOptions {
  gitRunner?: GitRunner;
  fsModule?: typeof fsMod;
  pathModule?: typeof pathMod;
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

  const showCurrentResult = gitRunner(['-C', cwd, 'rebase', '--show-current']);
  const rebaseHead = showCurrentResult.status === 0 ? showCurrentResult.stdout.trim() : '';

  const unmergedResult = gitRunner(['-C', cwd, 'ls-files', '-u']);
  const unmergedFiles = unmergedResult.status === 0 ? parseUnmergedFiles(unmergedResult.stdout) : [];

  const inProgress = Boolean(rebaseDir || rebaseHead || unmergedFiles.length > 0);

  return {
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
