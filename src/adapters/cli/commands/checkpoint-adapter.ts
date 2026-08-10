/** Concrete implementations of the focused checkpoint ports.
 * Wires existing git, backlog, verification, and lifecycle adapters
 * into the focused checkpoint ports owned by the application layer. */

import type {
  CheckpointVerificationPort,
  CheckpointVerificationResult,
  CheckpointGitPort,
  CheckpointLifecyclePort,
  CheckpointLifecycleAuthorizationPort,
  CheckpointMissionPort,
} from '../../../application/ports/cli-workflows.js';
import { git, run, findIgnoredSourceFiles } from '../../git/git.js';
import { getTaskAssignee, recordLifecycleOperation, resolveTaskFile } from '../../backlog/backlog.js';
import { findMissionDir, findMissionArea, inferSlug, resolveWorktree } from '../../filesystem/mission-utils.js';
import { formatVerificationCommand, recordGateResult, runVerificationGate } from '../../verification/verification.js';

// ---------------------------------------------------------------------------
// Verification port
// ---------------------------------------------------------------------------

export function createCheckpointVerificationAdapter(
  options: { runVerificationGateFn?: typeof runVerificationGate; formatVerificationCommandFn?: typeof formatVerificationCommand; recordGateResultFn?: typeof recordGateResult; runFn?: typeof run } = {},
): CheckpointVerificationPort {
  const runVerificationGateFn = options.runVerificationGateFn || runVerificationGate;
  const formatVerificationCommandFn = options.formatVerificationCommandFn || formatVerificationCommand;
  const recordGateResultFn = options.recordGateResultFn || recordGateResult;
  const runFn = options.runFn || run;

  return {
    async runVerification(area: string, rootDir: string, missionDir: string): Promise<CheckpointVerificationResult> {
      const command = formatVerificationCommandFn(area, rootDir);
      const verifyResult = runVerificationGateFn(area, { rootDir, stdio: 'inherit', runFn: runFn });
      // Persist gate observation to operator-local state
      recordGateResultFn(missionDir, {
        area,
        command,
        exitCode: verifyResult.status,
      });
      return {
        exitCode: verifyResult.status as number,
        area,
        command,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Git port
// ---------------------------------------------------------------------------

export function createCheckpointGitAdapter(
  options: { gitFn?: typeof git; findIgnoredSourceFilesFn?: typeof findIgnoredSourceFiles } = {},
): CheckpointGitPort {
  const gitFn = options.gitFn || git;
  const findIgnoredSourceFilesFn = options.findIgnoredSourceFilesFn || findIgnoredSourceFiles;

  return {
    stage(rootDir: string): void {
      gitFn(['-C', rootDir, 'add', '-A']);
    },

    findIgnoredSourceFiles(rootDir: string): readonly string[] {
      return findIgnoredSourceFilesFn(rootDir);
    },

    async commit(rootDir: string, message: string, body: string): Promise<number> {
      const result = gitFn(['-C', rootDir, 'commit', '-m', message, '-m', body]);
      return result.status as number;
    },
  };
}

// ---------------------------------------------------------------------------
// Lifecycle port
// ---------------------------------------------------------------------------

export function createCheckpointLifecycleAdapter(
  options: { recordLifecycleOperationFn?: typeof recordLifecycleOperation } = {},
): CheckpointLifecyclePort {
  const recordLifecycleOperationFn = options.recordLifecycleOperationFn || recordLifecycleOperation;

  return {
    async recordCheckpoint(slug: string, cpName: string, agent: string | null): Promise<void> {
      // Non-blocking telemetry — recordLifecycleOperation returns boolean
      // but a failure (false) does not abort the checkpoint.
      await recordLifecycleOperationFn(slug, {
        trigger: 'checkpoint',
        toStatus: cpName,
        agent,
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Lifecycle authorization port
// ---------------------------------------------------------------------------

export function createCheckpointLifecycleAuthorizationAdapter(
  options: { checkLifecycleTransitionFn?: (_slug: string, _cpName: string, _agent: string | null) => Promise<string | null> } = {},
): CheckpointLifecycleAuthorizationPort {
  const checkLifecycleTransitionFn = options.checkLifecycleTransitionFn || defaultCheckLifecycleTransition;

  return {
    async checkLifecycleTransition(slug: string, cpName: string, agent: string | null): Promise<string | null> {
      return checkLifecycleTransitionFn(slug, cpName, agent);
    },
  };
}

/** Default authorization: always allow (null = authorized).
 * Checkpoints have no lifecycle transition in the domain model
 * (MissionCommand has no 'checkpoint' type). The rejection path
 * exists for testability (SC4) and for future authorization policy.
 * Telemetry recording is handled separately by CheckpointLifecyclePort. */
async function defaultCheckLifecycleTransition(
  _slug: string, _cpName: string, _agent: string | null,
): Promise<string | null> {
  return null;
}

// ---------------------------------------------------------------------------
// Mission port
// ---------------------------------------------------------------------------

export function createCheckpointMissionAdapter(
  options: {
    inferSlugFn?: typeof inferSlug;
    resolveWorktreeFn?: typeof resolveWorktree;
    findMissionDirFn?: typeof findMissionDir;
    findMissionAreaFn?: typeof findMissionArea;
    resolveTaskFileFn?: typeof resolveTaskFile;
    getTaskAssigneeFn?: typeof getTaskAssignee;
  } = {},
): CheckpointMissionPort {
  const inferSlugFn = options.inferSlugFn || inferSlug;
  const resolveWorktreeFn = options.resolveWorktreeFn || resolveWorktree;
  const findMissionDirFn = options.findMissionDirFn || findMissionDir;
  const findMissionAreaFn = options.findMissionAreaFn || findMissionArea;
  const resolveTaskFileFn = options.resolveTaskFileFn || resolveTaskFile;
  const getTaskAssigneeFn = options.getTaskAssigneeFn || getTaskAssignee;

  return {
    inferSlug(explicit?: string): string | null {
      return inferSlugFn(explicit);
    },

    resolveWorktree(slug: string, cwd: string): string | null {
      return resolveWorktreeFn(slug, { cwd });
    },

    async resolveMission(slug: string, rootDir: string): Promise<{ missionDir: string; area: string } | null> {
      const missionDir = findMissionDirFn(slug, rootDir);
      if (!missionDir) {
        return null;
      }
      return { missionDir, area: findMissionAreaFn(missionDir) };
    },

    async resolveTaskAssignee(slug: string, rootDir: string): Promise<string | null> {
      const taskResolution = resolveTaskFileFn(slug, rootDir);
      if (!taskResolution.ok || !taskResolution.taskFile) {
        return null;
      }
      return getTaskAssigneeFn(taskResolution.taskFile);
    },
  };
}

// ---------------------------------------------------------------------------
// Legacy: composite adapter for backward compatibility
// ---------------------------------------------------------------------------

import type { CheckpointWorkflowPort, CheckpointResult } from '../../../application/ports/cli-workflows.js';

export interface CheckpointWorkflowAdapterOptions {
  readonly inferSlugFn?: (_explicit?: string) => string | null;
  readonly resolveWorktreeFn?: (_slug: string, _opts?: { cwd: string }) => string | null;
  readonly findMissionDirFn?: (_slug: string, _rootDir: string) => string | null;
  readonly findMissionAreaFn?: (_missionDir: string) => string;
  readonly runVerificationGateFn?: typeof runVerificationGate;
  readonly formatVerificationCommandFn?: typeof formatVerificationCommand;
  readonly recordGateResultFn?: typeof recordGateResult;
  readonly gitFn?: typeof git;
  readonly runFn?: typeof run;
  readonly findIgnoredSourceFilesFn?: typeof findIgnoredSourceFiles;
  readonly resolveTaskFileFn?: typeof resolveTaskFile;
  readonly getTaskAssigneeFn?: typeof getTaskAssignee;
  readonly recordLifecycleOperationFn?: typeof recordLifecycleOperation;
}

/** Create a composite CheckpointWorkflowPort (legacy, used by tests that mock the whole workflow). */
export function createCheckpointWorkflowAdapter(options: CheckpointWorkflowAdapterOptions = {}): CheckpointWorkflowPort {
  const inferSlugFn = options.inferSlugFn || inferSlug;
  const resolveWorktreeFn = options.resolveWorktreeFn || resolveWorktree;
  const findMissionDirFn = options.findMissionDirFn || findMissionDir;
  const findMissionAreaFn = options.findMissionAreaFn || findMissionArea;
  const runVerificationGateFn = options.runVerificationGateFn || runVerificationGate;
  const formatVerificationCommandFn = options.formatVerificationCommandFn || formatVerificationCommand;
  const recordGateResultFn = options.recordGateResultFn || recordGateResult;
  const gitFn = options.gitFn || git;
  const runFn = options.runFn || run;
  const findIgnoredSourceFilesFn = options.findIgnoredSourceFilesFn || findIgnoredSourceFiles;
  const resolveTaskFileFn = options.resolveTaskFileFn || resolveTaskFile;
  const getTaskAssigneeFn = options.getTaskAssigneeFn || getTaskAssignee;
  const recordLifecycleOperationFn = options.recordLifecycleOperationFn || recordLifecycleOperation;

  return {
    async executeCheckpoint(args: string[]): Promise<CheckpointResult> {
      const params = args.filter(a => !a.startsWith('--'));
      let [explicitSlug, cpName, nextAction] = params;

      let slug = inferSlugFn(explicitSlug);
      if (slug && explicitSlug !== slug) {
        nextAction = cpName;
        cpName = explicitSlug;
      }

      if (!slug || !cpName || !nextAction) {
        return { ok: false, reason: 'mission-not-found', slug: slug || '' };
      }

      const launchRoot = process.cwd();
      const rootDir = resolveWorktreeFn(slug, { cwd: launchRoot }) || launchRoot;

      const missionDir = findMissionDirFn(slug, rootDir);
      if (!missionDir) {
        return { ok: false, reason: 'mission-not-found', slug };
      }

      const area = findMissionAreaFn(missionDir);

      const verifyResult = runVerificationGateFn(area, { rootDir, stdio: 'inherit', runFn });
      recordGateResultFn(missionDir, {
        area,
        command: formatVerificationCommandFn(area, rootDir),
        exitCode: verifyResult.status,
      });
      if (verifyResult.status !== 0) {
        return {
          ok: false,
          reason: 'verification-failure',
          area,
          exitCode: verifyResult.status as number,
          command: formatVerificationCommandFn(area, rootDir),
        };
      }

      gitFn(['-C', rootDir, 'add', '-A']);

      const ignoredSourceFiles = findIgnoredSourceFilesFn(rootDir);
      if (ignoredSourceFiles.length > 0) {
        return { ok: false, reason: 'ignored-files', ignoredFiles: ignoredSourceFiles };
      }

      const commitMsg = `checkpoint(${slug}): ${cpName}`;
      const commitBody = `Next action: ${nextAction}`;
      const commitResult = gitFn(['-C', rootDir, 'commit', '-m', commitMsg, '-m', commitBody]);
      if (commitResult.status !== 0) {
        return { ok: false, reason: 'commit-failure' };
      }

      const taskResolution = resolveTaskFileFn(slug, rootDir);
      const assignee = taskResolution.ok && taskResolution.taskFile
        ? getTaskAssigneeFn(taskResolution.taskFile)
        : null;
      await recordLifecycleOperationFn(slug, {
        trigger: 'checkpoint',
        toStatus: cpName,
        agent: assignee,
      });

      return { ok: true, checkpointName: cpName, nextAction, slug };
    },
  };
}
