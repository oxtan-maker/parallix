import { failureReasonFromCause } from '../../domain/failure-reason.js';
import { gateFailureReasonFromProcess } from '../../domain/failure-classification.js';
import { randomUUID } from 'node:crypto';
import { verificationObservation, type VerificationMeasurement } from '../../application/ports/verification-observation.js';
import type { RepositoryGate } from './repository-gate-schema.js';
export { validateRepositoryGates, type RepositoryGate, type RepositoryGates } from './repository-gate-schema.js';
import { loadPhaseGateParallelism, loadPhaseGates, type GatePlanPhase } from './phase-gate-plan.js';
export { loadPhaseGateParallelism, loadPhaseGates, loadRepositoryGates, loadRequirePreIntegration } from './phase-gate-plan.js';
import { verificationEnvironment } from './verification-environment.js';
import type { ParallixConfiguration } from "../../application/ports/configuration.js";
// Repository-configured lifecycle gates.
//
// Generic, language-neutral gate execution for the pre-review preparation, pre-review,
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
import { assertIndependentGateInvocation, gateAdmission, type GateAdmissionPort, type GateAdmissionRun } from '../../application/ports/gate-admission.js';
import { runGateCommand } from './gate-command-runner.js';
export { runGateCommand } from './gate-command-runner.js';
import type { IntegrationVerificationEvidencePort, ReusableVerificationProofPort } from '../../application/ports/integration-verification-evidence.js';
import { GateDashboard } from './gate-dashboard.js';
import { blockDependents, evidenceOutcomes, phaseSummary, renderGateOutput, type BlockedGate, type GateRunOutcome, type PhaseGateRunResult } from './phase-gate-outcomes.js';
import { PhaseGateResources } from './phase-gate-resources.js';
import * as fmt from '../../application/presentation/cli-format.js';
import { resolveCanonicalGateResources, resolveCanonicalMaxConcurrentGates } from './product-config.js';

/** Ordered lifecycle phases that may carry configured gates. */
export const GATE_PHASES = ['handoff', 'review', 'integration'] as const;
export type GatePhase = (typeof GATE_PHASES)[number];
export type GateLog = (message: string) => void;

/** Environment keys shared by every configured gate command. */
export const GATE_ENV = {
  SLUG: 'PARALLIX_MISSION_SLUG',
  CHECKOUT: 'PARALLIX_CHECKOUT_PATH',
  PHASE: 'PARALLIX_PHASE',
} as const;

export type { GateRunOutcome, BlockedGate, PhaseGateRunResult } from './phase-gate-outcomes.js';

/** Injectable command runner. Mirrors `spawnSync` return shape. */
export type GateCommandRunner = (
  _command: string,
  _args: string[],
  _options: { cwd: string, env: NodeJS.ProcessEnv, stdio: string, signal?: globalThis.AbortSignal, onOutput?: (_chunk: string, _stream: 'stdout' | 'stderr') => void, forwardOutput?: boolean, bindProcessGroup?: (_pid: number) => void },
) => { status: number | null, stdout: string, stderr: string, signal?: string | null, cpu?: VerificationMeasurement['cpu'], reused?: boolean } | Promise<{ status: number | null, stdout: string, stderr: string, signal?: string | null, cpu?: VerificationMeasurement['cpu'], reused?: boolean }>;

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
 *
 * @param {GatePhase} phase
 * @param {{slug: string, checkoutPath: string, gates?: RepositoryGate[], commandRunner?: GateCommandRunner, log?: Function, error?: Function}} opts
 */
export interface PhaseGateOptions {
  admission?: GateAdmissionPort;
  admissionRun?: GateAdmissionRun;
  /** Resolved before launch from adapters.gates.resources; only gates with a resource consult it. */
  resourceLimits?: Readonly<Record<string, number>>;
  signal?: AbortSignal;
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

  const execute = (options: PhaseGateOptions) => new PhaseGateExecution(phase, options, gates, log, error).execute();
  try {
    assertIndependentGateInvocation();
    opts.admission?.assertIndependent();
    const limited = { ...opts, resourceLimits: resolveGateResourceLimits(checkoutPath, gates) };
    if (!Number.isFinite(resolveCanonicalMaxConcurrentGates(checkoutPath))) { return execute(limited); }
    return await (opts.admission ?? gateAdmission()).run(checkoutPath,
      admissionRun => execute({ ...limited, admissionRun, signal: admissionRun.signal }), opts.signal);
  } catch (cause) {
    return { ok: false, phase, gates, executed: 0, skipped: false, dryRun: false,
      cancelled: cause instanceof Error && cause.name === 'AbortError', failedGate: null, error: String(cause) };
  }
}
/** Rejects undeclared resource references before any gate child can launch. */
function resolveGateResourceLimits(checkoutPath: string, gates: RepositoryGate[]): Readonly<Record<string, number>> {
  if (!gates.some(gate => gate.resource)) { return {}; }
  const limits = resolveCanonicalGateResources(checkoutPath);
  for (const gate of gates) {
    if (gate.resource && !(gate.resource in limits)) { throw new Error(`Repository gate "${gate.key}" uses undeclared resource "${gate.resource}"`); }
  }
  return limits;
}

function phaseDashboard(phase: GatePhase, opts: PhaseGateOptions, gates: RepositoryGate[], cancelByOperator: () => void): GateDashboard | null {
  const dashboard = (!opts.log || opts.log === fmt.log.plain) && (!opts.error || opts.error === fmt.log.fail)
    && process.stdin.isTTY && process.stdout.isTTY && !process.stdin.isRaw
    ? new GateDashboard(phase, gates.map(gate => gate.key), cancelByOperator) : null;

  return dashboard;
}

function phaseExecutionState(phase: GatePhase, opts: PhaseGateOptions, gates: RepositoryGate[], log: GateLog, error: GateLog) {
  const { slug, checkoutPath } = opts;

  // Execute through `bash -c`, the same shell mechanism the review preparation declared
  // gate runner and the integration gate use, so configured commands may be
  // arbitrary shell (pipelines, redirects, `./scripts/...`), not just bare
  // executables. No new runner or shell language is introduced. The default
  // runner captures each gate's streams so concurrent output can later be
  // rendered as distinct sections instead of interleaving byte-by-byte.
  const runner: GateCommandRunner = opts.commandRunner || runGateCommand;

  const env = buildGateEnv(phase, slug, checkoutPath, opts.configuration?.forwardedEnvironment ?? { ...process.env }, { realAgent: opts.realAgent, realAgentModel: opts.realAgentModel });

  Object.assign(env, opts.admissionRun?.environment);

  const maxParallel = Math.min(gates.length, opts.maxParallel ?? loadPhaseGateParallelism(checkoutPath, toConfigPhase(phase)));

  const phaseStarted = Date.now();

  const controller = new globalThis.AbortController();

  const cancellation = { operatorCancelled: false };

  const cancelByOperator = () => { cancellation.operatorCancelled = true; controller.abort(); };

  opts.signal?.addEventListener('abort', cancelByOperator, { once: true });
  if (opts.signal?.aborted) { cancelByOperator(); }

  const dashboard = phaseDashboard(phase, opts, gates, cancelByOperator);

  const liveSerial = maxParallel === 1 && !dashboard && !opts.commandRunner && (!opts.log || opts.log === fmt.log.plain);

  // Integration gathers every independent result; other phases stop at the first failure.
  const failFast = phase !== 'integration';

  const failure: { failedGate: GateRunOutcome | null; errorText: string | null; all: GateRunOutcome[]; blocked: BlockedGate[]; cancelled: GateRunOutcome[] } =
    { failedGate: null, errorText: null, all: [], blocked: [], cancelled: [] };

  let executed = 0;

  const outcomes: GateRunOutcome[] = [];

  const coverage = phase === 'integration' ? opts.verificationEvidence?.start(checkoutPath, gates) : null;

  const pending = [...gates];
  const completed = new Set<string>();
  const running = new Set<Promise<GateRunOutcome>>();
  return { phase, failFast, opts, gates, log, error, slug, checkoutPath, runner, env, maxParallel, phaseStarted, controller, cancelByOperator, dashboard, liveSerial, failure, executed, outcomes, coverage, pending, completed, running, cancellation };
}

class PhaseGateExecution {
  private readonly batchId = randomUUID();
  private readonly observations = new Map<string, Awaited<ReturnType<NonNullable<ReturnType<typeof verificationObservation>>['begin']>>>();
  private readonly state: ReturnType<typeof phaseExecutionState>;
  private readonly resources: PhaseGateResources;
  constructor(phase: GatePhase, opts: PhaseGateOptions, gates: RepositoryGate[], log: GateLog, error: GateLog) {
    this.state = phaseExecutionState(phase, opts, gates, log, error);
    this.resources = new PhaseGateResources(this.state.maxParallel, this.state.checkoutPath, opts.resourceLimits ?? {},
      () => opts.admission ?? gateAdmission(), this.state.controller.signal);
  }

  async startPending(): Promise<void> {
    while ((!this.state.failFast || this.state.failure.failedGate === null) && !this.state.controller.signal.aborted) {
      const index = this.state.pending.findIndex(gate => this.resources.launchable(gate)
        && (gate.after || []).every(dependency => this.state.completed.has(dependency)));
      if (index < 0) { break; }
      const gate = this.state.pending.splice(index, 1)[0];
      this.state.dashboard?.startGate(gate.key);
      this.logProgress(gate, this.resources.launch(gate) ? undefined : `waiting for resource "${gate.resource}"`);
      const verification = gate.reuse === 'clean-tree'
        ? await import('../verification/' + 'verification.js') as ReusableVerificationProofPort : null;
      this.state.running.add(this.launchGate(gate, verification));
    }
  }

  private logProgress(gate: RepositoryGate, status = `started (${this.resources.active}/${this.state.maxParallel} active)`): void {
    if (!this.state.dashboard) { this.state.log(`Repository gate (${this.state.phase}): ${gate.key} ${status}.`); }
  }

  /** A tagged gate command holds its own resource slot until its process tree settles. */
  private runAdmitted(gate: RepositoryGate) {
    const { opts, controller } = this.state;
    const invoke = async (slot?: GateAdmissionRun, queued = false) => {
      if (queued) { this.logProgress(gate); }
      await this.observations.get(gate.key)?.started().catch(() => undefined);
      return this.state.runner(gate.command, [], {
      cwd: path.resolve(this.state.checkoutPath), stdio: 'pipe', forwardOutput: this.state.liveSerial,
      env: { ...this.state.env, ...slot?.environment },
      signal: slot ? AbortSignal.any([controller.signal, slot.signal]) : controller.signal,
      bindProcessGroup: slot ? (pid: number) => { opts.admissionRun?.bindProcessGroup(pid); slot.bindProcessGroup(pid); } : opts.admissionRun?.bindProcessGroup,
      onOutput: chunk => this.state.dashboard?.append(gate.key, chunk)
      });
    };
    return this.resources.run(gate, invoke);
  }

  async launchGate(gate: RepositoryGate, verification: ReusableVerificationProofPort | null): Promise<GateRunOutcome> {
    const started = Date.now();
    const observation = await verificationObservation()?.begin({ root: this.state.checkoutPath, mission: this.state.slug,
      batchId: this.batchId, gate: gate.key, command: gate.command, phase: this.state.phase,
      after: gate.after ?? [], plan: this.state.gates.map(gate => gate.key) }).catch(() => null);
    this.observations.set(gate.key, observation ?? null);
    // Delay proof loading until a clean-tree gate actually runs. This keeps
    // bootstrap-only gate planning independent of Git verification modules.
    const proofContext = JSON.stringify({ phase: this.state.phase, slug: this.state.slug, checkoutPath: path.resolve(this.state.checkoutPath), gate: gate.key });
    const reusable: { ok: boolean; identity?: string; error?: string } = gate.reuse === 'clean-tree'
      ? verification!.readReusableVerificationProof(gate.command, this.state.checkoutPath, { context: proofContext, configuration: this.state.opts.configuration }) : { ok: false, identity: undefined, error: 'reuse disabled' };
    if (reusable.ok) {
      await observation?.complete({ result: 'reused', exitCode: 0, failureReason: null, wallMs: null, cpu: null }).catch(() => undefined);
      return { key: gate.key, command: gate.command, exitCode: 0, stdout: 'reused exact clean-tree proof', stderr: '', durationMs: 0 };
    }
    // Reuse the freshly checked identity snapshot returned even on a cache miss.
    const beforeProof = { ok: Boolean(reusable.identity), identity: reusable.identity, error: reusable.error };
    const run = Promise.resolve().then(() => this.runAdmitted(gate))
      .then(result => {
        const exitCode = typeof result.status === 'number' ? result.status : null;
        if (exitCode === 0 && gate.reuse === 'clean-tree') {
          const persisted = beforeProof.ok
            ? verification!.writeReusableVerificationProof(gate.command, this.state.checkoutPath, { context: proofContext, configuration: this.state.opts.configuration, expectedIdentity: beforeProof.identity })
            : beforeProof;
          return { key: gate.key, command: gate.command, exitCode, cpu: result.cpu, reused: result.reused, stdout: String(result.stdout || ''), stderr: persisted.ok ? String(result.stderr || '') : `${String(result.stderr || '')}\nproof unavailable: ${persisted.error}`, durationMs: Date.now() - started };
        }
        return { key: gate.key, command: gate.command, exitCode, cpu: result.cpu, reused: result.reused, signal: result.signal ?? null, failureReason: gateFailureReasonFromProcess(result), stdout: String(result.stdout || ''), stderr: String(result.stderr || ''), durationMs: Date.now() - started };
      })
      .catch(cause => ({ failureReason: failureReasonFromCause(cause, 'process'), key: gate.key, command: gate.command, exitCode: null, stdout: '', stderr: String(cause), durationMs: Date.now() - started }));
    const outcome: GateRunOutcome = await run;
    await observation?.complete({ result: outcome.reused ? 'reused' : outcome.exitCode === 0 ? 'passed'
      : this.state.controller.signal.aborted ? 'interrupted' : 'failed', exitCode: outcome.exitCode,
      failureReason: outcome.failureReason ?? null, wallMs: outcome.reused ? null : outcome.durationMs ?? null,
      cpu: outcome.cpu ?? null }).catch(() => undefined);
    return outcome;
  }

  settleOutcome(run: Promise<GateRunOutcome>, outcome: GateRunOutcome): void {
    this.state.running.delete(run);
    this.state.executed++;
    this.state.outcomes.push(outcome);
    this.resources.complete(this.state.gates.find(gate => gate.key === outcome.key)!);
    this.state.dashboard?.finishGate(outcome.key, outcome.exitCode, [outcome.stdout, outcome.stderr].filter(Boolean).join('\n'), outcome.durationMs ?? 0, this.state.controller.signal.aborted);
    if (outcome.exitCode === 0) {
      this.state.completed.add(outcome.key);
      if (!this.state.dashboard) { this.state.log(`Repository gate (${this.state.phase}): ${outcome.key} passed.`); }
      return;
    }
    if (!this.state.dashboard && !this.state.liveSerial) { renderGateOutput(this.state.phase, outcome, this.state.log); }
    if (this.state.cancellation.operatorCancelled && !this.state.failFast) { this.state.failure.cancelled.push(outcome); }
    else if (!this.state.failFast || this.state.failure.failedGate === null) { this.settleFailure(outcome); }
  }

  private settleFailure(outcome: GateRunOutcome): void {
    const text = `Repository gate "${outcome.key}" exited with code ${outcome.exitCode ?? 'unknown'} for ${this.state.phase}.`;
    this.recordFailure(outcome, text);
    if (!this.state.dashboard) { this.state.log(`Repository gate (${this.state.phase}): ${outcome.key} failed.`); this.state.error(text); }
    if (this.state.failFast) { this.state.controller.abort(); }
    else { blockDependents(this.state.pending, this.state.failure.all, this.state.failure.blocked); }
  }

  private recordFailure(outcome: GateRunOutcome, text: string): void {
    this.state.failure.all.push(outcome);
    if (this.state.failure.failedGate === null) { this.state.failure.failedGate = outcome; this.state.failure.errorText = text; }
  }

  /** Operator-stopped parts: killed children and gates that never started. */
  private cancelledKeys(): string[] {
    return this.state.cancellation.operatorCancelled && !this.state.failFast
      ? [...this.state.failure.cancelled.map(outcome => outcome.key), ...this.state.pending.map(gate => gate.key)] : [];
  }

  private dashboardLine(gate: RepositoryGate): string {
    const outcome = this.state.outcomes.find(item => item.key === gate.key);
    const blockedBy = this.state.failure.blocked.find(item => item.key === gate.key)?.blockedBy;
    if (!outcome) { return blockedBy ? `  ⊘ ${gate.key} blocked by ${blockedBy.join(', ')}` : `  · ${gate.key} not run`; }
    const killed = this.state.controller.signal.aborted && outcome !== this.state.failure.failedGate && outcome.exitCode !== 0;
    return `  ${killed ? '×' : outcome.exitCode === 0 ? '✓' : '✗'} ${gate.key} ${((outcome.durationMs ?? 0) / 1000).toFixed(1)}s`;
  }

  reportDashboard(): void {
    if (this.state.dashboard) {
      this.state.log(`Repository gates (${this.state.phase}): ${this.state.cancellation.operatorCancelled ? 'cancelled' : this.state.failure.failedGate ? 'failed' : 'passed'}; ${this.state.executed}/${this.state.gates.length} completed in ${((Date.now() - this.state.phaseStarted) / 1000).toFixed(1)}s.`);
      for (const gate of this.state.gates) { this.state.log(this.dashboardLine(gate)); }
      if (!this.state.cancellation.operatorCancelled) { for (const failed of this.state.failure.all) { renderGateOutput(this.state.phase, failed, this.state.error); } }
    }
  }

  close(): void {
    this.state.opts.signal?.removeEventListener('abort', this.state.cancelByOperator);
    this.state.dashboard?.close();
  }

  async execute(): Promise<PhaseGateRunResult> {
    try { return await this.executeGates(); }
    catch (cause) { this.state.controller.abort(); await Promise.allSettled(this.state.running); throw cause; }
    finally { this.close(); }
  }

  private recordUnresolvedDependencies(): void {
    const { pending, failure, controller, failFast, dashboard, phase } = this.state;
    if (pending.length === 0 || controller.signal.aborted || (failFast && failure.failedGate !== null)) { return; }
    const gate = pending[0];
    const text = `Repository gate "${gate.key}" has unresolved dependencies for ${phase}.`;
    this.recordFailure({ key: gate.key, command: gate.command, exitCode: null, stdout: '', stderr: text }, text);
    if (!dashboard) { this.state.error(text); }
  }

  private summarizeAggregate(cancelledKeys: string[]): void {
    const { all: failures, blocked } = this.state.failure;
    const { operatorCancelled } = this.state.cancellation;
    if (operatorCancelled) { this.state.failure.errorText = `Repository gates (${this.state.phase}) cancelled.`; return; }
    if (this.state.failFast || failures.length + blocked.length + cancelledKeys.length === 0) { return; }
    for (const line of phaseSummary(this.state.phase, failures, blocked, cancelledKeys)) { this.state.log(line); }
    if (failures.length > 1 || blocked.length > 0) {
      this.state.failure.errorText = `Repository gates (${this.state.phase}) failed: ${failures.map(outcome => outcome.key).join(', ')}${blocked.length ? `; blocked: ${blocked.map(gate => gate.key).join(', ')}` : ''}.`;
    }
  }

  /** The executor reports how the phase settled, so a failed or cancelled run is observable evidence too. */
  private completeCoverage(cancelledKeys: string[]): boolean {
    if (!this.state.coverage) { return false; }
    const settled = this.state.cancellation.operatorCancelled ? 'cancelled'
      : this.state.failure.failedGate !== null ? 'failed'
        : this.state.controller.signal.aborted ? 'cancelled' : 'passed';
    return this.state.coverage.complete(evidenceOutcomes(this.state.gates, this.state.outcomes, this.state.failure.blocked, new Set(cancelledKeys)), settled);
  }

  private async executeGates(): Promise<PhaseGateRunResult> {
    while (this.state.pending.length > 0 || this.state.running.size > 0) {
      await this.startPending();
      if (this.state.running.size === 0) {
        this.recordUnresolvedDependencies();
        break;
      }
      const { run, outcome } = await Promise.race([...this.state.running].map(run => run.then(outcome => ({ run, outcome }))));
      this.settleOutcome(run, outcome);
    }
    this.reportDashboard();
    const { all: failures, blocked } = this.state.failure;
    const cancelledKeys = this.cancelledKeys();
    this.summarizeAggregate(cancelledKeys);
    const proofReusable = this.completeCoverage(cancelledKeys);
    return {
      ok: failures.length === 0 && !this.state.controller.signal.aborted,
      phase: this.state.phase,
      gates: this.state.gates,
      executed: this.state.executed,
      skipped: false,
      dryRun: false,
      cancelled: this.state.cancellation.operatorCancelled,
      failedGate: this.state.failure.failedGate,
      failures,
      blocked,
      ...(cancelledKeys.length ? { cancelledGates: cancelledKeys } : {}),
      outcomes: this.state.outcomes,
      proofReusable,
      error: this.state.failure.errorText,
    };
  }
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
function toConfigPhase(phase: GatePhase): GatePlanPhase {
  return ({ handoff: "preHandoff", review: 'preReview', integration: 'preIntegration' } as const)[phase];
}
