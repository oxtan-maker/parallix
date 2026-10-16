import { createIntegrationVerificationEvidencePort } from '../../verification/integration-verification-proof.js';
import type { ParallixConfiguration } from '../../../application/ports/configuration.js';
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
import crypto from 'node:crypto';
import * as git from '../../git/git.js';
import * as backlog from '../../backlog/backlog.js';
import * as stateMap from '../../config/state-map.js';
import * as forgejo from '../../forgejo/forgejo.js';
import * as github from '../../github/github-pr.js';
import * as missionUtils from '../../filesystem/mission-utils.js';
import { getPrimaryWorktree } from '../../filesystem/mission-utils.js';
import { claimRecoveryLock } from '../../filesystem/recovery-claim.js';
import * as verification from '../../verification/verification.js';
import * as agents from '../../agents/agents.js';
import * as runtimeMatrix from '../../agents/runtime-matrix.js';
import * as productConfig from '../../config/product-config.js';
import * as reviewState from '../../review/review-state.js';
import * as reviewCommands from '../../review/review-commands.js';
import { applyAgentFallback } from '../../review/review-agent-fallback.js';
import * as reviewAdapter from '../../review/review-adapter.js';
import * as rebaseWorkflow from '../../rebase/rebase-workflow-adapter.js';
import * as repositoryGates from '../../config/repository-gates.js';
import * as gates from './integrate-gates.js';
import * as integrationGateRebound from './integrate-gate-rebound.js';
import * as conflict from './integrate-conflict.js';
import * as post from './integrate-post.js';
import type { IntegrateWorkflowPorts } from '../../../application/ports/integrate-workflow.js';

/**
 * Bind the concrete mechanisms to the workflow ports. Every method reaches its
 * module through the imported namespace *at call time*, so a test that swaps a
 * dependency of this module (see `test/lib/module-mock.ts`) is observed by the
 * workflow — the `createHandoffPorts` pattern.
 */
export function createIntegratePorts(configuration?: ParallixConfiguration): IntegrateWorkflowPorts {
  const runIntegrationGates: typeof repositoryGates.runPhaseGates = (phase, options) => repositoryGates.runPhaseGates(phase, {
    ...options, configuration, verificationEvidence: createIntegrationVerificationEvidencePort(configuration),
  });
  return {
    process: composeIntegrationProcess(configuration),
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
      getPrStatus: (branch, rootDir, options) => forgejo.getPrStatus(branch, rootDir, { ...options, configuration }),
      getLatestReviewDecision: (branch, options) => forgejo.getLatestReviewDecision(branch, { ...options, configuration }),
      syncMerged: (branch, commit, options) => forgejo.syncMerged(branch, commit, { ...options, configuration }),
      readToken: user => forgejo.readToken(user, undefined, configuration),
      resolveTokenFile: user => forgejo.resolveTokenFile(user, undefined, configuration),
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
      getPrimaryWorktree: () => missionUtils.getPrimaryWorktree(configuration),
      getPrimaryBranch: () => missionUtils.getPrimaryBranch(),
      conventionalWorktreePath: slug => missionUtils.conventionalWorktreePath(slug, missionUtils.getPrimaryWorktree(configuration)),
      resolveMissionBaseBranch: (slug, rootDir) => missionUtils.resolveMissionBaseBranch(slug, rootDir),
      resolveBaseWorktree: (slug, options) => missionUtils.resolveBaseWorktree(slug, { ...options, configuration }),
      resolveWorktree: (slug, options) => missionUtils.resolveWorktree(slug, options),
      findMissionDocInBranches: (slug, rootDir) => missionUtils.findMissionDocInBranches(slug, rootDir),
      parseConflictFilesFromMergeOutput: output => missionUtils.parseConflictFilesFromMergeOutput(output),
      softResetTrailingBacklogNoise: (rootDir, gitRunner) => missionUtils.softResetTrailingBacklogNoise(rootDir, gitRunner),
    },
    verification: {
      formatVerificationCommand: (area, rootDir) => verification.formatVerificationCommand(area, rootDir),
    },
    agents: {
      startAgent: (step, options) => agents.startAgent(step, { ...options, configuration }),
      selectAgent: step => agents.selectAgent(step, { configuration }),
      workflowLauncherStatus: (agent, rootDir) => agents.workflowLauncherStatus(agent, rootDir, configuration),
      applyAgentFallback: options => applyAgentFallback(options as Parameters<typeof applyAgentFallback>[0]),
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
      createRebaseWorkflowPort: options => rebaseWorkflow.createRebaseWorkflowPort({ ...options, configuration }),
    },
    gates: {
      loadPhaseGates: (rootDir, phase) => repositoryGates.loadPhaseGates(rootDir, phase),
      loadRequirePreIntegration: rootDir => repositoryGates.loadRequirePreIntegration(rootDir),
      runPhaseGates: (phase, options) => runIntegrationGates(phase, options),
      captureFinalIntegrationTree: rootDir => gates.captureFinalIntegrationTree(rootDir),
      listChangedPathsBetween: (rootDir, fromCommit, toCommit) => gates.listChangedPathsBetween(rootDir, fromCommit, toCommit),
      resolveIntegrationVerificationWorktree: (slug, options) => gates.resolveIntegrationVerificationWorktree(slug, options),
      isIntendedPayloadAtHead: (rootDir, paths, options) => gates.isIntendedPayloadAtHead(rootDir, paths, options),
      routeIntegrationGateFailure: options => integrationGateRebound.routeIntegrationGateFailure({ ...options, runPhaseGatesFn: runIntegrationGates }),
    },
    checkout: composeIntegrationCheckout(),
    landing: composeIntegrationLanding(configuration),
  };
}

function composeIntegrationProcess(configuration: ParallixConfiguration | undefined): IntegrateWorkflowPorts['process'] {
  return {
    terminate: code => process.exit(code),
    cwd: () => process.cwd(),
    chdir: directory => process.chdir(directory),
    claimBaseMutation: async (base, branch) => {
      const key = crypto.createHash('sha256').update(`${base}\0${branch}`).digest('hex');
      return claimRecoveryLock(`integration-base-${key}`);
    },
    claimIntegration: async slug => {
      const rootKey = crypto.createHash('sha256').update(getPrimaryWorktree(configuration)).digest('hex').slice(0, 16);
      return claimRecoveryLock(`integrate-${rootKey}-${slug}`);
    },
  };
}

function composeIntegrationCheckout(): IntegrateWorkflowPorts['checkout'] {
  return {
    stashMainCheckoutIfNeeded: options => conflict.stashMainCheckoutIfNeeded(options),
    restoreMainCheckoutStash: stash => conflict.restoreMainCheckoutStash(stash),
    maybeDropStashAfterCollision: (restoreResult, rootDir) => conflict.maybeDropStashAfterCollision(restoreResult, rootDir),
    reportStashPopFailure: (slug, restoreResult, options) => conflict.reportStashPopFailure(slug, restoreResult, options),
    prepareNoisePatchForSquash: (rootDir, options) => conflict.prepareNoisePatchForSquash(rootDir, options),
    restoreNoisePatchAfterSquash: (rootDir, patchPath, options) => conflict.restoreNoisePatchAfterSquash(rootDir, patchPath, options),
    getUnresolvedIndexConflicts: rootDir => conflict.getUnresolvedIndexConflicts(rootDir),
    areAllBacklogOnlyConflicts: files => conflict.areAllBacklogOnlyConflicts(files),
    findExistingSquashCommit: (rootDir, slug) => conflict.findExistingSquashCommit(rootDir, slug),
    findLandedSquashOnBaseBranch: (rootDir, slug) => conflict.findLandedSquashOnBaseBranch(rootDir, slug),
    buildConflictResolutionPrompt: (slug, area, options) => conflict.buildConflictResolutionPrompt(slug, area, options),
    rewriteWorktreePaths: (taskFile, slug, options) => conflict.rewriteWorktreePaths(taskFile, slug, options),
  };
}

function composeIntegrationLanding(configuration: ParallixConfiguration | undefined): IntegrateWorkflowPorts['landing'] {
  return {
    updateGraphifyRepository: rootDir => missionUtils.updateGraphifyKnowledgeGraph({ rootDir, configuration, failureHint: 'Continuing without blocking integration.' }),
    createAbort: () => new post.IntegrationAbort(),
    isAbort: error => error instanceof post.IntegrationAbort,
    classifyHookFailure: output => post.classifyHookFailure(output),
    reportSyncMergedFailure: syncResult => post.reportSyncMergedFailure(syncResult),
    resolveForgejoUserForIntegration: taskAssignee => post.resolveForgejoUserForIntegration(taskAssignee),
    isNoMergeToAbortResult: result => post.isNoMergeToAbortResult(result),
    persistLandedIntegrationOrAbort: (slug, commit, missionServices, options) => post.persistLandedIntegrationOrAbort(slug, commit, missionServices, options),
    closeLandedIntegrationOrAbort: (slug, commit, missionServices) => post.closeLandedIntegrationOrAbort(slug, commit, missionServices),
    recordPostIntegrationStatsOrAbort: (slug, options) => post.recordPostIntegrationStatsOrAbort(slug, { ...options, configuration }),
    hasIntegrationMeasurement: (slug, rootDir) => post.hasIntegrationMeasurement(slug, rootDir),
    runPreCommitHookOrAbort: (slug, options) => post.runPreCommitHookOrAbort(slug, options),
    runPostIntegrateHookOrAbort: (slug, options) => post.runPostIntegrateHookOrAbort(slug, options),
    cleanupMissionWorktree: slug => post.cleanupMissionWorktree(slug, { rootDir: missionUtils.getPrimaryWorktree(configuration), configuration }),
  };
}

export type { IntegrateOptions as IntegrateCommandOptions } from '../../../application/integrate-workflow.js';

/** Single workflow instance; port methods resolve their modules at call time. */
const workflow = createIntegrateWorkflow(createIntegratePorts());

const {
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

async function integrate(args: string[], options: import('../../../application/integrate-workflow.js').IntegrateOptions = {}) {
  return createIntegrateWorkflow(createIntegratePorts(options.configuration)).integrate(args, options);
}

export {
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
  closeLandedIntegrationOrAbort,
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
function printIntegrationPreflight(context: Parameters<typeof workflow.printIntegrationPreflight>[0], options: {
  configuration?: ParallixConfiguration;
  readTokenFn?: typeof forgejo.readToken,
  resolveTokenFileFn?: typeof forgejo.resolveTokenFile,
  detectRebaseStateFn?: typeof git.detectRebaseState,
  getUnresolvedIndexConflictsFn?: typeof conflict.getUnresolvedIndexConflicts,
  findMissionDocInBranchesFn?: typeof missionUtils.findMissionDocInBranches,
  conventionalWorktreePathFn?: typeof missionUtils.conventionalWorktreePath,
  isForgejoReviewEnabledFn?: typeof productConfig.isForgejoReviewEnabled,
  gitFn?: typeof git.git,
  // Matches `fmt.log.plain`, the production default the workflow uses.
  log?: (_text: string) => void,
} = {}) {
  return workflow.printIntegrationPreflight(context, options as Parameters<typeof workflow.printIntegrationPreflight>[1]);
}

// The default export also carries the named symbols as properties, mirroring
// the original CommonJS shape for callers that reach them through `default`.
const integrateWithHelpers = Object.assign(integrate, {
  resolveConflictsForMission: conflict.resolveConflictsForMission,
  rewriteWorktreePaths: conflict.rewriteWorktreePaths,
  buildConflictResolutionPrompt: conflict.buildConflictResolutionPrompt,
  stashMainCheckoutIfNeeded: conflict.stashMainCheckoutIfNeeded,
  restoreMainCheckoutStash: conflict.restoreMainCheckoutStash,
  findExistingSquashCommit: conflict.findExistingSquashCommit,
  getUnresolvedIndexConflicts: conflict.getUnresolvedIndexConflicts,
  parseStashPopCollisionFiles: conflict.parseStashPopCollisionFiles,
  reportStashPopFailure: conflict.reportStashPopFailure,
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

export default integrateWithHelpers;
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
