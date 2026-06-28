import { git, run } from './git.js';
import type { SpawnSyncOptions } from 'node:child_process';
import { loadAdapterConfig } from './product-config.js';
import { log } from './fmt.js';
import * as fsMod from 'node:fs';

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

export type GitFn = (args: string[], options?: GitOptions) => GitResult;

export interface VerificationAdapterConfig {
  command: string | null;
  defaultArea: string;
}

export interface VerificationProof {
  rootDir: string;
  area: string;
  command: string | null;
  commit: string;
  tree: string;
  verifiedAt: string;
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

/** @param {string} [area] @param {string} [rootDir] */
export function formatVerificationCommand(area: string | undefined, rootDir: string = process.cwd()): string {
  const { command, defaultArea } = resolveVerificationAdapter(rootDir);
  const effectiveArea = area || defaultArea;
  if (!command) {
    return NO_GATE_NOTICE;
  }
  return command.replaceAll('{{area}}', effectiveArea || DEFAULT_AREA);
}

/** @param {string} [area] @param {{rootDir?: string, log?: Function, stdio?: string, runFn?: Function}} [options] */
export function runVerificationGate(area: string | undefined, options: { rootDir?: string; log?: Function; stdio?: string; runFn?: Function } = {}): import('child_process').SpawnSyncReturns<string> {
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
  return runFn('bash', ['-lc', command.replaceAll('{{area}}', effectiveArea)], { cwd: rootDir, stdio });
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

/** @param {string} [area] @param {string} [rootDir] @param {{gitRunner?: GitFn, runFn?: Function, stdio?: string}} [options] */
export function captureVerifiedTreeProof(area: string | undefined, rootDir: string = process.cwd(), options: { gitRunner?: GitFn; runFn?: Function; stdio?: string } = {}): { ok: boolean; proof?: VerificationProof; error?: string } {
  const {
    gitRunner = git,
    runFn = run,
    stdio = 'inherit'
  } = options;

  const before = readPublishedTreeState(rootDir, { gitRunner });
  if (!before.ok) {return before;}

  const verification = runVerificationGate(area, {
    rootDir: before.rootDir,
    runFn,
    stdio
  });
  if (verification.status !== 0) {
    return {
      ok: false,
      error: `verification gate failed for ${before.rootDir} with exit code ${verification.status}`
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

  const { command, defaultArea } = resolveVerificationAdapter(before.rootDir!);
  const effectiveArea = area || defaultArea;

  return {
    ok: true,
    proof: {
      rootDir: before.rootDir!,
      area: effectiveArea,
      command: command || null,
      commit: after.commit,
      tree: after.tree,
      verifiedAt: new Date().toISOString()
    }
  };
}

/** @param {{rootDir?: string, commit?: string, tree?: string}} proof @param {string} [rootDir] @param {{gitRunner?: GitFn}} [opts] */
export function assertVerifiedTreeProof(proof: { rootDir?: string; commit?: string; tree?: string }, rootDir: string = process.cwd(), opts: { gitRunner?: GitFn } = {}): { ok: boolean; proof?: PublishedTreeState; error?: string } {
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
