import fs from 'node:fs';
import path from 'node:path';
import { git } from './git.js';

export interface RebaseCompletion {
  from: string;
  to: string;
  branch: string;
  mappings: Array<[string, string]>;
}

function gitText(root: string, args: string[]): string {
  const result = git(['-C', root, ...args]);
  if (result.status !== 0) { throw new Error(`Git metadata unavailable (${args[0]})`); }
  return result.stdout.trim();
}

function stateDirectory(root: string): string {
  return path.join(gitText(root, ['rev-parse', '--absolute-git-dir']), 'parallix');
}

export function rebaseInProgress(root: string): boolean {
  const gitDirectory = path.dirname(stateDirectory(root));
  return ['rebase-merge', 'rebase-apply'].some(name => fs.existsSync(path.join(gitDirectory, name)));
}

export function readRebaseCompletions(root: string): RebaseCompletion[] {
  try {
    return fs.readFileSync(path.join(stateDirectory(root), 'rebase-completions.jsonl'), 'utf8')
      .split('\n').filter(Boolean).map(line => JSON.parse(line) as RebaseCompletion);
  } catch { return []; }
}

const GIT_HOOKS = [
  'applypatch-msg', 'pre-applypatch', 'post-applypatch', 'pre-commit', 'pre-merge-commit',
  'prepare-commit-msg', 'commit-msg', 'post-commit', 'pre-rebase', 'post-checkout',
  'post-merge', 'pre-push', 'pre-receive', 'update', 'proc-receive', 'post-receive',
  'post-update', 'reference-transaction', 'push-to-checkout', 'pre-auto-gc',
  'sendemail-validate', 'fsmonitor-watchman', 'p4-changelist', 'p4-prepare-changelist',
  'p4-post-changelist', 'p4-pre-submit', 'post-index-change',
];

const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

/** Install a worktree-local hook overlay; original hook files stay in place.
 * The generated recorder is plain Node ESM, so npm installations need no tsx
 * loader, source checkout, globally installed px, or human-readable Git output.
 */
export function ensureRebaseCompletionRecorder(root: string): void {
  const state = stateDirectory(root);
  const hooks = path.join(state, 'hooks');
  const metadataPath = path.join(state, 'hook-overlay.json');
  let previous: string;
  const configured = git(['-C', root, 'config', '--path', '--get', 'core.hooksPath']);
  const current = configured.status === 0 ? path.resolve(root, configured.stdout.trim()) : null;
  if (current === hooks) {
    previous = (JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as { previous: string }).previous;
  } else {
    previous = current ?? path.resolve(root, gitText(root, ['rev-parse', '--git-common-dir']), 'hooks');
  }
  if (previous === hooks) { throw new Error('Original Git hook path unavailable'); }
  // Enabling per-worktree configuration must not reinterpret a shared explicit
  // core.worktree setting. Such unusual layouts retain ordinary cache misses.
  if (git(['-C', root, 'config', '--local', '--get', 'core.worktree']).status === 0) {
    throw new Error('Cannot install worktree hooks over shared core.worktree');
  }
  fs.mkdirSync(hooks, { recursive: true });
  const names = new Set(GIT_HOOKS);
  try { for (const name of fs.readdirSync(previous)) { if (name !== 'post-rewrite') { names.add(name); } } }
  catch { /* A new repository may not have a hooks directory. */ }
  for (const name of names) {
    const target = path.join(hooks, name);
    const existing = fs.lstatSync(target, { throwIfNoEntry: false });
    if (existing?.isSymbolicLink() && fs.readlinkSync(target) !== path.join(previous, name)) { fs.unlinkSync(target); }
    if (!fs.lstatSync(target, { throwIfNoEntry: false })) {
      fs.symlinkSync(path.join(previous, name), target);
    }
  }
  const recorder = path.join(state, 'record-rewrite.mjs');
  const source = `
import fs from 'node:fs';
import cp from 'node:child_process';
const input = fs.readFileSync(0);
const original = ${JSON.stringify(path.join(previous, 'post-rewrite'))};
let status = 0;
try {
  fs.accessSync(original, fs.constants.X_OK);
  status = cp.spawnSync(original, process.argv.slice(2), { input, stdio: ['pipe', 'inherit', 'inherit'] }).status || 0;
} catch {}
if (process.argv[2] === 'rebase') {
  try {
    const read = args => cp.execFileSync('git', args, { encoding: 'utf8' }).trim();
    const mappings = input.toString('utf8').trim().split('\\n').filter(Boolean).map(line => line.trim().split(/\\s+/).slice(0, 2));
    const record = { from: read(['rev-parse', 'ORIG_HEAD']), to: read(['rev-parse', 'HEAD']),
      branch: read(['symbolic-ref', '--quiet', '--short', 'HEAD']), mappings };
    fs.appendFileSync(${JSON.stringify(path.join(state, 'rebase-completions.jsonl'))}, JSON.stringify(record) + '\\n', { mode: 0o600 });
  } catch { process.stderr.write('Parallix: could not record completed rebase; active verification will run again.\\n'); }
}
process.exitCode = status;
`;
  fs.writeFileSync(recorder, source, { mode: 0o600 });
  fs.writeFileSync(path.join(hooks, 'post-rewrite'), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(recorder)} "$@"\n`, { mode: 0o700 });
  fs.writeFileSync(metadataPath, JSON.stringify({ previous }), { mode: 0o600 });
  gitText(root, ['config', '--local', 'extensions.worktreeConfig', 'true']);
  gitText(root, ['config', '--worktree', 'core.hooksPath', hooks]);
}
