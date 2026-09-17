/**
 * Integrate command adapter (TASK-2512).
 *
 * The integration workflow lives in `src/application/integrate-workflow.ts`
 * and its step modules under `src/application/integrate/`. This module binds
 * the concrete mechanisms to that workflow's ports and keeps the symbols existing callers (`src/composition/create-cli.ts`,
 * `src/composition/application-services.ts`) and the characterization suites
 * import. It sequences nothing.
 */
import { createIntegrateWorkflow } from '../../../application/integrate-workflow.js';
import fs from 'node:fs';
import { spawnSync } from '../../process/process-runner.js';
import * as git from '../../git/git.js';
import * as backlog from '../../backlog/backlog.js';
import * as stateMap from '../../config/state-map.js';
import * as forgejo from '../../forgejo/forgejo.js';
import * as github from '../../github/github-pr.js';
import * as missionUtils from '../../filesystem/mission-utils.js';
import { getPrimaryWorktree } from '../../filesystem/mission-utils.js';
import * as verification from '../../verification/verification.js';
import * as agents from '../../agents/agents.js';
import * as runtimeMatrix from '../../agents/runtime-matrix.js';
import * as productConfig from '../../config/product-config.js';
import * as reviewState from '../../review/review-state.js';
import * as reviewCommands from '../../review/review-commands.js';
import * as reviewLoop from '../../review/review-loop.js';
import * as reviewAdapter from '../../review/review-adapter.js';
import * as rebaseWorkflow from '../../rebase/rebase-workflow-adapter.js';
import * as repositoryGates from '../../config/repository-gates.js';
import * as gates from './integrate-gates.js';
import * as integrationGateRebound from './integrate-gate-rebound.js';
import * as conflict from './integrate-conflict.js';
import * as post from './integrate-post.js';
import type { IntegrateGitRunner, IntegrateWorkflowPorts } from '../../../application/ports/integrate-workflow.js';

/** The verification adapter's runner type also names the spawn `signal`; the port's runner result omits it. */
const asGitFn = (runner: IntegrateGitRunner) => runner as unknown as NonNullable<Parameters<typeof verification.assertVerifiedTreeProof>[2]>['gitRunner'];

/**
 * Bind the concrete mechanisms to the workflow ports. Every method reaches its
 * module through the imported namespace *at call time*, so a test that swaps a
 * dependency of this module (see `test/lib/module-mock.ts`) is observed by the
 * workflow — the `createHandoffPorts` pattern.
 */
export function createIntegratePorts(): IntegrateWorkflowPorts {
  return {
    process: {
      terminate: code => process.exit(code),
    },
    fileSystem: {
      existsSync: target => fs.existsSync(target),
      isSymbolicLink: target => fs.lstatSync(target).isSymbolicLink(),
    },
    git: {
      git: args => git.git(args),
      getCurrentBranch: () => git.getCurrentBranch(),
      detectRebaseState: rootDir => git.detectRebaseState(rootDir),
    },
    backlog: {
      resolveTaskFile: (slug, rootDir) => backlog.resolveTaskFile(slug, rootDir),
      setTaskStatus: (taskFile, status) => backlog.setTaskStatus(taskFile, status),
      completeTask: (slug, rootDir) => backlog.completeTask(slug, rootDir),
      checkBacklogIntegrity: rootDir => backlog.checkBacklogIntegrity(rootDir),
      getTaskAssignee: taskFile => backlog.getTaskAssignee(taskFile) as string | null,
      getTaskClassification: taskFile => backlog.getTaskClassification(taskFile) as string | null,
      classificationFromLabels: labels => backlog.classificationFromLabels(labels as string[]) as string | null,
      classificationLabels: () => backlog.CLASSIFICATION_LABELS,
      transitionTask: (slug, status) => backlog.transitionTask(slug, status),
    },
    stateMap: {
      toVirtual: (state, map) => stateMap.toVirtual(state, map),
      toActual: (state, map) => stateMap.toActual(state, map),
    },
    forgejo: {
      getPrStatus: (branch, rootDir, options) => forgejo.getPrStatus(branch, rootDir, options),
      getLatestReviewDecision: (branch, options) => forgejo.getLatestReviewDecision(branch, options),
      syncMerged: (branch, commit, options) => forgejo.syncMerged(branch, commit, options),
      readToken: user => forgejo.readToken(user),
      resolveTokenFile: user => forgejo.resolveTokenFile(user),
      listOpenPrsForSlug: (baseSlug, token) => forgejo.listOpenPrsForSlug(baseSlug, token),
    },
    github: {
      submitOrObserveGithubPr: (expected, rootDir) => github.submitOrObserveGithubPr(expected, rootDir),
    },
    missionPaths: {
      inferSlug: explicitSlug => missionUtils.inferSlug(explicitSlug),
      findMissionDir: slug => missionUtils.findMissionDir(slug),
      findMissionArea: missionDir => missionUtils.findMissionArea(missionDir),
      missionTitle: slug => missionUtils.missionTitle(slug),
      missionBranchName: (slug, rootDir) => missionUtils.missionBranchName(slug, rootDir ?? undefined),
      missionDirForSlug: (rootDir, slug) => missionUtils.missionDirForSlug(rootDir, slug),
      getPrimaryWorktree: () => missionUtils.getPrimaryWorktree(),
      getPrimaryBranch: () => missionUtils.getPrimaryBranch(),
      conventionalWorktreePath: slug => missionUtils.conventionalWorktreePath(slug),
      resolveMissionBaseBranch: (slug, rootDir) => missionUtils.resolveMissionBaseBranch(slug, rootDir),
      resolveBaseWorktree: (slug, options) => missionUtils.resolveBaseWorktree(slug, options),
      resolveWorktree: (slug, options) => missionUtils.resolveWorktree(slug, options),
      findMissionDocInBranches: (slug, rootDir) => missionUtils.findMissionDocInBranches(slug, rootDir),
      parseConflictFilesFromMergeOutput: output => missionUtils.parseConflictFilesFromMergeOutput(output),
      softResetTrailingBacklogNoise: (rootDir, gitRunner) => missionUtils.softResetTrailingBacklogNoise(rootDir, gitRunner),
    },
    verification: {
      formatVerificationCommand: (area, rootDir) => verification.formatVerificationCommand(area, rootDir),
      captureVerifiedTreeProof: (area, rootDir, gitRunner) => verification.captureVerifiedTreeProof(area, rootDir, { gitRunner: asGitFn(gitRunner), runFn: spawnSync }),
      assertVerifiedTreeProof: (proof, rootDir, gitRunner) => verification.assertVerifiedTreeProof(proof, rootDir, { gitRunner: asGitFn(gitRunner) }),
    },
    agents: {
      startAgent: (step, options) => agents.startAgent(step, options as unknown as Parameters<typeof agents.startAgent>[1]),
      selectAgent: step => agents.selectAgent(step),
      workflowLauncherStatus: (agent, rootDir) => agents.workflowLauncherStatus(agent, rootDir),
      applyAgentFallback: options => reviewLoop.applyAgentFallback(options as Parameters<typeof reviewLoop.applyAgentFallback>[0]),
      describeReviewMatrix: () => runtimeMatrix.formatMatrixSummary(runtimeMatrix.buildAutonomousReviewMatrix()),
    },
    productConfig: {
      isForgejoReviewEnabled: rootDir => productConfig.isForgejoReviewEnabled(rootDir),
      resolveIntegrationMode: rootDir => productConfig.resolveIntegrationMode(rootDir),
    },
    review: {
      readReviewState: (slug, rootDir, missionStore) => reviewState.readReviewState(slug, rootDir, missionStore),
      submitForReview: (slug, skipGate, options) => reviewCommands.submitForReview(slug, skipGate, options),
      resolveForgejoUser: reviewer => reviewAdapter.resolveForgejoUser(reviewer),
    },
    rebase: {
      createRebaseWorkflowPort: options => rebaseWorkflow.createRebaseWorkflowPort(options),
    },
    gates: {
      loadPhaseGates: (rootDir, phase) => repositoryGates.loadPhaseGates(rootDir, phase),
      loadRequirePreIntegration: rootDir => repositoryGates.loadRequirePreIntegration(rootDir),
      runPhaseGates: (phase, options) => repositoryGates.runPhaseGates(phase, options as Parameters<typeof repositoryGates.runPhaseGates>[1]),
      captureFinalIntegrationTree: rootDir => gates.captureFinalIntegrationTree(rootDir),
      resolveIntegrationVerificationWorktree: (slug, options) => gates.resolveIntegrationVerificationWorktree(slug, options),
      isIntendedPayloadAtHead: (rootDir, paths, options) => gates.isIntendedPayloadAtHead(rootDir, paths, options),
      routeIntegrationGateFailure: options => integrationGateRebound.routeIntegrationGateFailure(options),
    },
    checkout: {
      stashMainCheckoutIfNeeded: options => conflict.stashMainCheckoutIfNeeded(options),
      restoreMainCheckoutStash: stash => conflict.restoreMainCheckoutStash(stash),
      maybeDropStashAfterCollision: (restoreResult, rootDir) => conflict.maybeDropStashAfterCollision(restoreResult, rootDir),
      reportStashPopFailure: (slug, restoreResult, options) => conflict.reportStashPopFailure(slug, restoreResult, options),
      prepareNoisePatchForSquash: (rootDir, options) => conflict.prepareNoisePatchForSquash(rootDir, options),
      restoreNoisePatchAfterSquash: (rootDir, patchPath, options) => conflict.restoreNoisePatchAfterSquash(rootDir, patchPath, options),
      getUnresolvedIndexConflicts: rootDir => conflict.getUnresolvedIndexConflicts(rootDir) as { ok: boolean; error?: string; files: string[] },
      areAllBacklogOnlyConflicts: files => conflict.areAllBacklogOnlyConflicts(files),
      findExistingSquashCommit: (rootDir, slug) => conflict.findExistingSquashCommit(rootDir, slug),
      findLandedSquashOnBaseBranch: (rootDir, slug) => conflict.findLandedSquashOnBaseBranch(rootDir, slug),
      buildConflictResolutionPrompt: (slug, area, options) => conflict.buildConflictResolutionPrompt(slug, area, options),
      rewriteWorktreePaths: (taskFile, slug, options) => conflict.rewriteWorktreePaths(taskFile, slug, options),
      maybeUpdateGraphifyOnPrimary: (rootDir, options) => conflict.maybeUpdateGraphifyOnPrimary(rootDir, options),
    },
    landing: {
      createAbort: () => new post.IntegrationAbort(),
      isAbort: error => error instanceof post.IntegrationAbort,
      classifyHookFailure: output => post.classifyHookFailure(output),
      reportSyncMergedFailure: syncResult => post.reportSyncMergedFailure(syncResult),
      resolveForgejoUserForIntegration: taskAssignee => post.resolveForgejoUserForIntegration(taskAssignee),
      isNoMergeToAbortResult: result => post.isNoMergeToAbortResult(result),
      persistLandedIntegrationOrAbort: (slug, commit, missionServices, options) => post.persistLandedIntegrationOrAbort(slug, commit, missionServices, options),
      recordPostIntegrationStatsOrAbort: (slug, options) => post.recordPostIntegrationStatsOrAbort(slug, options),
      runPreCommitHookOrAbort: (slug, options) => post.runPreCommitHookOrAbort(slug, options),
      runPostIntegrateHookOrAbort: (slug, options) => post.runPostIntegrateHookOrAbort(slug, options),
      cleanupMissionWorktree: slug => post.cleanupMissionWorktree(slug),
    },
  };
}

export type { IntegrateOptions as IntegrateCommandOptions } from '../../../application/integrate-workflow.js';

/** Single workflow instance; port methods resolve their modules at call time. */
const workflow = createIntegrateWorkflow(createIntegratePorts());

const {
  integrate,
  buildIntegrationContext,
  evaluateTaskStatusForIntegration,
  promoteTaskForIntegrationIfNeeded,
  recoverMissionForIntegration,
  buildIntegrationReadiness,
  printIntegrationReadiness,
  runIntegrationRebase,
  predictIntegrationRebase,
  parseIntegrateArgs,
  VARIANT_B_AUTOMATION_SUMMARY,
} = workflow;

export {
  maybeUpdateGraphifyOnPrimary,
  prepareNoisePatchForSquash,
  restoreNoisePatchAfterSquash,
  getUnresolvedIndexConflicts,
  areAllBacklogOnlyConflicts,
  parseStashPopCollisionFiles,
  maybeDropStashAfterCollision,
  reportStashPopFailure,
  rewriteWorktreePaths,
  stashMainCheckoutIfNeeded,
  restoreMainCheckoutStash,
  findExistingSquashCommit,
  findLandedSquashOnBaseBranch,
  resolveConflictsForMission,
  buildConflictResolutionPrompt,
} from './integrate-conflict.js';

export {
  IntegrationAbort,
  classifyHookFailure,
  SYNC_MERGED_DIAGNOSTICS,
  printDiagnosticTable,
  reportSyncMergedFailure,
  formatRecordedStatsRow,
  shellQuote,
  resolveForgejoUserForIntegration,
  isNoMergeToAbortResult,
  recordPostIntegrationStats,
  recordPostIntegrationStatsOrAbort,
  persistLandedIntegrationOrAbort,
  runPostIntegrateHookOrAbort,
  runPreCommitHookOrAbort,
  cleanupMissionWorktree,
} from './integrate-post.js';

export {
  detectChangedAreas,
  isIntendedPayloadAtHead,
  parseFilesToAreas,
  orderIntegrationGates,
  gateMatchesChangedAreas,
  loadIntegrationConfig,
  getIntegrationGatePlan,
  printIntegrationGatePlan,
  buildIntegrationGateEnv,
  captureFinalIntegrationTree,
  resolveIntegrationVerificationWorktree,
  buildIntegrationVerificationInvocation,
  executeIntegrationGates,
} from './integrate-gates.js';

/**
 * The preflight option seams stay typed against the concrete adapter functions
 * they default to, so a partial test double is still a type error here rather
 * than silently accepted through the port's structural types.
 */
function printIntegrationPreflight(context: any, options: {
  readTokenFn?: typeof forgejo.readToken,
  resolveTokenFileFn?: typeof forgejo.resolveTokenFile,
  detectRebaseStateFn?: typeof git.detectRebaseState,
  getUnresolvedIndexConflictsFn?: typeof conflict.getUnresolvedIndexConflicts,
  findMissionDocInBranchesFn?: typeof missionUtils.findMissionDocInBranches,
  isForgejoReviewEnabledFn?: typeof productConfig.isForgejoReviewEnabled,
  gitFn?: typeof git.git,
  // Matches `fmt.log.plain`, the production default the workflow uses.
  log?: (_text: string) => string | null,
} = {}) {
  return workflow.printIntegrationPreflight(context, options as Parameters<typeof workflow.printIntegrationPreflight>[1]);
}

// The default export also carries the named symbols as properties, mirroring
// the original CommonJS shape for callers that reach them through `default`.
Object.assign(integrate, {
  resolveConflictsForMission: conflict.resolveConflictsForMission,
  rewriteWorktreePaths: conflict.rewriteWorktreePaths,
  buildConflictResolutionPrompt: conflict.buildConflictResolutionPrompt,
  stashMainCheckoutIfNeeded: conflict.stashMainCheckoutIfNeeded,
  restoreMainCheckoutStash: conflict.restoreMainCheckoutStash,
  findExistingSquashCommit: conflict.findExistingSquashCommit,
  getUnresolvedIndexConflicts: conflict.getUnresolvedIndexConflicts,
  parseStashPopCollisionFiles: conflict.parseStashPopCollisionFiles,
  reportStashPopFailure: conflict.reportStashPopFailure,
  maybeUpdateGraphifyOnPrimary: conflict.maybeUpdateGraphifyOnPrimary,
  prepareNoisePatchForSquash: conflict.prepareNoisePatchForSquash,
  areAllBacklogOnlyConflicts: conflict.areAllBacklogOnlyConflicts,
  cleanupMissionWorktree: post.cleanupMissionWorktree,
  isNoMergeToAbortResult: post.isNoMergeToAbortResult,
  resolveForgejoUserForIntegration: post.resolveForgejoUserForIntegration,
  SYNC_MERGED_DIAGNOSTICS: post.SYNC_MERGED_DIAGNOSTICS,
  printDiagnosticTable: post.printDiagnosticTable,
  reportSyncMergedFailure: post.reportSyncMergedFailure,
  recordPostIntegrationStats: post.recordPostIntegrationStats,
  recordPostIntegrationStatsOrAbort: post.recordPostIntegrationStatsOrAbort,
  runPostIntegrateHookOrAbort: post.runPostIntegrateHookOrAbort,
  runPreCommitHookOrAbort: post.runPreCommitHookOrAbort,
  formatRecordedStatsRow: post.formatRecordedStatsRow,
  classifyHookFailure: post.classifyHookFailure,
  detectChangedAreas: gates.detectChangedAreas,
  parseFilesToAreas: gates.parseFilesToAreas,
  loadIntegrationConfig: gates.loadIntegrationConfig,
  getIntegrationGatePlan: gates.getIntegrationGatePlan,
  printIntegrationGatePlan: gates.printIntegrationGatePlan,
  buildIntegrationGateEnv: gates.buildIntegrationGateEnv,
  captureFinalIntegrationTree: gates.captureFinalIntegrationTree,
  resolveIntegrationVerificationWorktree: gates.resolveIntegrationVerificationWorktree,
  buildIntegrationVerificationInvocation: gates.buildIntegrationVerificationInvocation,
  executeIntegrationGates: gates.executeIntegrationGates,
  orderIntegrationGates: gates.orderIntegrationGates,
  gateMatchesChangedAreas: gates.gateMatchesChangedAreas,
  VARIANT_B_AUTOMATION_SUMMARY,
  evaluateTaskStatusForIntegration,
  promoteTaskForIntegrationIfNeeded,
  recoverMissionForIntegration,
  printIntegrationPreflight,
  parseIntegrateArgs,
  buildIntegrationContext,
  getPrimaryWorktree,
  predictIntegrationRebase,
  runIntegrationRebase,
});

export default integrate;
export {
  integrate,
  parseIntegrateArgs,
  buildIntegrationContext,
  getPrimaryWorktree,
  VARIANT_B_AUTOMATION_SUMMARY,
  evaluateTaskStatusForIntegration,
  promoteTaskForIntegrationIfNeeded,
  recoverMissionForIntegration,
  printIntegrationPreflight,
  runIntegrationRebase,
  predictIntegrationRebase,
  buildIntegrationReadiness,
  printIntegrationReadiness,
};
