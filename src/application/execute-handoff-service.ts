import { rebound, DEFAULT_REBOUND_ATTEMPTS, type ReboundReason, type VerifyResult } from './rebound-kernel.js';
import { buildTypedMissionRecoveryAdvice, isTypedCheckpointEvidenceFailure } from './typed-mission-recovery-advice.js';
import type {
  AutonomousReviewPort,
  CheckpointValidationPort,
  ExecuteOperatorOutputPort,
  ExecuteRepairLaunchPort,
  HandoffExecutionPort,
  HandoffRunResult,
} from './ports/execute-mission.js';
import type { AgentLaunchPhase } from './recording/current-work-recorder.js';

export interface ExecuteHandoffPorts {
  readonly checkpoints: CheckpointValidationPort;
  readonly handoff: HandoffExecutionPort;
  readonly review: AutonomousReviewPort;
  readonly repairLaunch: ExecuteRepairLaunchPort;
  readonly output: ExecuteOperatorOutputPort;
}

export interface ExecuteHandoffRequest {
  readonly slug: string;
  readonly worktree: string;
  readonly agent: string;
  readonly taskFile: string | null;
  readonly onAgentLaunched?: (_agent: string, _phase: AgentLaunchPhase) => Promise<void>;
  readonly onAutonomousStop?: (_reason: string) => Promise<void>;
}

/** Application-owned post-execute ordering: evidence, handoff, then review. */
export class ExecuteHandoffService {
  constructor(private readonly _ports: ExecuteHandoffPorts) {}

  async run(request: ExecuteHandoffRequest): Promise<boolean> {
    let validation = await this.validate(request);
    if (!validation.ok) {
      const repaired = await this.repairCheckpointGap(request, validation);
      if (!repaired) { return false; }
    }

    const holder: { result: HandoffRunResult } = { result: await this._ports.handoff.run(request) };
    if (!holder.result.ok) { await this.repairHandoff(request, holder); }
    if (!holder.result.ok) {
      this._ports.output.error(`Automated handoff failed: ${holder.result.error}`);
      this._ports.output.error('       You may need to complete the handoff manually:');
      this._ports.output.error(`       ${this._ports.output.command(`px review ${request.slug} --submit`)}`);
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

  private async validate(request: ExecuteHandoffRequest) {
    return this._ports.checkpoints.validateBeforeHandoff({ ...request, log: this._ports.output.log, error: this._ports.output.error });
  }

  private async repairCheckpointGap(request: ExecuteHandoffRequest, validation: { error?: string; nextCheckpoint?: string; ok: boolean }): Promise<boolean> {
    const error = validation.error ?? 'checkpoint validation failed';
    const classification = this._ports.handoff.classifyFailure(error);
    if (!validation.nextCheckpoint && classification?.failureClass !== 'IncompleteEvidence') {
      this.manualCheckpointAction(request, error); return false;
    }
    this._ports.output.log(`Checkpoint validation failed (${classification?.failureClass ?? 'DeclaredCheckpointGap'}). Bouncing to the implementer for a targeted checkpoint repair...`);
    const next = validation.nextCheckpoint ?? /(?:CP-|CHECKPOINT_)(\d+)/i.exec(error)?.[1];
    const diagnostic = next
      ? `${error}\n\n${isTypedCheckpointEvidenceFailure(error) ? buildTypedMissionRecoveryAdvice(request.slug, next.startsWith('CP-') ? next : `CP-${next}`) : this.fileCheckpointContinuation(request, next.startsWith('CP-') ? next : `CP-${next}`)}`
      : error;
    const repaired = await this.rebound(request, diagnostic, async () => {
      const verdict = await this.validate(request);
      return { ok: verdict.ok, diagnostic: verdict.error ?? '' };
    });
    if (repaired) { return true; }
    const finalValidation = await this.validate(request);
    if (finalValidation.ok) { return true; }
    this.manualCheckpointAction(request, finalValidation.error ?? diagnostic);
    return false;
  }

  private async repairHandoff(request: ExecuteHandoffRequest, holder: { result: HandoffRunResult }): Promise<void> {
    const error = holder.result.error ?? 'unknown';
    const diagnostic = [error, holder.result.gateOutput?.stdout, holder.result.gateOutput?.stderr].filter(Boolean).join('\n');
    const classification = this._ports.handoff.classifyFailure(error);
    if (classification?.failureClass === 'GitBlockers' || classification?.dispatchAction === 'HumanOnly' || !classification) {
      this._ports.output.log(`\nAutomated handoff failed: ${error}`);
      this._ports.output.log('Attempting post-execute repair...');
      const repair = await this._ports.handoff.repairHygiene({
        ...request, error, log: this._ports.output.log, outputError: this._ports.output.error,
      });
      if (repair.repaired) { this._ports.output.log('Repair successful. Retrying automated handoff...'); holder.result = await this._ports.handoff.run({ ...request, force: true }); return; }
      if (repair.blocker) { holder.result = { ...holder.result, error: repair.blocker }; }
      else if (this._ports.handoff.isRelaunchableFailure(error)) {
        this._ports.output.log('Content error detected. Attempting agent relaunch to fix...');
        await this.rebound(request, error, async () => {
          holder.result = await this._ports.handoff.run({ ...request, force: true });
          return { ok: holder.result.ok, diagnostic: holder.result.error ?? '' };
        });
        if (!holder.result.ok) { holder.result = { ...holder.result, error: `Post-relaunch handoff failed: ${holder.result.error ?? 'unknown'}` }; }
      }
      return;
    }
    this._ports.output.log(`\nRelaunchable error detected (${classification.failureClass}). Bouncing to the implementer...`);
    const reason: ReboundReason = holder.result.gateFailure ?? { kind: 'handoff-verification', error, gateOutput: diagnostic };
    await this.rebound(request, reason, async () => {
      holder.result = await this._ports.handoff.run({ ...request, force: true });
      return { ok: holder.result.ok, diagnostic: holder.result.error ?? '', reason: holder.result.gateFailure };
    });
    if (!holder.result.ok) { holder.result = { ...holder.result, error: `Gate failure persisting after ${DEFAULT_REBOUND_ATTEMPTS} relaunch attempts. Manual intervention required.` }; }
  }

  private async rebound(request: ExecuteHandoffRequest, reason: ReboundReason | string, verify: () => Promise<VerifyResult>): Promise<boolean> {
    const reboundReason: ReboundReason = typeof reason === 'string'
      ? { kind: 'handoff-verification', error: reason }
      : reason;
    const result = await rebound(reboundReason, {
      slug: request.slug, worktree: request.worktree, implementer: request.agent,
      readHead: () => this._ports.repairLaunch.readHead(request.worktree),
      verify: async () => {
        const result = await verify();
        return { ...result, command: result.command ?? (reboundReason.kind === 'gate-failure' ? reboundReason.command : undefined) };
      },
      startAgent: async (_step, options) => this._ports.repairLaunch.launch({
        slug: request.slug, worktree: request.worktree, agent: request.agent,
        prompt: typeof options.prompt === 'function' ? options.prompt(request.agent) : String(options.prompt ?? ''),
        sessionPolicy: options.sessionPolicy,
      }) as never,
      log: this._ports.output.log, error: this._ports.output.error,
    });
    return result.outcome === 'fixed';
  }

  private fileCheckpointContinuation(request: ExecuteHandoffRequest, checkpoint: string): string {
    return `Mission ${request.slug} is incomplete: ${checkpoint}. Continue the existing execute mission in ${request.worktree} from ${checkpoint}. Complete ${checkpoint} and record its evidence, then immediately continue to every remaining declared checkpoint and mission gate. Do not exit or send a final response until every declared checkpoint has its evidence and every mission-declared gate passes, unless a mission stop rule applies or a genuine external dependency blocks progress.`;
  }

  private manualCheckpointAction(request: ExecuteHandoffRequest, error: string): void {
    this._ports.output.error(`       ${error}`);
    this._ports.output.error(`       ${this.checkpointValidationNextAction(request, error)}`);
  }

  private checkpointValidationNextAction(request: ExecuteHandoffRequest, error: string): string {
    if (isTypedCheckpointEvidenceFailure(error)) {
      const checkpoint = /Planned checkpoint evidence is missing before handoff:\s*(CP-\d+)/i.exec(error)?.[1] ?? 'CP-N';
      return buildTypedMissionRecoveryAdvice(request.slug, checkpoint);
    }
    if (/MISSION\.md.*## Checkpoints|Malformed checkpoint declaration/i.test(error)) {
      return `Update ${request.worktree}/missions/${request.slug}/MISSION.md with valid - CP N: <name> or - CP-N: <name> declarations, then re-run: ${this._ports.output.command(`px review ${request.slug} --submit`)}.`;
    }
    return `Create a checkpoint document (CP-N.md) in ${request.worktree}/missions/${request.slug} with a Goal Check table. Then re-run: ${this._ports.output.command(`px review ${request.slug} --submit`)}.`;
  }
}
