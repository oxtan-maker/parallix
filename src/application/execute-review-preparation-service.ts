import { rebound, reboundDiagnostic, classifyReboundReason, type ReboundOutcome, type ReboundReason, type VerifyResult } from './rebound-kernel.js';
import { buildTypedMissionRecoveryAdvice, isTypedCheckpointEvidenceFailure } from './typed-mission-recovery-advice.js';
import type {
  AutonomousReviewPort,
  CheckpointValidationPort,
  CheckpointValidationVerdict,
  ExecuteOperatorOutputPort,
  ExecuteRepairLaunchPort,
  ReviewPreparationExecutionPort,
  ReviewPreparationRunResult,
} from './ports/execute-mission.js';
import type { AgentLaunchPhase } from './recording/execution-activity-recorder.js';

export interface ExecuteReviewPreparationPorts {
  readonly checkpoints: CheckpointValidationPort;
  readonly reviewPreparation: ReviewPreparationExecutionPort;
  readonly review: AutonomousReviewPort;
  readonly repairLaunch: ExecuteRepairLaunchPort;
  readonly output: ExecuteOperatorOutputPort;
}

export interface ExecuteReviewPreparationRequest {
  readonly slug: string;
  readonly worktree: string;
  readonly agent: string;
  /** Explicit automatic-review family; carried unchanged through review preparation retries. */
  readonly reviewer?: string;
  readonly taskFile: string | null;
  readonly beginReviewPreparation?: () => Promise<void>;
  readonly prepareImplementationRepair?: (_diagnostic: string, _reason?: ReboundReason) => Promise<void>;
  readonly onAgentLaunched?: (_agent: string, _phase: AgentLaunchPhase) => Promise<void>;
  readonly onAutonomousStop?: (_reason: string) => Promise<void>;
  readonly onImplementerLaunched?: (_agent: string) => Promise<void>;
}

/** Application-owned post-execute ordering: evidence, review preparation, then review. */
export class ExecuteReviewPreparationService {
  constructor(private readonly _ports: ExecuteReviewPreparationPorts) { }

  async run(request: ExecuteReviewPreparationRequest): Promise<boolean> {
    const original = request;
    const actual = { agent: request.agent };
    let lastStop: string | null = null;
    request = { ...request, onAutonomousStop: async reason => { if (lastStop === reason) { return; } lastStop = reason; await original.onAutonomousStop?.(reason); }, get agent() { return actual.agent; },
      onImplementerLaunched: async agent => {
        await original.onImplementerLaunched?.(agent);
        actual.agent = agent;
      },
    };
    await request.beginReviewPreparation?.();
    let validation = await this.validate(request);
    if (!validation.ok) {
      if (validation.humanOnlyContractBlocker) {
        this._ports.output.error(validation.error ?? 'Invalid locked contract requires human review.');
        await request.onAutonomousStop?.('Recorded invalid locked contract requires operator decision; evidence repair is stopped.');
        return false;
      }
      const repaired = await this.repairCheckpointGap(request, validation);
      if (!repaired) { await request.onAutonomousStop?.(validation.error ?? 'Checkpoint evidence repair failed'); return false; }
    }

    const holder: { result: ReviewPreparationRunResult } = { result: await this._ports.reviewPreparation.run(request) };
    if (!holder.result.ok) { await this.repairReviewPreparation(request, holder); }
    if (!holder.result.ok) {
      this._ports.output.error(`Automated review preparation failed: ${holder.result.error}`);
      this._ports.output.error("       You may need to complete the review preparation manually:");
      this._ports.output.error(`       ${this._ports.output.command(`px review ${request.slug} --submit`)}`);
      await request.onAutonomousStop?.(holder.result.error ?? 'Review preparation failed');
      return false;
    }
    if (holder.result.gatekeeperPushedBack) {
      this._ports.output.log(`\nGatekeeper posted pushback for ${this._ports.output.formatSlug(request.slug)}; skipping autonomous review loop until artifacts are fixed.`);
      return true;
    }
    this._ports.output.log(`\nStarting autonomous review loop (implementer: ${this._ports.output.formatAgent(request.agent)})...`);
    await this._ports.review.start({ ...request, implementer: request.agent });
    return true;
  }

  private async validate(request: ExecuteReviewPreparationRequest) {
    return this._ports.checkpoints.validateBeforeReviewPreparation({ ...request, log: this._ports.output.log, error: this._ports.output.error });
  }

  private async repairCheckpointGap(request: ExecuteReviewPreparationRequest, validation: CheckpointValidationVerdict): Promise<boolean> {
    const error = validation.error ?? 'checkpoint validation failed';
    const classification = this._ports.reviewPreparation.classifyFailure(error);
    if (!validation.nextCheckpoint && classification?.failureClass !== 'IncompleteEvidence') {
      this.manualCheckpointAction(request, error); return false;
    }
    this._ports.output.log(`Checkpoint validation failed (${classification?.failureClass ?? 'DeclaredCheckpointGap'}). Bouncing to the implementer for a targeted checkpoint repair...`);
    const next = validation.nextCheckpoint ?? /(?:CP-|CHECKPOINT_)(\d+)/i.exec(error)?.[1];
    const diagnostic = this.checkpointRepairDiagnostic(request, error, next);
    const repaired = await this.rebound(request, diagnostic, async () => {
      const verdict = await this.validate(request);
      return { ok: verdict.ok, diagnostic: verdict.error ?? '', ...(verdict.humanOnlyContractBlocker ? { reason: { kind: 'declared-gate-validation' as const, command: verdict.humanOnlyContractBlocker.command, diagnostic: verdict.error ?? 'Recorded contract requires operator decision' } } : {}) };
    });
    if (repaired.outcome === 'fixed') { return true; }
    const finalValidation = await this.validate(request);
    if (finalValidation.ok) { return true; }
    this.manualCheckpointAction(request, finalValidation.error ?? diagnostic);
    return false;
  }

  private checkpointRepairDiagnostic(request: ExecuteReviewPreparationRequest, error: string, next: string | undefined): string {
    return next
      ? `${error}\n\n${isTypedCheckpointEvidenceFailure(error) ? buildTypedMissionRecoveryAdvice(request.slug, next.startsWith('CP-') ? next : `CP-${next}`) : this.fileCheckpointContinuation(request, next.startsWith('CP-') ? next : `CP-${next}`)}`
      : error;

  }

  private async repairReviewPreparation(request: ExecuteReviewPreparationRequest, holder: { result: ReviewPreparationRunResult }): Promise<void> {
    if (await this.stopForContract(request, holder.result) || holder.result.recoveryAttempted) { return; }
    const error = holder.result.error ?? 'unknown';
    const diagnostic = reviewPreparationFailureDiagnostic(holder.result, error);
    const classification = holder.result.recoveryFailure ? classifyReboundReason(holder.result.recoveryFailure) : this._ports.reviewPreparation.classifyFailure(error);
    if (!classification || classification.dispatchAction === 'HumanOnly' || (!holder.result.recoveryFailure && classification.failureClass === 'GitBlockers')) {
      await this.repairHygieneFailure(request, holder, error);
      return;
    }
    this._ports.output.log(`\nRelaunchable error detected (${classification.failureClass}). Bouncing to the implementer...`);
    const reason: ReboundReason = holder.result.recoveryFailure ?? holder.result.gateFailure ?? { kind: "review-preparation-verification", error, gateOutput: diagnostic };
    const outcome = await this.rebound(request, reason, async () => {
      holder.result = await this._ports.reviewPreparation.run({ ...request, force: true });
      return this.reviewPreparationVerification(holder.result);
    });
    if (await this.stopForContract(request, holder.result)) { return; }
    if (!holder.result.ok) { holder.result = { ...holder.result, error: `Recovery stopped after ${outcome.attempts} relaunch attempt(s): ${outcome.dossier || outcome.diagnostic || holder.result.error}` }; }
  }

  private async repairHygieneFailure(request: ExecuteReviewPreparationRequest, holder: { result: ReviewPreparationRunResult }, error: string): Promise<void> {
    this._ports.output.log(`\nAutomated review preparation failed: ${error}`);
    this._ports.output.log('Attempting post-execute repair...');
    const repair = await this._ports.reviewPreparation.repairHygiene({
      ...request, error, log: this._ports.output.log, outputError: this._ports.output.error,
    });
    if (repair.repaired) { this._ports.output.log("Repair successful. Retrying automated review preparation..."); holder.result = await this._ports.reviewPreparation.run({ ...request, force: true }); return; }
    if (repair.blocker) { holder.result = { ...holder.result, error: repair.blocker }; }
    else if (this._ports.reviewPreparation.isRelaunchableFailure(error)) {
      this._ports.output.log('Content error detected. Attempting agent relaunch to fix...');
      await this.rebound(request, error, async () => {
        holder.result = await this._ports.reviewPreparation.run({ ...request, force: true });
        return this.reviewPreparationVerification(holder.result);
      });
      if (await this.stopForContract(request, holder.result)) { return; }
      if (!holder.result.ok) { holder.result = { ...holder.result, error: `Post-relaunch review preparation failed: ${holder.result.error ?? 'unknown'}` }; }
    }
  }

  private async stopForContract(request: ExecuteReviewPreparationRequest, result: ReviewPreparationRunResult): Promise<boolean> {
    if (result.reason !== 'human-only-contract-blocker' && result.reason !== 'repair-contract-changed') { return false; }
    await request.onAutonomousStop?.(result.error ?? 'Recorded contract requires operator decision.');
    return true;
  }

  private reviewPreparationVerification(result: ReviewPreparationRunResult): VerifyResult {
    const diagnostic = result.error ?? '';
    const reason = result.reason === 'human-only-contract-blocker' || result.reason === 'repair-contract-changed'
      ? { kind: 'declared-gate-validation' as const, command: 'px checkpoint check', diagnostic }
      : result.recoveryFailure ?? result.gateFailure ?? (result.ok ? undefined : { kind: "review-preparation-verification" as const, error: diagnostic });
    return { ok: result.ok, diagnostic, reason };
  }

  private async rebound(request: ExecuteReviewPreparationRequest, reason: ReboundReason | string, verify: () => Promise<VerifyResult>): Promise<ReboundOutcome> {
    const reboundReason: ReboundReason = typeof reason === 'string'
      ? { kind: "review-preparation-verification", error: reason }
      : reason;
    const result = await rebound(reboundReason, {
      slug: request.slug, worktree: request.worktree, implementer: request.agent,
      readHead: () => this._ports.repairLaunch.readHead(request.worktree),
      transitionToImplementer: () => request.prepareImplementationRepair?.(typeof reason === 'string' ? reason : reboundDiagnostic(reason), reboundReason),
      verify: async () => {
        await request.beginReviewPreparation?.();
        const result = await verify();
        return { ...result, command: result.command ?? (reboundReason.kind === 'gate-failure' ? reboundReason.command : undefined) };
      },
      startAgent: async (_step, options) => this._ports.repairLaunch.launch({
        slug: request.slug, worktree: request.worktree, agent: request.agent,
        prompt: typeof options.prompt === 'function' ? options.prompt(request.agent) : String(options.prompt ?? ''),
        sessionPolicy: options.sessionPolicy,
        onAgentChanged: async agent => { await request.onImplementerLaunched?.(agent); await request.onAgentLaunched?.(agent, 'review-response'); },
      }),
      applyAgentFallback: async ({ launchResult, original }) => {
        const actual = launchResult?.agent || original;
        if (launchResult?.agent) { await request.onImplementerLaunched?.(actual); }
        return actual;
      },
      log: this._ports.output.log, error: this._ports.output.error,
    });
    return result;
  }

  private fileCheckpointContinuation(request: ExecuteReviewPreparationRequest, checkpoint: string): string {
    return `Mission ${request.slug} is incomplete: ${checkpoint}. Continue the existing execute mission in ${request.worktree} from ${checkpoint}. Complete ${checkpoint} and record its evidence, then immediately continue to every remaining declared checkpoint and mission gate. Do not exit or send a final response until every declared checkpoint has its evidence and every mission-declared gate passes, unless a mission stop rule applies or a genuine external dependency blocks progress.`;
  }

  private manualCheckpointAction(request: ExecuteReviewPreparationRequest, error: string): void {
    this._ports.output.error(`       ${error}`);
    this._ports.output.error(`       ${this.checkpointValidationNextAction(request, error)}`);
  }

  private checkpointValidationNextAction(request: ExecuteReviewPreparationRequest, error: string): string {
    if (isTypedCheckpointEvidenceFailure(error)) {
      const checkpoint = /Planned checkpoint evidence is missing before review preparation:\s*(CP-\d+)/i.exec(error)?.[1] ?? 'CP-N';
      return buildTypedMissionRecoveryAdvice(request.slug, checkpoint);
    }
    if (/MISSION\.md.*## Checkpoints|Malformed checkpoint declaration/i.test(error)) {
      return `Update ${request.worktree}/missions/${request.slug}/MISSION.md with valid - CP N: <name> or - CP-N: <name> declarations, then re-run: ${this._ports.output.command(`px review ${request.slug} --submit`)}.`;
    }
    return `Create a checkpoint document (CP-N.md) in ${request.worktree}/missions/${request.slug} with a Goal Check table. Then re-run: ${this._ports.output.command(`px review ${request.slug} --submit`)}.`;
  }
}

function reviewPreparationFailureDiagnostic(result: ReviewPreparationRunResult, error: string): string {
  return [error, result.gateOutput?.stdout, result.gateOutput?.stderr].filter(Boolean).join('\n');
}
