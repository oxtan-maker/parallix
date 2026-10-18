import { normalizeGates, validateRepositoryGates, type RepositoryGate, type RepositoryGates } from './repository-gate-schema.js';
export { validateRepositoryGates, type RepositoryGate, type RepositoryGates } from './repository-gate-schema.js';
import { verificationEnvironment } from './verification-environment.js';
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
import { runGateCommand } from './gate-command-runner.js';
export { runGateCommand } from './gate-command-runner.js';
import type { IntegrationVerificationEvidencePort, ReusableVerificationProofPort } from '../../application/ports/integration-verification-evidence.js';
import { GateDashboard } from './gate-dashboard.js';
import * as fmt from '../../application/presentation/cli-format.js';
import { loadEffectiveConfig, loadWorkflowConfig } from './product-config.js';

/** Ordered lifecycle phases that may carry configured gates. */
export const GATE_PHASES = ['handoff', 'review', 'integration'] as const;
export type GatePhase = (typeof GATE_PHASES)[number];
export type GateLog = (message: string) => void;
type ConfigPhase = 'preHandoff' | 'preReview' | 'preIntegration';
interface GateConfiguration {
  preHandoff?: unknown; preReview?: unknown; preIntegration?: unknown;
  requirePreIntegration?: unknown; parallel?: Partial<Record<ConfigPhase, number>>;
}

/** Environment keys shared by every configured gate command. */
export const GATE_ENV = {
  SLUG: 'PARALLIX_MISSION_SLUG',
  CHECKOUT: 'PARALLIX_CHECKOUT_PATH',
  PHASE: 'PARALLIX_PHASE',
} as const;

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
  const gateIssues = validateRepositoryGates((declared.config as { adapters?: unknown } | null)?.adapters);
  if (gateIssues.length > 0) { throw new Error(gateIssues.join('; ')); }
  const config = loadEffectiveConfig(rootDir || process.cwd());
  const gates = (config.adapters as { gates?: GateConfiguration } | undefined)?.gates;
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
  const gates = (config.adapters as { gates?: GateConfiguration } | undefined)?.gates;
  return typeof gates === 'object' && gates !== null && gates.requirePreIntegration === true;
}

/** Load all three phase gate lists at once. */
export function loadRepositoryGates(rootDir: string): RepositoryGates {
  const config = loadEffectiveConfig(rootDir || process.cwd());
  const gates = (config.adapters as { gates?: GateConfiguration } | undefined)?.gates;
  if (!gates || typeof gates !== 'object') {
    return { ...EMPTY_GATES };
  }
  return {
    preHandoff: Array.isArray(gates.preHandoff) ? normalizeGates(gates.preHandoff) : [],
    preReview: Array.isArray(gates.preReview) ? normalizeGates(gates.preReview) : [],
    preIntegration: Array.isArray(gates.preIntegration) ? normalizeGates(gates.preIntegration) : [],
  };
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
  const parallel = (loadEffectiveConfig(rootDir || process.cwd()).adapters as { gates?: GateConfiguration } | undefined)?.gates?.parallel?.[phase];
  return Number.isInteger(parallel) && (parallel as number) >= 2 ? parallel as number : 1;
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
function inheritedGateEnvironment(): NodeJS.ProcessEnv { return { ...process.env }; }

/** @param {GatePhase} phase @param {string} slug @param {string} checkoutPath */
export function buildGateEnv(phase: GatePhase, slug: string, checkoutPath: string, inheritEnv: NodeJS.ProcessEnv = inheritedGateEnvironment(), extraEnv: { realAgent?: string | null, realAgentModel?: string | null } = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...verificationEnvironment(inheritEnv),
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
export interface PhaseGateOptions {
  configuration?: ParallixConfiguration;
  verificationEvidence?: IntegrationVerificationEvidencePort;
  slug: string;
  checkoutPath: string;
  gates?: RepositoryGate[];
  commandRunner?: GateCommandRunner;
  log?: GateLog;
  error?: GateLog;
  /** Plan-only: resolve and print the gate list without executing it. */
  dryRun?: boolean;
  /** Optional self-development integration agent selection (F4 / TASK-2269). */
  realAgent?: string | null;
  realAgentModel?: string | null;
  /** Override the configured parallelism (mainly for focused tests). */
  maxParallel?: number;
}

export async function runPhaseGates(phase: GatePhase, opts: PhaseGateOptions): Promise<PhaseGateRunResult> {
  const { checkoutPath } = opts;
  const gates = opts.gates ?? loadPhaseGates(checkoutPath, toConfigPhase(phase));
  const log = opts.log || fmt.log.plain;
  const error = opts.error || fmt.log.plainError;
  const dryRun = opts.dryRun === true;

  const skipped = skippedPhaseGateResult(phase, gates, dryRun, log);
  if (skipped) { return skipped; }

  return new PhaseGateExecution(phase, opts, gates, log, error).execute();
}

function phaseDashboard(phase: GatePhase, opts: PhaseGateOptions, gates: RepositoryGate[], cancelByOperator: () => void): GateDashboard | null {
  const dashboard = (!opts.log || opts.log === fmt.log.plain) && (!opts.error || opts.error === fmt.log.fail)
    && process.stdin.isTTY && process.stdout.isTTY && !process.stdin.isRaw
    ? new GateDashboard(phase, gates.map(gate => gate.key), cancelByOperator) : null;

  return dashboard;
}

function phaseExecutionState(phase: GatePhase, opts: PhaseGateOptions, gates: RepositoryGate[], log: GateLog, error: GateLog) {

  const { slug, checkoutPath } = opts;

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

  const cancellation = { operatorCancelled: false };

  const cancelByOperator = () => { cancellation.operatorCancelled = true; controller.abort(); };

  const dashboard = phaseDashboard(phase, opts, gates, cancelByOperator);

  const liveSerial = maxParallel === 1 && !dashboard && !opts.commandRunner && (!opts.log || opts.log === fmt.log.plain);

  const failure: { failedGate: GateRunOutcome | null; errorText: string | null } = { failedGate: null, errorText: null };

  let executed = 0;

  const outcomes: GateRunOutcome[] = [];

  const coverage = phase === 'integration' ? opts.verificationEvidence?.start(checkoutPath, gates) : null;

  const pending = [...gates];

  const completed = new Set<string>();

  const running = new Set<Promise<GateRunOutcome>>();
  return { phase, opts, gates, log, error, slug, checkoutPath, runner, env, maxParallel, phaseStarted, controller, cancelByOperator, dashboard, liveSerial, failure, executed, outcomes, coverage, pending, completed, running, cancellation };
}

class PhaseGateExecution {
  private readonly state: ReturnType<typeof phaseExecutionState>;
  constructor(phase: GatePhase, opts: PhaseGateOptions, gates: RepositoryGate[], log: GateLog, error: GateLog) { this.state = phaseExecutionState(phase, opts, gates, log, error); }

  async startPending(): Promise<void> {
    while (this.state.failure.failedGate === null && !this.state.controller.signal.aborted && this.state.running.size < this.state.maxParallel) {
      const index = this.state.pending.findIndex(gate => (gate.after || []).every(dependency => this.state.completed.has(dependency)));
      if (index < 0) { break; }
      const gate = this.state.pending.splice(index, 1)[0];
      if (this.state.dashboard) { this.state.dashboard.startGate(gate.key); }
      else { this.state.log(`Repository gate (${this.state.phase}): ${gate.key} started (${this.state.running.size + 1}/${this.state.maxParallel} active).`); }
      const verification = gate.reuse === 'clean-tree'
        ? await import('../verification/' + 'verification.js') as ReusableVerificationProofPort : null;
      this.state.running.add(this.launchGate(gate, verification));
    }
  }

  launchGate(gate: RepositoryGate, verification: ReusableVerificationProofPort | null): Promise<GateRunOutcome> {
    const started = Date.now();
    // Delay proof loading until a clean-tree gate actually runs. This keeps
    // bootstrap-only gate planning independent of Git verification modules.
    const proofContext = JSON.stringify({ phase: this.state.phase, slug: this.state.slug, checkoutPath: path.resolve(this.state.checkoutPath), gate: gate.key });
    const reusable: { ok: boolean; identity?: string; error?: string } = gate.reuse === 'clean-tree'
      ? verification!.readReusableVerificationProof(gate.command, this.state.checkoutPath, { context: proofContext, configuration: this.state.opts.configuration }) : { ok: false, identity: undefined, error: 'reuse disabled' };
    if (reusable.ok) {
      const outcome = Promise.resolve({ key: gate.key, command: gate.command, exitCode: 0, stdout: 'reused exact clean-tree proof', stderr: '', durationMs: 0 });
      return outcome;
    }
    // Reuse the freshly checked identity snapshot returned even on a cache miss.
    const beforeProof = { ok: Boolean(reusable.identity), identity: reusable.identity, error: reusable.error };
    const run = Promise.resolve().then(() => this.state.runner(gate.command, [], {
      cwd: path.resolve(this.state.checkoutPath), env: this.state.env, stdio: 'pipe', signal: this.state.controller.signal,
      forwardOutput: this.state.liveSerial,
      onOutput: chunk => this.state.dashboard?.append(gate.key, chunk)
    }))
      .then(result => {
        const exitCode = typeof result.status === 'number' ? result.status : null;
        if (exitCode === 0 && gate.reuse === 'clean-tree') {
          const persisted = beforeProof.ok
            ? verification!.writeReusableVerificationProof(gate.command, this.state.checkoutPath, { context: proofContext, configuration: this.state.opts.configuration, expectedIdentity: beforeProof.identity })
            : beforeProof;
          return { key: gate.key, command: gate.command, exitCode, stdout: String(result.stdout || ''), stderr: persisted.ok ? String(result.stderr || '') : `${String(result.stderr || '')}\nproof unavailable: ${persisted.error}`, durationMs: Date.now() - started };
        }
        return { key: gate.key, command: gate.command, exitCode, stdout: String(result.stdout || ''), stderr: String(result.stderr || ''), durationMs: Date.now() - started };
      })
      .catch(cause => ({ key: gate.key, command: gate.command, exitCode: null, stdout: '', stderr: String(cause), durationMs: Date.now() - started }));
    return run;
  }

  settleOutcome(run: Promise<GateRunOutcome>, outcome: GateRunOutcome): void {
    this.state.running.delete(run);
    this.state.executed++;
    this.state.outcomes.push(outcome);
    this.state.dashboard?.finishGate(outcome.key, outcome.exitCode, [outcome.stdout, outcome.stderr].filter(Boolean).join('\n'), outcome.durationMs ?? 0, this.state.controller.signal.aborted);
    if (!this.state.dashboard && !this.state.liveSerial && outcome.exitCode !== 0) { renderGateOutput(this.state.phase, outcome, this.state.log); }
    if (outcome.exitCode !== 0 && this.state.failure.failedGate === null) {
      this.state.failure.failedGate = outcome;
      this.state.failure.errorText = `Repository gate "${outcome.key}" exited with code ${outcome.exitCode ?? 'unknown'} for ${this.state.phase}.`;
      if (!this.state.dashboard) { this.state.log(`Repository gate (${this.state.phase}): ${outcome.key} failed.`); this.state.error(this.state.failure.errorText); }
      this.state.controller.abort();
    } else if (outcome.exitCode === 0) {
      this.state.completed.add(outcome.key);
      if (!this.state.dashboard) { this.state.log(`Repository gate (${this.state.phase}): ${outcome.key} passed.`); }
    }
  }

  reportDashboard(): void {
    if (this.state.dashboard) {
      this.state.log(`Repository gates (${this.state.phase}): ${this.state.cancellation.operatorCancelled ? 'cancelled' : this.state.failure.failedGate ? 'failed' : 'passed'}; ${this.state.executed}/${this.state.gates.length} completed in ${((Date.now() - this.state.phaseStarted) / 1000).toFixed(1)}s.`);
      for (const gate of this.state.gates) {
        const outcome = this.state.outcomes.find(item => item.key === gate.key);
        this.state.log(`  ${outcome ? this.state.controller.signal.aborted && outcome !== this.state.failure.failedGate && outcome.exitCode !== 0 ? '×' : outcome.exitCode === 0 ? '✓' : '✗' : '·'} ${gate.key}${outcome ? ` ${((outcome.durationMs ?? 0) / 1000).toFixed(1)}s` : ' not run'}`);
      }
      if (this.state.failure.failedGate && !this.state.cancellation.operatorCancelled) { renderGateOutput(this.state.phase, this.state.failure.failedGate, this.state.error); }
    }
  }

  async execute(): Promise<PhaseGateRunResult> {
    while (this.state.pending.length > 0 || this.state.running.size > 0) {
      await this.startPending();
      if (this.state.running.size === 0 && this.state.failure.failedGate === null && !this.state.controller.signal.aborted) {
        const gate = this.state.pending[0];
        this.state.failure.errorText = `Repository gate "${gate.key}" has unresolved dependencies for ${this.state.phase}.`;
        this.state.failure.failedGate = { key: gate.key, command: gate.command, exitCode: null, stdout: '', stderr: this.state.failure.errorText };
        if (!this.state.dashboard) { this.state.error(this.state.failure.errorText); }
        break;
      }
      if (this.state.running.size === 0) { break; }
      const { run, outcome } = await Promise.race([...this.state.running].map(run => run.then(outcome => ({ run, outcome }))));
      this.settleOutcome(run, outcome);
    }
    this.state.dashboard?.close();
    this.reportDashboard();
    if (this.state.cancellation.operatorCancelled) { this.state.failure.errorText = `Repository gates (${this.state.phase}) cancelled.`; }
    if (this.state.coverage) {
      // The executor reports how the phase settled, so a failed or cancelled run
      // is observable evidence too instead of an absent result.
      this.state.coverage.complete(this.state.outcomes,
        this.state.cancellation.operatorCancelled ? 'cancelled'
          : this.state.failure.failedGate !== null ? 'failed'
            : this.state.controller.signal.aborted ? 'cancelled' : 'passed');
    }
    return {
      ok: this.state.failure.failedGate === null && !this.state.controller.signal.aborted,
      phase: this.state.phase,
      gates: this.state.gates,
      executed: this.state.executed,
      skipped: false,
      dryRun: false,
      cancelled: this.state.cancellation.operatorCancelled,
      failedGate: this.state.failure.failedGate,
      outcomes: this.state.outcomes,
      error: this.state.failure.errorText,
    };

  }
}

function renderGateOutput(phase: GatePhase, outcome: GateRunOutcome, log: GateLog): void {
  log(`\n--- Repository gate (${phase}): ${outcome.key} output (exit ${outcome.exitCode ?? 'unknown'}) ---`);
  log(`Command: ${outcome.command}`);
  if (outcome.stdout) { log(outcome.stdout.trimEnd()); }
  if (outcome.stderr) { log(outcome.stderr.trimEnd()); }
  log(`--- End repository gate (${phase}): ${outcome.key} ---`);
}

function skippedPhaseGateResult(phase: GatePhase, gates: RepositoryGate[], dryRun: boolean, log: GateLog): PhaseGateRunResult | null {
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
  return ({ handoff: 'preHandoff', review: 'preReview', integration: 'preIntegration' } as const)[phase];
}
