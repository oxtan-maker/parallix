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
  { ok: true; root: string; trackedOutput: string; branch: string; toolchain: string } | { ok: false; error: string } {
  let root: string;
  try { root = fs.realpathSync(rootDir); } catch { return { ok: false, error: 'verification proof root is unreadable' }; }
  const dirty = gitRunner(['-C', root, 'status', '--porcelain']);
  if (dirty.status !== 0 || (dirty.stdout || '').trim()) {
    return { ok: false, error: 'verification proof cannot reuse a dirty worktree' };
  }
  const tracked = gitRunner(['-C', root, 'ls-files', '-s']);
  const trackedOutput = tracked.stdout || '';
  if (tracked.status !== 0 || !trackedOutput.trim()) {
    return { ok: false, error: 'verification proof input manifest is unreadable' };
  }
  const branch = gitRunner(['-C', root, 'branch', '--show-current']);
  if (branch.status !== 0) { return { ok: false, error: 'verification branch identity is unreadable' }; }
  return { ok: true, root, trackedOutput, branch: branch.stdout.trim(), toolchain: verificationToolchainIdentity(searchPath) };
}

/** External task catalog paths excluded from active candidate inputs. */
export const isVerificationBookkeeping = (file: string): boolean =>
  file.startsWith('backlog/tasks/') || file.startsWith('backlog/completed/');
