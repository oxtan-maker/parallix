import type {
  CheckpointVerificationPort,
  CheckpointGitPort,
  CheckpointLifecyclePort,
  CheckpointLifecycleAuthorizationPort,
  CheckpointMissionPort,
  CheckpointResult,
} from './ports/cli-workflows.js';

/** Interface-neutral checkpoint command request.
 * Parsed by the CLI boundary (src/interfaces/cli/) per SC3.
 * The use case receives this structured input, not raw argv. */
export interface CheckpointRequest {
  /** Explicit slug argument, or null for inferred slug. */
  readonly explicitSlug: string | null;
  /** Checkpoint name (e.g. CP-1.md). */
  readonly cpName: string;
  /** Next action description. */
  readonly nextAction: string;
}

/** Progress event emitted during checkpoint execution.
 * Allows the CLI boundary to render step progress without the use case
 * knowing about rendering details. */
export interface CheckpointProgress {
  /** Step number (1-4), or 0 for intermediate events. */
  readonly step: number;
  /** Step label for rendering. */
  readonly label: string;
  /** Event type for rendering decisions. */
  readonly type: 'start' | 'step' | 'verification-pass';
  /** Area being verified (step 1 and verification-pass only). */
  readonly area?: string;
  /** Resolved slug (start event only). */
  readonly slug?: string;
  /** Checkpoint name (start event only). */
  readonly checkpointName?: string;
}

/** CLI-independent application entry point for the checkpoint workflow.
 * Orchestrates verification, staging, commit, and lifecycle recording
 * through focused application ports. */
export class CheckpointCommandUseCase {
  constructor(
    private readonly _verification: CheckpointVerificationPort,
    private readonly _git: CheckpointGitPort,
    private readonly _lifecycle: CheckpointLifecyclePort,
    private readonly _lifecycleAuth: CheckpointLifecycleAuthorizationPort,
    private readonly _mission: CheckpointMissionPort,
  ) {}

  /** Execute checkpoint workflow. Returns structured result (no stdout/exit).
   * Accepts a typed CheckpointRequest parsed by the CLI boundary (SC3).
   * Emits progress events via onProgress callback for CLI rendering. */
  async execute(request: CheckpointRequest, onProgress?: (_event: CheckpointProgress) => void): Promise<CheckpointResult> {
    const explicitSlug = request.explicitSlug;
    const cpName = request.cpName;
    const nextAction = request.nextAction;

    if (!cpName || !nextAction) {
      return { ok: false, reason: 'mission-not-found', slug: '' };
    }

    const launchRoot = process.cwd();

    // Infer slug when not explicitly provided
    let slug = explicitSlug || this._mission.inferSlug(explicitSlug ?? undefined);
    if (!slug) {
      return { ok: false, reason: 'mission-not-found', slug: '' };
    }

    // Resolve worktree path for the mission
    const rootDir = this._mission.resolveWorktree(slug, launchRoot) || launchRoot;

    // Resolve mission directory
    const missionContext = await this._mission.resolveMission(slug, rootDir);

    if (!missionContext) {
      return { ok: false, reason: 'mission-not-found', slug };
    }

    const area = missionContext.area;
    const missionDir = missionContext.missionDir;

    // Emit start event with resolved slug for CLI rendering
    onProgress?.({ step: 0, label: '', type: 'start', slug, checkpointName: cpName });

    // Step 1: Verify
    onProgress?.({ step: 1, label: `Running verification gate for area: ${area}`, type: 'step', area });
    const verifyResult = await this._verification.runVerification(area, rootDir, missionDir);
    if (verifyResult.exitCode !== 0) {
      return {
        ok: false,
        reason: 'verification-failure',
        area: verifyResult.area,
        exitCode: verifyResult.exitCode,
        command: verifyResult.command,
      };
    }

    onProgress?.({ step: 0, label: `Verification gate passed for area: ${area}`, type: 'verification-pass', area });

    // Step 2: Stage
    onProgress?.({ step: 2, label: 'Staging all tracked changes', type: 'step' });
    this._git.stage(rootDir);

    const ignoredFiles = this._git.findIgnoredSourceFiles(rootDir);
    if (ignoredFiles.length > 0) {
      return { ok: false, reason: 'ignored-files', ignoredFiles };
    }

    // Step 3: Lifecycle authorization (before commit)
    const assignee = await this._mission.resolveTaskAssignee(slug, rootDir);
    const rejectionReason = await this._lifecycleAuth.checkLifecycleTransition(slug, cpName, assignee);
    if (rejectionReason !== null) {
      return { ok: false, reason: 'lifecycle-rejection', rejectionReason };
    }

    // Step 4: Commit
    onProgress?.({ step: 3, label: 'Committing checkpoint', type: 'step' });
    const commitMsg = `checkpoint(${slug}): ${cpName}`;
    const commitBody = `Next action: ${nextAction}`;
    const commitExitCode = await this._git.commit(rootDir, commitMsg, commitBody);
    if (commitExitCode !== 0) {
      return { ok: false, reason: 'commit-failure' };
    }

    // Step 5: Record lifecycle telemetry (non-blocking, after commit)
    await this._lifecycle.recordCheckpoint(slug, cpName, assignee);

    return { ok: true, checkpointName: cpName, nextAction, slug };
  }
}

// Re-export types for consumers
export type { CheckpointResult, CheckpointSuccess, CheckpointVerificationFailure, CheckpointIgnoredFilesFailure, CheckpointCommitFailure, CheckpointMissionNotFound, CheckpointLifecycleRejection } from './ports/cli-workflows.js';
