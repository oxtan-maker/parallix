import { classifyFailure } from '../domain/failure-classification.js';
import { failureReason } from '../domain/failure-reason.js';
import { preparationRecoveryReason } from './review-preparation-failure.js';
import { rebound, reboundDiagnostic, classifyReboundReason, type ReboundOutcome, type ReboundReason, type VerifyResult } from './rebound-kernel.js';
import { buildTypedMissionRecoveryAdvice } from './typed-mission-recovery-advice.js';
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
import { DECLARED_GATES_RETURN_STAGE, type WorkflowReturnStage } from '../domain/board-event.js';

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
  readonly continueIntegrationRepair?: () => Promise<boolean | null>;
  readonly beginReviewPreparation?: () => Promise<void>;
  readonly prepareImplementationRepair?: (_diagnostic: string, _reason: ReboundReason,
    _returnStage: WorkflowReturnStage) => Promise<void>;
  readonly onAgentLaunched?: (_agent: string, _phase: AgentLaunchPhase, _model?: string | null) => Promise<void>;
  readonly onAutonomousStop?: (_reason: string) => Promise<void>;
  readonly onImplementerLaunched?: (_agent: string) => Promise<void>;
}

/** Application-owned post-execute ordering: evidence, review preparation, then review. */
export class ExecuteReviewPreparationService {
  constructor(private readonly _ports: ExecuteReviewPreparationPorts) { }

  private trackImplementer(request: ExecuteReviewPreparationRequest): ExecuteReviewPreparationRequest {
    const original = request;
    const actual = { agent: request.agent };
    let lastStop: string | null = null;
    request = { ...request, onAutonomousStop: async reason => { if (lastStop === reason) { return; } lastStop = reason; await original.onAutonomousStop?.(reason); }, get agent() { return actual.agent; },
      onImplementerLaunched: async agent => {
        await original.onImplementerLaunched?.(agent);
        actual.agent = agent;
      },
    };
    return request;
  }

  private async ensureCheckpointEvidence(request: ExecuteReviewPreparationRequest): Promise<boolean> {
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

    return true;
  }

  async run(request: ExecuteReviewPreparationRequest): Promise<boolean> {
    request = this.trackImplementer(request);
    const resumed = await request.continueIntegrationRepair?.();
    if (resumed !== undefined && resumed !== null) { return resumed; }
    await request.beginReviewPreparation?.();
    if (!await this.ensureCheckpointEvidence(request)) { return false; }

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
    const classification = classifyFailure(validation.failureReason);
    if (!validation.nextCheckpoint && classification?.failureClass !== 'IncompleteEvidence') {
      this.manualCheckpointAction(request, validation); return false;
    }
    this._ports.output.log(`Checkpoint validation failed (${classification?.failureClass ?? 'DeclaredCheckpointGap'}). Bouncing to the implementer for a targeted checkpoint repair...`);
    const next = validation.nextCheckpoint;
    const diagnostic = this.checkpointRepairDiagnostic(request, error, next, validation.source);
    const repaired = await this.rebound(request, { kind: 'review-preparation-verification', error: diagnostic, failureReason: validation.failureReason ?? failureReason('incomplete-evidence', 'review-preparation') }, async () => {
      const verdict = await this.validate(request);
      return { ok: verdict.ok, diagnostic: verdict.error ?? '', reason: verdict.humanOnlyContractBlocker ? { kind: 'declared-gate-validation' as const, command: verdict.humanOnlyContractBlocker.command, diagnostic: verdict.error ?? 'Recorded contract requires operator decision' } : verdict.ok ? undefined : { kind: 'review-preparation-verification' as const, error: verdict.error ?? '', failureReason: verdict.failureReason ?? failureReason('incomplete-evidence', 'review-preparation') } };
    });
    if (repaired.outcome === 'fixed') { return true; }
    const finalValidation = await this.validate(request);
    if (finalValidation.ok) { return true; }
    this.manualCheckpointAction(request, finalValidation);
    return false;
  }

  private checkpointRepairDiagnostic(request: ExecuteReviewPreparationRequest, error: string, next: string | undefined, source?: 'recorded' | 'historical'): string {
    return next
      ? `${error}\n\n${source === 'recorded' ? buildTypedMissionRecoveryAdvice(request.slug, next.startsWith('CP-') ? next : `CP-${next}`) : this.fileCheckpointContinuation(request, next.startsWith('CP-') ? next : `CP-${next}`)}`
      : error;

  }

  private async repairReviewPreparation(request: ExecuteReviewPreparationRequest, holder: { result: ReviewPreparationRunResult }): Promise<void> {
    if (await this.stopForContract(request, holder.result) || holder.result.recoveryAttempted) { return; }
    const error = holder.result.error ?? 'unknown';

    const reason = preparationRecoveryReason(holder.result);
    const classification = classifyReboundReason(reason);
    if (!classification || classification.dispatchAction === 'HumanOnly' || (holder.result.recoveryFailure?.kind !== 'rebase-conflict' && classification.failureClass === 'GitBlockers')) {
      await this.repairHygieneFailure(request, holder, error);
      return;
    }
    this._ports.output.log(`\nRelaunchable error detected (${classification.failureClass}). Bouncing to the implementer...`);

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
      ...request, error, failureReason: holder.result.failureReason, log: this._ports.output.log, outputError: this._ports.output.error,
    });
    if (repair.repaired) { this._ports.output.log("Repair successful. Retrying automated review preparation..."); holder.result = await this._ports.reviewPreparation.run({ ...request, force: true }); return; }
    if (repair.blocker) { holder.result = { ...holder.result, error: repair.blocker }; }
    else if (classifyFailure(holder.result.failureReason).dispatchAction === 'AutoSendBack') {
      this._ports.output.log('Content error detected. Attempting agent relaunch to fix...');
      await this.rebound(request, preparationRecoveryReason(holder.result), async () => {
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
      : result.ok ? undefined : preparationRecoveryReason(result);
    return { ok: result.ok, diagnostic, reason };
  }

  private async rebound(request: ExecuteReviewPreparationRequest, reason: ReboundReason | string, verify: () => Promise<VerifyResult>): Promise<ReboundOutcome> {
    const reboundReason: ReboundReason = typeof reason === 'string'
      ? { kind: "review-preparation-verification", error: reason, failureReason: failureReason('unexpected', 'review-preparation') }
      : reason;
    const result = await rebound(reboundReason, {
      slug: request.slug, worktree: request.worktree, implementer: request.agent,
      returnStage: DECLARED_GATES_RETURN_STAGE,
      readHead: () => this._ports.repairLaunch.readHead(request.worktree),
      transitionToImplementer: (_slug, returnStage) => {
        return request.prepareImplementationRepair?.(
          typeof reason === 'string' ? reason : reboundDiagnostic(reason), reboundReason, returnStage);
      },
      verify: async () => {
        await request.beginReviewPreparation?.();
        const result = await verify();
        return { ...result, command: result.command ?? (reboundReason.kind === 'gate-failure' ? reboundReason.command : undefined) };
      },
      startAgent: async (_step, options) => this._ports.repairLaunch.launch({
        slug: request.slug, worktree: request.worktree, agent: request.agent,
        prompt: typeof options.prompt === 'function' ? options.prompt(request.agent) : String(options.prompt ?? ''),
        sessionPolicy: options.sessionPolicy,
        onAgentChanged: async (agent, model) => { await request.onImplementerLaunched?.(agent); await request.onAgentLaunched?.(agent, 'review-response', model); },
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

  private manualCheckpointAction(request: ExecuteReviewPreparationRequest, validation: CheckpointValidationVerdict): void {
    if (validation.failureReason?.context?.contract === 'checkpoint-declarations') {
      this._ports.output.error(`Update the historical mission declaration document: ${validation.error ?? 'invalid declarations'}. Use a ## Checkpoints section with - CP N: <name> declarations, then retry review preparation.`);
      return;
    }
    this._ports.output.error(`       ${validation.error ?? 'Checkpoint validation failed'}`);
    this._ports.output.error(validation.source === 'recorded'
      ? buildTypedMissionRecoveryAdvice(request.slug, validation.nextCheckpoint ?? 'CP-N')
      : `Create a checkpoint document (CP-N.md) with a Goal Check table and repair the historical declarations in ${request.worktree}, then re-run px review ${request.slug} --submit.`);
  }

}
