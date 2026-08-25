import { git, run } from '../git/git.js';
import type { SpawnSyncOptions } from 'node:child_process';
import { loadAdapterConfig } from '../config/product-config.js';
import { log } from '../../application/presentation/cli-format.js';
import * as fsMod from 'node:fs';
import * as pathMod from 'node:path';
import { createHash } from 'node:crypto';
import { getPrimaryBranch } from '../filesystem/mission-utils.js';
import { resolveParallixHome, readJson, writeJson } from '../storage/storage.js';

interface GitOptions {
  encoding?: BufferEncoding;
  stdio?: SpawnSyncOptions['stdio'];
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

export type GitFn = (_args: string[], _options?: GitOptions) => GitResult;

export interface VerificationAdapterConfig {
  command: string | null;
  defaultArea: string;
}

/** Adapter-owned machine markers for unchanged-tree verifier contention. */
export function isTransientVerificationFailure(output: { stdout?: unknown; stderr?: unknown }): boolean {
  const diagnostic = `${String(output.stdout ?? '')}\n${String(output.stderr ?? '')}`;
  return /\[unit-test-budget:exceeded\]|\[unit-test-budget\]\s+SUITE BUDGET EXCEEDED:/i.test(diagnostic);
}

export interface VerificationProof {
  rootDir: string;
  branch?: string;
  area: string;
  command: string | null;
  commit: string;
  tree: string;
  verifiedAt: string;
}

export interface ReusableVerificationProof {
  version: 2;
  identity: string;
  command: string;
  inputFingerprint: string;
  toolchain: string;
  commit: string;
  tree: string;
  verifiedAt: string;
  status: 'passed';
}

export interface PublishedTreeStateOk {
  ok: true;
  rootDir: string;
  commit: string;
  tree: string;
}

export interface PublishedTreeStateFail {
  ok: false;
  error: string;
}

export type PublishedTreeState = PublishedTreeStateOk | PublishedTreeStateFail;

// parallix targets arbitrary repositories, so there is no universal gate
// command. When adapters.verification.command is not configured, verification
// is a no-op pass ("no validation"). A repository opts into a real gate by
// declaring the command in workflow.config.json.
export const DEFAULT_AREA = 'docs';
// Shell-safe no-op so this is harmless if pasted into a command sequence: `:` is
// the bash null command and `#` comments the explanation.
export const NO_GATE_NOTICE = ': # no verification gate configured (set adapters.verification.command)';

export function resolveVerificationAdapter(rootDir: string = process.cwd()): VerificationAdapterConfig {
  const config = loadAdapterConfig(rootDir);
  const verification = (config.verification as { command?: unknown; defaultArea?: unknown }) || {};
  const command = typeof verification.command === 'string' && verification.command.trim()
    ? verification.command.trim()
    : null;
  const defaultArea = typeof verification.defaultArea === 'string' && verification.defaultArea.trim()
    ? verification.defaultArea.trim()
    : DEFAULT_AREA;

  return { command, defaultArea };
}

const KNOWN_CHANGE_AREAS = ['lib', 'server', 'auth-server', 'web-client', 'docs', 'workflow', 'android', 'kubernetes'];
const WORKFLOW_OWNED_DIRS = new Set(['test', 'scripts', 'config', 'prompts', 'data']);

/** @param {string} filesOutput */
export function detectAreasFromChangedFiles(filesOutput: string): string[] {
  const areas = new Set<string>();
  filesOutput.split('\n').forEach((rawFile) => {
    const file = rawFile.trim();
    if (!file || !file.includes('/')) {return;}
    const topDir = file.split('/')[0];
    if (KNOWN_CHANGE_AREAS.includes(topDir)) {
      areas.add(topDir);
      return;
    }
    if (WORKFLOW_OWNED_DIRS.has(topDir)) {
      areas.add('workflow');
    }
  });
  return Array.from(areas);
}

/**
 * Detect the verification area from files changed in the mission's worktree
 * relative to the primary branch. Returns null when no mission context or
 * relevant changed files are available.
 */
export function detectMissionChangedArea(
  missionDir: string | null,
  rootDir: string = process.cwd(),
  options: { gitRunner?: GitFn; baseBranch?: string } = {}
): string | null {
  if (!missionDir) {return null;}

  const gitRunner = options.gitRunner || git;
  let baseBranch = options.baseBranch;
  if (!baseBranch) {
    try {
      baseBranch = getPrimaryBranch(rootDir, gitRunner as unknown as Function);
    } catch {
      return null;
    }
  }

  const diffResult = gitRunner(['-C', rootDir, 'diff', '--name-only', `${baseBranch}...HEAD`]);
  if (diffResult.status !== 0 || !diffResult.stdout || !diffResult.stdout.trim()) {
    return null;
  }

  const areas = detectAreasFromChangedFiles(diffResult.stdout);
  // A verification command accepts one area. Mixed-area changes must use the
  // strict superset rather than silently choosing the first path in git's
  // alphabetical output (for example, docs before lib).
  if (areas.length > 1) {return 'all';}
  return areas[0] || null;
}

/** Resolve an explicit, diff-scoped, or configured verification area. */
export function resolveEffectiveArea(area: string | undefined, rootDir: string = process.cwd(), missionDir: string | null = null): string {
  if (area) {return area;}
  const { defaultArea } = resolveVerificationAdapter(rootDir);
  return detectMissionChangedArea(missionDir, rootDir) || defaultArea;
}

/** @param {string} [area] @param {string} [rootDir] @param {string|null} [missionDir] */
export function formatVerificationCommand(area: string | undefined, rootDir: string = process.cwd(), missionDir: string | null = null): string {
  const { command } = resolveVerificationAdapter(rootDir);
  // An already-resolved area is authoritative. Only resolve from mission
  // context when the caller has not supplied one.
  const effectiveArea = area || resolveEffectiveArea(undefined, rootDir, missionDir);
  if (!command) {
    return NO_GATE_NOTICE;
  }
  return command.replaceAll('{{area}}', effectiveArea || DEFAULT_AREA);
}

/** @param {string} [area] @param {{rootDir?: string, log?: Function, stdio?: string, runFn?: Function}} [options] */
export function runVerificationGate(area: string | undefined, options: { rootDir?: string; log?: Function; stdio?: string; runFn?: Function; maxBuffer?: number } = {}): import('child_process').SpawnSyncReturns<string> {
  const opts = options;
  const rootDir = opts.rootDir || process.cwd();
  const { command, defaultArea } = resolveVerificationAdapter(rootDir);
  const effectiveArea = area || defaultArea;

  if (!command) {
    const info = opts.log || log.info;
    info(`No verification gate configured for area: ${effectiveArea}; default is no validation. `
      + 'Set adapters.verification.command in workflow.config.json to enforce one.');
    return { status: 0 } as import('child_process').SpawnSyncReturns<string>;
  }

  const stdio = opts.stdio || 'inherit';
  const runFn = opts.runFn || run;
  return runFn('bash', ['-c', command.replaceAll('{{area}}', effectiveArea)], {
    cwd: rootDir,
    stdio,
    ...(stdio === 'pipe' ? { encoding: 'utf8', maxBuffer: opts.maxBuffer ?? 10 * 1024 * 1024 } : {}),
  });
}

/** The gate-result artifact a lifecycle command leaves for the board to read. */
export interface GateResultRecord {
  /** Verification area the gate ran for. */
  readonly area: string;
  /** Gate command line, recorded so the status can be traced to what ran. */
  readonly command: string;
  /** Process exit code. `0` is the only passing value. */
  readonly exitCode: number;
  readonly status: 'passed' | 'failed';
  readonly recordedAt: string;
}

/** Relative location of the gate-result artifact inside a mission directory. */
export const GATE_RESULT_RELATIVE_PATH = pathMod.join('.workflow', 'gate-result.json');

/**
 * Record the outcome of a verification gate run beside the mission.
 *
 * The status is the process exit code and nothing else — ADR 0048 classifies an
 * agent's own prose about a gate as an unverifiable claim (failure class 1), so
 * the board must never derive gate state from checkpoint narrative. `.workflow/`
 * is ignored by Git, which keeps this an operator-local observation of a local
 * run rather than a committed assertion about the tree.
 *
 * Returns the written record, or `null` when the artifact could not be written;
 * recording never blocks the command that produced the result.
 */
export function recordGateResult(
  missionDir: string,
  result: { area: string; command: string; exitCode: number | null },
  options: { now?: () => Date } = {},
): GateResultRecord | null {
  const exitCode = typeof result.exitCode === 'number' ? result.exitCode : 1;
  const record: GateResultRecord = {
    area: result.area,
    command: result.command,
    exitCode,
    status: exitCode === 0 ? 'passed' : 'failed',
    recordedAt: (options.now ? options.now() : new Date()).toISOString(),
  };
  const target = pathMod.join(missionDir, GATE_RESULT_RELATIVE_PATH);
  try {
    writeJson(target, record);
    return record;
  } catch {
    return null;
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Fingerprint every tracked input for an expensive verifier. This deliberately
 * uses the complete tracked index rather than a guessed changed-file subset:
 * an incomplete manifest must execute, never reuse. Any dirty worktree fails
 * closed before the index fingerprint can be trusted.
 */
export function createVerificationProofIdentity(command: string, rootDir: string = process.cwd(), options: { gitRunner?: GitFn } = {}): { ok: boolean; identity?: string; inputFingerprint?: string; toolchain?: string; commit?: string; tree?: string; error?: string } {
  if (typeof command !== 'string' || !command.trim()) {
    return { ok: false, error: 'verification proof requires a non-empty command' };
  }
  const gitRunner = options.gitRunner || git;
  let resolvedRoot: string;
  try { resolvedRoot = fsMod.realpathSync(rootDir); } catch { return { ok: false, error: 'verification proof root is unreadable' }; }
  const dirty = gitRunner(['-C', resolvedRoot, 'status', '--porcelain']);
  const dirtyOutput = dirty.stdout || '';
  if (dirty.status !== 0 || dirtyOutput.trim()) {
    return { ok: false, error: 'verification proof cannot reuse a dirty worktree' };
  }
  const tracked = gitRunner(['-C', resolvedRoot, 'ls-files', '-s']);
  const trackedOutput = tracked.stdout || '';
  if (tracked.status !== 0 || !trackedOutput.trim()) {
    return { ok: false, error: 'verification proof input manifest is unreadable' };
  }
  const state = readPublishedTreeState(resolvedRoot, { gitRunner });
  if (!state.ok) { return state; }
  const toolchain = JSON.stringify({ node: process.version, modules: process.versions.modules, platform: process.platform, arch: process.arch });
  const inputFingerprint = digest(trackedOutput);
  return {
    ok: true,
    inputFingerprint,
    toolchain,
    commit: state.commit,
    tree: state.tree,
    identity: digest(JSON.stringify({ version: 2, command: command.trim(), inputFingerprint, toolchain, commit: state.commit, tree: state.tree })),
  };
}

export function verificationProofPath(identity: string, homeDir: string = resolveParallixHome({ ensureDir: false })): string {
  return pathMod.join(homeDir, 'verification-proofs', `${identity}.json`);
}

export function readReusableVerificationProof(command: string, rootDir: string = process.cwd(), options: { gitRunner?: GitFn; proofPath?: string } = {}): { ok: boolean; proof?: ReusableVerificationProof; identity?: string; error?: string } {
  const identityResult = createVerificationProofIdentity(command, rootDir, options);
  if (!identityResult.ok) { return identityResult; }
  const filePath = options.proofPath || verificationProofPath(identityResult.identity!);
  const result = readJson<ReusableVerificationProof>(filePath);
  const proof = result.data;
  if (!result.ok || !proof || proof.version !== 2 || proof.status !== 'passed'
    || proof.identity !== identityResult.identity || proof.command !== command.trim()
    || proof.inputFingerprint !== identityResult.inputFingerprint || proof.toolchain !== identityResult.toolchain
    || proof.commit !== identityResult.commit || proof.tree !== identityResult.tree) {
    return { ok: false, identity: identityResult.identity, error: 'verification proof is missing, malformed, or does not match current inputs' };
  }
  return { ok: true, proof, identity: identityResult.identity };
}

export function writeReusableVerificationProof(command: string, rootDir: string = process.cwd(), options: { gitRunner?: GitFn; proofPath?: string; expectedIdentity?: string } = {}): { ok: boolean; proof?: ReusableVerificationProof; identity?: string; error?: string } {
  const identityResult = createVerificationProofIdentity(command, rootDir, options);
  if (!identityResult.ok) { return identityResult; }
  if (options.expectedIdentity && identityResult.identity !== options.expectedIdentity) {
    return { ok: false, identity: identityResult.identity, error: 'verification inputs changed while the gate was running' };
  }
  const proof: ReusableVerificationProof = {
    version: 2,
    identity: identityResult.identity!,
    command: command.trim(),
    inputFingerprint: identityResult.inputFingerprint!,
    toolchain: identityResult.toolchain!,
    commit: identityResult.commit!,
    tree: identityResult.tree!,
    verifiedAt: new Date().toISOString(),
    status: 'passed',
  };
  try {
    writeJson(options.proofPath || verificationProofPath(proof.identity, resolveParallixHome({ ensureDir: true })), proof, { mode: 0o600 });
  } catch {
    return { ok: false, identity: proof.identity, error: 'verification proof could not be written' };
  }
  return { ok: true, proof, identity: proof.identity };
}

/** @param {string} rootDir @param {{gitRunner?: GitFn}} [options] */
export function readPublishedTreeState(rootDir: string, options: { gitRunner?: GitFn } = {}): PublishedTreeState {
  const gitRunner = options.gitRunner || git;
  const resolvedRoot = fsMod.realpathSync(rootDir);
  const commitResult = gitRunner(['-C', resolvedRoot, 'rev-parse', 'HEAD']);
  const treeResult = gitRunner(['-C', resolvedRoot, 'rev-parse', 'HEAD^{tree}']);

  const commit = commitResult.stdout ? commitResult.stdout.trim() : '';
  const tree = treeResult.stdout ? treeResult.stdout.trim() : '';
  if (commitResult.status !== 0 || treeResult.status !== 0 || !commit || !tree) {
    return {
      ok: false,
      error: `could not resolve current published tree for ${resolvedRoot}`
    };
  }

  return { ok: true, rootDir: resolvedRoot, commit, tree };
}

/** Cap of captured verifier characters carried on a structured gate failure. */
const BOUNDED_VERIFIER_OUTPUT = 8000;

/** Resolve the exact command that executes for this area, never its template. */
function resolveVerificationCommand(rootDir: string, area?: string): string | null {
  const { command, defaultArea } = resolveVerificationAdapter(rootDir);
  return command?.replaceAll('{{area}}', area || defaultArea) || null;
}

/** @param {string} [area] @param {string} [rootDir] @param {{gitRunner?: GitFn, runFn?: Function, stdio?: string, maxBuffer?: number}} [options] */
export function captureVerifiedTreeProof(area: string | undefined, rootDir: string = process.cwd(), options: { gitRunner?: GitFn; runFn?: Function; stdio?: string; maxBuffer?: number; proofPath?: string } = {}): { ok: boolean; proof?: VerificationProof; error?: string; exitCode?: number | null; command?: string | null; cwd?: string; stdout?: string; stderr?: string } {
  const {
    gitRunner = git,
    runFn = run,
    // Pipe the gate so a failing verification can capture its stdout/stderr into
    // the structured gate failure below. Inherit would discard the diagnostic
    // (the task-2373.01 loss), so publication captures rather than streams.
    stdio = 'pipe',
    maxBuffer,
    proofPath,
  } = options;

  const before = readPublishedTreeState(rootDir, { gitRunner });
  if (!before.ok) {return before;}

  const command = resolveVerificationCommand(before.rootDir, area);
  const reusable = command
    ? readReusableVerificationProof(command, before.rootDir, { gitRunner, proofPath })
    : { ok: false };
  if (reusable.ok) {
    return {
      ok: true,
      proof: {
        rootDir: before.rootDir,
        branch: gitRunner(['-C', before.rootDir, 'branch', '--show-current']).stdout.trim(),
        area: area || resolveVerificationAdapter(before.rootDir).defaultArea,
        command,
        commit: before.commit,
        tree: before.tree,
        verifiedAt: reusable.proof!.verifiedAt,
      },
    };
  }

  const verification = runVerificationGate(area, {
    rootDir: before.rootDir,
    runFn,
    stdio,
    maxBuffer,
  });
  if (verification.status !== 0) {
    // Preserve the structured root failure end-to-end: the exact exit status
    // plus bounded captured stdout/stderr, so an outer Forgejo/publish wrapper
    // cannot collapse a gate failure to an exit-code-only string and strand the
    // next agent (task-2373.01). The wrapper string is presentation only; the
    // structured fields below are what classification and repair prompting read.
    const stdout = String(verification.stdout ?? '').trim().slice(-BOUNDED_VERIFIER_OUTPUT);
    const stderr = String(verification.stderr ?? '').trim().slice(-BOUNDED_VERIFIER_OUTPUT);
    const detail = `${stdout}\n${stderr}`.slice(-BOUNDED_VERIFIER_OUTPUT);
    return {
      ok: false,
      exitCode: verification.status,
      command,
      cwd: before.rootDir,
      stdout,
      stderr,
      error: `verification gate failed for ${before.rootDir} with exit code ${verification.status}${detail ? `:\n${detail}` : ''}`
    };
  }

  const after = readPublishedTreeState(before.rootDir!, { gitRunner });
  if (!after.ok) {return after;}
  if (after.commit !== before.commit || after.tree !== before.tree) {
    return {
      ok: false,
      error: `verification proof became stale while publishing ${before.rootDir}`
    };
  }

  const { defaultArea } = resolveVerificationAdapter(before.rootDir!);
  const effectiveArea = area || defaultArea;

  return {
    ok: true,
    proof: {
      rootDir: before.rootDir!,
      branch: gitRunner(['-C', before.rootDir!, 'branch', '--show-current']).stdout.trim(),
      area: effectiveArea,
      command: command || null,
      commit: after.commit,
      tree: after.tree,
      verifiedAt: new Date().toISOString()
    }
  };
}

/** @param {{rootDir?: string, commit?: string, tree?: string}} proof @param {string} [rootDir] @param {{gitRunner?: GitFn}} [opts] */
export function assertVerifiedTreeProof(proof: { rootDir?: string; branch?: string; commit?: string; tree?: string }, rootDir: string = process.cwd(), opts: { gitRunner?: GitFn } = {}): { ok: boolean; proof?: PublishedTreeState; error?: string } {
  if (!proof || typeof proof !== 'object') {
    return { ok: false, error: 'missing verification proof' };
  }

  const o = opts;
  const gitRunner = o.gitRunner || git;
  const current = readPublishedTreeState(rootDir, { gitRunner });
  if (!current.ok) {return current;}

  if (proof.rootDir !== current.rootDir) {
    return { ok: false, error: `verification proof was captured from a different checkout: ${proof.rootDir}` };
  }
  if (proof.commit !== current.commit || proof.tree !== current.tree) {
    return { ok: false, error: 'verification proof does not match the tree being published' };
  }

  return { ok: true, proof: current };
}

/** @param {string[]} args @param {{log?: Function}} [options] */
export default function runWorkflow(args: string[], options: { log?: Function } = {}): import('child_process').SpawnSyncReturns<string> {
  const opts = options;
  const logFn = opts.log || log.plain;
  const area = args[0] || process.env.VERIFY_AREA || DEFAULT_AREA;
  logFn(`Running verification gate for area: ${area}...`);
  return runVerificationGate(area, { stdio: 'inherit' });
}
