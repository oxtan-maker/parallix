import { commandErrorMessage } from './agent-result.js';

import { draftMissionServices, type DraftAdapterDependencies } from './draft-adapter-types.js';

import type { MissionIntakeService } from '../../../application/mission-intake-service.js';

import type { DraftWorkflowContext } from '../../../application/ports/cli-workflows.js';
import * as fmt from '../../../application/presentation/cli-format.js';
import { startDraftAgent, selectAgent, readAgentConfigOrExit } from '../../agents/agents.js';
import { resolveTaskFile, transitionTask, getTaskLabels } from '../../backlog/backlog.js';

import { transitionVirtual } from '../../config/state-map.js';

import { missionLabels, missionId } from '../../../domain/mission.js';

import { buildDraftPrompt, normalizeDraftClassification } from './draft-prompts.js';
import { enforceDraftCommitSafety } from './draft-conflicts.js';

import { validateStoredDraftClassification, readTaskTitle, recordDraftRefinement, repairDraftContract, restartDraftAgent, DRAFT_CONTRACT_REPAIR_ATTEMPTS } from './draft-workflow-support.js';
import { logDraftCompletion } from './draft-completion.js';
import { recordDraftImplementer, recordDraftStats } from './draft-telemetry.js';
import type { DraftWorkflowEnvironment } from './draft-workflow-adapter.js';
export async function draftIntake(environment: DraftWorkflowEnvironment, ctx: DraftWorkflowContext): Promise<DraftWorkflowContext> {
  const { logFn, errorFn, debugFn, exitedContext, safeExit } = environment;
  const resolveTaskFileFn = (ctx.options as DraftAdapterDependencies).resolveTaskFileFn || resolveTaskFile;
  const { missionTitle, taskLabels } = draftIntakeMirror(ctx, resolveTaskFileFn);

  let intakeOutcome: Awaited<ReturnType<MissionIntakeService['execute']>>;
  try {
    if (typeof ctx.missionServicesFn !== 'function') { throw new Error('draft command requires injected mission services'); }
    const missionServices = await draftMissionServices(ctx);
    intakeOutcome = await missionServices.intake.execute({
      operationId: `draft-intake-${ctx.slug}`,
      missionId: missionId(ctx.slug),
      repositoryId: missionServices.repositoryId,
      title: missionTitle,
      labels: missionLabels(taskLabels),
      rawStatus: 'backlog',
      externalTaskRef: null,
      capabilities: new Set(['mission:intake']),
    });
  } catch (intakeError) {
    errorFn(fmt.status('FAIL', `Mission intake to SQLite failed for ${ctx.slug}: ${(intakeError instanceof Error ? intakeError.message : String(intakeError))}`));
    logFn('Repair: ensure the operator-local database is reachable, then re-run the draft. The Backlog task was not transitioned.');
    safeExit(1);
    return exitedContext({ ...ctx });
  }

  if (intakeOutcome.status === 'completed') {
    debugFn(fmt.status('PASS', `Mission materialized in SQLite (v${intakeOutcome.value?.version})`));
  } else if (intakeOutcome.error?.kind === 'conflict') {
    logFn(fmt.status('INFO', `Mission already recorded in SQLite: ${intakeOutcome.error.message}`));
  } else {
    errorFn(fmt.status('FAIL', `Mission intake to SQLite failed for ${ctx.slug}: ${intakeOutcome.error?.message || 'unknown error'}`));
    logFn('Repair: resolve the intake failure above, then re-run the draft. The Backlog task was not transitioned.');
    safeExit(1);
    return exitedContext({ ...ctx });
  }

  return ctx;
}

export async function draftTransition(environment: DraftWorkflowEnvironment, ctx: DraftWorkflowContext): Promise<DraftWorkflowContext> {
  const { logFn, errorFn, plumbingLogFn, exitedContext, safeExit } = environment;
  const transitionTaskFn = (ctx.options as DraftAdapterDependencies).transitionTaskFn || transitionTask;

  const transitionOk = await transitionTaskFn(ctx.slug, 'backlog', { rootDir: ctx.targetWorktree, log: plumbingLogFn });
  // Backlog-backed missions keep the strict contract: a task-file transition
  // failure is fatal. A synthetic (adhoc) intake has no Backlog backing in an
  // adhoc-only repository, so its lifecycle is DB-authoritative and the
  // missing task-file transition is a best-effort no-op, not a failure. A
  // DB-owned (web/board-created) mission is the same: no Backlog file, DB
  // authority, best-effort no-op transition.
  if (!transitionOk && !ctx.syntheticTask && !ctx.dbOwned) {
    errorFn(fmt.status('FAIL', `Could not transition task ${ctx.slug} to backlog status.`));
    safeExit(1);
    return exitedContext({ ...ctx });
  }
  if (!transitionOk && (ctx.syntheticTask || ctx.dbOwned)) {
    logFn(fmt.status('WARN', `No Backlog task file to transition for ${ctx.slug}; lifecycle is DB-authoritative.`));
  }

  return ctx;
}

export async function draftLaunchAgent(environment: DraftWorkflowEnvironment, ctx: DraftWorkflowContext): Promise<DraftWorkflowContext> {
  const { logFn, errorFn, debugFn, plumbingLogFn, exitedContext, safeExit } = environment;
  const merged = ctx.options as DraftAdapterDependencies;
  const readAgentConfigOrExitFn = merged.readAgentConfigOrExitFn || readAgentConfigOrExit;
  const selectAgentFn = merged.selectAgentFn || selectAgent;
  const startDraftAgentFn = merged.startDraftAgentFn || startDraftAgent;
  const resolveTaskFileFn = merged.resolveTaskFileFn || resolveTaskFile;
  const recordDraftImplementerFn = merged.recordDraftImplementerFn || recordDraftImplementer;
  const recordDraftStatsFn = merged.recordDraftStatsFn || recordDraftStats;

  const agentConfig = readAgentConfigOrExitFn(undefined, { configuration: merged.configuration });
  const agent = ctx.agent || selectAgentFn('draft', { config: agentConfig, configuration: merged.configuration });
  const prompt = buildDraftPrompt(ctx.slug, { rootDir: ctx.mainRepo, worktree: ctx.targetWorktree || '' });
  logFn('');
  logFn(fmt.bold(`Running ${fmt.agent(agent)} to write the mission contract...`));
  const { agent: actualAgent, result } = await startDraftAgentFn({
    configuration: merged.configuration,
    prompt,
    slug: ctx.slug,
    worktree: ctx.targetWorktree,
    agent
  });
  debugFn(`Draft agent family: ${fmt.agent(actualAgent)}`);

  if (result.error) {
    errorFn(fmt.status('FAIL', `Could not start draft agent (${fmt.agent(actualAgent)}): ${commandErrorMessage(result.error)}`));
    safeExit(1);
    return exitedContext({ ...ctx, agent, actualAgent: actualAgent, agentResult: result });
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    errorFn(fmt.status('FAIL', `Draft agent (${fmt.agent(actualAgent)}) exited with status ${result.status}.`));
    safeExit(result.status || 1);
    return exitedContext({ ...ctx, agent, actualAgent: actualAgent, agentResult: result });
  }

  const taskResolutionAfter = resolveTaskFileFn(ctx.slug, ctx.targetWorktree);
  await recordDraftImplementerFn({
    selected: agent,
    actual: actualAgent,
    taskResolution: taskResolutionAfter,
    slug: ctx.slug,
    worktree: ctx.targetWorktree,
    // An agent fallback stays on the default path; the assignee bookkeeping
    // it performs afterwards does not.
    log: logFn,
    plumbingLog: plumbingLogFn
  });

  recordDraftStatsFn({
    configuration: merged.configuration,
    slug: ctx.slug,
    rootDir: ctx.targetWorktree,
    agentFamily: actualAgent,
    result,
    log: plumbingLogFn,
    error: errorFn
  });

  return { ...ctx, agent, actualAgent: actualAgent, agentResult: result };
}

export async function draftPostProcess(environment: DraftWorkflowEnvironment, ctx: DraftWorkflowContext): Promise<DraftWorkflowContext> {
  const { exitFn, logFn, errorFn, debugFn, exitedContext, safeExit } = environment;
  const merged = ctx.options as DraftAdapterDependencies;
  const normalizeDraftClassificationFn = merged.normalizeDraftClassificationFn || normalizeDraftClassification;
  const restartDraftAgentFn = merged.restartDraftAgentFn || restartDraftAgent;
  const readAgentConfigOrExitFn = merged.readAgentConfigOrExitFn || readAgentConfigOrExit;

  const normalizationResult = await validateStoredDraftClassification(ctx) ?? normalizeDraftClassificationFn(ctx.slug, ctx.targetWorktree, {
    configuration: merged.configuration,
    errorFn
  });
  if (!normalizationResult.ok) {
    logFn(fmt.status('WARN', `Post-draft mission type labels are not valid (${normalizationResult.reason}). Relaunching draft agent to repair them.`));
    const restartOk = await restartDraftAgentFn(ctx.slug, ctx.targetWorktree, {
      logFn,
      errorFn,
      exitFn,
      readAgentConfigOrExitFn,
      configuration: merged.configuration,
      selectAgentFn: merged.selectAgentFn,
      startDraftAgentFn: merged.startDraftAgentFn,
    });
    if (!restartOk) {
      safeExit(1);
      return exitedContext({ ...ctx });
    }
    const postRestartNorm = await validateStoredDraftClassification(ctx) ?? normalizeDraftClassificationFn(ctx.slug, ctx.targetWorktree, {
      configuration: merged.configuration,
      errorFn
    });
    if (!postRestartNorm.ok) {
      errorFn(fmt.status('FAIL', `Classification validation failed after recovery (${postRestartNorm.reason}).`));
      safeExit(1);
      return exitedContext({ ...ctx });
    } else {
      debugFn(fmt.status('PASS', `Post-draft mission type labels validated after restart: ${postRestartNorm.classification}`));
    }
  } else {
    debugFn(fmt.status('PASS', `Post-draft mission type labels validated: ${normalizationResult.classification}`));
  }

  return ctx;
}

export function draftCommitSafety(environment: DraftWorkflowEnvironment, ctx: DraftWorkflowContext): DraftWorkflowContext {
  const { logFn, errorFn, plumbingLogFn, exitedContext, safeExit } = environment;
  const enforceDraftCommitSafetyFn = (ctx.options as DraftAdapterDependencies).enforceDraftCommitSafetyFn || enforceDraftCommitSafety;

  try {
    enforceDraftCommitSafetyFn({ slug: ctx.slug, worktree: ctx.targetWorktree, logFn, plumbingLogFn });
  } catch (error) {
    errorFn(fmt.status('FAIL', (error instanceof Error ? error.message : String(error))));
    safeExit(1);
    return exitedContext({ ...ctx });
  }

  return ctx;
}

export async function draftFinalTransition(environment: DraftWorkflowEnvironment, ctx: DraftWorkflowContext): Promise<void> {
  const { logFn, errorFn, plumbingLogFn, safeExit } = environment;
  const { transitionTaskFn, transitionVirtualFn, repairDraftContractFn, enforceDraftCommitSafetyFn } = finalTransitionBindings(ctx);
  const merged = ctx.options as DraftAdapterDependencies;
  let refined = await recordDraftRefinement(ctx);
  for (let attempt = 1;refined.ok === false && draftRepairBudgetAllows(refined.contractIncomplete, attempt);attempt += 1) {
    logFn(fmt.status('WARN', `${refined.message} Sending it back to the draft agent (attempt ${attempt}/${DRAFT_CONTRACT_REPAIR_ATTEMPTS}).`));
    const repaired = await repairDraftContractFn(ctx.slug, ctx.targetWorktree, ctx.actualAgent || ctx.agent, refined.message, { configuration: merged.configuration, startDraftAgentFn: merged.startDraftAgentFn, logFn, errorFn });
    if (!repaired) { break; }
    try {
      enforceDraftCommitSafetyFn({ slug: ctx.slug, worktree: ctx.targetWorktree, logFn, plumbingLogFn });
    } catch (error) {
      errorFn(fmt.status('FAIL', (error instanceof Error ? error.message : String(error))));
      safeExit(1);
      return;
    }
    refined = await recordDraftRefinement(ctx);
  }
  if (refined.ok === false) {
    errorFn(fmt.status('FAIL', `Recording refinement for ${ctx.slug} failed: ${refined.message}`));
    logFn(refined.contractIncomplete
      ? `Repair: the draft agent did not record the missing parts. Record them from ${ctx.targetWorktree} with the commands named above, read them back with \`px status ${ctx.slug}\`, then re-run \`px draft ${ctx.slug}\`. The Backlog task was not transitioned to ready.`
      : 'Repair: ensure the operator-local database is reachable, then re-run the draft. The Backlog task was not transitioned to ready.');
    safeExit(1);
    return;
  }

  const transitionOptions = { rootDir: ctx.targetWorktree, log: plumbingLogFn };
  const readyOk = await transitionVirtualFn(transitionTaskFn, ctx.slug, 'ready', transitionOptions);
  // Best-effort mirror for synthetic (adhoc) intakes and DB-owned
  // (web/board-created) intakes: the DB authority records the refinement
  // above, so a missing Backlog task-file transition in an adhoc-only
  // repository is a no-op, not a failure.
  if (!readyOk && !ctx.syntheticTask && !ctx.dbOwned) {
    errorFn(fmt.status('FAIL', `Could not transition task ${ctx.slug} to ready status.`));
    safeExit(1);
    return;
  }
  if (!readyOk && (ctx.syntheticTask || ctx.dbOwned)) {
    logFn(fmt.status('WARN', `No Backlog task file transition for ${ctx.slug}; lifecycle is DB-authoritative.`));
  }

  await logDraftCompletion(ctx, environment.startedAtMs, logFn);
}

function draftIntakeMirror(ctx: DraftWorkflowContext, resolveTaskFileFn: typeof resolveTaskFile) {
  const getTaskLabelsFn = getTaskLabels;

  let missionTitle = ctx.syntheticTask?.title || ctx.slug;
  let taskLabels: string[] = [];
  try {
    const taskResolution = resolveTaskFileFn(ctx.slug, ctx.targetWorktree);
    taskLabels = taskResolution?.ok && taskResolution?.taskFile
      ? getTaskLabelsFn(taskResolution.taskFile)
      : [];
    if (taskResolution?.ok && taskResolution?.taskFile) {
      missionTitle = readTaskTitle(taskResolution.taskFile, missionTitle);
    }
  } catch {
    taskLabels = [];
  }

  return { missionTitle, taskLabels };
}

function finalTransitionBindings(ctx: DraftWorkflowContext) {
  const transitionTaskFn = (ctx.options as DraftAdapterDependencies).transitionTaskFn || transitionTask;
  const transitionVirtualFn = (ctx.options as DraftAdapterDependencies).transitionVirtualFn || transitionVirtual;

  // Record refinement on the Mission aggregate before the Backlog task
  // moves to ready. Activation demands `refined`, and intake materializes
  // every mission as `backlog`, so without this the persisted aggregate
  // would never leave the backlog and `px active` could not run. Ordering
  // it first keeps the failure story the same as intake's: a database
  // failure leaves the Backlog task where it was.
  const merged = ctx.options as DraftAdapterDependencies;
  const repairDraftContractFn = merged.repairDraftContractFn || repairDraftContract;
  const enforceDraftCommitSafetyFn = merged.enforceDraftCommitSafetyFn || enforceDraftCommitSafety;
  return { transitionTaskFn, transitionVirtualFn, repairDraftContractFn, enforceDraftCommitSafetyFn };
}

function draftRepairBudgetAllows(contractIncomplete: boolean, attempt: number): boolean { return contractIncomplete && attempt <= DRAFT_CONTRACT_REPAIR_ATTEMPTS; }
