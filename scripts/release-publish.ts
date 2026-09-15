import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type Version = [number, number, number];
type Command = (command: string, args: string[]) => { status: number | null, stdout: string, stderr: string };

const packageName = '@magnusekdahl/parallix';
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function parseNormalVersion(value: unknown): Version | null {
  const match = semver.exec(String(value));
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

export function isNewerNormalVersion(proposed: string, published: string): boolean {
  const left = parseNormalVersion(proposed);
  const right = parseNormalVersion(published);
  if (!left || !right) { return false; }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) { return left[index] > right[index]; }
  }
  return false;
}

export function validateMetadata(manifest: { version?: unknown }, lockfile: { version?: unknown }): string {
  if (!parseNormalVersion(manifest.version)) {
    throw new Error(`package.json version must be a normal SemVer version, got ${String(manifest.version)}`);
  }
  if (manifest.version !== lockfile.version) {
    throw new Error('package.json and package-lock.json versions must match');
  }
  return manifest.version as string;
}

function command(command: string, args: string[]): { status: number | null, stdout: string, stderr: string } {
  const result = childProcess.spawnSync(command, args, { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

function required(run: Command, executable: string, args: string[]): string {
  const result = run(executable, args);
  if (result.status !== 0) { throw new Error(`${executable} ${args.join(' ')} failed: ${result.stderr || result.stdout}`); }
  return result.stdout.trim();
}

function npmValue(run: Command, spec: string, field: string): string | null {
  const result = run('npm', ['view', spec, field, '--json', '--registry=https://registry.npmjs.org']);
  if (result.status !== 0) {
    if (/\bE404\b|404 Not Found/i.test(`${result.stderr}\n${result.stdout}`)) { return null; }
    throw new Error(`npm view ${spec} ${field} failed: ${result.stderr || result.stdout}`);
  }
  try { return String(JSON.parse(result.stdout)); } catch { return result.stdout.trim() || null; }
}

export function validateTrustedRelease(root: string, trustedSha: string, run: Command = command) {
  if (process.env.NPM_TOKEN || process.env.NODE_AUTH_TOKEN) {
    throw new Error('release must use npm Trusted Publishing without NPM_TOKEN or NODE_AUTH_TOKEN');
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const lockfile = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const version = validateMetadata(manifest, lockfile);
  const publishedVersion = npmValue(run, `${packageName}@${version}`, 'version');
  const publishedGitHead = publishedVersion === null ? null : npmValue(run, `${packageName}@${version}`, 'gitHead');
  if (publishedVersion !== null && publishedGitHead !== trustedSha) {
    throw new Error(`${packageName}@${version} is already published for a different SHA`);
  }
  const latest = npmValue(run, packageName, 'version');
  if (publishedVersion === null && latest !== null && !isNewerNormalVersion(version, latest)) {
    throw new Error(`${version} is not newer than published normal release ${latest}`);
  }
  const tag = `v${version}`;
  const tagSha = run('git', ['rev-parse', `${tag}^{commit}`]);
  if (tagSha.status === 0 && tagSha.stdout.trim() !== trustedSha) {
    throw new Error(`${tag} points to ${tagSha.stdout.trim()}, not trusted SHA ${trustedSha}`);
  }
  return { version, tag, alreadyPublished: publishedVersion !== null, tagExists: tagSha.status === 0 };
}

export function publishTrustedRelease(root: string, trustedSha: string, run: Command = command) {
  const release = validateTrustedRelease(root, trustedSha, run);
  required(run, 'npm', ['run', 'prepack']);
  required(run, 'npm', ['run', 'prepublishOnly']);
  if (!release.alreadyPublished) {
    required(run, 'npm', ['publish', '--access', 'public', '--provenance', '--registry=https://registry.npmjs.org']);
  }
  if (!release.tagExists) {
    required(run, 'git', ['tag', release.tag, trustedSha]);
    required(run, 'git', ['push', 'origin', release.tag]);
  }
  // A release is bound to its tag, and validateTrustedRelease already proved the
  // tag is absent or at trustedSha. targetCommitish is not compared: GitHub
  // ignores it once the tag exists, so it proves nothing about the release.
  const existingRelease = run('gh', ['release', 'view', release.tag]);
  if (existingRelease.status !== 0) {
    if (!/not found/i.test(`${existingRelease.stderr}\n${existingRelease.stdout}`)) {
      throw new Error(`gh release view ${release.tag} failed: ${existingRelease.stderr || existingRelease.stdout}`);
    }
    required(run, 'gh', ['release', 'create', release.tag, '--target', trustedSha, '--generate-notes']);
  }
}

function main() {
  const trustedSha = required(command, 'git', ['rev-parse', 'HEAD']);
  publishTrustedRelease(process.cwd(), trustedSha);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) { main(); }
