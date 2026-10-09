import type { ParallixConfiguration } from "../../application/ports/configuration.js";
// Repository-configured lifecycle gates.
//
// Generic, language-neutral gate execution for the pre-handoff, pre-review,
// and pre-integration phases. Gates are declared per repository in
// `workflow.config.json` under `adapters.gates`; they are disabled by default,
// so a repository that does not declare them runs no lifecycle gate.
//
// This module intentionally knows nothing about Node, npm, tsx,
// `scripts/verify-local.sh`, or any Parallix directory layout. It runs the
// configured shell commands from the supplied checkout with a fixed environment
// contract. The selection policy ("which gates run") is owned by the
// repository configuration, never inferred from the repository layout.
import path from 'node:path';
import { spawn } from 'node:child_process';
import { GateDashboard, retainGateOutput } from './gate-dashboard.js';
import * as fmt from '../../application/presentation/cli-format.js';
import { loadEffectiveConfig, loadWorkflowConfig } from './product-config.js';

/** Ordered lifecycle phases that may carry configured gates. */
export const GATE_PHASES = ['handoff', 'review', 'integration'] as const;
export type GatePhase = (typeof GATE_PHASES)[number];

/** Environment keys shared by every configured gate command. */
export const GATE_ENV = {
  SLUG: 'PARALLIX_MISSION_SLUG',
  CHECKOUT: 'PARALLIX_CHECKOUT_PATH',
  PHASE: 'PARALLIX_PHASE',
} as const;

/** A single ordered gate command for one phase. */
export interface RepositoryGate {
  key: string;
  command: string;
  order: number;
  after?: string[];
  reuse?: 'never' | 'clean-tree';
}

/** The complete declared gate surface for a repository. */
export interface RepositoryGates {
  preHandoff: RepositoryGate[];
  preReview: RepositoryGate[];
  preIntegration: RepositoryGate[];
}

const EMPTY_GATES: RepositoryGates = {
  preHandoff: [],
  preReview: [],
  preIntegration: [],
};

/**
 * Read the declared gates for a single phase from the effective workflow
 * configuration. Omitted configuration yields an empty list, so an
 * unconfigured repository runs no gate for that phase.
 */
/** @param {'preHandoff'|'preReview'|'preIntegration'} phase */
export function loadPhaseGates(rootDir: string, phase: 'preHandoff' | 'preReview' | 'preIntegration'): RepositoryGate[] {
  const declared = loadWorkflowConfig(rootDir || process.cwd());
  const gateIssues = validateRepositoryGates((declared.config as any)?.adapters);
  if (gateIssues.length > 0) { throw new Error(gateIssues.join('; ')); }
  const config = loadEffectiveConfig(rootDir || process.cwd());
  const gates = (config.adapters as any)?.gates;
  if (!gates || typeof gates !== 'object' || !Array.isArray(gates[phase])) {
    return [];
  }
  return normalizeGates(gates[phase]);
}

/**
 * Whether the repository opts into the TASK-2300 mandatory-gate invariant at
 * the integration boundary. Defaults to false so an unconfigured repository
 * completes the integration path with no lifecycle gate (mission task-2457
 * success criterion 1). A repository that wants fail-closed sets
 * `adapters.gates.requirePreIntegration: true` in its workflow.config.json.
 */
export function loadRequirePreIntegration(rootDir: string): boolean {
  const config = loadEffectiveConfig(rootDir || process.cwd());
  const gates = (config.adapters as any)?.gates;
  return typeof gates === 'object' && gates !== null && gates.requirePreIntegration === true;
}

/** Load all three phase gate lists at once. */
export function loadRepositoryGates(rootDir: string): RepositoryGates {
  const config = loadEffectiveConfig(rootDir || process.cwd());
  const gates = (config.adapters as any)?.gates;
  if (!gates || typeof gates !== 'object') {
    return { ...EMPTY_GATES };
  }
  return {
    preHandoff: Array.isArray(gates.preHandoff) ? normalizeGates(gates.preHandoff) : [],
    preReview: Array.isArray(gates.preReview) ? normalizeGates(gates.preReview) : [],
    preIntegration: Array.isArray(gates.preIntegration) ? normalizeGates(gates.preIntegration) : [],
  };
}

/** @param {unknown} raw */
function normalizeGates(raw: unknown): RepositoryGate[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  /** @type {RepositoryGate[]} */
  const gates = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const key = (entry as any).key;
    const command = (entry as any).command;
    if (typeof key !== 'string' || !key) {
      continue;
    }
    if (typeof command !== 'string' || !command.trim()) {
      continue;
    }
    const order = typeof (entry as any).order === 'number' ? (entry as any).order : 0;
    const after = Array.isArray((entry as any).after) && (entry as any).after.every((dependency: unknown) => typeof dependency === 'string' && dependency)
      ? (entry as any).after
      : undefined;
    const reuse: RepositoryGate['reuse'] = (entry as any).reuse === 'clean-tree' ? 'clean-tree' : 'never';
    gates.push({ key, command, order, ...(after ? { after } : {}), reuse });
  }
  return gates.sort((a, b) => a.order - b.order);
}

/**
 * Structural validation for the `adapters.gates` object. Returns a list of
 * human-readable issues; an empty list means the shape is acceptable.
 * @param {unknown} adapters
 */
export function validateRepositoryGates(adapters: unknown): string[] {
  const issues: string[] = [];
  if (!adapters || typeof adapters !== 'object') {
    return issues;
  }
  const gates = (adapters as any).gates;
  if (gates === undefined) {
    return issues;
  }
  if (typeof gates !== 'object' || Array.isArray(gates)) {
    return ['adapters.gates must be an object'];
  }
  // adapters.gates declares additionalProperties:false in the workflow schema;
  // reject any key it does not recognise so a typo (e.g. requireIntegration)
  // fails validation instead of silently disappearing.
  const KNOWN_GATE_KEYS = new Set(['requirePreIntegration', 'parallel', 'preHandoff', 'preReview', 'preIntegration']);
  for (const key of Object.keys(gates)) {
    if (!KNOWN_GATE_KEYS.has(key)) {
      issues.push(`adapters.gates.${key} is not a recognised key (allowed: ${[...KNOWN_GATE_KEYS].join(', ')})`);
    }
  }
  if (gates.requirePreIntegration !== undefined && typeof gates.requirePreIntegration !== 'boolean') {
    issues.push('adapters.gates.requirePreIntegration must be a boolean');
  }
  if (gates.parallel !== undefined) {
    if (!gates.parallel || typeof gates.parallel !== 'object' || Array.isArray(gates.parallel)) {
      issues.push('adapters.gates.parallel must be an object');
    } else {
      for (const [phase, limit] of Object.entries(gates.parallel)) {
        if (!['preHandoff', 'preReview', 'preIntegration'].includes(phase)) {
          issues.push(`adapters.gates.parallel.${phase} is not a recognised phase`);
        } else if (!Number.isInteger(limit) || (limit as number) < 2) {
          issues.push(`adapters.gates.parallel.${phase} must be an integer of at least 2`);
        }
      }
    }
  }
  const PHASE_LABELS = {
    preHandoff: 'pre-handoff',
    preReview: 'pre-review',
    preIntegration: 'pre-integration',
  } as const;
  for (const [phase, expected] of Object.entries(PHASE_LABELS)) {
    const value = gates[phase];
    if (value === undefined) {
      continue;
    }
    if (!Array.isArray(value)) {
      issues.push(`adapters.gates.${phase} must be an array (${expected} gates)`);
      continue;
    }
    value.forEach((entry, index) => {
      if (!entry || typeof entry !== 'object') {
        issues.push(`adapters.gates.${phase}[${index}] must be an object`);
        return;
      }
      if (typeof entry.key !== 'string' || !entry.key) {
        issues.push(`adapters.gates.${phase}[${index}].key must be a non-empty string`);
      }
      if (typeof entry.command !== 'string' || !entry.command.trim()) {
        issues.push(`adapters.gates.${phase}[${index}].command must be a non-empty string`);
      }
      if (entry.order !== undefined && typeof entry.order !== 'number') {
        issues.push(`adapters.gates.${phase}[${index}].order must be a number`);
      }
      if (entry.after !== undefined && (!Array.isArray(entry.after) || entry.after.some((dependency: unknown) => typeof dependency !== 'string' || !dependency))) {
        issues.push(`adapters.gates.${phase}[${index}].after must be an array of non-empty gate keys`);
      }
      if (entry.reuse !== undefined && entry.reuse !== 'never' && entry.reuse !== 'clean-tree') {
        issues.push(`adapters.gates.${phase}[${index}].reuse must be "never" or "clean-tree"`);
      }
    });
    const seen = new Set<string>();
    for (const entry of [...value].sort((a, b) => (a?.order ?? 0) - (b?.order ?? 0))) {
      if (typeof entry?.key !== 'string') { continue; }
      if (seen.has(entry.key)) { issues.push(`adapters.gates.${phase} has duplicate gate key "${entry.key}"`); }
      if (Array.isArray(entry.after)) {
        for (const dependency of entry.after) {
          if (typeof dependency === 'string' && !seen.has(dependency)) {
            issues.push(`adapters.gates.${phase} gate "${entry.key}" must depend on an earlier gate, not "${dependency}"`);
          }
        }
      }
      seen.add(entry.key);
    }
  }
  return issues;
}

/** Result of running a configured gate. */
export interface GateRunOutcome {
  key: string;
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs?: number;
}

/** Result of running a phase's gates. */
export interface PhaseGateRunResult {
  /** True when every configured gate passed (or no gates were configured). */
  ok: boolean;
  phase: GatePhase;
  /** Gates that were configured for this phase. */
  gates: RepositoryGate[];
  /** Number of gates actually executed. */
  executed: number;
  /** True when no gates were configured (nothing ran). */
  skipped: boolean;
  /** True when the run was a plan-only dry run that executed nothing. */
  dryRun: boolean;
  /** Operator cancelled the active gate process groups. */
  cancelled?: boolean;
  /** The first failing gate, if any. */
  failedGate: GateRunOutcome | null;
  /** Complete captured output for every gate that ran. */
  outcomes?: GateRunOutcome[];
  error: string | null;
}

/** Injectable command runner. Mirrors `spawnSync` return shape. */
export type GateCommandRunner = (
  _command: string,
  _args: string[],
  _options: { cwd: string, env: NodeJS.ProcessEnv, stdio: string, signal?: globalThis.AbortSignal, onOutput?: (_chunk: string, _stream: 'stdout' | 'stderr') => void, forwardOutput?: boolean },
) => { status: number | null, stdout: string, stderr: string } | Promise<{ status: number | null, stdout: string, stderr: string }>;

/** Read a phase's opt-in concurrency limit; serial is the default. */
export function loadPhaseGateParallelism(rootDir: string, phase: 'preHandoff' | 'preReview' | 'preIntegration'): number {
  const parallel = (loadEffectiveConfig(rootDir || process.cwd()).adapters as any)?.gates?.parallel?.[phase];
  return Number.isInteger(parallel) && parallel >= 2 ? parallel : 1;
}

/**
 * Build the fixed environment every configured gate receives. The three
 * contract values are the mission slug, the resolved checkout path, and the
 * exact phase identifier. The invoking process environment is inherited so the
 * command can find its own toolchain.
 *
 * `BASH_ENV` is scrubbed: the runner invokes `bash -c`, which honours it for
 * non-interactive shells, so an inherited startup hook could otherwise alter
 * `PATH` or the gate result. The removed node driver in `scripts/verify-local.sh`
 * did the same delete (TASK-2300 hardening).
 *
 * Inherited `PARALLIX_REAL_AGENT` / `PARALLIX_REAL_AGENT_MODEL` are deleted
 * first, then set only when both a real agent and its model are supplied. The
 * removed driver did the same scrub-and-set (F10): leaving an inherited value
 * unscrubbed would make the `agent-smoke` gate run against an ambient
 * `PARALLIX_REAL_AGENT=codex` from an earlier session.
 */
/** @param {GatePhase} phase @param {string} slug @param {string} checkoutPath */
export function buildGateEnv(phase: GatePhase, slug: string, checkoutPath: string, inheritEnv: NodeJS.ProcessEnv = { ...process.env }, extraEnv: { realAgent?: string | null, realAgentModel?: string | null } = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...inheritEnv,
    [GATE_ENV.SLUG]: slug,
    [GATE_ENV.CHECKOUT]: path.resolve(checkoutPath),
    [GATE_ENV.PHASE]: phase,
  };
  delete env['BASH_ENV'];
  delete env['PARALLIX_REAL_AGENT'];
  delete env['PARALLIX_REAL_AGENT_MODEL'];
  if (extraEnv.realAgent && extraEnv.realAgentModel) {
    env['PARALLIX_REAL_AGENT'] = extraEnv.realAgent;
    env['PARALLIX_REAL_AGENT_MODEL'] = extraEnv.realAgentModel;
  }
  return env;
}

/**
 * Run a phase's configured gates from the supplied checkout. Gates execute in
 * declared order; the first non-zero exit aborts and is reported. An empty
 * gate list (unconfigured phase) is a successful no-op and never invokes the
 * command runner.
 */
/**
 * @param {GatePhase} phase
 * @param {{slug: string, checkoutPath: string, gates?: RepositoryGate[], commandRunner?: GateCommandRunner, log?: Function, error?: Function}} opts
 */
export async function runPhaseGates(
  phase: GatePhase,
  opts: {
    configuration?: ParallixConfiguration;
    slug: string;
    checkoutPath: string;
    gates?: RepositoryGate[];
    commandRunner?: GateCommandRunner;
    log?: Function;
    error?: Function;
    /** Plan-only: resolve and print the gate list without executing it. */
    dryRun?: boolean;
    /** Optional self-development integration agent selection (F4 / TASK-2269). */
    realAgent?: string | null;
    realAgentModel?: string | null;
    /** Override the configured parallelism (mainly for focused tests). */
    maxParallel?: number;
  },
): Promise<PhaseGateRunResult> {
  const { slug, checkoutPath } = opts;
  const gates = opts.gates ?? loadPhaseGates(checkoutPath, toConfigPhase(phase));
  const log = opts.log || fmt.log.plain;
  const error = opts.error || fmt.log.plainError;
  const dryRun = opts.dryRun === true;

  const skipped = skippedPhaseGateResult(phase, gates, dryRun, log);
  if (skipped) { return skipped; }

  // Execute through `bash -c`, the same shell mechanism the handoff declared
  // gate runner and the integration gate use, so configured commands may be
  // arbitrary shell (pipelines, redirects, `./scripts/...`), not just bare
  // executables. No new runner or shell language is introduced. The default
  // runner captures each gate's streams so concurrent output can later be
  // rendered as distinct sections instead of interleaving byte-by-byte.
  const runner = opts.commandRunner || runGateCommand;
  const env = buildGateEnv(phase, slug, checkoutPath, opts.configuration?.forwardedEnvironment ?? { ...process.env }, { realAgent: opts.realAgent, realAgentModel: opts.realAgentModel });
  const maxParallel = opts.maxParallel ?? loadPhaseGateParallelism(checkoutPath, toConfigPhase(phase));
  const phaseStarted = Date.now();
  const controller = new globalThis.AbortController();
  let operatorCancelled = false;
  const cancelByOperator = () => { operatorCancelled = true; controller.abort(); };
  const dashboard = (!opts.log || opts.log === fmt.log.plain) && (!opts.error || opts.error === fmt.log.fail)
    && process.stdin.isTTY && process.stdout.isTTY && !process.stdin.isRaw
    ? new GateDashboard(phase, gates.map(gate => gate.key), cancelByOperator) : null;
  const liveSerial = maxParallel === 1 && !dashboard && !opts.commandRunner && (!opts.log || opts.log === fmt.log.plain);

  let failedGate: GateRunOutcome | null = null;
  let errorText: string | null = null;
  let executed = 0;
  const outcomes: GateRunOutcome[] = [];

  const pending = [...gates];
  const completed = new Set<string>();
  const running = new Set<Promise<GateRunOutcome>>();
  while (pending.length > 0 || running.size > 0) {
    while (failedGate === null && !controller.signal.aborted && running.size < maxParallel) {
      const index = pending.findIndex(gate => (gate.after || []).every(dependency => completed.has(dependency)));
      if (index < 0) { break; }
      const gate = pending.splice(index, 1)[0];
      if (dashboard) { dashboard.startGate(gate.key); }
      else { log(`Repository gate (${phase}): ${gate.key} started (${running.size + 1}/${maxParallel} active).`); }
      const started = Date.now();
      // Delay proof loading until a clean-tree gate actually runs. This keeps
      // bootstrap-only gate planning independent of Git verification modules.
      const verification = gate.reuse === 'clean-tree'
        ? await import('../verification/' + 'verification.js') : null;
      const proofContext = JSON.stringify({ phase, slug, checkoutPath: path.resolve(checkoutPath), gate: gate.key });
      const reusable = gate.reuse === 'clean-tree'
        ? verification!.readReusableVerificationProof(gate.command, checkoutPath, { context: proofContext }) : { ok: false };
      if (reusable.ok) {
        const outcome = Promise.resolve({ key: gate.key, command: gate.command, exitCode: 0, stdout: 'reused exact clean-tree proof', stderr: '', durationMs: 0 });
        running.add(outcome);
        continue;
      }
      const beforeProof = gate.reuse === 'clean-tree'
        ? verification!.createVerificationProofIdentity(gate.command, checkoutPath, { context: proofContext }) : { ok: false };
      const run = Promise.resolve().then(() => runner(gate.command, [], { cwd: path.resolve(checkoutPath), env, stdio: 'pipe', signal: controller.signal,
        forwardOutput: liveSerial,
        onOutput: chunk => dashboard?.append(gate.key, chunk) }))
        .then(result => {
          const exitCode = typeof result.status === 'number' ? result.status : null;
          if (exitCode === 0 && gate.reuse === 'clean-tree') {
            const persisted = beforeProof.ok
              ? verification!.writeReusableVerificationProof(gate.command, checkoutPath, { context: proofContext, expectedIdentity: beforeProof.identity })
              : beforeProof;
            return { key: gate.key, command: gate.command, exitCode, stdout: String(result.stdout || ''), stderr: persisted.ok ? String(result.stderr || '') : `${String(result.stderr || '')}\nproof unavailable: ${persisted.error}`, durationMs: Date.now() - started };
          }
          return { key: gate.key, command: gate.command, exitCode, stdout: String(result.stdout || ''), stderr: String(result.stderr || ''), durationMs: Date.now() - started };
        })
        .catch(cause => ({ key: gate.key, command: gate.command, exitCode: null, stdout: '', stderr: String(cause), durationMs: Date.now() - started }));
      running.add(run);
    }
    if (running.size === 0 && failedGate === null && !controller.signal.aborted) {
      const gate = pending[0];
      errorText = `Repository gate "${gate.key}" has unresolved dependencies for ${phase}.`;
      failedGate = { key: gate.key, command: gate.command, exitCode: null, stdout: '', stderr: errorText };
      if (!dashboard) { error(errorText); }
      break;
    }
    if (running.size === 0) { break; }
    const { run, outcome } = await Promise.race([...running].map(run => run.then(outcome => ({ run, outcome }))));
    running.delete(run);
    executed++;
    outcomes.push(outcome);
    dashboard?.finishGate(outcome.key, outcome.exitCode, [outcome.stdout, outcome.stderr].filter(Boolean).join('\n'), outcome.durationMs ?? 0, controller.signal.aborted);
    if (!dashboard && !liveSerial && outcome.exitCode !== 0) { renderGateOutput(phase, outcome, log); }
    if (outcome.exitCode !== 0 && failedGate === null) {
      failedGate = outcome;
      errorText = `Repository gate "${outcome.key}" exited with code ${outcome.exitCode ?? 'unknown'} for ${phase}.`;
      if (!dashboard) { log(`Repository gate (${phase}): ${outcome.key} failed.`); error(errorText); }
      controller.abort();
    } else if (outcome.exitCode === 0) {
      completed.add(outcome.key);
      if (!dashboard) { log(`Repository gate (${phase}): ${outcome.key} passed.`); }
    }
  }

  dashboard?.close();
  if (dashboard) {
    log(`Repository gates (${phase}): ${operatorCancelled ? 'cancelled' : failedGate ? 'failed' : 'passed'}; ${executed}/${gates.length} completed in ${((Date.now() - phaseStarted) / 1000).toFixed(1)}s.`);
    for (const gate of gates) {
      const outcome = outcomes.find(item => item.key === gate.key);
      log(`  ${outcome ? controller.signal.aborted && outcome !== failedGate && outcome.exitCode !== 0 ? '×' : outcome.exitCode === 0 ? '✓' : '✗' : '·'} ${gate.key}${outcome ? ` ${((outcome.durationMs ?? 0) / 1000).toFixed(1)}s` : ' not run'}`);
    }
    if (failedGate && !operatorCancelled) { renderGateOutput(phase, failedGate, error); }
  }
  if (operatorCancelled) { errorText = `Repository gates (${phase}) cancelled.`; }
  return {
    ok: failedGate === null && !controller.signal.aborted,
    phase,
    gates,
    executed,
    skipped: false,
    dryRun: false,
    cancelled: operatorCancelled,
    failedGate,
    outcomes,
    error: errorText,
  };
}

function renderGateOutput(phase: GatePhase, outcome: GateRunOutcome, log: Function): void {
  log(`\n--- Repository gate (${phase}): ${outcome.key} output (exit ${outcome.exitCode ?? 'unknown'}) ---`);
  log(`Command: ${outcome.command}`);
  if (outcome.stdout) { log(outcome.stdout.trimEnd()); }
  if (outcome.stderr) { log(outcome.stderr.trimEnd()); }
  log(`--- End repository gate (${phase}): ${outcome.key} ---`);
}

export function runGateCommand(command: string, _args: string[], options: { cwd: string, env: NodeJS.ProcessEnv, stdio: string, signal?: globalThis.AbortSignal, onOutput?: (_chunk: string, _stream: 'stdout' | 'stderr') => void, forwardOutput?: boolean, terminationGraceMs?: number }): Promise<{ status: number | null, stdout: string, stderr: string }> {
  return new Promise(resolve => {
    const child = spawn('bash', ['-c', command], { cwd: options.cwd, env: options.env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let watchdog: NodeJS.Timeout | undefined;
    const signalGroup = (signal: NodeJS.Signals) => {
      try {
        if (process.platform === 'win32') { child.kill(signal); }
        else if (child.pid) { process.kill(-child.pid, signal); }
      } catch { /* The child already exited. */ }
    };
    const finish = (status: number | null) => {
      if (settled) { return; }
      settled = true;
      if (watchdog) { clearTimeout(watchdog); }
      options.signal?.removeEventListener('abort', stop);
      resolve({ status, stdout, stderr });
    };
    const stop = () => {
      if (settled || watchdog) { return; }
      signalGroup('SIGTERM');
      watchdog = setTimeout(() => {
        signalGroup('SIGKILL');
        child.stdout?.destroy();
        child.stderr?.destroy();
        stderr = retainGateOutput(stderr, '\nGate cancelled after termination grace period.');
        finish(null);
      }, options.terminationGraceMs ?? 5000);
    };
    options.signal?.addEventListener('abort', stop, { once: true });
    if (options.signal?.aborted) { stop(); }
    child.stdout?.on('data', chunk => {
      stdout = retainGateOutput(stdout, String(chunk));
      options.onOutput?.(String(chunk), 'stdout');
      if (options.forwardOutput && !process.stdout.write(chunk)) { child.stdout?.pause(); process.stdout.once('drain', () => child.stdout?.resume()); }
    });
    child.stderr?.on('data', chunk => {
      stderr = retainGateOutput(stderr, String(chunk));
      options.onOutput?.(String(chunk), 'stderr');
      if (options.forwardOutput && !process.stderr.write(chunk)) { child.stderr?.pause(); process.stderr.once('drain', () => child.stderr?.resume()); }
    });
    child.once('error', cause => { stderr = retainGateOutput(stderr, String(cause)); finish(null); });
    child.once('close', finish);
  });
}

function skippedPhaseGateResult(phase: GatePhase, gates: RepositoryGate[], dryRun: boolean, log: Function): PhaseGateRunResult | null {
  if (dryRun) {
    log(gates.length === 0 ? `Repository gates (${phase}): none configured — dry run, nothing to plan.` : `Repository gates (${phase}): dry run — resolved plan (nothing executes):`);
    for (const gate of gates) { log(`  [${gate.order}] ${gate.key}: ${gate.command}`); }
    return { ok: true, phase, gates, executed: 0, skipped: true, dryRun: true, failedGate: null, error: null };
  }
  if (gates.length === 0) {
    log(`Repository gates (${phase}): none configured — skipping.`);
    return { ok: true, phase, gates: [], executed: 0, skipped: true, dryRun: false, failedGate: null, error: null };
  }
  return null;
}

/** @param {GatePhase} phase */
function toConfigPhase(phase: GatePhase): 'preHandoff' | 'preReview' | 'preIntegration' {
  return `pre${phase.charAt(0).toUpperCase() + phase.slice(1)}` as any;
}
