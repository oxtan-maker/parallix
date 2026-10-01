import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** A case-owned Git repository on `main` with one initial commit. */
export interface CommittedRepository {
  readonly root: string;
  /** Run `git -C root ...args`; throws with Git's output when it fails. */
  git(..._args: string[]): string;
}

function runGit(root: string, args: readonly string[]): string {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(' ')} failed`);
  }
  return result.stdout;
}

/**
 * Initialise `root` (owned by the calling test case) as a repository whose
 * `main` branch has one commit holding `README.md` plus `files`
 * (TASK-2622.04). Older supported Git releases lack `git init -b`, so the
 * branch is created with `checkout -b`.
 */
export function initCommittedRepository(root: string, files: Readonly<Record<string, string>> = {}): CommittedRepository {
  runGit(root, ['init']);
  runGit(root, ['checkout', '-b', 'main']);
  runGit(root, ['config', 'user.name', 'Test User']);
  runGit(root, ['config', 'user.email', 'test@example.com']);
  const contents: Record<string, string> = { 'README.md': '# temp repo\n', ...files };
  for (const [file, text] of Object.entries(contents)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text, 'utf8');
  }
  runGit(root, ['add', ...Object.keys(contents)]);
  runGit(root, ['commit', '-m', 'init']);
  return { root, git: (...args) => runGit(root, args) };
}
