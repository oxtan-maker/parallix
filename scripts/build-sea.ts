#!/usr/bin/env node

/**
 * build-sea.ts — narrow SEA build adapter for the native single-executable
 * proof (TASK-2286, ADR 0044).
 *
 * The adapter is deliberately thin: it consumes the canonical ESM bundle that
 * `scripts/build-canonical-bundle.ts` already published to `build/px.mjs` and
 * wraps it — byte for byte — into one Node single executable for the local
 * platform. It never rebuilds, re-bundles, transforms, or minifies the payload,
 * and it never edits `build/`.
 *
 * Usage:
 *   tsx scripts/build-sea.ts                  build build/sea/px for this platform
 *   tsx scripts/build-sea.ts --check-runtime  resolve/validate the SEA Node only
 *   tsx scripts/build-sea.ts --rollback       withdraw build/sea, leaving npm intact
 *
 * Environment:
 *   PARALLIX_SEA_NODE  explicit Node executable to embed and to run the SEA
 *                      config with. When unset, the adapter searches the
 *                      current executable, PATH, and nvm for a Node >= 25.
 *
 * Exit codes:
 *   0  success
 *   1  build failure
 *   2  no ESM-SEA-capable Node runtime available (ADR 0044 toolchain stop)
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

import { MINIMUM_SEA_NODE_MAJOR, evaluateSeaRuntime } from './sea-surfaces.ts';

const moduleRequire = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundleDir = path.join(root, 'build');
const bundlePath = path.join(bundleDir, 'px.mjs');
const seaDir = path.join(bundleDir, 'sea');
const executableName = process.platform === 'win32' ? 'px.exe' : 'px';

const RM_OPTIONS = { recursive: true, force: true, maxRetries: 10, retryDelay: 100 };
const NO_TOOLCHAIN_EXIT = 2;

/** Node's fixed SEA sentinel fuse (see nodejs.org single-executable-applications). */
const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

/**
 * The SEA configuration for this proof. `useSnapshot` and `useCodeCache` are
 * disabled: the mission scopes startup optimization out, and a snapshot would
 * stop the payload from being the untouched canonical bundle.
 */
const SEA_CONFIG = Object.freeze({
  main: 'px.mjs',
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,
  mainFormat: 'module',
});

interface SeaNode { executable: string; version: string; major: number; }

type SeaConfig = typeof SEA_CONFIG & { output: string; executable?: string };

/** Error carrying the process exit code the CLI should report. */
class SeaBuildError extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode: number) {
    super(message);
    this.name = 'SeaBuildError';
    this.exitCode = exitCode;
  }
}

function sha256File(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function parseNodeVersion(version: string | null | undefined): { major: number; minor: number; patch: number } | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(version || '').trim());
  if (!match) { return null; }
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/** Report the version string of a candidate Node executable, or null. */
function probeNodeVersion(executable: string): string | null {
  const probe = spawnSync(executable, ['--version'], { encoding: 'utf8' });
  if (probe.status !== 0) { return null; }
  const version = String(probe.stdout || '').trim();
  return /^v\d+\.\d+\.\d+/.test(version) ? version : null;
}

/**
 * Collect candidate Node executables in preference order: an operator-pinned
 * one first, then the running runtime, PATH, and nvm installs.
 */
function candidateNodeExecutables(): string[] {
  const candidates: string[] = [];
  if (process.env.PARALLIX_SEA_NODE) { candidates.push(process.env.PARALLIX_SEA_NODE); }
  candidates.push(process.execPath);
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    if (dir) { candidates.push(path.join(dir, process.platform === 'win32' ? 'node.exe' : 'node')); }
  }
  const nvmRoot = path.join(process.env.NVM_DIR || path.join(os.homedir(), '.nvm'), 'versions', 'node');
  try {
    // Newest first: v26 must win over v25 when both are installed.
    for (const version of fs.readdirSync(nvmRoot).sort().reverse()) {
      candidates.push(path.join(nvmRoot, version, 'bin', 'node'));
    }
  } catch {
    // nvm is optional.
  }
  const seen = new Set<string>();
  return candidates.filter(candidate => {
    if (!candidate || seen.has(candidate)) { return false; }
    seen.add(candidate);
    return true;
  });
}

/**
 * Resolve the Node runtime that will be embedded in the executable.
 *
 * SC1: when `PARALLIX_SEA_NODE` is set explicitly, an unsupported major is a
 * hard failure rather than a reason to silently search for a different runtime
 * — ADR 0044 forbids substituting a runtime behind the operator's back.
 *
 */
function resolveSeaNode(): SeaNode {
  const pinned = process.env.PARALLIX_SEA_NODE;
  if (pinned) {
    const version = probeNodeVersion(pinned);
    if (!version) {
      throw new SeaBuildError(`PARALLIX_SEA_NODE is not a runnable Node executable: ${pinned}`, NO_TOOLCHAIN_EXIT);
    }
    const verdict = evaluateSeaRuntime(version);
    if (!verdict.supported) {
      throw new SeaBuildError(`PARALLIX_SEA_NODE=${pinned}: ${verdict.reason}`, NO_TOOLCHAIN_EXIT);
    }
    return { executable: pinned, version, major: verdict.major };
  }

  const inspected: string[] = [];
  for (const candidate of candidateNodeExecutables()) {
    const version = probeNodeVersion(candidate);
    if (!version) { continue; }
    inspected.push(`${candidate} (${version})`);
    const verdict = evaluateSeaRuntime(version);
    if (verdict.supported) { return { executable: candidate, version, major: verdict.major }; }
  }
  throw new SeaBuildError(
    `No ESM-SEA-capable Node runtime found (need major >= ${MINIMUM_SEA_NODE_MAJOR} for ` +
    'mainFormat: "module"). Inspected: ' + (inspected.join(', ') || 'none') + '. ' +
    'Set PARALLIX_SEA_NODE to a Node 25/26 executable, or install one (e.g. `nvm install 26`).',
    NO_TOOLCHAIN_EXIT,
  );
}

/** Node >= 25.5.0 can build the final SEA executable without postject. */
function supportsBuiltInSeaBuild(version: string): boolean {
  const parsed = parseNodeVersion(version);
  if (!parsed) { return false; }
  return parsed.major > 25 || (parsed.major === 25 && parsed.minor >= 5);
}

function resolvePostjectCli(): string | null {
  try {
    return moduleRequire.resolve('postject/dist/cli.js');
  } catch {
    return null;
  }
}

function buildSeaConfig(output: string, executable: string): SeaConfig {
  return { ...SEA_CONFIG, output, executable };
}

/** Recursively copy `from` into `to`, creating parents. */
function copyTree(from: string, to: string): void {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
}

/** Current source commit, or 'unknown' outside a Git checkout. */
function sourceCommit(): string {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  return result.status === 0 ? String(result.stdout).trim() : 'unknown';
}

/**
 * Read the section names of a 64-bit little-endian ELF file.
 *
 * Only the section-header table and its string table are read, so the cost is
 * independent of the embedded SEA payload size.
 *
 * Returns [] when the file is not a 64-bit little-endian ELF.
 */
function elfSectionNames(file: string): string[] {
  const handle = fs.openSync(file, 'r');
  try {
    const header = Buffer.alloc(64);
    fs.readSync(handle, header, 0, 64, 0);
    // 0x7f 'E' 'L' 'F', then EI_CLASS === 2 (64-bit) and EI_DATA === 1 (LE).
    if (header.readUInt32BE(0) !== 0x7f454c46 || header[4] !== 2 || header[5] !== 1) { return []; }
    const sectionOffset = Number(header.readBigUInt64LE(0x28));
    const entrySize = header.readUInt16LE(0x3a);
    const entryCount = header.readUInt16LE(0x3c);
    const stringIndex = header.readUInt16LE(0x3e);
    if (sectionOffset === 0 || entryCount === 0 || stringIndex >= entryCount) { return []; }

    const table = Buffer.alloc(entrySize * entryCount);
    fs.readSync(handle, table, 0, table.length, sectionOffset);
    const stringHeader = table.subarray(stringIndex * entrySize, (stringIndex + 1) * entrySize);
    const stringsOffset = Number(stringHeader.readBigUInt64LE(0x18));
    const stringsSize = Number(stringHeader.readBigUInt64LE(0x20));
    const strings = Buffer.alloc(stringsSize);
    fs.readSync(handle, strings, 0, stringsSize, stringsOffset);

    const names: string[] = [];
    for (let index = 0; index < entryCount; index += 1) {
      const nameOffset = table.readUInt32LE(index * entrySize);
      const end = strings.indexOf(0, nameOffset);
      names.push(strings.toString('utf8', nameOffset, end === -1 ? undefined : end));
    }
    return names;
  } finally {
    fs.closeSync(handle);
  }
}

/**
 * Report whether the produced executable carries a platform code signature.
 * The proof is explicitly unsigned (signing is a later phase), so this exists
 * to make the *absence* inspectable rather than assumed.
 */
function inspectSignature(executable: string): { signed: boolean; status: string; mechanism: string } {
  if (process.platform === 'darwin') {
    const result = spawnSync('codesign', ['-dv', executable], { encoding: 'utf8' });
    const signed = result.status === 0;
    return { signed, status: signed ? 'signed' : 'unsigned', mechanism: 'codesign' };
  }
  if (process.platform === 'win32') {
    return { signed: false, status: 'unsigned', mechanism: 'authenticode' };
  }
  // ELF: an unsigned binary carries no signature section. Parse the real
  // section-header string table rather than substring-scanning 150 MB of
  // payload, which matches ".sig" inside arbitrary embedded data.
  const names = elfSectionNames(executable);
  const signed = names.some(name => name === '.note.signature' || name === '.sig' || name === '.signature');
  return { signed, status: signed ? 'signed' : 'unsigned', mechanism: 'elf-section-header' };
}

/** SC9: withdraw the binary artifact. npm and source execution are untouched. */
function rollback(): number {
  const existed = fs.existsSync(seaDir);
  fs.rmSync(seaDir, RM_OPTIONS);
  console.log(existed
    ? `[sea-rollback] removed ${seaDir}; npm fallback \`node build/px.mjs\` is unaffected`
    : `[sea-rollback] nothing to remove at ${seaDir}`);
  return 0;
}

interface PostjectBuild {
  seaNode: SeaNode;
  staging: string;
  configPath: string;
  stagedExecutable: string;
}

function buildWithPostject({ seaNode, staging, configPath, stagedExecutable }: PostjectBuild): SeaConfig {
  const postjectCli = resolvePostjectCli();
  if (!postjectCli) {
    throw new Error(
      `Node ${seaNode.version} requires external SEA blob injection, but the optional ` +
      '`postject` tool is not installed in this checkout. Install dev dependencies or use ' +
      'Node 25.5.0+ so `--build-sea` can build the executable directly.',
    );
  }

  const blobName = 'sea-prep.blob';
  const blobConfig = { ...SEA_CONFIG, output: blobName };
  fs.writeFileSync(configPath, `${JSON.stringify(blobConfig, null, 2)}\n`);

  execFileSync(seaNode.executable, ['--experimental-sea-config', configPath], {
    cwd: staging,
    stdio: 'inherit',
  });

  // Embed the *pinned* runtime: the executable is a copy of the very Node
  // that validated the config, not whatever `node` resolves to at run time.
  fs.copyFileSync(seaNode.executable, stagedExecutable);
  fs.chmodSync(stagedExecutable, 0o755);
  execFileSync(process.execPath, [
    postjectCli,
    stagedExecutable,
    'NODE_SEA_BLOB',
    path.join(staging, blobName),
    '--sentinel-fuse', SEA_FUSE,
  ], { cwd: staging, stdio: 'inherit' });

  return blobConfig;
}

function build(): number {
  // SC1: the runtime gate runs before any artifact is created or staged.
  const seaNode = resolveSeaNode();
  console.log(`[sea-build] pinned SEA runtime: ${seaNode.executable} (${seaNode.version})`);

  if (!fs.existsSync(bundlePath)) {
    throw new Error(`Canonical bundle missing at ${bundlePath}; run \`npm run bundle\` first.`);
  }

  const staging = path.join(root, `.sea-staging.${process.pid}`);
  fs.rmSync(staging, RM_OPTIONS);
  fs.mkdirSync(staging, { recursive: true });
  const payload = path.join(staging, 'payload');
  fs.mkdirSync(payload, { recursive: true });

  try {
    // SC2: the SEA main is a byte-for-byte copy of the canonical bundle. The
    // digest comparison is the falsifiable form of "exact npm payload".
    const bundleSha256 = sha256File(bundlePath);
    const seaMain = path.join(staging, SEA_CONFIG.main);
    fs.copyFileSync(bundlePath, seaMain);
    const seaMainSha256 = sha256File(seaMain);
    if (seaMainSha256 !== bundleSha256) {
      throw new Error(`SEA input is not byte-identical to ${bundlePath} (${seaMainSha256} != ${bundleSha256})`);
    }

    const stagedExecutable = path.join(payload, executableName);
    const configPath = path.join(staging, 'sea-config.json');
    let materializedConfig: SeaConfig;
    if (supportsBuiltInSeaBuild(seaNode.version)) {
      materializedConfig = buildSeaConfig(stagedExecutable, seaNode.executable);
      fs.writeFileSync(configPath, `${JSON.stringify(materializedConfig, null, 2)}\n`);
      execFileSync(seaNode.executable, ['--build-sea', configPath], {
        cwd: staging,
        stdio: 'inherit',
      });
      fs.chmodSync(stagedExecutable, 0o755);
    } else {
      materializedConfig = buildWithPostject({
        seaNode,
        staging,
        configPath,
        stagedExecutable,
      });
    }

    // The payload directory is the executable's package root. `packageRoot()`
    // walks up from the bundle's own directory — which, inside a SEA, is the
    // directory holding the executable — so staging build/'s package.json and
    // declared runtime assets here is what makes assets resolve natively.
    for (const entry of fs.readdirSync(bundleDir)) {
      // px.mjs itself is embedded in the executable; `sea/` is the output.
      if (entry === 'px.mjs' || entry === 'sea') { continue; }
      copyTree(path.join(bundleDir, entry), path.join(payload, entry));
    }
    // px.mjs.map stays next to the executable: the embedded bundle's
    // sourceMappingURL is resolved relative to the executable's own URL, which
    // is what makes SEA stack traces map back to .ts sources. The map moved one
    // directory deeper than in the npm layout (build/ -> build/sea/), so
    // each relative `sources` entry gains one more `../` so the mapped paths
    // stay the ones a developer can open.
    const stagedMap = path.join(payload, 'px.mjs.map');
    const sourceMap = JSON.parse(fs.readFileSync(stagedMap, 'utf8'));
    sourceMap.sources = sourceMap.sources.map((source: string) =>
      (path.posix.isAbsolute(source) || /^[a-z]+:/i.test(source)) ? source : `../${source}`);
    fs.writeFileSync(stagedMap, JSON.stringify(sourceMap));

    for (const file of ['LICENSE', 'NOTICES']) {
      fs.copyFileSync(path.join(root, file), path.join(payload, file));
    }
    fs.copyFileSync(configPath, path.join(payload, 'sea-config.json'));

    const executableSha256 = sha256File(stagedExecutable);
    const metadata = {
      task: 'TASK-2286',
      adr: 'docs/adr/0044-workflow-distribution-model.md',
      platform: `${process.platform}-${process.arch}`,
      pinnedNode: { executable: seaNode.executable, version: seaNode.version, major: seaNode.major },
      seaConfig: materializedConfig,
      bundleSha256,
      executableSha256,
      executableSizeBytes: fs.statSync(stagedExecutable).size,
      sourceCommit: sourceCommit(),
      signature: inspectSignature(stagedExecutable),
      crossPlatformClaim: 'none — this proof covers only the platform recorded above',
    };
    fs.writeFileSync(path.join(payload, 'sea-metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`);

    // Swap the finished payload into place; a failed build leaves build/sea as
    // it was, exactly like the canonical bundle builder.
    const retired = `${seaDir}.retired.${process.pid}`;
    fs.rmSync(retired, RM_OPTIONS);
    if (fs.existsSync(seaDir)) { fs.renameSync(seaDir, retired); }
    fs.renameSync(payload, seaDir);
    fs.rmSync(retired, RM_OPTIONS);

    const finalExecutable = path.join(seaDir, executableName);
    console.log(`[sea-build] ${finalExecutable}: ${metadata.executableSizeBytes.toLocaleString()} bytes`);
    console.log(`[sea-build] bundle sha256 ${bundleSha256} (byte-identical SEA input)`);
    console.log(`[sea-build] signature: ${metadata.signature.status}`);
    return 0;
  } finally {
    fs.rmSync(staging, RM_OPTIONS);
  }
}

function main(argv: string[]): number {
  if (argv.includes('--rollback')) { return rollback(); }
  if (argv.includes('--check-runtime')) {
    const seaNode = resolveSeaNode();
    console.log(JSON.stringify(seaNode, null, 2));
    return 0;
  }
  return build();
}

function runCli(): void {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`[sea-build] FAIL: ${(error as Error).message}`);
    const exitCode = (error as SeaBuildError).exitCode;
    process.exitCode = typeof exitCode === 'number' ? exitCode : 1;
  }
}

export { SEA_CONFIG, SeaBuildError, executableName, resolveSeaNode, seaDir, main };
export type { SeaNode };

// Run as a script: `tsx scripts/build-sea.ts [--rollback|--check-runtime]`.
// The module is ESM (it reads import.meta.url), so entry detection compares the
// invoked path rather than require.main.
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) { runCli(); }
