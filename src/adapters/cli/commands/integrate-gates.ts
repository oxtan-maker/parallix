// Integration gate planning and execution support for `px integrate`.
//
// Owns changed-area detection, integration configuration access, gate
// selection/ordering, gate-plan rendering, gate environment construction,
// final-tree capture, verification-worktree resolution, and gate execution.
// The dependency direction is one-way: `integrate.ts` imports from here.
import fs from 'node:fs';
import child_process from 'node:child_process';
import path from 'node:path';
import { git } from '../../git/git.js';
import * as fmt from '../../../application/presentation/cli-format.js';
import * as verification from '../../verification/verification.js';
import { resolveWorktree, getPrimaryWorktree, getPrimaryBranch, conventionalWorktreePath } from '../../filesystem/mission-utils.js';

const { formatVerificationCommand } = verification;

// Integration gates support
/**
 * Resolve this lazily: command modules are imported by the unit-test harness
 * after some tests switch into temporary repositories that have no primary
 * branch. Integration itself still resolves the config from the primary
 * worktree when it needs to read it.
 */
export function getIntegrationConfigPath(): string {
  return path.join(getPrimaryWorktree(), 'config', 'integration-pipelines.json');
}

/**
 * Detect which top-level areas have been modified in the mission branch vs primary branch
 * Returns an array of area names (e.g., ['server', 'auth-server', 'web-client'])
 */
/** @param {string} slug @param {{gitRunner?: Function, rootDir?: string, baseBranch?: string|null}} opts */
export function detectChangedAreas(slug: string, opts: {gitRunner?: Function, rootDir?: string, baseBranch?: string | null} = {}) {
  const primaryBranch = opts.baseBranch || getPrimaryBranch();
  const branch = `mission/${slug}`;
  const runner = (opts.gitRunner || git) as Function;

  // Get changed files between primary branch and mission branch
  const diffResult = runner(['-C', opts.rootDir || getPrimaryWorktree(), 'diff', '--name-only', primaryBranch, branch, '--']);
  
  if (diffResult.status !== 0 && !diffResult.stdout.trim()) {
    // No changes or error - fall back to checking against HEAD in the worktree
    const worktree = resolveWorktree(slug) || conventionalWorktreePath(slug, opts.rootDir);
    if (fs.existsSync(worktree)) {
      const worktreeDiff = runner(['-C', worktree, 'diff', '--name-only', primaryBranch, 'HEAD', '--']);
      if (worktreeDiff.status === 0 && worktreeDiff.stdout.trim()) {
        return parseFilesToAreas(worktreeDiff.stdout);
      }
    }
    return [];
  }
  
  return parseFilesToAreas(diffResult.stdout);
}

/** @param {string} rootDir @param {Iterable<string>} paths @param {{gitRunner?: Function}} opts */
export function isIntendedPayloadAtHead(rootDir: string, paths: Iterable<string>, opts: {gitRunner?: Function} = {}) {
  const payloadPaths = [...paths];
  if (payloadPaths.length === 0) { return false; }
  const runner = (opts.gitRunner || git) as Function;
  return runner(['-C', rootDir, 'diff', '--quiet', 'HEAD', '--', ...payloadPaths]).status === 0;
}

/**
 * Parse a list of files (one per line) and extract the top-level area directories
 */
/** @param {string} filesOutput */
export function parseFilesToAreas(filesOutput: string) {
  const areas = new Set<string>();
  const knownAreas = ['lib', 'server', 'auth-server', 'web-client', 'docs', 'workflow', 'android', 'kubernetes'];
  const workflowOwnedDirs = new Set(['test', 'scripts', 'config', 'prompts', 'data']);
  const workflowRootFiles = new Set([
    'px.ts',
    'px.js',
    'index.ts',
    'index.js',
    'package.json',
    'package-lock.json',
    'workflow.config.json',
    'tsconfig.json',
    'tsconfig.base.json',
    'eslint.config.js',
    'eslint.config.mjs',
    'eslint.config.cjs'
  ]);
  
  filesOutput.split('\n').forEach((file: string) => {
    file = file.trim();
    if (!file) {return;}
    if (!file.includes('/')) {
      if (workflowRootFiles.has(file)) {
        areas.add('workflow');
      }
      return;
    }
    const topDir = file.split('/')[0];
    if (knownAreas.includes(topDir)) {
      areas.add(topDir);
      return;
    }
    if (workflowOwnedDirs.has(topDir)) {
      areas.add('workflow');
    }
  });
  
  return Array.from(areas);
}

/**
 * @param {{gates?: Record<string, any>}} config
 * @returns {{key: string, command: string, order: number, run_last: boolean, areas?: string[], always?: boolean}[]}
 */
export function orderIntegrationGates(config: {gates?: Record<string, any>}) {
  const gateEntries = Object.entries(config.gates || {});
  /** @type {{key: string, command: string, order: number, run_last: boolean, areas?: string[], always?: boolean}[]} */
  const gates = gateEntries
    .map(([key, value]) => {
      /** @type {{key: string, command: string, order: number, run_last: boolean, areas?: string[], always?: boolean}} */
      let gate = {
        key,
        command: value.command,
        order: value.order || 0,
        run_last: value.run_last || false,
        ...(Array.isArray(value.areas) && value.areas.length > 0 ? { areas: value.areas } : {}),
        ...(value.always === true ? { always: true } : {})
      };
      return gate;
    })
    .filter(gate => {
      const rawGate = config.gates?.[gate.key];
      if (rawGate && rawGate.enabled === false) {
        return false;
      }
      return true;
    });

  const nonRunLast = gates.filter(g => !g.run_last).sort((a, b) => a.order - b.order);
  const runLastGates = gates.filter(g => g.run_last).sort((a, b) => a.order - b.order);
  return /** @type {{key: string, command: string, order: number, run_last: boolean, areas?: string[], always?: boolean}[]} */ ([...nonRunLast, ...runLastGates]);
}

/** @param {string} gateKey @param {string[]} changedAreas @param {string[]|undefined} gateAreas @param {boolean|undefined} always */
export function gateMatchesChangedAreas(gateKey: string, changedAreas: string[], gateAreas?: string[], always?: boolean) {
  if (always) {return true;}
  if (changedAreas.length === 0) {return true;}
  if (Array.isArray(gateAreas) && gateAreas.length > 0) {
    return gateAreas.some(area => changedAreas.includes(area));
  }
  if (changedAreas.includes(gateKey)) {return true;}
  if (gateKey === 'web-e2e') {
    return changedAreas.includes('web-client');
  }
  if (gateKey === 'workflow' || gateKey === 'custom-agent-smoke') {
    return changedAreas.includes('workflow') || changedAreas.includes('lib');
  }
  return false;
}

/**
 * Load integration pipelines config from repo-side file
 */
/** @param {{configPath?: string}} opts */
export function loadIntegrationConfig(opts: {configPath?: string} = {}) {
  const configPath = opts.configPath || getIntegrationConfigPath();
  if (!fs.existsSync(configPath) || !fs.statSync(configPath).size) {
    return { ok: false, error: 'no config present' };
  }
  
  try {
    const content = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(content);
    return { ok: true, config };
  } catch (/** @type{any} */ error: any) {
    return { ok: false, error: `invalid JSON: ${error.message}` };
  }
}

/**
 * Get the integration gate plan for changed areas
 * Returns { gates: [{key, command, run_last}], changedAreas: [...] }
 */
/** @param {string} slug @param {{runIntegrationGates?: boolean, gitRunner?: Function, dryRun?: boolean, configPath?: string}} opts */
export function getIntegrationGatePlan(slug: string, opts: {runIntegrationGates?: boolean, gitRunner?: Function, dryRun?: boolean, configPath?: string} = {}) {
  // Check config
  const configResult = loadIntegrationConfig(opts);
  if (!configResult.ok) {
    if (opts.runIntegrationGates) {
      fmt.log.info(`integration-gates: ${configResult.error}, skipping`);
    }
    return { gates: [], changedAreas: [], configError: configResult.error };
  }
  
  const config = configResult.config;
  if (!config.gates || Object.keys(config.gates).length === 0) {
    if (opts.runIntegrationGates) {
      fmt.log.info('integration-gates: no gates defined in config, skipping');
    }
    return { gates: [], changedAreas: [], configError: 'no gates defined' };
  }
  
  // Detect changed areas (always detect for dry-run; for real run, detect only if runIntegrationGates)
  const changedAreas = (opts.runIntegrationGates || opts.dryRun) ? detectChangedAreas(slug, opts) : [];
  
  // Build list of gates to run, preserving order with run_last handling
  /** @type {{key: string, command: string, order: number, run_last: boolean, areas?: string[], always?: boolean}[]} */
  const orderedGates = orderIntegrationGates(config);
  // Retain legacy dry-run behaviour for configurations without an unconditional
  // gate. Once a config declares one, an empty/no-area diff must run only its
  // unconditional defenses instead of expanding area-scoped E2E gates.
  const alwaysGates = orderedGates.filter(gate => gate.always);
  const relevantGates = changedAreas.length === 0 && alwaysGates.length > 0
    ? alwaysGates
    : orderedGates.filter(gate => gateMatchesChangedAreas(gate.key, changedAreas, gate.areas, gate.always));
  
  return { gates: relevantGates, changedAreas, configError: null };
}

/**
 * Print the integration gate plan (for --dry-run)
 */
/** @param{{key: string, command: string, order: number, run_last: boolean}[]} gates */
export function printIntegrationGatePlan(gates: any) {
  fmt.log.info('Integration gate plan:');
  for (const gate of gates) {
    fmt.log.info(`  ${gate.key}: ${gate.command}`);
  }
}

/**
 * @param {string} slug
 * @param {{dryRun?: boolean, processEnv?: NodeJS.ProcessEnv, gitRunner?: Function, baseBranch?: string|null, baseWorktree?: string|null}} opts
 */
export function buildIntegrationGateEnv(slug: string, opts: {dryRun?: boolean, processEnv?: NodeJS.ProcessEnv, gitRunner?: Function, baseBranch?: string | null, baseWorktree?: string | null, realAgent?: string | null, realAgentModel?: string | null} = {}) {
  /** @type {{[key: string]: string | undefined}} */
  const env = /** @type {{[key: string]: string | undefined}} */ ({
    // Integration gates need the invoking process environment (especially
    // PATH and HOME) to find the selected Node runtime on macOS and Linux.
    // Tests can still pass an isolated environment explicitly.
    ...(opts.processEnv || process.env),
    INTEGRATE_DRY_RUN: opts.dryRun ? 'true' : 'false',
    PARALLIX_EXECUTION_ROOT: opts.baseWorktree ? path.resolve(opts.baseWorktree) : undefined,
    INTEGRATE_CHANGED_AREAS: detectChangedAreas(slug, {
      gitRunner: opts.gitRunner,
      baseBranch: opts.baseBranch,
      ...(opts.baseWorktree ? { rootDir: opts.baseWorktree } : {})
    }).join(' ')
  });

  // Integration must always use the repo-side config, but the changed-area set
  // should be the one resolved for this mission branch, not rediscovered later.
  delete (env as any).INTEGRATION_CONFIG_PATH;
  if (opts.realAgent && opts.realAgentModel) {
    (env as any).PARALLIX_REAL_AGENT = opts.realAgent;
    (env as any).PARALLIX_REAL_AGENT_MODEL = opts.realAgentModel;
  }
  return env;
}

/** Capture the exact clean mission tree that integration gates are allowed to verify. */
export function captureFinalIntegrationTree(rootDir: string, opts: {gitRunner?: Function} = {}) {
  const resolvedRoot = path.resolve(rootDir || '');
  if (!rootDir || !fs.existsSync(resolvedRoot)) {
    return { ok: false, error: `selected execution root does not exist: ${resolvedRoot || rootDir}` };
  }
  const runner = (opts.gitRunner || git) as Function;
  const status = runner(['-C', resolvedRoot, 'status', '--porcelain']);
  if (status.status !== 0) {
    return { ok: false, error: `could not inspect selected execution root: ${status.stderr || status.stdout || resolvedRoot}` };
  }
  if (String(status.stdout || '').trim()) {
    return { ok: false, error: `selected execution root is not finalized (dirty tree): ${resolvedRoot}` };
  }
  const commit = runner(['-C', resolvedRoot, 'rev-parse', 'HEAD']);
  const tree = runner(['-C', resolvedRoot, 'rev-parse', 'HEAD^{tree}']);
  if (commit.status !== 0 || tree.status !== 0) {
    return { ok: false, error: `could not resolve final commit/tree for selected execution root: ${resolvedRoot}` };
  }
  return { ok: true, rootDir: resolvedRoot, commit: String(commit.stdout || '').trim(), tree: String(tree.stdout || '').trim() };
}

/**
 * @param {string} slug
 * @param {{baseWorktree?: string, resolveWorktreeFn?: Function, conventionalWorktreePathFn?: Function}} opts
 */
export function resolveIntegrationVerificationWorktree(slug: string, opts: {baseWorktree?: string, resolveWorktreeFn?: Function, conventionalWorktreePathFn?: Function} = {}) {
  const resolveFn = (opts.resolveWorktreeFn || resolveWorktree) as Function;
  const convFn = (opts.conventionalWorktreePathFn || conventionalWorktreePath) as Function;
  return resolveFn(slug, { cwd: opts.baseWorktree })
    || convFn(slug, opts.baseWorktree);
}

/**
 * @param {string} slug
 * @param {{baseWorktree?: string, resolveWorktreeFn?: Function, conventionalWorktreePathFn?: Function, formatVerificationCommandFn?: Function}} opts
 */
export function buildIntegrationVerificationInvocation(slug: string, opts: {baseWorktree?: string, resolveWorktreeFn?: Function, conventionalWorktreePathFn?: Function, formatVerificationCommandFn?: Function} = {}) {
  const cwd = resolveIntegrationVerificationWorktree(slug, opts);
  const fmtFn = (opts.formatVerificationCommandFn || formatVerificationCommand) as Function;
  return {
    command: fmtFn('integrate', cwd),
    cwd
  };
}

/**
 * Execute integration gates, aborting on first failure
 * Returns { ok: boolean, failedGate: string|null, error: string|null }
 */
/**
 * @param {{key: string, command: string, order: number, run_last: boolean}[]} gates
 * @param {{commandRunner?: Function, rootDir: string}} opts
 */
export async function executeIntegrationGates(gates: any, opts: {commandRunner?: Function, rootDir: string}) {
  if (!opts.rootDir) {
    throw new Error('integration gates require an explicit execution root');
  }
  const runner = (opts.commandRunner || ((/** @type{string} */ cmd: string) => child_process.spawnSync(cmd, {
      shell: true,
      cwd: opts.rootDir,
      stdio: 'inherit'
    }))) as Function;
  
  for (const gate of gates) {
    fmt.log.info(`Running integration gate: ${gate.key}...`);
    fmt.log.info(`  Command: ${gate.command}`);
    
    // Execute the command using the injected runner
    const result = runner(gate.command, [], { cwd: opts.rootDir, stdio: 'inherit' });
    
    if (result.status !== 0) {
      fmt.log.fail(`Integration gate failed: ${gate.key}`);
      fmt.log.fail(`  Command: ${gate.command}`);
      fmt.log.fail(`  Exit code: ${result.status}`);
      return { ok: false, failedGate: gate.key, error: `Command exited with code ${result.status}` };
    }
    
    fmt.log.pass(`Integration gate passed: ${gate.key}`);
  }
  
  return { ok: true, failedGate: null, error: null };
}
