import type { GitFn } from './verification.js';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function verificationDigest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function resolveNpm(searchPath: string): string | null {
  for (const directory of searchPath.split(path.delimiter)) {
    const candidate = path.join(directory, 'npm');
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return fs.realpathSync(candidate);
    } catch { /* Continue to the next executable lookup candidate. */ }
  }
  return null;
}

function npmSignature(npm: string): string {
  const manifest = path.resolve(path.dirname(npm), '../package.json');
  const hash = createHash('sha256').update(fs.readFileSync(npm));
  if (fs.existsSync(manifest)) { hash.update(fs.readFileSync(manifest)); }
  return hash.digest('hex');
}

/** Runtime and effective npm launcher identity; file reads avoid spawning npm.
 * Missing npm supports non-npm verifiers; appearance/change invalidates proof. */
export function verificationToolchainIdentity(searchPath = ''): string {
  const npm = resolveNpm(searchPath);
  return JSON.stringify({ node: process.version, executable: fs.realpathSync(process.execPath),
    modules: process.versions.modules, platform: process.platform, arch: process.arch,
    npm, npmDigest: npm ? npmSignature(npm) : null });
}

export function readVerificationInputs(rootDir: string, gitRunner: GitFn, searchPath = ''):
  { ok: true; root: string; trackedOutput: string; branch: string; commit: string | null; toolchain: string } | { ok: false; error: string } {
  let root: string;
  try { root = fs.realpathSync(rootDir); } catch { return { ok: false, error: 'verification proof root is unreadable' }; }
  // Porcelain v2 reports cleanliness, branch and HEAD together. Repeated
  // active/review checks need no separate branch and revision subprocesses.
  const status = gitRunner(['-C', root, 'status', '--porcelain=v2', '--branch']);
  const lines = (status.stdout || '').split('\n').filter(Boolean);
  if (status.status !== 0 || lines.some(line => !line.startsWith('# '))) {
    return { ok: false, error: 'verification proof cannot reuse a dirty worktree' };
  }
  const branchLine = lines.find(line => line.startsWith('# branch.head '));
  const oidLine = lines.find(line => line.startsWith('# branch.oid '));
  if (!branchLine || !oidLine) { return { ok: false, error: 'verification branch identity is unreadable' }; }
  const branch = branchLine.slice('# branch.head '.length);
  const oid = oidLine.slice('# branch.oid '.length);
  if (oid !== '(initial)' && !/^[a-f0-9]{40,64}$/.test(oid)) {
    return { ok: false, error: 'verification HEAD identity is unreadable' };
  }
  const tracked = gitRunner(['-C', root, 'ls-files', '-s']);
  const trackedOutput = tracked.stdout || '';
  if (tracked.status !== 0 || !trackedOutput.trim()) {
    return { ok: false, error: 'verification proof input manifest is unreadable' };
  }
  return { ok: true, root, trackedOutput, branch: branch === '(detached)' ? '' : branch,
    commit: oid === '(initial)' ? null : oid, toolchain: verificationToolchainIdentity(searchPath) };
}

/** External task catalog paths excluded from active candidate inputs. */
export const isVerificationBookkeeping = (file: string): boolean =>
  file.startsWith('backlog/tasks/') || file.startsWith('backlog/completed/');
