// Dependency install identity for Parallix's own development worktrees (TASK-2714).
//
// Parallix develops itself: every mission worktree runs the draft install hook and
// every landed integration runs scripts/refresh-global-px.sh, which used to run
// `pnpm install --frozen-lockfile` unconditionally even when nothing the installer
// consumes had changed. This module records, per environment (per worktree), the
// semantic dependency inputs of the LAST SUCCESSFUL install, so a later refresh can
// skip reconciliation when that identity still matches and must reconcile when it
// does not.
//
// Semantic, not raw bytes: a release version bump (scripts/bump-version.sh) changes
// package.json `version` and, where a root lockfile carries one, that lockfile's root
// version metadata. Neither changes what gets installed, so neither may invalidate the
// identity. Dependency specifiers, resolutions, integrity hashes, install policy
// (pnpm-workspace.yaml) and the pinned toolchain do.
//
// A successful identity is published only after the installer exits 0. A missing,
// unreadable, schema-invalid or mismatched record means "reconcile". Trust is also
// withdrawn *before* the installer runs: the record is marked pending, so an install
// that fails partway (pnpm may already have mutated node_modules) cannot leave the
// previous success trusted, even when the inputs are later reverted.
//
// An identity match alone is not proof of an installed tree. The skip path also
// requires the install output (node_modules) to still be present, so deleting the
// installed tree while keeping the record reconciles instead of building on nothing.
//
// Plain ESM with no dependencies: the draft hook runs in a worktree that has no
// node_modules yet, so this file must be runnable by bare `node`.
//
// ADR 0063 keeps pnpm as the installer and pnpm-lock.yaml as the only lockfile;
// ADR 0044/0046 keep npm for packing and publication. This module changes neither.

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

export const IDENTITY_SCHEMA = 1;
export const IDENTITY_RELATIVE_PATH = path.join('.workflow', 'dependency-identity.json');
export const INSTALL_ARGS = ['install', '--frozen-lockfile', '--prefer-offline'];
export const INSTALL_COMMAND = 'pnpm';
// The directory the installer produces. Its absence invalidates an otherwise
// matching identity: the record describes an install, not a tree that still exists.
export const INSTALL_STATE_DIRECTORY = 'node_modules';

// Manifest fields whose presence means the install has something to produce.
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'bundledDependencies', 'bundleDependencies'];

// package.json fields the installer consumes. `version` is deliberately absent: it is
// release metadata, and a version-only bump must not reinstall.
const MANIFEST_FIELDS = [
  'name',
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
  'peerDependenciesMeta',
  'bundledDependencies',
  'bundleDependencies',
  'overrides',
  'pnpm',
  'engines',
  'engineStrict',
  'packageManager',
  'bin',
];

/** @param {string} worktree @returns {string} */
export function identityFile(worktree) {
  return path.join(worktree, IDENTITY_RELATIVE_PATH);
}

/**
 * Root-project version metadata is release bookkeeping, not an install input.
 * In a YAML lockfile it is a top-level (indentation zero) `version:` key; nested
 * `version:` entries under `importers:`/`packages:`/`snapshots:` are resolutions and
 * stay in the identity.
 *
 * @param {string} text
 * @returns {string}
 */
export function normalizeYamlLockfile(text) {
  return String(text)
    .split('\n')
    .filter(line => !/^version:/.test(line))
    .join('\n');
}

/** @param {string} text @returns {unknown} */
function normalizeJsonLockfile(text) {
  const parsed = JSON.parse(text);
  if (parsed && typeof parsed === 'object') {
    delete parsed.version;
    const rootPkg = parsed.packages && parsed.packages[''];
    if (rootPkg && typeof rootPkg === 'object') { delete rootPkg.version; }
  }
  return parsed;
}

/**
 * The semantic dependency inputs of a worktree, in a deterministic order.
 *
 * @param {string} worktree
 * @param {{ readFileFn?: (_p: string) => string, existsFn?: (_p: string) => boolean, nodeVersion?: string }} [options]
 * @returns {{ manifests: Record<string, unknown>, lockfiles: Record<string, string>, installPolicy: Record<string, string>, toolchain: Record<string, string> }}
 */
export function dependencyInputs(worktree, options = {}) {
  const readFileFn = options.readFileFn || ((p) => fs.readFileSync(p, 'utf8'));
  const existsFn = options.existsFn || ((p) => fs.existsSync(p));
  const read = (name) => {
    const file = path.join(worktree, name);
    return existsFn(file) ? readFileFn(file) : null;
  };

  const manifests = {};
  const rootManifest = read('package.json');
  if (rootManifest !== null) {
    const parsed = JSON.parse(rootManifest);
    const selected = {};
    for (const field of MANIFEST_FIELDS) {
      if (parsed[field] !== undefined) { selected[field] = parsed[field]; }
    }
    manifests['package.json'] = selected;
  }

  const lockfiles = {};
  for (const name of ['pnpm-lock.yaml', 'npm-shrinkwrap.json', 'package-lock.json']) {
    const text = read(name);
    if (text === null) { continue; }
    lockfiles[name] = name.endsWith('.json') ? normalizeJsonLockfile(text) : normalizeYamlLockfile(text);
  }

  const installPolicy = {};
  for (const name of ['pnpm-workspace.yaml', '.npmrc']) {
    const text = read(name);
    if (text !== null) { installPolicy[name] = text; }
  }

  return {
    manifests,
    lockfiles,
    installPolicy,
    toolchain: {
      node: options.nodeVersion || process.version,
      packageManager: String((manifests['package.json'] || {}).packageManager || ''),
    },
  };
}

/** @param {unknown} value @returns {string} */
function canonicalJson(value) {
  if (value === null || typeof value !== 'object') { return JSON.stringify(value) ?? 'null'; }
  if (Array.isArray(value)) { return `[${value.map(canonicalJson).join(',')}]`; }
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

/**
 * sha256 over the canonical semantic inputs. Two worktrees with the same identity
 * install the same dependency graph.
 *
 * @param {string} worktree
 * @param {Parameters<typeof dependencyInputs>[1]} [options]
 * @returns {{ identity: string, inputs: ReturnType<typeof dependencyInputs> }}
 */
export function computeDependencyIdentity(worktree, options = {}) {
  const inputs = dependencyInputs(worktree, options);
  return { identity: crypto.createHash('sha256').update(canonicalJson(inputs)).digest('hex'), inputs };
}

/**
 * The raw identity record for a worktree, trusted or not, or null when absent or
 * unparsable. Kept separate from `readInstalledIdentity` so a withdrawn record can
 * still be inspected for forensics without ever being trusted.
 *
 * @param {string} worktree
 * @returns {{ identity?: unknown, pendingReconciliation?: unknown } | null}
 */
export function readIdentityRecord(worktree) {
  try {
    const record = JSON.parse(fs.readFileSync(identityFile(worktree), 'utf8'));
    return record && typeof record === 'object' ? record : null;
  } catch (_) {
    return null;
  }
}

/**
 * The recorded identity for a worktree, or null when absent, unusable or withdrawn.
 * A record that fails the schema check is treated exactly like a missing one: the
 * caller reconciles instead of trusting a corrupt file. A record marked pending by a
 * reconciliation that has not succeeded yet is equally untrusted.
 *
 * @param {string} worktree
 * @returns {{ identity: string, inputs?: unknown, publishedAt?: string } | null}
 */
export function readInstalledIdentity(worktree) {
  const record = readIdentityRecord(worktree);
  if (!record) { return null; }
  if (record.pendingReconciliation) { return null; }
  if (record.schema !== IDENTITY_SCHEMA) { return null; }
  if (typeof record.identity !== 'string' || !/^[0-9a-f]{64}$/.test(record.identity)) { return null; }
  return record;
}

/**
 * Withdraw trust in the recorded identity before an installer is allowed to mutate
 * the tree. The prior identity stays in the file for inspection, but a concurrent or
 * later reader cannot treat it as a successful install until this run succeeds.
 *
 * @param {string} worktree
 * @param {{ targetIdentity: string, nowFn?: () => Date }} params
 * @returns {void}
 */
export function markReconciliationPending(worktree, params) {
  const file = identityFile(worktree);
  const previous = readIdentityRecord(worktree);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({
    schema: IDENTITY_SCHEMA,
    identity: typeof previous?.identity === 'string' ? previous.identity : null,
    inputs: previous?.inputs ?? null,
    publishedAt: previous?.publishedAt ?? null,
    pendingReconciliation: { targetIdentity: params.targetIdentity, attemptedAt: (params.nowFn || (() => new Date()))().toISOString() },
  }, null, 2)}\n`, 'utf8');
}

/**
 * Whether the manifest declares anything for the installer to produce. A manifest
 * with no dependencies legitimately installs to an empty (or absent) node_modules.
 *
 * @param {ReturnType<typeof dependencyInputs>} inputs
 * @returns {boolean}
 */
export function declaresDependencies(inputs) {
  const manifest = (inputs && inputs.manifests && inputs.manifests['package.json']) || {};
  return DEPENDENCY_FIELDS.some(field => {
    const value = manifest[field];
    if (Array.isArray(value)) { return value.length > 0; }
    return Boolean(value) && typeof value === 'object' && Object.keys(value).length > 0;
  });
}

/**
 * Whether the installed dependency tree the identity describes is still present.
 * A record alone is not an installed tree: node_modules can be pruned, moved or
 * cleaned while the record survives.
 *
 * @param {string} worktree
 * @param {{ inputs?: ReturnType<typeof dependencyInputs>, statFn?: (_p: string) => any, readdirFn?: (_p: string) => string[] | null }} [options]
 * @returns {boolean}
 */
export function installedStatePresent(worktree, options = {}) {
  if (options.inputs && !declaresDependencies(options.inputs)) { return true; }
  const statFn = options.statFn || ((p) => { try { return fs.statSync(p); } catch (_) { return null; } });
  const readdirFn = options.readdirFn || ((p) => { try { return fs.readdirSync(p); } catch (_) { return null; } });
  const directory = path.join(worktree, INSTALL_STATE_DIRECTORY);
  const stats = statFn(directory);
  if (!stats || !stats.isDirectory()) { return false; }
  const entries = readdirFn(directory);
  return Array.isArray(entries) && entries.length > 0;
}

/**
 * Publish the identity of a dependency installation that already succeeded.
 *
 * @param {string} worktree
 * @param {{ identity: string, inputs?: unknown }} record
 * @returns {string} the path written
 */
export function publishInstalledIdentity(worktree, record) {
  const file = identityFile(worktree);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({
    schema: IDENTITY_SCHEMA,
    identity: record.identity,
    inputs: record.inputs ?? null,
    publishedAt: new Date().toISOString(),
  }, null, 2)}\n`, 'utf8');
  return file;
}

/**
 * Reconcile the worktree's dependencies only when the recorded successful identity no
 * longer matches, or when the installed tree it describes is gone, then publish the
 * new identity. Exits with the installer's status; a failed install publishes nothing
 * and leaves the record untrusted.
 *
 * @param {{ worktree: string, force?: boolean, command?: string, args?: string[], nodeVersion?: string, nowFn?: () => Date, logFn?: (_l: string) => void, spawnFn?: Function, installedStatePresentFn?: (_w: string, _o: any) => boolean }} params
 * @returns {{ action: 'skipped' | 'installed' | 'failed', identity: string, exitCode: number | null, reason: string }}
 */
export function ensureDependencies(params) {
  const worktree = params.worktree;
  const logFn = params.logFn || ((line) => process.stdout.write(`${line}\n`));
  const spawnFn = params.spawnFn || ((cmd, args) => spawnSync(cmd, args, { cwd: worktree, stdio: 'inherit' }));
  const presentFn = params.installedStatePresentFn || installedStatePresent;
  const command = params.command || INSTALL_COMMAND;
  const args = params.args || INSTALL_ARGS;

  // The node runtime is part of the semantic inputs: an install made under one
  // runtime is not proven correct under another (engines, build scripts).
  const { identity, inputs } = computeDependencyIdentity(worktree, { nodeVersion: params.nodeVersion });
  const recorded = readInstalledIdentity(worktree);

  if (!params.force && recorded && recorded.identity === identity) {
    if (presentFn(worktree, { inputs })) {
      logFn(`dependency-identity: skip install in ${worktree}; installed identity ${identity.slice(0, 12)} still matches`);
      return { action: 'skipped', identity, exitCode: 0, reason: 'identity-match' };
    }
    logFn(`dependency-identity: installed identity ${identity.slice(0, 12)} matches but ${INSTALL_STATE_DIRECTORY} is missing in ${worktree}; reconciling`);
  }

  const reason = params.force ? 'forced'
    : !recorded ? 'no successful installed identity recorded'
      : recorded.identity === identity ? 'installed dependency tree is missing'
        : 'installed identity no longer matches the dependency inputs';
  logFn(`dependency-identity: ${reason}; running \`${command} ${args.join(' ')}\``);

  // Withdraw trust before the installer can touch the tree. A partial install must
  // never be covered by the previous success, not even after the inputs revert.
  markReconciliationPending(worktree, { targetIdentity: identity, nowFn: params.nowFn });

  const result = spawnFn(command, args);
  if (result.status !== 0) {
    logFn(`dependency-identity: install failed (exit ${result.status}); identity ${identity.slice(0, 12)} stays untrusted until a successful install`);
    return { action: 'failed', identity, exitCode: result.status ?? 1, reason: 'install-failed' };
  }

  publishInstalledIdentity(worktree, { identity, inputs });
  logFn(`dependency-identity: installed identity ${identity.slice(0, 12)} published for ${worktree}`);
  return { action: 'installed', identity, exitCode: 0, reason };
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--worktree') { out.worktree = argv[++i]; }
    else if (arg === '--force') { out.force = true; }
    else if (arg === '--command') { out.command = argv[++i]; }
    else { out._.push(arg); }
  }
  return out;
}

function main(argv) {
  const [subcommand, ...rest] = argv;
  const options = parseArgs(rest);
  const worktree = path.resolve(options.worktree || process.cwd());

  if (subcommand === 'ensure') {
    const result = ensureDependencies({ ...options, worktree });
    return result.exitCode ?? 0;
  }
  if (subcommand === 'compute') {
    process.stdout.write(`${computeDependencyIdentity(worktree).identity}\n`);
    return 0;
  }
  if (subcommand === 'check') {
    const { identity, inputs } = computeDependencyIdentity(worktree);
    const recorded = readInstalledIdentity(worktree);
    // A match is only meaningful while the installed tree still exists; dependent
    // work must stop on a pruned tree exactly as it does on a changed identity.
    const matches = Boolean(recorded) && recorded.identity === identity
      && installedStatePresent(worktree, { inputs });
    process.stdout.write(`${matches ? 'match' : 'reconcile'} ${identity.slice(0, 12)}${recorded ? ` ${recorded.identity.slice(0, 12)}` : ' none'}\n`);
    return matches ? 0 : 2;
  }
  if (subcommand === 'published') {
    const recorded = readInstalledIdentity(worktree);
    process.stdout.write(`${recorded ? recorded.identity : 'none'}\n`);
    return recorded ? 0 : 1;
  }
  process.stderr.write('usage: dependency-identity.mjs <ensure|compute|check|published> --worktree DIR [--force]\n');
  return 64;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  process.exitCode = main(process.argv.slice(2));
}
