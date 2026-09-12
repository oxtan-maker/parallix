import fs from 'node:fs';
import path from 'node:path';
import child_process from 'node:child_process';
import { detectRebaseState, git, getCurrentBranch } from '../../git/git.js';
import { resolveTaskFile, setTaskStatus, completeTask, getTaskAssignee, getTaskClassification, classificationFromLabels, CLASSIFICATION_LABELS } from '../../backlog/backlog.js';
import { toVirtual, toActual } from '../../config/state-map.js';
import { getPrStatus, getLatestReviewDecision, syncMerged, readToken, resolveTokenFile, listOpenPrsForSlug } from '../../forgejo/forgejo.js';
import * as fmt from '../../../application/presentation/cli-format.js';

import { buildAutonomousReviewMatrix, formatMatrixSummary } from '../../agents/runtime-matrix.js';
import { findMissionDir, findMissionArea, missionTitle, parseConflictFilesFromMergeOutput, inferSlug, getPrimaryWorktree, getPrimaryBranch, conventionalWorktreePath, softResetTrailingBacklogNoise, findMissionDocInBranches, missionBranchName, missionDirForSlug, resolveMissionBaseBranch, resolveBaseWorktree, resolveWorktree } from '../../filesystem/mission-utils.js';
import * as verification from '../../verification/verification.js';
const { formatVerificationCommand } = verification;
import { isForgejoReviewEnabled } from '../../config/product-config.js';
import { readReviewState } from '../../review/review-state.js';
import { submitForReview } from '../../review/review-commands.js';
import { transitionTask } from '../../backlog/backlog.js';
import { startAgent, selectAgent, workflowLauncherStatus } from '../../agents/agents.js';
import { applyAgentFallback } from '../../review/review-loop.js';
// SC2: the squash-commit hook bounce routes through the one rebound kernel
// (TASK-2377.03). integrate builds its kernel context from injectable seams so
// tests keep a mock launch/transition/fallback port instead of a real agent.
import { rebound, type ReboundContext } from '../../../application/rebound-kernel.js';

import { missionId, isDbAdhocIdentity } from '../../../domain/mission.js';
import { applyReviewerCommand, ConfiguredReviewerEligibility, reviewStatus } from '../../../domain/review.js';
import { agentFamily } from '../../../domain/agents.js';
import { detectChangedAreas, isIntendedPayloadAtHead, parseFilesToAreas, orderIntegrationGates, gateMatchesChangedAreas, loadIntegrationConfig, getIntegrationGatePlan, printIntegrationGatePlan, buildIntegrationGateEnv, captureFinalIntegrationTree, resolveIntegrationVerificationWorktree, buildIntegrationVerificationInvocation, executeIntegrationGates } from './integrate-gates.js';
import { loadPhaseGates, loadRequirePreIntegration, runPhaseGates } from '../../config/repository-gates.js';
import { routeIntegrationGateFailure } from './integrate-gate-rebound.js';

const VARIANT_B_AUTOMATION_SUMMARY = 'Variant B automation: Backlog task closeout, worktree-path rewrite, squash commit with hook-enforced validation, Forgejo sync-merged, and mission worktree cleanup.';

// Re-exported from integrate-conflict.ts and integrate-post.ts
import {
  maybeUpdateGraphifyOnPrimary,
  prepareNoisePatchForSquash,
  restoreNoisePatchAfterSquash,
  getUnresolvedIndexConflicts,
  areAllBacklogOnlyConflicts,
  parseStashPopCollisionFiles,
  reportStashPopFailure,
  rewriteWorktreePaths,
  stashMainCheckoutIfNeeded,
  restoreMainCheckoutStash,
  findExistingSquashCommit,
  resolveConflictsForMission,
  buildConflictResolutionPrompt,
  maybeDropStashAfterCollision,
} from './integrate-conflict.js';
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
  cleanupMissionWorktree,
} from './integrate-post.js';

import {
  IntegrationAbort,
  classifyHookFailure,
  SYNC_MERGED_DIAGNOSTICS,
  printDiagnosticTable,
  reportSyncMergedFailure,
  formatRecordedStatsRow,
  resolveForgejoUserForIntegration,
  isNoMergeToAbortResult,
  recordPostIntegrationStats,
  recordPostIntegrationStatsOrAbort,
  persistLandedIntegrationOrAbort,
  runPostIntegrateHookOrAbort,
  cleanupMissionWorktree,
} from './integrate-post.js';

import { resolveForgejoUser } from '../../review/review-adapter.js';

const REAL_AGENT_OPTION = '--real-agent';
const REAL_AGENT_MODEL_OPTION = '--real-agent-model';
const INTEGRATE_VALUE_OPTIONS = new Set([REAL_AGENT_OPTION, REAL_AGENT_MODEL_OPTION]);
const CODEX_REAL_AGENT_MODEL = 'gpt-5.6-luna';

/** Resolve a task file into the integration checkout without escaping either worktree. */
function resolveIntegrationTaskPath(rawTaskFile: string | undefined, missionWorktree: string | null | undefined, baseWorktree: string | null | undefined): string | null {
  if (!rawTaskFile) { return ''; }
  if (!baseWorktree) { return null; }
  if (missionWorktree) {
    const relative = path.relative(missionWorktree, rawTaskFile);
    if (!relative.startsWith('..') && !path.isAbsolute(relative)) { return path.join(baseWorktree, relative); }
  }
  const baseRelative = path.relative(baseWorktree, rawTaskFile);
  return !baseRelative.startsWith('..') && !path.isAbsolute(baseRelative) ? rawTaskFile : null;
}

/** Parse only the public integrate flags before any preflight or gate work. */
function parseIntegrateArgs(args: string[]) {
  const params: string[] = [];
  let dryRun = false;
  let noIntegrationGates = false;
  let noGate = false;
  let realAgent: string | null = null;
  let realAgentModel: string | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (INTEGRATE_VALUE_OPTIONS.has(arg)) {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${arg} requires a value.`);
      }
      if (arg === REAL_AGENT_OPTION) {
        if (realAgent !== null) {throw new Error('--real-agent may be supplied only once.');}
        realAgent = value;
      } else {
        if (realAgentModel !== null) {throw new Error('--real-agent-model may be supplied only once.');}
        realAgentModel = value;
      }
      index += 1;
      continue;
    }
    if (arg === '--dry-run') { dryRun = true; continue; }
    if (arg === '--no-integration-gates') { noIntegrationGates = true; continue; }
    if (arg === '--no-gate') { noGate = true; continue; }
    if (arg.startsWith('--')) {throw new Error(`Unknown integrate option: ${arg}`);}
    params.push(arg);
  }

  if ((realAgent === null) !== (realAgentModel === null)) {
    throw new Error('--real-agent and --real-agent-model must be supplied together.');
  }
  if (realAgent !== null && realAgent !== 'codex') {
    throw new Error(`Unsupported real agent "${realAgent}". Supported value: codex.`);
  }
  if (realAgent === 'codex' && realAgentModel !== CODEX_REAL_AGENT_MODEL) {
    throw new Error(`Unsupported Codex real-agent model "${realAgentModel}". Supported value: ${CODEX_REAL_AGENT_MODEL}.`);
  }
  if (noIntegrationGates && process.env.PARALLIX_TEST_ALLOW_INTEGRATION_GATE_BYPASS !== '1') {
    throw new Error('--no-integration-gates is rejected: final integration gates are mandatory.');
  }
  return { explicitSlug: params[0], dryRun, noIntegrationGates, noGate, realAgent, realAgentModel };
}

export interface IntegrateFn extends Function {
  resolveConflictsForMission: typeof resolveConflictsForMission;
  cleanupMissionWorktree: typeof cleanupMissionWorktree;
  rewriteWorktreePaths: typeof rewriteWorktreePaths;
  isNoMergeToAbortResult: typeof isNoMergeToAbortResult;
  buildConflictResolutionPrompt: typeof buildConflictResolutionPrompt;
  VARIANT_B_AUTOMATION_SUMMARY: typeof VARIANT_B_AUTOMATION_SUMMARY;
  stashMainCheckoutIfNeeded: typeof stashMainCheckoutIfNeeded;
  restoreMainCheckoutStash: typeof restoreMainCheckoutStash;
  evaluateTaskStatusForIntegration: typeof evaluateTaskStatusForIntegration;
  promoteTaskForIntegrationIfNeeded: typeof promoteTaskForIntegrationIfNeeded;
  findExistingSquashCommit: typeof findExistingSquashCommit;
  printIntegrationPreflight: typeof printIntegrationPreflight;
  resolveForgejoUserForIntegration: typeof resolveForgejoUserForIntegration;
  getUnresolvedIndexConflicts: typeof getUnresolvedIndexConflicts;
  parseStashPopCollisionFiles: typeof parseStashPopCollisionFiles;
  reportStashPopFailure: typeof reportStashPopFailure;
  maybeUpdateGraphifyOnPrimary: typeof maybeUpdateGraphifyOnPrimary;
  SYNC_MERGED_DIAGNOSTICS: typeof SYNC_MERGED_DIAGNOSTICS;
  printDiagnosticTable: typeof printDiagnosticTable;
  reportSyncMergedFailure: typeof reportSyncMergedFailure;
  recordPostIntegrationStats: typeof recordPostIntegrationStats;
  recordPostIntegrationStatsOrAbort: typeof recordPostIntegrationStatsOrAbort;
  runPostIntegrateHookOrAbort: typeof runPostIntegrateHookOrAbort;
  formatRecordedStatsRow: typeof formatRecordedStatsRow;
  detectChangedAreas: typeof detectChangedAreas;
  parseFilesToAreas: typeof parseFilesToAreas;
  loadIntegrationConfig: typeof loadIntegrationConfig;
  getIntegrationGatePlan: typeof getIntegrationGatePlan;
  printIntegrationGatePlan: typeof printIntegrationGatePlan;
  buildIntegrationGateEnv: typeof buildIntegrationGateEnv;
  captureFinalIntegrationTree: typeof captureFinalIntegrationTree;
  parseIntegrateArgs: typeof parseIntegrateArgs;
  resolveIntegrationVerificationWorktree: typeof resolveIntegrationVerificationWorktree;
  buildIntegrationVerificationInvocation: typeof buildIntegrationVerificationInvocation;
  classifyHookFailure: typeof classifyHookFailure;
  executeIntegrationGates: typeof executeIntegrationGates;
  orderIntegrationGates: typeof orderIntegrationGates;
  gateMatchesChangedAreas: typeof gateMatchesChangedAreas;
  buildIntegrationContext: typeof buildIntegrationContext;
  areAllBacklogOnlyConflicts: typeof areAllBacklogOnlyConflicts;
  getPrimaryWorktree: typeof getPrimaryWorktree;
  recoverMissionForIntegration: typeof recoverMissionForIntegration;
}

/**
 * Name the implementer a bounce should launch.
 *
 * Both `px integrate` bounces — the squash-commit hook failure and the
 * integration-gate failure — resolve the same way, so the chain lives once:
 * the task's own assignee, then the role's configured agent, then a launcher
 * probe. F3: only trust a launcher that reports itself supported; an absent
 * launcher returns `{ agent: '', supported: false }`, so name an agent only
 * when the probe confirms a healthy, supported family. An empty result means
 * strand rather than launch with an empty agent identity.
 */
function resolveBounceImplementer(
  taskAssignee: string | null,
  rootDir: string,
  fns: { selectAgentFn?: typeof selectAgent, workflowLauncherStatusFn?: typeof workflowLauncherStatus },
): string {
  const implementer = taskAssignee || (fns.selectAgentFn ? fns.selectAgentFn('act-on-review') : '');
  if (implementer) { return implementer; }
  if (!fns.workflowLauncherStatusFn) { return ''; }
  const status = fns.workflowLauncherStatusFn(taskAssignee ?? '', rootDir);
  return status?.supported ? (status.agent ?? '') : '';
}

/** @param {string[]} args */
async function integrate(args: string[], options: {
  missionServicesFn?: Function;
  /** Board composition receives the terminal status without terminating the UI process. */
  exitFn?: (_code: number) => void;
  // SC2: kernel-context injection seams. The squash-commit hook bounce builds
  // its rebound() context from these so tests keep a mock launch/transition/
  // fallback port instead of a real agent, git, or Forgejo.
  startAgentFn?: typeof startAgent;
  transitionTaskFn?: typeof transitionTask;
  applyAgentFallbackFn?: typeof applyAgentFallback;
  selectAgentFn?: typeof selectAgent;
  workflowLauncherStatusFn?: typeof workflowLauncherStatus;
  /** TASK-2492: integration-gate failure routing, injected for tests. */
  routeIntegrationGateFailureFn?: typeof routeIntegrationGateFailure;
} = {}) {
  const exitFn = options.exitFn ?? process.exit;
  const missionServicesFn = options.missionServicesFn;
  const startAgentFn = options.startAgentFn ?? startAgent;
  const transitionTaskFn = options.transitionTaskFn ?? transitionTask;
  const applyAgentFallbackFn = options.applyAgentFallbackFn ?? applyAgentFallback;
  const selectAgentFn = options.selectAgentFn ?? selectAgent;
  const workflowLauncherStatusFn = options.workflowLauncherStatusFn ?? workflowLauncherStatus;
  const routeIntegrationGateFailureFn = options.routeIntegrationGateFailureFn ?? routeIntegrationGateFailure;
  let exitCode = 0;
  /** @type{{created?: boolean, message?: string, rootDir?: string}|null} */
  let temporaryStash = null;
  let nextActionMessage = null;
  let parsedArgs;
  try {
    parsedArgs = parseIntegrateArgs(args);
  } catch (error: any) {
    fmt.log.fail(error.message);
    exitFn(1);
    return;
  }
  const { explicitSlug, dryRun, noIntegrationGates, noGate, realAgent, realAgentModel } = parsedArgs;
  const slug = inferSlug(explicitSlug);

  /** @type {{slug: string, branch: string, currentBranch: string, missionDir?: string, area: string, task: {ok: boolean, taskFile?: string, reason?: string, matches?: string[]}, taskStatus?: string, taskAssignee?: string|null, forgejoUser?: string|null, forgejoToken?: string|null, taskAssigneeWarning?: string|null, pr: {exists?: boolean, state?: string, number?: number, merged?: boolean, createdAt?: string | null, raw?: string}, siblingPrs: any[], approval: {ok?: boolean, error?: string, reviewState?: string, defaultUserApproved?: boolean, defaultUserApprovedAt?: string, source?: string}, baseBranch?: string, baseWorktree?: string, mainBranch: string, mainDirtyEntries: string[], mainDirty: boolean, missionStatus?: string, missionReview?: any, promoteBacklogOnCloseout?: boolean}} */
  let context;

  if (process.env.FORGEJO_USER === 'gemini' || process.env.WORKFLOW_AGENT === 'gemini') {
    fmt.log.fail('Gemini is not authorized to run integrate. Post a handoff comment on the PR and stop.');
    exitFn(1);
    return;
  }

  if (!slug) {
    fmt.log.fail('Usage: px integrate [<slug>] [--dry-run] [--no-integration-gates]');
    exitFn(1);
    return;
  }

    if (noGate) {
      fmt.log.warn('integrate ignores --no-gate. The landed squash commit relies on the local git hooks for validation.');
    }

    try {
      const executionDir = process.cwd();
      // architecture invariant/architecture invariant: Read authoritative Mission state from SqliteMissionStore.
      // Database unavailability fails the operation (architecture invariant: fail-closed).
      if (typeof missionServicesFn !== 'function') { throw new Error('integrate command requires injected mission services'); }
      // Resolve the authoritative store before buildIntegrationContext so the
      // reviewer lookup (TASK-2420 review round 2, F1) receives its third
      // `missionStore` argument; the store is rootDir-independent, so the
      // base worktree resolved inside the context call is not needed here.
      const missionServices = await missionServicesFn(executionDir);
      context = await buildIntegrationContext(slug, { missionStore: missionServices.store });
      const missionLoad = await missionServices.store.load(missionId(slug));
      if (missionLoad.kind === 'unavailable') {
        fmt.log.fail(`Mission store unavailable: ${missionLoad.reason}. Integration cannot proceed on legacy files.`);
        throw new IntegrationAbort();
      }
      if (missionLoad.kind === 'missing') {
        fmt.log.fail(`Mission ${missionId(slug)} not found in SQLite. Materialize through the intake boundary before integration.`);
        throw new IntegrationAbort();
      }
      if (missionLoad.kind === 'found') {
        const missionContext = /** @type {Record<string, unknown>} */ (context as Record<string, unknown>);
        missionContext.missionStatus = missionLoad.mission.status;
        missionContext.missionLabels = missionLoad.mission.labels;
        missionContext.missionReview = missionLoad.mission.review;
        missionContext.missionVersion = missionLoad.version;
        // architecture invariant: Use Mission store review as approval source when Forgejo is unavailable.
        if (context.approval.ok !== true && missionLoad.mission.review) {
          const lastRound = missionLoad.mission.review.rounds[missionLoad.mission.review.rounds.length - 1];
          if (lastRound?.decision?.kind === 'approved') {
            // `providerDisabled` records that no review provider is configured
            // at all (review.provider !== 'forgejo'), as opposed to a
            // configured provider that could not be reached. Recovery may only
            // treat the stored decision as the sole approval authority in the
            // former case (see recoverMissionForIntegration).
            const providerDisabled = context.approval.error === 'forgejo-off';
            context.approval = { ok: true, reviewState: 'APPROVED', source: 'mission-store', providerDisabled };
          }
        }
      }

      // Reconcile the authoritative Mission before preflight or merge work.
      // Backlog promotion remains delayed until closeout, because it can be
      // part of the candidate branch, but it is never lifecycle authority.
      if (!dryRun) {
        context.promoteBacklogOnCloseout = context.missionStatus === 'review';
        await recoverMissionForIntegration(context, { missionServices });
      }

      // The integration target is the mission's recorded base worktree/branch.
      // For legacy missions these resolve to the primary worktree/branch, keeping
      // the merge/commit/sync path byte-identical to today.
      const baseWorktree = context.baseWorktree;
      const baseBranch = context.baseBranch;
      const { failures } = printIntegrationPreflight(context, { gitFn: git });

      if (failures.length > 0) {
        fmt.log.fail('\nIntegration preflight failed. Resolve the blockers above before running integrate.');
        throw new IntegrationAbort();
      }

      // The Verification row of the readiness view below reports exactly what
      // ran; it never claims "passed" without a gate result behind it.
      let verificationEvidence = 'no gate ran';
      if (noIntegrationGates) {
        fmt.log.info('Integration gates skipped via --no-integration-gates flag');
        verificationEvidence = 'skipped via --no-integration-gates';
      } else {
        // The integration checkout is the mission's own worktree. Verify the
        // exact resulting tree is finalized before any gate runs, then run the
        // repository's configured pre-integration gates from that checkout.
        // An unconfigured repository runs no gate; a gate that exits non-zero
        // aborts before the merge. This replaces the previous hardcoded
        // `./scripts/verify-local.sh integrate` invocation so the live integration
        // gate carries no Node/npm/tsx/verify-local.sh/Parallix-layout assumption
        // (TASK-2457).
        const checkout = resolveIntegrationVerificationWorktree(slug, { baseWorktree });
        const finalTree = captureFinalIntegrationTree(checkout);
        if (!finalTree.ok) {
          fmt.log.fail(`Integration gates cannot start for ${slug}: ${finalTree.error}`);
          throw new IntegrationAbort();
        }
        const gates = loadPhaseGates(checkout, 'preIntegration');
        // The mandatory-gate invariant is repository-configured, not hardcoded
        // product policy (task-2457 F11): a repository that opts in via
        // adapters.gates.requirePreIntegration: true fails closed on an empty gate
        // list; an unconfigured repository completes the integration path with
        // no lifecycle gate. --no-integration-gates is rejected outside the test
        // bypass, so the message below never points at it (task-2457 F12).
        const requirePreIntegration = loadRequirePreIntegration(checkout);
        fmt.log.debug(`Integration gate target: slug=${slug} root=${finalTree.rootDir} commit=${finalTree.commit} tree=${finalTree.tree} requirePreIntegration=${requirePreIntegration}`);
        const result = await runPhaseGates('integration', {
          slug,
          checkoutPath: checkout,
          gates,
          log: fmt.log.plain,
          error: fmt.log.fail,
          // Plan-only dry run executes nothing; self-development agent selection
          // reaches the gate environment via buildGateEnv (F4 / TASK-2269).
          dryRun,
          realAgent,
          realAgentModel,
        });
        if (dryRun) {
          fmt.log.info(`Integration gate plan resolved for ${slug}: ${gates.length} gate(s) configured; nothing executed.`);
        } else if (result.skipped) {
          if (requirePreIntegration) {
            // An unconfigured or self-edited branch that removes
            // adapters.gates.preIntegration must fail closed here rather than
            // merge with "All integration gates passed." (TASK-2300 / F1). The
            // invariant is opt-in via adapters.gates.requirePreIntegration.
            fmt.log.fail(`\nIntegration gates are mandatory for ${slug}: no preIntegration gates configured in workflow.config.json, but adapters.gates.requirePreIntegration is set. Configure adapters.gates.preIntegration to run gates.`);
            fmt.log.fail('Aborting before merge.');
            throw new IntegrationAbort();
          }
          fmt.log.info(`Integration gates for ${slug}: none configured and adapters.gates.requirePreIntegration is not set — proceeding without a lifecycle gate.`);
          verificationEvidence = 'no pre-integration gate configured';
        } else if (!result.ok) {
          fmt.log.fail(`\nIntegration gates failed for ${slug} (root=${finalTree.rootDir}) — ${result.error}`);
          // TASK-2492: an approved mission whose integration gate goes red is no
          // longer a dead end. The failure is classified and routed; only the
          // recoverable mission-regression route continues, and it continues
          // only because the identical gate set re-ran green.
          const route = await routeIntegrationGateFailureFn({
            slug,
            missionWorktree: checkout,
            baseWorktree,
            baseBranch: context.baseBranch,
            verificationCommand: formatVerificationCommand(context.area, checkout),
            failedGate: result.failedGate,
            gateError: result.error,
            gates,
            implementer: resolveBounceImplementer(context.taskAssignee ?? null, checkout, { selectAgentFn, workflowLauncherStatusFn }),
            repositoryId: missionLoad.kind === 'found' ? String(missionLoad.mission.repositoryId) : 'unknown',
            realAgent,
            realAgentModel,
            startAgentFn: startAgentFn as unknown as ReboundContext['startAgent'],
            transitionTaskFn: (bounceSlug: string) => transitionTaskFn(bounceSlug, 'active'),
            applyAgentFallbackFn: applyAgentFallbackFn as unknown as ReboundContext['applyAgentFallback'],
          });
          if (route.route !== 'fixed') {
            fmt.log.fail('Aborting before merge.');
            throw new IntegrationAbort();
          }
          verificationEvidence = `${gates.length} integration gate(s) passed after ${route.rebounds} integration-gate rebound(s)`;
        } else {
          fmt.log.pass('All integration gates passed.');
          verificationEvidence = `${gates.length} integration gate(s) passed`;
        }
      }

      printIntegrationReadiness(buildIntegrationReadiness(context, { verification: verificationEvidence }));

      if (dryRun) {
        await promoteTaskForIntegrationIfNeeded(context, { dryRun: true, missionServicesFn });
        fmt.log.pass('Dry run complete. Integration preflight passed.');
        return;
      }

      temporaryStash = stashMainCheckoutIfNeeded({
        slug,
        dirtyEntries: context.mainDirtyEntries as string[],
        rootDir: /** @type{string} */(baseWorktree) as string
      });

    // End-context check: if we are in the worktree that is about to be deleted,
    // move the Node process to the base worktree to avoid being left in a ghost directory.
    const missionWorktree = conventionalWorktreePath(slug);
    if (process.cwd() === missionWorktree || process.cwd().startsWith(missionWorktree + '/')) {
      fmt.log.info(`Moving process directory to ${baseWorktree} before mission worktree deletion.`);
      process.chdir(baseWorktree as string);
    }

    const branch = missionBranchName(slug, baseWorktree);
    // TASK-2479: capture the pre-integration base-branch tip so the landing
    // result can show the `<before> → <after>` SHA transition.
    const landedFromSha = git(['-C', baseWorktree, 'rev-parse', baseBranch]).stdout.trim();
    const mainTitle = missionTitle(slug) || slug;
    const summary = mainTitle.replace(/\s+/g, ' ').trim();
    // A DB-owned adhoc identity has no Backlog task file; the closeout below is
    // best-effort and guards every task-file access. Keep mainTaskFile empty for
    // adhoc so the fs.existsSync guards below no-op rather than crash.
    const rawTaskFile = (context.task as any)?.taskFile as string | undefined;
    const mainTaskFile = resolveIntegrationTaskPath(rawTaskFile, context.missionWorktree, baseWorktree);
    if (mainTaskFile === null) {
      fmt.log.fail(baseWorktree
        ? 'Mission task file is outside the integration checkout; refusing to stage an unsafe closeout path.'
        : 'Integration base worktree is unavailable; refusing to stage backlog closeout.');
      throw new IntegrationAbort();
    }
    fmt.log.debug(`Selecting integration variant: Variant B (local squash-merge)`);
    fmt.log.debug(`\nStep 1: Using base worktree ${baseWorktree} on ${baseBranch} as the squash-merge target...`);

    fmt.log.debug(`Step 2: Checking merge conflicts against local ${baseBranch} in the base worktree...`);
    const dryMerge = git(['-C', baseWorktree, 'merge', '--no-commit', '--no-ff', branch]);
    const abortResult = git(['-C', baseWorktree, 'merge', '--abort']);

    let proceedToSquash = false;

    // Check abort failure for the success path (merge was clean but abort didn't).
    // When dryMerge.status === 0, the abort restores the worktree after a clean
    // probe — if it fails the base may be left in a dirty merge state.
    let abortFailed = abortResult.status !== 0 && !isNoMergeToAbortResult(abortResult);

    if (dryMerge.status === 0 && abortFailed) {
      fmt.log.fail('Dry-run merge could not be aborted cleanly. Inspect the local integration checkout before retrying integrate.');
      throw new IntegrationAbort();
    }

    if (dryMerge.status !== 0) {
      // Classify conflicts BEFORE deciding on abort failure.
      // This allows backlog-only classification to rescue unabortable merges.
      // (architecture invariant / architecture migration)
      const conflictOutput = [/** @type {any} */ (dryMerge).stdout, /** @type {any} */ (dryMerge).stderr].filter(Boolean).join('\n');
      const conflictFiles = parseConflictFilesFromMergeOutput(conflictOutput);
      const backlogOnly = areAllBacklogOnlyConflicts(conflictFiles) && conflictFiles.length > 0;

      if (backlogOnly) {
        fmt.log.info('Backlog-only conflicts detected — refreshing base branch and retrying probe merge...');

        // Safe cleanup: if abort failed, use reset --hard to clear stale merge state.
        // After successful reset, clear abortFailed so the fallback path after retry
        // uses the normal conflict-resolution flow (not the generic abort-failure path).
        if (abortFailed) {
          const resetResult = git(['-C', baseWorktree, 'reset', '--hard', 'HEAD']);
          if (resetResult.status !== 0) {
            fmt.log.fail('[RETRY] Could not clean up after backlog-only conflict merge.');
            throw new IntegrationAbort();
          }
          abortFailed = false;
        }

        // Fetch and advance local base branch to the latest remote ref.
        // Either failure aborts the integration — retrying against an unrefreshed
        // base would violate the mission's requirement to retry against updated base.
        const fetchResult = git(['-C', baseWorktree, 'fetch', '--all', '--prune']);
        if (fetchResult.status !== 0) {
          fmt.log.fail('[RETRY] Could not fetch remote refs — aborting integration.');
          throw new IntegrationAbort();
        }
        const pullResult = git(['-C', baseWorktree, 'pull', '--ff-only']);
        if (pullResult.status !== 0) {
          fmt.log.fail(`[RETRY] Could not fast-forward ${baseBranch} — aborting integration.`);
          throw new IntegrationAbort();
        }
        fmt.log.info(`Base branch ${baseBranch} refreshed via fast-forward.`);

        // Retry probe merge against the refreshed base.
        const retryMerge = git(['-C', baseWorktree, 'merge', '--no-commit', '--no-ff', branch]);
        const retryAbort = git(['-C', baseWorktree, 'merge', '--abort']);
        if (retryAbort.status !== 0 && !isNoMergeToAbortResult(retryAbort)) {
          abortFailed = true;
          fmt.log.fail('[RETRY] Dry-run merge retry could not be aborted cleanly.');
        } else if (retryMerge.status === 0) {
          fmt.log.pass('Probe merge retry succeeded — proceeding to squash-merge.');
          proceedToSquash = true;
        }
      }

      if (proceedToSquash) {
        // Retry resolved drift — fall through to Step 3 (squash-merge) below.
      } else if (!abortFailed) {
        // Abort succeeded; check for existing squash or fail with conflict details.
        const existingSquash = findExistingSquashCommit(baseWorktree, slug);
        if (existingSquash) {
          fmt.log.warn(`Squash commit already exists on local ${baseBranch} from a previous partial integration (${existingSquash.slice(0, 12)}). Resuming from sync-merged step.`);
          const mergedCommit = existingSquash;
          if (isForgejoReviewEnabled(baseWorktree)) {
            fmt.log.debug('Step 6 (resume): Syncing merged state to Forgejo...');
            const syncResult = syncMerged(branch, mergedCommit, {
              rootDir: baseWorktree,
              forgejoUser: context.forgejoUser,
              token: context.forgejoToken,
              baseBranch: context.baseBranch
            });
            if (!syncResult.ok) {
              reportSyncMergedFailure(syncResult);
              throw new IntegrationAbort();
            }
          } else {
            fmt.log.debug('Step 6 (resume): Skipping Forgejo sync (review provider is not forgejo).');
          }
          if (fs.existsSync(baseWorktree)) {
            nextActionMessage = `Next: cd ${baseWorktree}`;
          }
          await persistLandedIntegrationOrAbort(slug, mergedCommit, missionServices, { rootDir: baseWorktree as string });
          await (recordPostIntegrationStatsOrAbort as any)(slug, { rootDir: baseWorktree, missionStore: missionServices.store });
          if (!cleanupMissionWorktree(slug)) {
            fmt.log.fail('Mission worktree cleanup failed.');
            throw new IntegrationAbort();
          }
          fmt.log.pass('Mission worktree cleaned up.');
          maybeUpdateGraphifyOnPrimary(baseWorktree, { log: fmt.log.debug });
          runPostIntegrateHookOrAbort(slug, { baseWorktree: baseWorktree as string, baseBranch: baseBranch as string, variant: 'variant-b-resumed' });
          fmt.log.plain('');
          fmt.log.pass(`✓ integrated into ${baseBranch} (resumed from partial state)`);
          fmt.log.plain(`  ${baseBranch}  ${landedFromSha} → ${mergedCommit}`);
        } else {
          fmt.log.fail('Merge conflicts detected. Rebase the mission branch before integrating.');
          if (conflictFiles.length > 0) {
            fmt.log.info(`Conflicting files (${conflictFiles.length}):`);
            conflictFiles.forEach(f => fmt.log.info(`  - ${f}`));
          }
          fmt.log.info('Conflict helper path:');
          for (const line of formatMatrixSummary(buildAutonomousReviewMatrix())) {
            fmt.log.info(line);
          }
          for (const line of buildConflictResolutionPrompt(slug, context.area, { baseBranch: context.baseBranch || '' })) {
            fmt.log.info(line);
          }
          throw new IntegrationAbort();
        }
      } else {
        // Abort failed and not backlog-only (or retry failed): fail closed.
        fmt.log.fail('Dry-run merge could not be aborted cleanly. Inspect the local integration checkout before retrying integrate.');
        throw new IntegrationAbort();
      }
    }

    if (dryMerge.status === 0 || proceedToSquash) {
      fmt.log.debug('Step 3: Squash-merging the mission branch...');
      let noisePatchState = null;
      if (softResetTrailingBacklogNoise(baseWorktree, git)) {
        noisePatchState = prepareNoisePatchForSquash(baseWorktree, { gitRunner: git });
        if (!noisePatchState.ok) {
          fmt.log.fail('Could not preserve trailing backlog noise before squash merge.');
          if (noisePatchState.error) {
            fmt.log.fail(noisePatchState.error);
          }
          throw new IntegrationAbort();
        }
      }
      const squashResult = git(['-C', baseWorktree, 'merge', '--squash', branch]);
      if (squashResult.status !== 0) {
        noisePatchState?.cleanup?.();
        fmt.log.fail('Squash merge failed.');
        throw new IntegrationAbort();
      }
      if (noisePatchState?.patchPath) {
        const restoreNoiseResult = restoreNoisePatchAfterSquash(/** @type {string} */ (baseWorktree), noisePatchState.patchPath, { gitRunner: git });
        (noisePatchState.cleanup as Function)();
        if (!restoreNoiseResult.ok) {
          fmt.log.fail('Could not restore trailing backlog noise after squash merge.');
          if (restoreNoiseResult.error) {
            fmt.log.fail(restoreNoiseResult.error);
          }
          throw new IntegrationAbort();
        }
      }

      // Capture the squash payload before closeout changes the checkout. The
      // final commit names this set, so a concurrent bare board commit never
      // inherits ambient index entries from an earlier `git add -A`.
      const intendedPayloadPaths = new Set(
        git(['-C', baseWorktree, 'diff', '--cached', '--name-only', '--']).stdout
          .split('\n')
          .map(file => file.trim())
          .filter(Boolean)
      );

      fmt.log.debug('Step 4: Final closeout checks in the local integration checkout...');
      // Do not dirty the primary checkout before the probe merge and squash have
      // completed. The task file is commonly part of the mission branch, so an
      // early promotion can make `merge --abort` fail and leave index conflicts.
      await promoteTaskForIntegrationIfNeeded(context, { missionServicesFn });
      if (fs.existsSync(mainTaskFile)) {
        completeTask(slug, baseWorktree);
        const originalTaskPath = path.relative(baseWorktree as string, mainTaskFile);
        intendedPayloadPaths.add(originalTaskPath);
        // Re-resolve because it moved
        const updatedResolution = resolveTaskFile(slug, baseWorktree);
        if (updatedResolution.ok) {
          const completedTaskPath = path.relative(baseWorktree as string, updatedResolution.taskFile as string);
          intendedPayloadPaths.add(completedTaskPath);
          rewriteWorktreePaths(updatedResolution.taskFile as string, slug, { rootDir: baseWorktree });
          const stageCloseout = git(['-C', baseWorktree, 'add', '-A', '--', originalTaskPath, completedTaskPath]);
          if (stageCloseout.status !== 0) {
            fmt.log.fail('Could not stage backlog closeout for the landed squash commit.');
            throw new IntegrationAbort();
          }
        }
      }

      fmt.log.debug('Step 5: Creating the landed squash commit in the local integration checkout...');
      let commitResult = git([
        '-C',
        /** @type {string} */ (baseWorktree),
        'commit',
        '--only',
        '-m',
        `${branch}: ${summary}`,
        '--',
        ...intendedPayloadPaths
      ]);
      let retriedCommit = false;
      if (commitResult.status !== 0) {
        const output = [commitResult.stdout, commitResult.stderr].filter(Boolean).join('\n').trim();
        if (isIntendedPayloadAtHead(baseWorktree as string, intendedPayloadPaths, { gitRunner: git })) {
          const carryingCommit = git(['-C', baseWorktree, 'rev-parse', 'HEAD']).stdout.trim();
          fmt.log.pass(`Integration payload already landed in commit ${carryingCommit}.`);
        } else {
          fmt.log.fail('Could not create the squash commit in the local integration checkout.');
          if (output) {
            fmt.log.fail(output);
          }

          // SC2: Classify the squash-commit failure and bounce it through the
          // one rebound kernel. The kernel's verify re-runs the identical
          // `git commit --only` invocation, so `fixed` means the hook passes on
          // re-run — never merely that an agent ran. The kernel owns the
          // per-occurrence budget (2 attempts) in memory; nothing is persisted.
          const hookClassification = classifyHookFailure(output);
          if (!hookClassification.isHookFailure) {
            fmt.log.info(`The squash commit runs the repo git hooks. Fix the reported hook failure in ${baseWorktree} and retry integrate.`);
            fmt.log.info(`For this mission, the relevant verification command is ${formatVerificationCommand(context.area, baseWorktree)}`);
            throw new IntegrationAbort();
          }

          const implementer = resolveBounceImplementer(context.taskAssignee ?? null, baseWorktree, { selectAgentFn, workflowLauncherStatusFn });
          if (!implementer) {
            // No resolver could name an implementer — strand, as the deleted
            // policy did, rather than launch with an empty agent identity.
            fmt.log.info(`The squash commit runs the repo git hooks. Fix the reported hook failure in ${baseWorktree} and retry integrate.`);
            throw new IntegrationAbort();
          }

          const outcome = await rebound(
            { kind: 'hook-failure', hook: hookClassification.hookType, operation: 'squash commit', output },
            {
              slug,
              worktree: baseWorktree,
              implementer,
              // Casts: the injected production fns are more strongly typed than the
              // kernel's port shape; the call sites below match the kernel contract.
              startAgent: startAgentFn as unknown as ReboundContext['startAgent'],
              transitionToImplementer: (bounceSlug: string) => transitionTaskFn(bounceSlug, 'active'),
              applyAgentFallback: applyAgentFallbackFn as unknown as ReboundContext['applyAgentFallback'],
              verify: () => {
                retriedCommit = true;
                const retryResult = git([
                  '-C',
                  /** @type {string} */ (baseWorktree),
                  'commit',
                  '--only',
                  '-m',
                  `${branch}: ${summary}`,
                  '--',
                  ...intendedPayloadPaths
                ]);
                return { ok: retryResult.status === 0, diagnostic: [retryResult.stdout, retryResult.stderr].filter(Boolean).join('\n').trim() };
              },
            },
          );
          if (outcome.outcome !== 'fixed') {
            // exhausted / human-only — strand with the existing operator hint.
            fmt.log.info(`The squash commit runs the repo git hooks. Fix the reported hook failure in ${baseWorktree} and retry integrate.`);
            throw new IntegrationAbort();
          }
        }
      }
      if (retriedCommit) {
        fmt.log.pass('Squash commit created after hook fix.');
      }
      const mergedCommit = git(['-C', baseWorktree, 'rev-parse', 'HEAD']).stdout.trim();

      if (isForgejoReviewEnabled(baseWorktree)) {
        fmt.log.debug('Step 6: Syncing merged state to Forgejo...');
        const syncResult = syncMerged(branch, mergedCommit, {
          rootDir: baseWorktree,
          forgejoUser: context.forgejoUser,
          token: context.forgejoToken,
          baseBranch: context.baseBranch
        });
        if (!syncResult.ok) {
          reportSyncMergedFailure(syncResult);
          throw new IntegrationAbort();
        }
      } else {
        fmt.log.debug('Step 6: Skipping Forgejo sync (review provider is not forgejo).');
      }

      if (fs.existsSync(baseWorktree)) {
        nextActionMessage = `Next: cd ${baseWorktree}`;
      }
      await persistLandedIntegrationOrAbort(slug, mergedCommit, missionServices, { rootDir: baseWorktree as string });
      await (recordPostIntegrationStatsOrAbort as any)(slug, { rootDir: baseWorktree, missionStore: missionServices.store });
      if (cleanupMissionWorktree(slug)) {
        fmt.log.pass('Mission worktree cleaned up.');
      } else {
        fmt.log.fail('Mission worktree cleanup failed.');
        throw new IntegrationAbort();
      }

      maybeUpdateGraphifyOnPrimary(baseWorktree, { log: fmt.log.debug });
      runPostIntegrateHookOrAbort(slug, { baseWorktree: baseWorktree as string, baseBranch: baseBranch as string, variant: 'variant-b' });

      // Proof capture after post-integrate hook so it represents the
      // freshly rebuilt tree that will actually be published (architecture migration).
      const proofResult = verification.captureVerifiedTreeProof(context.area, baseWorktree, {
        gitRunner: git,
        runFn: /** @type {Function} */ (child_process.spawnSync)
      });
      if (!/** @type {any} */ (proofResult).ok) {
        fmt.log.fail(`Could not verify the exact tree being published: ${/** @type {any} */ (proofResult).error}`);
        throw new IntegrationAbort();
      }
      const proof = /** @type {any} */ (proofResult).proof;
      const proofCheck = verification.assertVerifiedTreeProof(proof!, baseWorktree, { gitRunner: git });
      if (!proofCheck.ok) {
        fmt.log.fail(`Verification proof is stale for the publish tree: ${/** @type {any} */ (proofCheck).error}`);
        throw new IntegrationAbort();
      }

      fmt.log.plain('');
      fmt.log.pass(`✓ integrated into ${baseBranch}`);
      fmt.log.plain(`  ${baseBranch}  ${landedFromSha} → ${mergedCommit}`);
    }
  } catch (error) {
    if (error instanceof IntegrationAbort) {
      exitCode = 1;
    } else {
      // Report and fail. Rethrowing here is swallowed by the `process.exit()`
      // below, which would end the run with a success code and no output at
      // all — the operator would see integrate "succeed" while doing nothing.
      fmt.log.fail(`Integration failed: ${(error as any)?.message || String(error)}`);
      if ((error as any)?.stack) {
        fmt.log.fail(String((error as any).stack));
      }
      exitCode = 1;
    }
  } finally {
    if (temporaryStash?.created) {
        const restoreResult = restoreMainCheckoutStash(temporaryStash as any);
      if (restoreResult.status !== 0) {
        // A stash pop can fail on a pure file-collision when a stashed
        // untracked working-tree file (e.g. a first-run config/agents.json)
        // was committed by the landed squash merge and now already exists on
        // disk. In that case the data is preserved and the temporary stash
        // can be dropped; only a genuine conflict (or a missing file) should
        // fail the run.
        const stashRootDir = (temporaryStash as unknown as {rootDir: string}).rootDir;
        const dropped = maybeDropStashAfterCollision(restoreResult, stashRootDir);
        if (dropped) {
          fmt.log.info('[RESTORE] Stashed working-tree change was preserved on disk by the landed commit; dropped the temporary stash.');
        } else {
          reportStashPopFailure(slug, restoreResult, { rootDir: stashRootDir });
          exitCode = 1;
        }
      }
    }

    if (nextActionMessage) {
      fmt.log.info(nextActionMessage);
    }
    exitFn(exitCode);
    return { exitCode };
  }
}

/** @param {string} slug @param{{baseBranch?: string|null, baseWorktree?: string|null, isForgejoReviewEnabledFn?: Function}} opts */
async function buildIntegrationContext(slug: string, {
  baseBranch = null,
  baseWorktree = null,
  isForgejoReviewEnabledFn = isForgejoReviewEnabled,
  getCurrentBranchFn = getCurrentBranch,
  readTokenFn = readToken,
  getPrStatusFn = getPrStatus,
  getLatestReviewDecisionFn = getLatestReviewDecision,
  readReviewStateFn = readReviewState,
  missionStore = null,
  gitFn = git
}: {
  baseBranch?: string | null,
  baseWorktree?: string | null,
  isForgejoReviewEnabledFn?: Function,
  getCurrentBranchFn?: Function,
  readTokenFn?: Function,
  getPrStatusFn?: Function,
  getLatestReviewDecisionFn?: Function,
  readReviewStateFn?: Function,
  missionStore?: import('../../../application/domain-ports.js').MissionStore | null,
  gitFn?: Function
} = {}) {
  if (!slug) {
    throw new Error('buildIntegrationContext requires a non-null mission slug.');
  }
  const branch = `mission/${slug}`;
  const currentBranch = getCurrentBranchFn();
  const missionDir = findMissionDir(slug);
  const area = missionDir ? findMissionArea(missionDir) : 'docs';

  // The mission integrates back into its recorded base branch/worktree. When no
  // base was recorded (every legacy mission) these resolve to the primary
  // branch/worktree, so the rest of integration is byte-identical to today.
  let resolvedBaseBranch: string | null = baseBranch;
  if (!resolvedBaseBranch) {
    try { resolvedBaseBranch = resolveMissionBaseBranch(slug, process.cwd()); } catch (_) { resolvedBaseBranch = getPrimaryBranch(); }
  }
  let resolvedBaseWorktree: string | null = baseWorktree;
  if (!resolvedBaseWorktree) {
    try { resolvedBaseWorktree = resolveBaseWorktree(slug, { rootDir: process.cwd() }); } catch (_) { resolvedBaseWorktree = getPrimaryWorktree(); }
  }
  // The mission branch owns the task payload that is about to be integrated.
  // Read task metadata there so integration remains independent of uncommitted
  // or stale files in the primary checkout.
  const missionWorktree = resolveWorktree(slug, { cwd: process.cwd() }) || resolvedBaseWorktree || process.cwd();
  /** @type {ReturnType<typeof resolveTaskFile>} */
  const task = isDbAdhocIdentity(slug)
    ? { ok: false, matches: [], reason: 'adhoc mission has no Backlog task' }
    : resolveTaskFile(slug, missionWorktree);
  const taskAssignee = task.ok ? getTaskAssignee(task.taskFile as string) : null;
  const forgejoEnabled = isForgejoReviewEnabledFn(/** @type {string} */ (resolvedBaseWorktree));
  
  let forgejoIdentity: {forgejoUser: string | null, warning: string | null} = { forgejoUser: null, warning: null };
  let forgejoToken: string | null = null;
  let pr: any = { exists: false };
  /** @type{any[]} */ let siblingPrs: any[] = [];
  let approval: any = { ok: false, error: 'forgejo-off', reviewState: null };

  if (forgejoEnabled) {
    forgejoIdentity = resolveForgejoUserForIntegration(taskAssignee);
    forgejoToken = readTokenFn(/** @type {any} */ (forgejoIdentity.forgejoUser || 'default'));
    // TASK-2420 (review round 1, F1): the reviewer login queried for recovery
    // authority must come from the Mission's recorded current review round, not
    // from the task assignee (the implementer). An implementation by `codex`
    // reviewed by `qwen` would otherwise query `codex` as the reviewer and
    // reject qwen's legitimate approval. Derive it from the persisted round
    // (fail-closed, ADR 0048): a mission with no recorded round yields no
    // reviewer, so reviewerUser stays null and recovery falls back to the
    // default user only — it cannot be forged from caller context.
    // TASK-2420 (review round 2, F1): the production `readReviewState` returns
    // null unless its third `missionStore` argument is supplied, so the
    // authoritative store must be passed here or the reviewer lookup always
    // falls back to the default user. The store is the operator Mission
    // authority, never task metadata.
    const reviewState = await Promise.resolve(readReviewStateFn(slug, /** @type {string} */ (resolvedBaseWorktree), /** @type {any} */ (missionStore)));
    // TASK-2420 (review round 2, F1): the round stores the reviewer as an
    // AgentFamily; the login it posts a provider APPROVED as is
    // resolveForgejoUser(reviewer). Map it the same way so the recovery
    // authority matches the login the reviewer actually used, never a caller
    // value. No recorded reviewer yields null → falls back to the default user.
    const configuredReviewer = reviewState?.reviewer
      ? resolveForgejoUser(/** @type {string} */ (reviewState.reviewer))
      : null;
    pr = /** @type {any} */ (getPrStatusFn(branch, process.cwd(), {
      forgejoUser: /** @type {any} */ (forgejoIdentity.forgejoUser),
      token: forgejoToken
    }));
    if (pr.exists && pr.merged === true) {
      pr = { ...pr, state: 'merged' };
    }
    
    if (pr.exists && slug) {
      const baseSlugMatch = slug.match(/^(task-\d+)/i);
      const baseSlug = baseSlugMatch ? baseSlugMatch[1].toLowerCase() : slug;
      if (forgejoToken) {
        const allOpen = listOpenPrsForSlug(baseSlug, forgejoToken);
        siblingPrs = allOpen.filter(p => p.head !== branch);
      }
    }

    approval = pr.exists ? /** @type {any} */ (getLatestReviewDecisionFn(branch, {
      forgejoUser: /** @type {any} */ (forgejoIdentity.forgejoUser),
      token: /** @type {any} */ (forgejoToken),
      // TASK-2420 (review round 1, F1): pass the configured reviewer's resolved
      // Forgejo login — derived from the recorded current review round above,
      // never the task assignee/implementer (fail-closed, ADR 0048) — so the
      // recovery authority recognizes an APPROVED by that reviewer too.
      reviewerUser: /** @type {any} */ (configuredReviewer),
    })) : /** @type {any} */ ({ ok: false, error: 'pr-missing', reviewState: undefined });
  }

  // Local review-state fallback: when forgejo token/API is unavailable but the
  // mission's Review shows approved, populate approval from local state
  // so that integrate can proceed without a live Forgejo connection.
  // Only applies when Forgejo was enabled but approval could not be obtained.
  if (forgejoEnabled && !approval.ok) {
    const localStateFallback = await Promise.resolve(readReviewStateFn(slug, /** @type {string} */ (resolvedBaseWorktree)));
    if (localStateFallback && localStateFallback.phase === 'approved' && localStateFallback.disposition === 'APPROVED') {
      approval = /** @type {any} */ ({ ok: true, reviewState: 'APPROVED', source: 'local-review-state' });
    }
  }
  
  const mainBranchResult = gitFn(['-C', /** @type {string} */ (resolvedBaseWorktree), 'branch', '--show-current']);
  const mainBranch = mainBranchResult.stdout.trim();
  const mainStatus = gitFn(['-C', /** @type {string} */ (resolvedBaseWorktree), 'status', '--short']);

  return {
    slug,
    branch,
    currentBranch,
    missionDir,
    area,
    task,
    missionWorktree,
    missionStatus: undefined as string | undefined,
    promoteBacklogOnCloseout: false,
    taskAssignee,
    forgejoUser: forgejoIdentity.forgejoUser,
    forgejoToken,
    taskAssigneeWarning: forgejoIdentity.warning,
    pr,
    siblingPrs,
    approval,
    baseBranch: resolvedBaseBranch,
    baseWorktree: resolvedBaseWorktree,
    mainBranch,
    mainDirtyEntries: mainStatus.stdout.trim().length > 0
      ? mainStatus.stdout.trim().split('\n').filter(Boolean)
      : [],
    mainDirty: mainStatus.stdout.trim().length > 0
  };
}

/**
 * Review round 1 (F3): pure prediction of the authority the real
 * `px integrate` run would establish through recovery. The real run persists
 * it; a dry run skips recovery, so it reports the same decision without
 * persisting. Both consume this one function, so `--dry-run` can never fail
 * for the case the real run accepts.
 *
 * @param {{slug: string, missionStatus?: string, missionReview?: any, taskStatus?: string, approval?: {ok?: boolean, reviewState?: string, defaultUserApproved?: boolean, defaultUserApprovedAt?: string, source?: string}, baseWorktree?: string}} context
 */
/**
 * Resolve the authoritative provider-approval timestamp recovery may turn into a
 * ReviewerDecision. TASK-2420: an APPROVED by the assigned/configured reviewer
 * (reviewerApproved/reviewerApprovedAt) qualifies on the same footing as the repo
 * default user's approval (defaultUserApproved/defaultUserApprovedAt). The
 * default-user approval wins only when both are present; the qualifier is the
 * approval's own provider timestamp, never the recovery wall clock (SC5).
 */
/** @param {{ok?: boolean, defaultUserApproved?: boolean, defaultUserApprovedAt?: string, reviewerApproved?: boolean, reviewerApprovedAt?: string}} approval */
function resolveAuthoritativeApprovalAt(approval: any): string | undefined {
  if (!approval || approval.ok !== true) {return undefined;}
  if (approval.defaultUserApproved) {return approval.defaultUserApprovedAt;}
  if (approval.reviewerApproved) {return approval.reviewerApprovedAt;}
  return undefined;
}

function recoveryEstablishesApproval(context: any): {
  established: boolean;
  via: 'lifecycle' | 'mission-review' | 'human-override' | null;
  decidedAt?: string;
  reason: string;
} {
  const status = context.missionStatus;
  if (status === 'integration' || status === 'done') {
    return { established: true, via: 'lifecycle', reason: '' };
  }
  const review = context.missionReview;
  const rounds = review?.rounds;
  const lastRound = rounds && rounds.length > 0 ? rounds[rounds.length - 1] : null;
  const overrideAt = resolveAuthoritativeApprovalAt(context.approval);

  if (lastRound?.decision?.kind === 'approved') {
    return { established: true, via: 'mission-review', decidedAt: lastRound.decision.decidedAt, reason: '' };
  }

  if (status === 'active') {
    if (!review && overrideAt === undefined) {
      return { established: false, via: null, reason: 'active with no authoritative Review and no default-user override; run px review <slug> --start before integration' };
    }
    if (review) {
      // The real run re-submits through the handoff operation: an undecided
      // round resubmits unchanged, a ready round advances to a fresh one.
      // The override applies only when the resulting round awaits a decision.
      const roundStatus = reviewStatus(review);
      if (overrideAt !== undefined && (roundStatus === 'awaiting-review' || roundStatus === 'ready-for-next-round')) {
        return { established: true, via: 'human-override', decidedAt: overrideAt, reason: '' };
      }
      return { established: false, via: null, reason: `existing Review is ${roundStatus}; resolve the round before overriding` };
    }
    return { established: true, via: 'human-override', decidedAt: overrideAt, reason: '' };
  }

  if (status === 'review') {
    if (review && overrideAt !== undefined && reviewStatus(review) === 'awaiting-review') {
      return { established: true, via: 'human-override', decidedAt: overrideAt, reason: '' };
    }
    return { established: false, via: null, reason: 'review without an authoritative approval; record a ReviewerDecision through px review' };
  }

  return { established: false, via: null, reason: `status ${status} is not recoverable to integration` };
}

/** @param {{slug: string, branch: string, currentBranch: string, missionDir?: string, area: string, task: {ok: boolean, taskFile?: string, reason?: string, matches?: string[]}, taskStatus?: string, taskAssignee?: string|null, forgejoUser?: string|null, forgejoToken?: string|null, taskAssigneeWarning?: string|null, pr: {exists?: boolean, state?: string, number?: number, merged?: boolean, createdAt?: string | null, raw?: string}, siblingPrs: any[], approval: {ok?: boolean, error?: string, reviewState?: string, defaultUserApproved?: boolean, defaultUserApprovedAt?: string, source?: string}, baseBranch?: string, baseWorktree?: string, mainBranch: string, mainDirtyEntries: string[], mainDirty: boolean, missionStatus?: string, missionReview?: any}} context */
function evaluateTaskStatusForIntegration(context: any) {
  const missionStatus = context.missionStatus ?? context.taskStatus;
  const stateMapOptions = { rootDir: /** @type {string} */ (context.baseWorktree) };
  if (toVirtual(missionStatus, /** @type {any} */ (stateMapOptions)) === 'approved') {
    return {
      ok: true,
      level: 'pass',
      message: `Backlog status: approved`
    };
  }

  // The Mission lifecycle is the approval authority (TASK-2379). Backlog
  // status is only a closeout representation and never an integration gate.
  if (missionStatus === 'integration' || missionStatus === 'done') {
    return {
      ok: true,
      level: 'pass',
      message: `Backlog status follows the Mission lifecycle (${context.missionStatus}); promotion happens at closeout`
    };
  }

  // Review round 1 (F3): a dry run has not run recovery yet, so
  // missionStatus still reflects the stale store state. Predict the same
  // authority the real run would establish and report it; the real run
  // persists it instead.
  const recovery = recoveryEstablishesApproval(context);
  if (recovery.established && recovery.via !== 'lifecycle') {
    const how = recovery.via === 'human-override'
      ? `the provider approval (${recovery.decidedAt}) would be recorded as an authoritative ReviewerDecision`
      : `the Mission Review already records an authoritative approval (${recovery.decidedAt})`;
    return {
      ok: true,
      level: 'warn',
      message: `Mission status: ${toVirtual(missionStatus, stateMapOptions)} accepted for integration because ${how} and recovery would move the Mission to integration`
    };
  }

  const reviewApproved = context.approval?.ok && context.approval.reviewState === 'APPROVED';
  const localApproved = context.approval?.source === 'local-review-state';
  const reviewCanProceed = missionStatus === 'review' && (reviewApproved || localApproved);

  if (reviewCanProceed) {
    let reason;
    if (localApproved) {
      reason = 'local review-state: approved';
    } else {
      reason = `latest formal review state is ${context.approval.reviewState}`;
    }
    return {
      ok: true,
      level: 'warn',
      message: `Mission status: review accepted for integration because ${reason}`
    };
  }

  return {
    ok: false,
    level: 'fail',
    message: `Mission status: expected approved, or review with an approved Forgejo PR; found ${toVirtual(missionStatus, stateMapOptions)}`
  };
}

/** @param {Function} log @param {string} slug @param {string} baseWorktree @param {string} baseBranch */
function printMergedPrRecoveryGuidance(log: Function, slug: string, baseWorktree: string, baseBranch: string) {
  log(fmt.status('INFO', 'Recovery: re-sync the local base branch, confirm the landed commit locally, then retry integrate.'));
  log(fmt.status('INFO', `  git -C ${baseWorktree} fetch --all --prune`));
  log(fmt.status('INFO', `  git -C ${baseWorktree} checkout ${baseBranch}`));
  log(fmt.status('INFO', `  git -C ${baseWorktree} pull --ff-only`));
  log(fmt.status('INFO', `  px integrate ${slug} --dry-run`));
}

/** @param {{slug: string, branch: string, currentBranch: string, missionDir?: string, area: string, task: {ok: boolean, taskFile?: string, reason?: string, matches?: string[]}, taskStatus?: string, taskAssignee?: string|null, forgejoUser?: string|null, forgejoToken?: string|null, taskAssigneeWarning?: string|null, pr: {exists?: boolean, state?: string, number?: number, merged?: boolean, createdAt?: string | null, raw?: string}, siblingPrs: any[], approval: {ok?: boolean, error?: string, reviewState?: string, defaultUserApproved?: boolean, defaultUserApprovedAt?: string, source?: string}, baseBranch?: string, baseWorktree?: string, mainBranch: string, mainDirtyEntries: string[], mainDirty: boolean, missionStatus?: string, promoteBacklogOnCloseout?: boolean}} context */
async function promoteTaskForIntegrationIfNeeded(
  context: any,
  { dryRun = false, missionServicesFn }: { dryRun?: boolean, missionServicesFn?: Function } = {},
) {
  const taskStatusCheck = evaluateTaskStatusForIntegration(context);
  const needsPromotion = context.task?.ok
    // Runtime integration always has Mission authority. taskStatus supports
    // direct callers that supply an older, pre-store context.
    && (context.missionStatus === 'review' || context.promoteBacklogOnCloseout === true
      || (context.missionStatus === undefined && context.taskStatus === 'review'))
    && taskStatusCheck.ok;

  if (!needsPromotion) {
    return { changed: false, dryRun: false };
  }

  if (dryRun) {
    fmt.log.info('Dry run: integration would promote Backlog status from review to approved because review is already fulfilled.');
    return { changed: false, dryRun: true };
  }

  // Approval owns `review -> integration`; landing alone owns
  // `integration -> done`. Read the authority first so the Backlog promotion
  // cannot get ahead of the durable lifecycle transition.
  if (typeof missionServicesFn !== 'function') { throw new Error('integration promotion requires injected mission services'); }
  const missionServices = await missionServicesFn(context.baseWorktree || process.cwd());
  const missionLoad = await missionServices.store.load(missionId(context.slug));
  if (missionLoad.kind === 'unavailable') {
    fmt.log.fail(`Mission store unavailable: ${missionLoad.reason}. Refusing to promote the Backlog task.`);
    throw new IntegrationAbort();
  }
  if (missionLoad.kind === 'missing') {
    fmt.log.fail(`Mission ${missionId(context.slug)} not found in SQLite. Refusing to promote the Backlog task — file-only lifecycle state is not permitted after cutover.`);
    throw new IntegrationAbort();
  }

  await recoverMissionForIntegration(context, { missionServices, missionLoad });

  // External boundary effect after the durable lifecycle transition.
  const stateMapOptions = { rootDir: /** @type {string} */ (context.baseWorktree) };
  const approvedStatus = toActual('approved', stateMapOptions) || 'approved';
  const taskPath = context.task?.taskFile
    ? resolveIntegrationTaskPath(context.task.taskFile, context.missionWorktree, context.baseWorktree)
      // buildIntegrationContext always supplies a worktree; direct callers may not.
      || (!context.missionWorktree && context.baseWorktree ? resolveTaskFile(context.slug, context.baseWorktree).taskFile : null)
    : '';
  const baseTask = taskPath ? { ok: true, taskFile: taskPath } : context.task?.taskFile ? { ok: false } : context.task;
  if (!baseTask?.ok || !setTaskStatus(/** @type {string} */ (baseTask.taskFile || ''), approvedStatus)) {
    fmt.log.fail('Could not promote the Backlog task to approved before integration.');
    throw new IntegrationAbort();
  }

  fmt.log.info('Promoted Backlog status from review to approved because review is already fulfilled.');

  return { changed: true, dryRun: false };
}

/**
 * Persist an explicit human override as a real `ReviewerDecision` through the
 * Review domain, returning the reloaded mission (TASK-2379 Part E). The
 * override is authoritative Review data — never an integrate-local boolean —
 * and it keeps its own timestamp: the approval happened on the provider at
 * `overrideApprovedAt`, recovery merely observes it late.
 *
 * Returns null when the Review is not awaiting a decision (the domain refuses
 * to rewrite an already-decided round) or when persistence fails.
 */
async function recordHumanOverrideDecision(
  context: any,
  {
    missionServices,
    missionLoad,
    overrideApprovedAt,
  }: { missionServices: any, missionLoad: any, overrideApprovedAt: string },
): Promise<any | null> {
  const review = missionLoad.mission.review;
  if (reviewStatus(review) !== 'awaiting-review') {
    fmt.log.fail(`Human override cannot be recorded for ${context.slug}: the Review is ${reviewStatus(review)}, not awaiting a decision. Resolve the current round (or start a new one with px review ${context.slug} --start) before overriding.`);
    return null;
  }
  const decidedReview = applyReviewerCommand(review, {
    type: 'approve',
    decidedAt: overrideApprovedAt,
    comment: null,
    source: { kind: 'provider', provider: 'forgejo' },
  });
  try {
    await missionServices.store.save({ ...missionLoad.mission, review: decidedReview }, missionLoad.version);
  } catch (error) {
    fmt.log.fail(`Could not persist the human override decision for ${context.slug}: ${(error as Error).message}`);
    return null;
  }
  const reloaded = await missionServices.store.load(missionId(context.slug));
  return reloaded.kind === 'found' ? reloaded : null;
}

/**
 * Repair interrupted lifecycle orchestration using workflow operations, never
 * by assigning Mission.status. A Review decision remains the sole approval
 * authority: an explicit human override becomes one, an active Mission
 * without Review facts must be handed off first, and a missing decision stops
 * recovery.
 */
async function recoverMissionForIntegration(
  context: any,
  {
    missionServices,
    missionLoad: suppliedLoad,
    submitForReviewFn = submitForReview,
  }: { missionServices: any, missionLoad?: any, submitForReviewFn?: typeof submitForReview },
) {
  let missionLoad = suppliedLoad ?? await missionServices.store.load(missionId(context.slug));
  if (missionLoad.kind !== 'found') {
    fmt.log.fail(`Mission ${missionId(context.slug)} is unavailable for lifecycle recovery.`);
    throw new IntegrationAbort();
  }

  if (missionLoad.mission.status === 'done') {
    // The existing landed-integration closeout path is idempotent and owns a
    // resumed done Mission. Do not create another lifecycle event here.
    return { recovered: false, status: 'done' };
  }

  // The authoritative provider approval (repo default user OR the
  // assigned/configured reviewer already approved on the provider) is the one
  // input recovery may turn into an authoritative ReviewerDecision. It carries
  // the approval's own timestamp and is never a bare boolean shortcut
  // (TASK-2379 Part E; TASK-2420 extends the qualifier to the assigned reviewer).
  const overrideApprovedAt = resolveAuthoritativeApprovalAt(context.approval);

  if (missionLoad.mission.status === 'active') {
    if (!missionLoad.mission.review && overrideApprovedAt === undefined) {
      fmt.log.fail(`Mission ${missionId(context.slug)} is active with no authoritative Review. Run px review ${context.slug} --start (or record a human decision through px review) before integration.`);
      throw new IntegrationAbort();
    }
    // Review round 1 (F1): recovery must not stamp the recovered
    // active → review transition with its own wall clock — a wall-clock
    // entry postdates the stored approval and the projection silently drops
    // the resulting negative review dwell. The entry time comes from an
    // authoritative source: the Review round's own startedAt, or, when
    // recovery creates the Review through the handoff operation, the PR
    // creation time of the PR the provider approval was recorded on.
    const entryRound = missionLoad.mission.review?.rounds?.length
      ? missionLoad.mission.review.rounds[missionLoad.mission.review.rounds.length - 1]
      : null;
    // A stored approval alone is not authority while a review provider exists:
    // the provider approval must corroborate it. When no review provider is
    // configured (`review.provider !== 'forgejo'`), there is no provider state
    // to refresh and the stored ReviewerDecision is the only approval
    // authority there can be — requiring a provider approval would make such a
    // repository permanently unintegratable.
    const providerlessStoredApproval = context.approval?.ok === true && context.approval.providerDisabled === true;
    if (entryRound?.decision?.kind === 'approved' && overrideApprovedAt === undefined && !providerlessStoredApproval) {
      fmt.log.fail(`Mission ${missionId(context.slug)} has a stored approval without the required provider approval. Refresh provider review state before integration.`);
      throw new IntegrationAbort();
    }
    let reviewEntryAt = entryRound?.startedAt;
    if (!reviewEntryAt && typeof context.pr?.createdAt === 'string' && context.pr.createdAt) {
      reviewEntryAt = context.pr.createdAt;
    }
    if (!reviewEntryAt) {
      fmt.log.fail(`Cannot derive an authoritative review-entry timestamp for ${context.slug}: no Review round startedAt and no PR creation time. Re-run px review ${context.slug} --start to record the review entry, or record the decision through px review, before integration.`);
      throw new IntegrationAbort();
    }
    const approvalAt = (entryRound?.decision?.kind === 'approved' ? entryRound.decision.decidedAt : undefined) ?? overrideApprovedAt;
    const entryMs = Date.parse(reviewEntryAt);
    const approvalMs = approvalAt !== undefined ? Date.parse(approvalAt) : NaN;
    if (Number.isNaN(entryMs) || (approvalAt !== undefined && (Number.isNaN(approvalMs) || entryMs > approvalMs))) {
      fmt.log.fail(`Authoritative timestamps for ${context.slug} are inverted or unparseable: review entry ${reviewEntryAt} vs approval ${approvalAt ?? 'none'}. Resolve the Review before integrating.`);
      throw new IntegrationAbort();
    }
    // An already-approved round is a decided review, not a fresh handoff:
    // replaying submit-for-review would return the round unchanged and the
    // workflow guard would reject it ("A submitted review must be awaiting a
    // reviewer decision"). Skip the handoff replay (AC #2) and move the lane to
    // review via a direct submit-for-review that passes the existing round
    // through unchanged; the workflow guard recognises the decided round and
    // moves active → review without rewriting it, so the approve transition
    // below runs at the stored decidedAt. A genuinely fresh round still goes
    // through the handoff operation unchanged (AC #3).
    if (entryRound?.decision?.kind === 'approved') {
      await missionServices.lifecycle.transition({
        operationId: `integrate-active-review:${context.slug}`,
        missionId: missionId(context.slug),
        expectedVersion: missionLoad.version,
        capabilities: new Set(['mission:transition']),
        // The round is already decided, so the workflow guard moves the lane
        // before it ever inspects reviewer eligibility; this is a stand-in for
        // that check, not a real review assignment.
        command: {
          type: 'submit-for-review',
          gatesPassed: true,
          review: missionLoad.mission.review,
          reviewerEligibility: ConfiguredReviewerEligibility.fromReviewStep({
            eligible: [agentFamily('configured-reviewer')],
            strategy: 'random',
          }),
        },
        actor: missionLoad.mission.assignee ?? 'custom',
        occurredAt: reviewEntryAt,
        idempotencyKey: `active-review:${context.slug}:${reviewEntryAt}`,
      });
      missionLoad = await missionServices.store.load(missionId(context.slug));
    } else {
      // Submit through the existing handoff operation; it alone owns the
      // active → review rules and persists the Review aggregate. The
      // authoritative entry timestamp rides along so the persisted lane event
      // and the Review round both carry it instead of the recovery wall clock.
      await submitForReviewFn(context.slug, false, {
        missionServicesFn: async () => missionServices,
        exit: (code: number) => { throw new Error(`submit-for-review exited ${code}`); },
        occurredAt: reviewEntryAt,
      });
      missionLoad = await missionServices.store.load(missionId(context.slug));
      if (missionLoad.kind !== 'found' || missionLoad.mission.status !== 'review') {
        fmt.log.fail(`Mission ${missionId(context.slug)} did not reach review through submit-for-review; resolve the Review handoff before integration.`);
        throw new IntegrationAbort();
      }
    }
  }

  if (missionLoad.mission.status === 'integration') {
    return { recovered: false, status: 'integration' };
  }
  if (missionLoad.mission.status !== 'review' || !missionLoad.mission.review) {
    fmt.log.fail(`Mission ${missionId(context.slug)} is ${missionLoad.mission.status}; integration requires an authoritative approved Review.`);
    throw new IntegrationAbort();
  }

  let reviewRound = missionLoad.mission.review.rounds[missionLoad.mission.review.rounds.length - 1];
  if (reviewRound.decision?.kind !== 'approved' && overrideApprovedAt !== undefined) {
    // Observe the previously happened approval late: persist it at its own
    // timestamp, then let the existing approve transition below run at that
    // same time. Recovery never stamps the approval with its own start time.
    const reloaded = await recordHumanOverrideDecision(context, {
      missionServices,
      missionLoad,
      overrideApprovedAt,
    });
    if (!reloaded || reloaded.mission.status !== 'review' || !reloaded.mission.review) {
      throw new IntegrationAbort();
    }
    missionLoad = reloaded;
    reviewRound = missionLoad.mission.review.rounds[missionLoad.mission.review.rounds.length - 1];
  }
  if (reviewRound.decision?.kind !== 'approved') {
    fmt.log.fail(`Mission ${missionId(context.slug)} is in review without an authoritative approval. Record a ReviewerDecision through px review before integration.`);
    throw new IntegrationAbort();
  }
  const approval = await missionServices.lifecycle.transition({
    operationId: `integrate-approve:${context.slug}`,
    missionId: missionId(context.slug),
    expectedVersion: missionLoad.version,
    capabilities: new Set(['mission:transition']),
    command: { type: 'approve', review: missionLoad.mission.review },
    actor: missionLoad.mission.assignee ?? 'custom',
    occurredAt: reviewRound.decision.decidedAt,
    idempotencyKey: `approve:${context.slug}:round-${reviewRound.number}`,
  });
  if (approval.status !== 'completed') {
    fmt.log.fail(`Mission approval failed before integration: ${approval.error?.message || 'unknown'}.`);
    throw new IntegrationAbort();
  }
  context.missionStatus = 'integration';
  return { recovered: true, status: 'integration', occurredAt: reviewRound.decision.decidedAt };
}

/**
 * True when the current process sits inside the mission's own worktree.
 *
 * Mirrors the pre-cleanup chdir check below: `px integrate` run from the
 * mission worktree is the documented flow, not an anomaly.
 *
 * @param {string} slug
 */
function isCwdInsideMissionWorktree(slug: string) {
  const missionWorktree = conventionalWorktreePath(slug);
  const cwd = process.cwd();
  return cwd === missionWorktree || cwd.startsWith(missionWorktree + path.sep);
}

/**
 * The trust evidence a human needs to authorize landing, and nothing else.
 *
 * Every row is a claim Parallix can establish authoritatively: the Mission
 * store's own Review (ADR 0053), the integration gate result (ADR 0041), and
 * git. A claim that cannot be established is omitted rather than guessed —
 * notably, invoking `px integrate` *is* the human decision, so no row ever
 * asserts that a human inspected the diff.
 *
 * @param {any} context
 * @param{{verification: string}} outcome
 * @returns {[string, string][]}
 */
export function buildIntegrationReadiness(context: any, { verification }: { verification: string }): [string, string][] {
  const rounds: any[] = context.missionReview?.rounds ?? [];
  const approvedRound = [...rounds].reverse().find(round => round?.decision?.kind === 'approved') ?? null;
  const lastRound = rounds.length > 0 ? rounds[rounds.length - 1] : null;
  const evidenceRound = approvedRound ?? lastRound;

  /** @type {[string, string][]} */
  const rows: [string, string][] = [['Mission', context.slug]];

  if (approvedRound) {
    rows.push(['Review', `approved (round ${approvedRound.number})`]);
  } else if (context.approval?.ok && context.approval?.reviewState === 'APPROVED') {
    rows.push(['Review', 'approved']);
  }

  const reviewer = evidenceRound?.reviewer ?? null;
  const implementer = evidenceRound?.implementer ?? null;
  if (reviewer) {
    rows.push(['Reviewer', String(reviewer)]);
  }
  if (reviewer && implementer) {
    rows.push([
      'Independence',
      reviewer === implementer
        ? `same agent family as the implementer (${implementer})`
        : `different agent family from the implementer (${implementer})`,
    ]);
  }

  rows.push(['Verification', verification]);
  rows.push(['Target', String(context.baseBranch || getPrimaryBranch())]);
  rows.push([
    'Workspace',
    context.mainDirty
      ? `${context.mainDirtyEntries.length} uncommitted change(s) in the integration checkout`
      : 'clean',
  ]);

  return rows;
}

/**
 * @param {[string, string][]} rows
 * @param{{log?: Function}} options
 */
export function printIntegrationReadiness(rows: [string, string][], { log = fmt.log.plain }: { log?: Function } = {}) {
  log('');
  log(fmt.bold('READY TO INTEGRATE'));
  log(fmt.table(rows.map(([label, value]) => [label, value])));
  log('');
}

/**
 * @param{{slug: string, branch: string, missionDir?: string, area: string, task: {ok: boolean, taskFile?: string, reason?: string, matches?: string[]}, taskStatus?: string, taskAssignee?: string|null, forgejoUser?: string|null, forgejoToken?: string|null, taskAssigneeWarning?: string|null, pr: {exists?: boolean, state?: string, number?: number, merged?: boolean, createdAt?: string | null, raw?: string}, siblingPrs: any[], approval: {ok?: boolean, error?: string, reviewState?: string, defaultUserApproved?: boolean, defaultUserApprovedAt?: string, source?: string}, baseBranch?: string, baseWorktree?: string, mainBranch: string, mainDirtyEntries: string[], mainDirty: boolean}} context
 */
function printIntegrationPreflight(
  context: any,
  {
    readTokenFn = readToken,
    resolveTokenFileFn = resolveTokenFile,
    detectRebaseStateFn = detectRebaseState,
    getUnresolvedIndexConflictsFn = getUnresolvedIndexConflicts,
    findMissionDocInBranchesFn = findMissionDocInBranches,
    isForgejoReviewEnabledFn = isForgejoReviewEnabled,
    gitFn = git,
    log = fmt.log.plain
  } = {}
) {
  // A null/undefined slug means the caller failed to resolve a real mission
  // before building preflight context. Fail loudly here instead of letting
  // "null" leak into operator-facing branch/path expectations below.
  if (!context.slug) {
    throw new Error('printIntegrationPreflight requires a context with a non-null mission slug.');
  }

  const failures = [];
  const warnings = [];

  // Implementation-level preflight facts are still checked exactly as before —
  // every failure below stays loud and still blocks. Only the *successful*
  // lines move behind DEBUG, so the default happy path carries the operator's
  // trust decision (printIntegrationReadiness) instead of a PASS cascade of
  // equal visual priority (TASK-2479).
  const detail = (text: string) => {
    if (process.env.DEBUG) { log(fmt.status('DEBUG', text)); }
  };

  // The integration "checkout" is the mission's base worktree on its base branch.
  // For legacy missions these fall back to the primary worktree/branch, so the
  // preflight output and checks are byte-identical to today.
  const baseWorktree = context.baseWorktree || getPrimaryWorktree();
  const baseBranch = context.baseBranch || getPrimaryBranch();

  detail(`Integration preflight for ${context.slug}`);

  const branchPrefix = missionBranchName(context.slug, baseWorktree);
  if ((/** @type {any} */ context).currentBranch === context.branch || (/** @type {any} */ context).currentBranch.startsWith(`${branchPrefix}-`)) {
    detail(`Mission branch: ${(/** @type {any} */ context).currentBranch}`);
  } else {
    failures.push('branch');
    log(fmt.status('FAIL', `Mission branch: current branch is ${(/** @type {any} */ context).currentBranch}, expected ${context.branch} (or a branch with a suffix)`));
  }

  if (context.missionDir) {
    detail(`Mission doc: ${path.join(context.missionDir, 'MISSION.md')}`);
  } else {
    failures.push('mission-doc');
    // Use the base slug (e.g. architecture migration) for the canonical path even when the
    // working slug carries a suffix (e.g. architecture migration-modern).
    const baseSlugMatch = context.slug.match(/^(task-\d+)/i);
    const canonicalSlug = baseSlugMatch ? baseSlugMatch[1].toLowerCase() : context.slug;
    const canonicalPath = path.relative(
      baseWorktree,
      path.join(missionDirForSlug(baseWorktree, canonicalSlug), 'MISSION.md')
    ).split(path.sep).join('/');
    log(fmt.status('FAIL', `Mission doc: ${canonicalPath} not found`));

    const candidates = findMissionDocInBranchesFn(context.slug, baseWorktree);
    if (candidates && candidates.length > 0) {
      log(fmt.status('INFO', `Found mission doc candidates on other branches. To recover, run:`));
      candidates.forEach(c => {
        log(fmt.status('INFO', `  git show ${c.branch}:${c.path} > ${canonicalPath}`));
      });
    }
  }

  if (context.task.ok) {
    detail(`Backlog task: ${path.basename(/** @type {string} */ (context.task.taskFile))} (${context.missionStatus || 'mission store'})`);
    
    try {
      const classification = getTaskClassification(/** @type {string} */ (context.task.taskFile));
      const classificationError = classification
        ? null
        : `Missing or invalid classification for ${context.slug}; expected exactly one of ai_sdlc, user_value, or unknown in the labels of ${context.task.taskFile}. Fix: add exactly one of those labels and do not use a separate frontmatter field for mission type.`;
      if (!classification) {
        failures.push('classification');
        log(fmt.status('FAIL', `Backlog classification: ${classificationError || 'missing'}`));
      } else {
        detail(`Backlog classification: ${classification}`);
      }
    } catch (/** @type{any} */ error) {
      failures.push('classification');
      log(fmt.status('FAIL', `Backlog classification: ${(error as Error).message || String(error)}`));
    }

    const taskStatusCheck = evaluateTaskStatusForIntegration(context);
    if (!taskStatusCheck.ok) {
      failures.push('task-status');
      log(fmt.status('FAIL', `${taskStatusCheck.message}`));
    } else if (taskStatusCheck.level === 'warn') {
      warnings.push('task-status-review-approved');
      log(fmt.status('WARN', `${taskStatusCheck.message}`));
    } else {
      detail(`${taskStatusCheck.message}`);
    }
  } else if (context.task.reason === 'ambiguous') {
    failures.push('task-ambiguity');
    log(fmt.status('FAIL', `Backlog task: ambiguous slug ${context.slug}`));
    if (context.task.matches) {
      context.task.matches.forEach((match: string) => log(`  - ${match}`));
    }
  } else if (isDbAdhocIdentity(context.slug)) {
    // An adhoc mission has no Backlog task to find: the Mission store carries
    // its status and labels (ADR 0053), so read them there rather than warning
    // about the absence of a file this intake never creates in the base
    // checkout.
    detail(`Backlog task: none — adhoc mission, Mission store is authoritative`);
    const classification = classificationFromLabels(context.missionLabels || []);
    if (classification) {
      detail(`Mission classification: ${classification}`);
    } else {
      failures.push('classification');
      log(fmt.status('FAIL', `Mission classification: expected exactly one of ${[...CLASSIFICATION_LABELS].join(', ')} in the Mission labels for ${context.slug}.`));
    }

    const adhocStatusCheck = evaluateTaskStatusForIntegration(context);
    if (!adhocStatusCheck.ok) {
      failures.push('task-status');
      log(fmt.status('FAIL', `${adhocStatusCheck.message}`));
    } else if (adhocStatusCheck.level === 'warn') {
      warnings.push('task-status-review-approved');
      log(fmt.status('WARN', `${adhocStatusCheck.message}`));
    } else {
      detail(`${adhocStatusCheck.message}`);
    }
  } else {
    log(fmt.status('WARN', `Backlog task: no task file found for ${context.slug}; continuing with synthetic/unknown task metadata.`));
    detail('Backlog classification: unknown');
  }

  if (isForgejoReviewEnabledFn(baseWorktree)) {
    const localApproved = context.approval?.source === 'local-review-state';
    const localApprovalFallback = localApproved;
    // Review round 1 (F3): predict the authority the real run would establish
    // through recovery; consumed only when the provider state looks
    // unapproved and the Mission lifecycle has not already left review (a
    // dry run has not run recovery, so missionStatus is still stale).
    const recoveryDecision = recoveryEstablishesApproval(context);
    const recoveryWouldEstablishApproval = recoveryDecision.established && recoveryDecision.via !== 'lifecycle';

    if (context.pr.exists && context.pr.state === 'open') {
      detail(`Forgejo PR: PR #${context.pr.number} open`);
      if (context.missionStatus === 'integration' || context.missionStatus === 'done') {
        // TASK-2379: recovery has established the authoritative approval in
        // the Mission lifecycle; the provider state read at context build
        // time is informational from here on.
        detail(`Forgejo approval: Mission lifecycle is authoritative (${context.missionStatus}); provider state informational (${context.approval.reviewState || 'missing'})`);
      } else if (localApprovalFallback) {
        detail(`Forgejo approval: token unavailable, approval sourced from the local Review (phase=approved)`);
      } else if (!context.approval.ok) {
        failures.push('pr-approval');
        log(fmt.status('FAIL', `Forgejo approval: could not verify an approved review (${context.approval.error})`));
      } else if (context.approval.reviewState !== 'APPROVED' && !recoveryWouldEstablishApproval) {
        failures.push('pr-approval');
        log(fmt.status('FAIL', `Forgejo approval: latest formal review state is ${context.approval.reviewState || 'missing'}, expected APPROVED`));
      } else if (context.approval.reviewState !== 'APPROVED') {
        // A dry run has not run recovery, so the provider state read at
        // context-build time looks unapproved. Report the authority the real
        // run would establish instead of failing for exactly the case the
        // real run accepts.
        detail(`Forgejo approval: recovery would establish the authoritative approval (${recoveryDecision.via} at ${recoveryDecision.decidedAt || 'n/a'}); provider state informational (${context.approval.reviewState || 'missing'})`);
      } else {
        detail(`Forgejo approval: latest formal review state is ${context.approval.reviewState}`);
      }
    } else if (context.pr.exists && context.pr.state === 'merged') {
      failures.push('pr-merged');
      log(fmt.status('FAIL', `Forgejo PR: PR #${context.pr.number} is already marked merged`));
      printMergedPrRecoveryGuidance(log, context.slug, baseWorktree, baseBranch);
    } else if (context.pr.exists) {
      failures.push('pr-state');
      log(fmt.status('FAIL', `Forgejo PR: unexpected state '${context.pr.state}'`));
    } else {
      failures.push('pr-missing');
      log(fmt.status('FAIL', `Forgejo PR: ${context.pr.raw || 'no PR found'}`));
    }

    if (context.siblingPrs && context.siblingPrs.length > 0) {
      warnings.push('sibling-prs');
      const baseSlugMatch = context.slug.match(/^(task-\d+)/i);
      const baseSlug = baseSlugMatch ? baseSlugMatch[1].toLowerCase() : context.slug;
      log(fmt.status('WARN', `Multiple open PRs detected for ${baseSlug}. Close stale PRs before integrating:`));
      context.siblingPrs.forEach((p: any) => {
        log(fmt.status('INFO', `  - PR #${p.number} (${p.head}): ${p.html_url}`));
      });
    }

    if (context.forgejoUser) {
      const tokenPath = resolveTokenFileFn(/** @type {string} */ (context.forgejoUser));
      const token = readTokenFn(/** @type {string} */ (context.forgejoUser));
      if (token) {
        detail(`Forgejo token: resolved for ${context.forgejoUser} (${tokenPath || 'env:FORGEJO_TOKEN'})`);
      } else if (localApprovalFallback) {
        detail(`Forgejo token: no token file found for ${context.forgejoUser} (approval sourced from the local Review)`);
      } else {
        failures.push('forgejo-token');
        log(fmt.status('FAIL', `Forgejo token: no token file found for ${context.forgejoUser}`));
      }
    } else if (!localApprovalFallback) {
      failures.push('forgejo-token');
      log(fmt.status('FAIL', 'Forgejo token: no forgejoUser configured'));
    }
  } else {
    detail('Forgejo PR/approval checks skipped (review provider is not forgejo).');
  }

  if (context.taskAssigneeWarning) {
    warnings.push('task-assignee');
    log(fmt.status('WARN', `${context.taskAssigneeWarning}`));
  }

  const expectedPrimaryBranch = baseBranch;
  if (context.mainBranch === expectedPrimaryBranch) {
    detail(`Integration checkout branch: ${baseWorktree} is on ${expectedPrimaryBranch}`);
  } else {
    failures.push('main-branch');
    const branchLabel = context.mainBranch || '(detached HEAD)';
    log(fmt.status('FAIL', `Integration checkout branch: expected ${expectedPrimaryBranch}, found ${branchLabel}`));
    log(fmt.status('INFO', `Retry with: git -C ${baseWorktree} checkout ${expectedPrimaryBranch}`));
  }

  const rebaseState = detectRebaseStateFn(baseWorktree);
  if (rebaseState.inProgress) {
    failures.push('rebase-in-progress');
    log(fmt.status('FAIL', `Integration checkout rebase: rebase in progress in ${baseWorktree}`));
    if (rebaseState.rebaseHead) {
      log(fmt.status('INFO', `Current rebase head: ${rebaseState.rebaseHead}`));
    }
    if (rebaseState.unmergedFiles.length > 0) {
      rebaseState.unmergedFiles.forEach(file => log(fmt.status('INFO', `  - ${file}`)));
    }
    log(fmt.status('INFO', 'Finish or abort the existing rebase before retrying:'));
    log(fmt.status('INFO', `  git -C ${baseWorktree} rebase --continue`));
    log(fmt.status('INFO', `  git -C ${baseWorktree} rebase --abort`));
    log(fmt.status('INFO', `  git -C ${baseWorktree} rebase --skip`));
    log(fmt.status('INFO', `Retry with: px integrate ${context.slug} --dry-run`));
  }

  const indexConflicts = getUnresolvedIndexConflictsFn(baseWorktree);
  if (!indexConflicts.ok) {
    failures.push('main-index-conflict-check');
    log(fmt.status('FAIL', `Integration checkout conflict scan: could not inspect ${baseWorktree} (${indexConflicts.error || 'unknown error'})`));
  } else if (indexConflicts.files.length > 0) {
    failures.push('main-index-conflicts');
    log(fmt.status('FAIL', `Integration checkout conflicts: unresolved merge entries detected in ${baseWorktree}`));
    indexConflicts.files.forEach(file => log(fmt.status('INFO', `  - ${file}`)));
    log(fmt.status('INFO', 'Resolve each conflicted path, then drop the stale stash entry before retrying:'));
    indexConflicts.files.forEach(file => {
      log(fmt.status('INFO', `  git -C ${baseWorktree} rm "${file}"`));
      log(fmt.status('INFO', `  git -C ${baseWorktree} add "${file}"`));
    });
    log(fmt.status('INFO', `  git -C ${baseWorktree} stash drop`));
    log(fmt.status('INFO', `Retry with: px integrate ${context.slug} --dry-run`));
  } else {
    detail('Integration checkout conflicts: no unresolved merge entries in the git index');
  }

  if (context.mainDirty) {
    // Detect dirty paths that overlap with files integrate mutates during closeout.
    // Unrelated backlog tasks are safe to stash and restore; only this mission's
    // task, mission artifacts, and the squash payload can collide with writes.
    const overlapPaths: string[] = [];
    const payloadResult = gitFn(['-C', baseWorktree, 'diff', '--name-only', '--no-renames', `${baseBranch}...${context.branch}`]);
    if (payloadResult.status === 0) {
      payloadResult.stdout.split('\n').map((file: string) => file.trim()).filter(Boolean).forEach((file: string) => overlapPaths.push(file));
    } else {
      failures.push('main-dirty-payload');
      const payloadError = String(payloadResult.stderr || 'git diff failed').split('\n')[0];
      fmt.log.fail(`[STASH] Could not determine the integration payload; refusing to stash a dirty checkout (${payloadError}).`);
    }
    const taskPath = context.task?.taskFile
      ? resolveIntegrationTaskPath(context.task.taskFile, context.missionWorktree, baseWorktree)
      : '';
    if (taskPath) {
      const taskRelativePath = path.relative(baseWorktree, taskPath);
      overlapPaths.push(taskRelativePath.split(path.sep).join('/'));
      overlapPaths.push(path.join('backlog/completed', path.basename(taskRelativePath)).split(path.sep).join('/'));
    }
    if (context.missionDir) {
      const relMissionPath = path.relative(baseWorktree, context.missionDir);
      overlapPaths.push(relMissionPath);
    }
    overlapPaths.push(`missions/${context.slug}`);

    const overlappingEntries: string[] = [];
    const nonOverlappingEntries: string[] = [];

    context.mainDirtyEntries.forEach((entry: string) => {
      // Extract the file path from git status --porcelain format (columns 3+)
      const filePath = entry.slice(3).trim();
      if (!filePath) {
        return;
      }

      // A first-run config is untracked by design. If the squash lands it,
      // restore drops the stash after confirming the landed file is preserved.
      const isRecoverableFirstRunConfig = entry.startsWith('?? ') && filePath === 'config/agents.json';
      let isOverlap = false;

      // Check against mission doc paths (scoped to current mission)
      if (!isRecoverableFirstRunConfig) {
        for (const mp of overlapPaths) {
          if (mp && (filePath === mp || filePath.startsWith(mp + path.sep) || filePath.startsWith(mp + '/'))) {
            isOverlap = true;
            break;
          }
        }
      }

      if (isOverlap) {
        overlappingEntries.push(entry);
      } else {
        nonOverlappingEntries.push(entry);
      }
    });

    if (overlappingEntries.length > 0) {
      // Upgrade to FAIL — overlapping dirty paths will collide with closeout mutations
      failures.push('main-dirty-overlap');
      fmt.log.fail(`[STASH] Integration checkout dirty: overlapping paths detected that collide with integrate closeout.`);
      overlappingEntries.forEach((entry: string) => log(fmt.status('WARN', `  - ${entry}`)));
      fmt.log.fail('Recovery steps:');
      fmt.log.fail(`  1. Commit or discard the overlapping changes in ${baseWorktree}`);
      fmt.log.fail(`     git -C ${baseWorktree} add ${overlappingEntries.map(e => `"${e.slice(3).trim()}"`).join(' ')}`);
      fmt.log.fail(`  2. Retry: px integrate ${context.slug} --dry-run`);
    } else if (nonOverlappingEntries.length > 0) {
      // Non-overlapping dirty paths are safe to stash and restore
      warnings.push('main-dirty');
      fmt.log.warn(`[STASH] Integration checkout dirty: ${baseWorktree} has uncommitted changes that will be stashed temporarily`);
      nonOverlappingEntries.forEach((entry: string) => log(fmt.status('INFO', `  - ${entry}`)));
    } else {
      detail('Integration checkout dirty state: clean');
    }
  } else {
    detail('Integration checkout dirty state: clean');
  }

  const gitDir = path.join(process.cwd(), '.git');
  const isMainRepo = fs.existsSync(gitDir) && !fs.lstatSync(gitDir).isSymbolicLink();
  const isCorrectPath = process.cwd() === baseWorktree;
  if (isMainRepo && isCorrectPath) {
    detail('Backlog context: resolves to main repository');
  } else if (isCwdInsideMissionWorktree(context.slug)) {
    // Running `px integrate` from the mission's own worktree is the documented
    // flow, and integrate chdir's to the integration checkout before any
    // closeout write. Warning about it trained operators to ignore the
    // warning line; keep the fact, drop the false alarm (TASK-2479).
    detail(`Backlog context: invoked from the mission worktree; closeout runs in ${baseWorktree}`);
  } else {
    warnings.push('backlog-context');
    log(fmt.status('WARN', `Backlog context: does not resolve to ${baseWorktree}. (Ignore if running from worktree to test dry-run; post-squash closeout still requires the local integration checkout).`));
  }

  detail('Forgejo configuration: allow_manual_merge assumed enabled');

  if (warnings.length > 0) {
    log(fmt.status('WARN', `Integration warnings: ${warnings.join(', ')}`));
  }

  detail(`${VARIANT_B_AUTOMATION_SUMMARY}`);

  return { failures, warnings };
}
// Attach all named exports as properties of the default export (mirrors original CJS shape for CommonJS require compatibility)
(integrate as any).resolveConflictsForMission = resolveConflictsForMission;
(integrate as any).cleanupMissionWorktree = cleanupMissionWorktree;
(integrate as any).rewriteWorktreePaths = rewriteWorktreePaths;
(integrate as any).isNoMergeToAbortResult = isNoMergeToAbortResult;
(integrate as any).buildConflictResolutionPrompt = buildConflictResolutionPrompt;
(integrate as any).VARIANT_B_AUTOMATION_SUMMARY = VARIANT_B_AUTOMATION_SUMMARY;
(integrate as any).stashMainCheckoutIfNeeded = stashMainCheckoutIfNeeded;
(integrate as any).restoreMainCheckoutStash = restoreMainCheckoutStash;
(integrate as any).evaluateTaskStatusForIntegration = evaluateTaskStatusForIntegration;
(integrate as any).promoteTaskForIntegrationIfNeeded = promoteTaskForIntegrationIfNeeded;
(integrate as any).recoverMissionForIntegration = recoverMissionForIntegration;
(integrate as any).findExistingSquashCommit = findExistingSquashCommit;
(integrate as any).printIntegrationPreflight = printIntegrationPreflight;
(integrate as any).resolveForgejoUserForIntegration = resolveForgejoUserForIntegration;
(integrate as any).getUnresolvedIndexConflicts = getUnresolvedIndexConflicts;
(integrate as any).parseStashPopCollisionFiles = parseStashPopCollisionFiles;
(integrate as any).reportStashPopFailure = reportStashPopFailure;
(integrate as any).maybeUpdateGraphifyOnPrimary = maybeUpdateGraphifyOnPrimary;
(integrate as any).SYNC_MERGED_DIAGNOSTICS = SYNC_MERGED_DIAGNOSTICS;
(integrate as any).printDiagnosticTable = printDiagnosticTable;
(integrate as any).reportSyncMergedFailure = reportSyncMergedFailure;
(integrate as any).recordPostIntegrationStats = recordPostIntegrationStats;
(integrate as any).recordPostIntegrationStatsOrAbort = recordPostIntegrationStatsOrAbort;
(integrate as any).runPostIntegrateHookOrAbort = runPostIntegrateHookOrAbort;
(integrate as any).formatRecordedStatsRow = formatRecordedStatsRow;
(integrate as any).detectChangedAreas = detectChangedAreas;
(integrate as any).parseFilesToAreas = parseFilesToAreas;
(integrate as any).loadIntegrationConfig = loadIntegrationConfig;
(integrate as any).getIntegrationGatePlan = getIntegrationGatePlan;
(integrate as any).printIntegrationGatePlan = printIntegrationGatePlan;
(integrate as any).buildIntegrationGateEnv = buildIntegrationGateEnv;
(integrate as any).captureFinalIntegrationTree = captureFinalIntegrationTree;
(integrate as any).parseIntegrateArgs = parseIntegrateArgs;
(integrate as any).resolveIntegrationVerificationWorktree = resolveIntegrationVerificationWorktree;
(integrate as any).buildIntegrationVerificationInvocation = buildIntegrationVerificationInvocation;
(integrate as any).classifyHookFailure = classifyHookFailure;
(integrate as any).executeIntegrationGates = executeIntegrationGates;
(integrate as any).orderIntegrationGates = orderIntegrationGates;
(integrate as any).gateMatchesChangedAreas = gateMatchesChangedAreas;
(integrate as any).buildIntegrationContext = buildIntegrationContext;
(integrate as any).prepareNoisePatchForSquash = prepareNoisePatchForSquash;
(integrate as any).areAllBacklogOnlyConflicts = areAllBacklogOnlyConflicts;
// Re-export getPrimaryWorktree from mission-utils
(integrate as any).getPrimaryWorktree = getPrimaryWorktree;
export default integrate;
export { integrate, detectChangedAreas, parseFilesToAreas, loadIntegrationConfig, getIntegrationGatePlan, printIntegrationGatePlan, buildIntegrationGateEnv, captureFinalIntegrationTree, parseIntegrateArgs, resolveIntegrationVerificationWorktree, buildIntegrationVerificationInvocation, executeIntegrationGates, orderIntegrationGates, gateMatchesChangedAreas, buildIntegrationContext, getPrimaryWorktree, VARIANT_B_AUTOMATION_SUMMARY, evaluateTaskStatusForIntegration, promoteTaskForIntegrationIfNeeded, recoverMissionForIntegration, printIntegrationPreflight, isIntendedPayloadAtHead };
