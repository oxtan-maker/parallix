// @ts-nocheck
import { randomUUID } from 'node:crypto';
import { git, getWorktreeStatus } from '../../git/git.js';
import * as path from 'node:path';
import * as fmt from '../../../application/presentation/cli-format.js';
import * as agents from '../../agents/agents.js';
import { findMissionDir, findCheckpoints, getFirstLine, missionTitle, readMissionFile, inferSlug, getMissionYear, missionDirForSlug, isWorkflowGeneratedArtifact } from '../../filesystem/mission-utils.js';
import * as handoff from './handoff.js';
import { resolveTaskFile, transitionTask, getTaskStatus, getTaskImplementer } from '../../backlog/backlog.js';
import { recordStageStatsSafe, startReviewLoop } from '../../review/review-loop.js';
import * as repairHandoff from './repair-handoff.js';
import { assembleStagePrompt } from '../../assets/runtime-assets.js';
import { resolvePromptOverride } from '../../config/product-config.js';
import { isDbAdhocIdentity } from '../../../domain/mission.js';
// TASK-2377.05 (SC3/SC4): both handoff relaunch loops run through the one
// rebound kernel, so a bounce is only reported fixed when the check that failed
// re-runs and passes. The kernel owns the per-occurrence budget in memory.
import { rebound, DEFAULT_REBOUND_ATTEMPTS, type ReboundContext } from '../../../application/rebound-kernel.js';
import {
  buildTypedMissionRecoveryAdvice,
  isTypedCheckpointEvidenceFailure,
} from '../../../application/typed-mission-recovery-advice.js';

function renderActiveProgress(event, logFn) {
  if (event.phase === 'handoff') {
    logFn(fmt.status('PASS', `Implementation complete (${fmt.agent(event.agent)}).`));
  }
}

// The active operator story already states the implementer above, so the Backlog
// task-sync PASS ("transitioned to active ... and committed") is internal
// bookkeeping, not an operator signal (SC4: task-synchronization narration stays
// out of the normal active path). Keep genuine WARN lines; drop only the success
// commit confirmation. Used only for the execute-path transition in onLaunch.
/** @param {Function} l */
function suppressTaskSyncCommitLog(l) {
  return (/** @type{string} */ msg) => {
    if (/^\[PASS\] Task .* transitioned to .* and committed\./.test(fmt.stripAnsi(msg))) {return;}
    l(msg);
  };
}

/**
 * @param {string[]} args
 * @param {{inferSlugFn?: Function, service?: {execute: Function}, controller?: {dispatch: Function}, controllerFactory?: Function, rootDir?: string, exitFn?: Function, logFn?: Function, errorFn?: Function}} [options]
 */
async function active(args, options = {}) {
  const {
    inferSlugFn = inferSlug,
    service,
    controller,
    controllerFactory,
    serviceFactory,
    rootDir = process.cwd(),
    exitFn = process.exit,
    logFn = fmt.log.info,
    errorFn = fmt.log.fail,
    missionTitleFn = missionTitle
  } = options;
  const explicitSlug = args[0];
  const slug = inferSlugFn(explicitSlug);
  if (!slug) {
    errorFn('Usage: px active [<slug>] [--implementer <family>]');
    exitFn(1);
    return;
  }

  const normalizedSlug = slug.toLowerCase();

  // TASK-2517 SC4: a mission whose payload already landed on the base branch has
  // no active work left. Refuse before launching an implementer and point at the
  // closeout command. The guard is opt-in via the injected seam so direct unit
  // callers that do not set it keep their existing behaviour.
  const payloadLandedFn = options.payloadLandedFn ?? (() => false);
  if (await payloadLandedFn(normalizedSlug)) {
    errorFn(fmt.status('FAIL', `Mission ${normalizedSlug} payload already landed on the base branch. Close it out with: px integrate ${normalizedSlug} --recover-landed`));
    exitFn(1);
    return;
  }

  // Strip a trailing mission id from the title so the headline never repeats
  // the slug (SC4/Why Now: repeated identity is a defect). Works for any id
  // shape, not just `task-NNNN` (e.g. `parallix-adhoc-<NNNN>` adhoc slugs).
  const stripTrailingId = (t: string) => t.replace(/\s*\([\w.-]+\)\s*$/i, '');
  const title = stripTrailingId(missionTitleFn(normalizedSlug) ?? '');
  logFn(`Mission ${fmt.slug(normalizedSlug)}${title ? `: ${title}` : ''}`);

  // Allow operators to pin the implementer agent family via CLI flag instead of WORKFLOW_AGENT env var.
  /** @param {string[]} arr @param {string} flag @param {string} name */
  function flagValue(arr, flag, name) {
    const i = arr.indexOf(flag);
    if (i === -1) {return null;}
    const v = arr[i + 1];
    if (!v || v.startsWith('--')) {
      errorFn(fmt.status('FAIL', `Missing value for --${name}. Usage: px active <slug> --${name} <family>`));
      exitFn(1);
      return null;
    }
    return v;
  }
  const preselectedImplementer = flagValue(args, '--implementer', 'implementer');
  if (args.includes('--implementer') && !preselectedImplementer) {return;}

  const renderProgress = event => renderActiveProgress(event, logFn);
  const operationId = `active:${normalizedSlug}:${randomUUID()}`;
  const outcome = await executeActiveCommand({ controller, controllerFactory, service, serviceFactory, rootDir, renderProgress, operationId, slug: normalizedSlug, agent: preselectedImplementer });
  if (outcome.status !== 'completed' || !outcome.value) {
    reportActiveFailure(outcome, normalizedSlug, errorFn, exitFn);
    return;
  }
}

async function executeActiveCommand({ controller, controllerFactory, service, serviceFactory, rootDir, renderProgress, operationId, slug, agent }) {
  const dispatcher = controller || (typeof controllerFactory === 'function' ? await controllerFactory(rootDir, renderProgress) : null);
  if (dispatcher) { return dispatcher.dispatch({ kind: 'active:execute', missionId: slug, operationId, agent, capabilities: new Set(['active:execute']), detached: false }); }
  const executeService = service || (typeof serviceFactory === 'function' ? await serviceFactory(rootDir, renderProgress) : null);
  if (!executeService) { throw new Error('active command requires an injected execute-mission service'); }
  return executeService.execute({ operationId, slug, agent, capabilities: new Set(['active:execute']) });
}

function reportActiveFailure(outcome, slug, errorFn, exitFn) {
  const message = outcome.error?.message || 'Could not launch execute agent.';
  const display = message === 'execute preflight failed' ? 'Preflight failed. Fix blockers above before launching the execute agent.'
    : message === 'dedicated execute worktree is required' ? `Could not locate dedicated worktree for mission/${fmt.slug(slug)}. Run "px draft ${slug}" first or create the worktree manually.` : message;
  errorFn(display);
  exitFn(Number(/exited with status (\d+)/.exec(message)?.[1] || 1));
}

// Select an active-step agent, launch it, and record the actual implementer in
// Backlog only after a successful launch. Accepts injectable dependencies so the
// selection/launch/record sequence can be verified in tests without process.exit.
//
// State-ordering contract:
//   selectAgent → startAgent (launch) → record Backlog (status=active, assignee)
//
// Backlog status is moved to 'active' from the onLaunch hook, which fires
// immediately after the launcher successfully spawns the process. If the final
// launch result later fails, we roll the task status back to the prior status.
/**
 * @param {{slug: string, worktree: string, preselectedAgent?: string | null, agentConfig: object, taskResolution: object, prompt: string, startAgentFn?: Function, transitionTaskFn?: Function, getTaskStatusFn?: Function, getTaskImplementerFn?: Function, selectAgentFn?: Function, log?: Function, sessionMarkerPort?: object | null, onAgentLaunched?: (agent: string) => Promise<void>, authorityAlreadyActive?: boolean, unrefChild?: boolean}} opts
 */
async function selectLaunchAndRecord(opts) {
  const {
    slug,
    worktree,
    preselectedAgent = null,
    agentConfig,
    taskResolution,
    prompt,
    startAgentFn = (/** @type{string} */ step, /** @type{any} */ opts) => agents.startAgent(step, opts),
    transitionTaskFn = transitionTask,
    getTaskStatusFn = getTaskStatus,
    getTaskImplementerFn = getTaskImplementer,
    selectAgentFn = agents.selectAgent,
    log = fmt.log.plain,
    sessionMarkerPort = null,
    // Reports every family the launcher actually starts, including each
    // automatic failover after a usage block. The application layer turns that
    // into the mission's current work; this adapter draws no conclusion.
    onAgentLaunched = null,
    // TASK-2582: the authoritative active boundary. The application layer
    // persists the Mission's active transition (state + lane event) when the
    // launcher confirms the spawn; a rejection fails the run.
    onActivated = null,
    authorityAlreadyActive = false,
    // Board fire-and-forget dispatch: unref the child so the board process can
    // exit on q/Ctrl+C while the action runs on (CP-4 ownership rule).
    unrefChild = false,
  } = opts;
  const preselected = preselectedAgent || selectAgentFn('active', { config: agentConfig });
  const taskResolutionTyped = /** @type{{ok: boolean, taskFile?: string} | undefined} */(taskResolution);
  const taskFile = taskResolutionTyped && taskResolutionTyped.ok && taskResolutionTyped.taskFile
    ? taskResolutionTyped.taskFile
    : null;
  const priorStatus = taskFile ? getTaskStatusFn(taskFile) : null;
  const priorImplementer = taskFile ? getTaskImplementerFn(taskFile) : null;
  let launchRecorded = false;
  let authoritativeActivationCommitted = authorityAlreadyActive;
  let launchTransitionFailed = false;
  let rebaseDeferred = false;
  let launchedAgent = null;
  const rollbackIfNeeded = async ({ throwOnFailure = true } = {}) => {
    // A failed run does not undo a committed lifecycle transition. Keep the
    // mirror active so retry/resume sees the same lane as the Mission store.
    if (authoritativeActivationCommitted || !launchRecorded || !priorStatus) {
      return;
    }

    log(fmt.status('WARN', `Execute launch for ${fmt.slug(slug)} did not complete cleanly; rolling task state back to ${priorStatus} / ${priorImplementer || 'none'}.`));
    // The rollback transition commits a task-sync PASS too; suppress that
    // bookkeeping line exactly like the onLaunch transition does (F1) so the
    // normal active path never carries task-synchronization narration.
    /** @type{{rootDir: string, log: Function, implementer?: string, clearAssignee?: boolean}} */
    const rollbackOpts = { rootDir: worktree, log: suppressTaskSyncCommitLog(log) };
    if (priorImplementer) {
      rollbackOpts.implementer = priorImplementer;
    } else {
      rollbackOpts.clearAssignee = true;
    }
    if (!await transitionTaskFn(slug, priorStatus, rollbackOpts)) {
      const msg = `Failed to roll back task ${fmt.slug(slug)} to ${priorStatus} after execute launch failure.`;
      if (throwOnFailure) {throw new Error(msg);}
      log(fmt.status('WARN', msg));
    }
    launchRecorded = false;
  };

  let actual;
  let result;
  try {
    ({ agent: actual, result } = await startAgentFn('active', {
      prompt,
      worktree,
      agent: preselected,
      slug: slug,
      role: 'implementer',
      unrefChild,
      sessionMarkerPort: sessionMarkerPort ?? undefined,
      onLaunch: async (/** @type{{agent: string, startedAtMs?: number}} */ { agent, startedAtMs }) => {
        launchedAgent = agent;
        // The authoritative active boundary lands here, as destination-state
        // work begins: the Mission state and its lane event persist before the
        // Backlog mirror moves and before any current-work publication
        // (TASK-2582). A failure stops the run: the Backlog task is not
        // written and no success output follows the agent's completion.
        if (onActivated) {
          try {
            await onActivated(agent, startedAtMs);
            authoritativeActivationCommitted = true;
          } catch (err) {
            // The authoritative active boundary refused to commit. Fail the
            // launch here, at the boundary — not after the agent exits: no
            // dependent work may run under an uncommitted transition, and the
            // operator sees the failure immediately (TASK-2582 review F1).
            // Throwing also stops the Backlog transition and current-work
            // publication below; startAgent stops the already-spawned agent
            // child and propagates the rejection without awaiting the agent
            // result (TASK-2582 review F4).
            const message = `Failed to persist the active lifecycle boundary for task ${fmt.slug(slug)}: ${err instanceof Error ? err.message : String(err)}`;
            log(fmt.status('FAIL', message));
            throw new Error(message);
          }
        }
        // Awaited: the caller publishes the mission's current work here, and
        // that write must land before the run reports its next state.
        await onAgentLaunched?.(agent);
        if (!(taskResolutionTyped && taskResolutionTyped.ok)) {
          return;
        }

        const fallback = agent !== preselected ? ` (selected ${fmt.agent(preselected)}; fallback)` : '';
        log(fmt.status('INFO', `Implementer: ${fmt.agent(agent)}${fallback}`));
        if (!await transitionTaskFn(slug, 'active', {
          implementer: agent,
          rootDir: worktree,
          log: suppressTaskSyncCommitLog(log),
        })) {
          launchTransitionFailed = true;
          return;
        }

        launchRecorded = true;
        rebaseDeferred = true;
      },
      onLimitHit: () => {
        // Legacy launches can undo their mirror-only write. Once activation
        // commits through the lifecycle authority, retain active for retry.
        rollbackIfNeeded({ throwOnFailure: false });
      },
      // The agent's own terminal stream is the progress record. Keep only
      // conditions an operator must act on; the normal launcher trace is debug detail.
      log: (message) => {
        if (/\[(WARN|FAIL)\]|No output yet|Still waiting/.test(message)) { log(message); }
      }
    }));
  } catch (err) {
    await rollbackIfNeeded();
    throw err;
  }

  // `actual` is the family that actually ran (may differ from `preselected` after
  // a limit-hit fallback inside startAgent). Use it as the canonical implementer.
  const agent = actual || launchedAgent || preselected;
  const launchSucceeded = !result.error && (typeof result.status !== 'number' || result.status === 0);

  if (!launchSucceeded) {
    await rollbackIfNeeded();
  }

  if (launchTransitionFailed) {
    throw new Error(`Failed to record task ${fmt.slug(slug)} as active after execute launch.`);
  }

  return { preselected, agent, result, rebaseDeferred };
}

// When startAgent falls back to a different family after a limit hit, the
// implementer that actually ran is `actual`, not the originally `preselected`
// one. Re-record the resolved agent in the Backlog task so the post-active
// handoff and the autonomous review loop poll the correct Forgejo identity.
/** @param {{slug: string, preselected: string, actual: string, taskResolution: object, worktree: string, log?: Function, transitionTaskFn?: Function}} opts */
function applyExecuteFallback(opts) {
  const {
    slug,
    preselected,
    actual,
    taskResolution,
    worktree,
    log = fmt.log.plain,
    transitionTaskFn = transitionTask
  } = opts;
  if (!actual || actual === preselected) {
    return preselected;
  }
  const taskResolutionTyped2 = /** @type{{ok: boolean, taskFile?: string} | undefined} */(taskResolution);
  if (taskResolutionTyped2 && taskResolutionTyped2.ok) {
    log(fmt.status('INFO', `Execute agent fell back from ${fmt.agent(preselected)} to ${fmt.agent(actual)}; enforcing backlog assignee.`));
    transitionTaskFn(slug, 'active', { implementer: actual, rootDir: worktree, log }).catch((err) => {
      log(fmt.status('WARN', `Could not record fallback implementer ${fmt.agent(actual)} in backlog task: ${err instanceof Error ? err.message : String(err)}`));
    });
  }
  return actual;
}

/**
 * Flatten the handoff gate's captured output into the single diagnostic string
 * the kernel's `handoff-verification` reason carries into the fix prompt.
 * @param {{stdout?: string, stderr?: string}} [gateOutput]
 */
function flattenGateOutput(gateOutput) {
  if (!gateOutput) {
    return undefined;
  }
  const joined = [gateOutput.stdout, gateOutput.stderr].filter(Boolean).join('\n').trim();
  return joined || undefined;
}

/** @param {string} errorMsg */
function nextMissingCheckpointFromError(errorMsg) {
  const match = /Declared checkpoint documents are missing before handoff:\s*([^.]*)\./.exec(errorMsg);
  return match ? /CP-\d+/.exec(match[1])?.[0] || null : null;
}

/** @param {string} slug @param {string} worktree @param {string} nextCheckpoint */
function buildCheckpointContinuationPrompt(slug, worktree, nextCheckpoint, typedMission = false) {
  if (typedMission) {
    return buildTypedMissionRecoveryAdvice(slug, nextCheckpoint);
  }
  return `Mission ${slug} is incomplete: ${nextCheckpoint}. Continue the existing execute mission in ${worktree} from ${nextCheckpoint}. ` +
    `Complete ${nextCheckpoint} and record its evidence, then immediately continue to every remaining declared checkpoint and mission gate. ` +
    `Do not exit or send a final response until every declared checkpoint has its evidence and every mission-declared gate passes, unless a mission stop rule applies or a genuine external dependency blocks progress.`;
}

/** @param {string} missionText */
function parseDeclaredCheckpointNames(missionText) {
  const section = /^## Checkpoints\s*$/m.exec(missionText);
  if (!section || section.index === undefined) {
    return { names: [], error: 'MISSION.md must contain a ## Checkpoints section with declarations such as "- CP 1: <name>".' };
  }

  // Checkpoint Documentation Requirements is a level-3 subsection of the
  // checkpoint section. Stop before it so its prose bullets are not parsed as
  // declarations.
  const sectionBody = missionText.slice(section.index + section[0].length).split(/^#{2,3}\s/m, 1)[0];
  const checkpointLines = sectionBody.split('\n').filter(line => /^\s*-\s*(?:\*\*|__|\*)?CP(?:\s*-\s*|\s*)\d/i.test(line));
  const names = [];
  for (const line of checkpointLines) {
    const match = /^\s*-\s*(?:\*\*|__|\*)?CP(?:\s*-\s*|\s*)(\d+)(?:\s*\([^)]*\))?(?:\*\*|__|\*)?\s*(?::|—|–|-)\s*\S/i.exec(line);
    if (!match) {
      return { names: [], error: `Malformed checkpoint declaration in MISSION.md: ${line.trim()}. Use a CP number followed by :, —, –, or -.` };
    }
    names.push(`CP-${match[1]}`);
  }

  if (names.length === 0) {
    return { names: [], error: 'MISSION.md ## Checkpoints section contains no checkpoint declarations. Use "- CP N: <name>" or "- CP-N: <name>".' };
  }
  return { names: [...new Set(names)] };
}

/**
 * Every declared checkpoint must have its evidence before handoff.
 *
 * A mission drafted through the typed verbs declares its checkpoints as a
 * recorded plan and records their evidence as Mission state, supplied by
 * `loadRecordedCheckpointsFn`. A mission drafted before that (the loader returns
 * null) declares them in its mission document and evidences them as committed
 * `CP-N.md` files. Either way a gap names the next checkpoint, which is what the
 * continuation relaunch resumes from.
 *
 * @param {string} slug @param {string} worktree
 * @param {{findMissionDirFn?: Function, findCheckpointsFn?: Function, readMissionFileFn?: Function, runFn?: Function, loadRecordedCheckpointsFn?: (slug: string) => Promise<{planned: string[], recorded: string[]} | null>, log?: Function, error?: Function}} [options]
 */
async function validateCheckpointsBeforeHandoff(slug, worktree, options = {}) {
  const {
    loadRecordedCheckpointsFn = async () => null,
    findMissionDirFn = findMissionDir,
    findCheckpointsFn = findCheckpoints,
    readMissionFileFn = readMissionFile,
    runFn = git,
    log = fmt.log.plain,
    error = fmt.log.plainError
  } = options;
  const recordedCheckpoints = await loadRecordedCheckpointsFn(slug);
  if (recordedCheckpoints) {
    const missing = recordedCheckpoints.planned.filter((name) => !recordedCheckpoints.recorded.includes(name));
    if (missing.length > 0) {
      const msg = `Planned checkpoint evidence is missing before handoff: ${missing.join(', ')}. Record each with \`px checkpoint record --name <CP-N>\` before handoff.`;
      error(msg);
      return { ok: false, error: msg, missingCheckpoints: missing, nextCheckpoint: missing[0] };
    }
    log(fmt.status('PASS', `All ${recordedCheckpoints.planned.length} planned checkpoint(s) have recorded evidence.`));
    return { ok: true, declaredCheckpoints: recordedCheckpoints.planned };
  }
  const rootDir = worktree || process.cwd();
  const missionDir = findMissionDirFn(slug, rootDir);
  if (!missionDir) {
    const msg = `Mission directory not found for slug: ${fmt.slug(slug)}. Cannot validate checkpoints.`;
    error(msg);
    return { ok: false, error: msg };
  }

  let declared;
  try {
    declared = parseDeclaredCheckpointNames(readMissionFileFn(missionDir));
  } catch (err) {
    const msg = `Could not read ${fmt.path(path.join(missionDir, 'MISSION.md'))} to validate declared checkpoints: ${/** @type{Error} */(err).message}`;
    error(msg);
    return { ok: false, error: msg };
  }
  if (declared.error) {
    error(declared.error);
    return { ok: false, error: declared.error };
  }

  const checkpoints = findCheckpointsFn(missionDir);
  const checkpointNames = new Set(checkpoints
    .map((/** @type{string} */ checkpoint) => /(?:CP-|CHECKPOINT_)(\d+)/i.exec(path.basename(checkpoint))?.[1])
    .filter(Boolean)
    .map((/** @type{string} */ number) => `CP-${number}`));
  const missing = declared.names.filter((/** @type{string} */ name) => !checkpointNames.has(name));
  if (missing.length > 0) {
    const msg = `Declared checkpoint documents are missing before handoff: ${missing.join(', ')}. Create and commit ${missing.map((/** @type{string} */ name) => `${name}.md`).join(', ')} in ${fmt.path(missionDir)} before handoff.`;
    error(msg);
    return { ok: false, error: msg, missingCheckpoints: missing, nextCheckpoint: missing[0] };
  }

  if (checkpoints.length === 0) {
    const msg = `No checkpoint documents found in ${fmt.path(missionDir)}. The execute agent must create checkpoint documents (CP-N.md) with a Goal Check table before handoff. Create at least CP-1 documenting your implementation, including a Goal Check table with real evidence such as a backticked command, test name, ADR reference, or test file path.`;
    error(msg);
    return { ok: false, error: msg };
  }

  const checkpointArgs = checkpoints.map((/** @type{string} */ checkpoint) => path.relative(rootDir, checkpoint) || checkpoint);
  const statusResult = runFn(['status', '--porcelain', '--', ...checkpointArgs], { cwd: rootDir });
  if (statusResult.status !== 0) {
    const statusError = (statusResult.stderr || statusResult.stdout || '').trim() || 'git status failed';
    const msg = `Could not verify checkpoint commit state for ${fmt.slug(slug)}: ${statusError}`;
    error(msg);
    return { ok: false, error: msg };
  }

  const dirtyCheckpointLines = (statusResult.stdout || '')
    .split('\n')
    .map((/** @type{string} */ line) => line.trimEnd())
    .filter(Boolean);

  if (dirtyCheckpointLines.length > 0) {
    const dirtyPaths = dirtyCheckpointLines
      .map((/** @type{string} */ line) => line.slice(3).trim())
      .filter(Boolean);
    const msg = `Checkpoint documents must be committed before handoff. Uncommitted checkpoint files: ${dirtyPaths.map((/** @type{string} */ p) => fmt.path(p)).join(', ')}. Commit the checkpoint update and re-run the handoff.`;
    error(msg);
    return { ok: false, error: msg };
  }

  log(fmt.status('PASS', `Found all ${declared.names.length} declared checkpoint document(s) in ${fmt.path(missionDir)}.`));
  return { ok: true, declaredCheckpoints: declared.names };
}

/** @param {string} errorMsg @param {string} slug @param {string} worktree */
function checkpointValidationNextAction(errorMsg, slug, worktree) {
  if (isTypedCheckpointEvidenceFailure(errorMsg)) {
    const checkpoint = /Planned checkpoint evidence is missing before handoff:\s*(CP-\d+)/i.exec(errorMsg)?.[1] || 'CP-N';
    return buildTypedMissionRecoveryAdvice(slug, checkpoint);
  }
  if (/MISSION\.md.*## Checkpoints|Malformed checkpoint declaration/i.test(errorMsg)) {
    return `Update ${fmt.path(path.join(missionDirForSlug(worktree, slug), 'MISSION.md'))} with valid - CP N: <name> or - CP-N: <name> declarations, then re-run: ${fmt.command(`px review ${slug} --submit`)}.`;
  }
  return `Create a checkpoint document (CP-N.md) in ${fmt.path(missionDirForSlug(worktree, slug))} with a Goal Check table. Then re-run: ${fmt.command(`px review ${slug} --submit`)}.`;
}

/**
 * @param {string} slug
 * @param {string} worktree
 * @param {string} agent
  * @param {{taskFile?: string | null, onAgentLaunched?: (agent: string, phase: 'review' | 'review-response') => Promise<void>, onAutonomousStop?: (reason: string) => Promise<void>, validateCheckpointsBeforeHandoffFn?: Function, performHandoff?: Function, startReviewLoop?: Function, repairHandoffFn?: {isRelaunchableError: Function, buildRelaunchPrompt: Function}, startAgentFn?: Function, workflowLauncherStatusFn?: Function, log?: Function, error?: Function}} [options]
 */
/**
 * The kernel's launch port for every handoff bounce. The kernel owns
 * classification, the fix prompt, the budget and the verify; this port owns only
 * what is genuinely launcher-side — the launcher-availability check and the
 * resume-aware `startAgent` call. Nothing here decides whether to bounce.
 */
function createReboundLaunchPort(context) {
  const { agent, slug, worktree, startAgentFn, workflowLauncherStatusFn, log } = context;
  return (async (_step: string, launchOptions: Record<string, unknown>) => {
    const status = workflowLauncherStatusFn(agent);
    if (!status.supported) {
      // A throw is how the kernel learns a launch could not happen; it records
      // the diagnostic and spends the attempt like any other failed try.
      throw new Error(`Agent ${agent} is not available for relaunch: ${status.detail || status.reason || 'unknown'}`);
    }
    const promptSlot = launchOptions.prompt;
    const prompt = typeof promptSlot === 'function' ? promptSlot(agent) : String(promptSlot ?? '');
    return await startAgentFn('active', {
      prompt,
      worktree,
      agent,
      slug,
      role: 'implementer',
      // startAgent uses the RESUME_CAPABLE set and session markers to decide resume.
      onLaunch: (/** @type{{agent: string}} */ { agent: launchedAgent }) => {
        log(`Relaunched ${fmt.agent(launchedAgent)} for repair. Session persistence will be used if available.`);
      }
    });
  }) as ReboundContext['startAgent'];
}

/**
 * Bounce a checkpoint gap to the implementer and report whether handoff may
 * proceed. Returns true to continue to performHandoff, false when the operator
 * has been given a manual instruction instead.
 */
async function repairCheckpointsBeforeHandoff(validation, context): Promise<boolean> {
  const { slug, worktree, agent, reboundLaunchPort, validateCheckpointsBeforeHandoffFn, log, error } = context;
  // architecture migration: classify the checkpoint validation error and attempt a targeted
  // agent relaunch (repair bounce) instead of only emitting stranded manual
  // instructions. Missing checkpoints and malformed Goal Check tables are
  // IncompleteEvidence — dispatchable to the implementer for repair.
  const classification = validation.error ? repairHandoff.classifyError(validation.error) : null;
  // architecture migration: restrict targeted relaunch to IncompleteEvidence only.
  // Non-incomplete-evidence errors (e.g. GitBlockers/dirty checkpoints,
  // InfraBlockers) retain their existing handling paths.
  const relaunchable = validation.nextCheckpoint
    || classification?.failureClass === repairHandoff.FailureClass.IncompleteEvidence;
  if (!relaunchable) {
    // Non-relaunchable checkpoint error — emit manual instruction
    error(`       ${checkpointValidationNextAction(/** @type {string} */ (validation.error), slug, worktree)}`);
    return false;
  }

  // SC3: the bounded `maxCheckpointRelaunches` loop is gone. The kernel owns
  // the budget and the verified fix: `verify` re-runs the same
  // `validateCheckpointsBeforeHandoffFn` check that just failed, so `fixed`
  // means the checkpoints really are present — never merely that an agent ran.
  log(`Checkpoint validation failed (${classification?.failureClass ?? 'DeclaredCheckpointGap'}). Bouncing to the implementer for a targeted checkpoint repair...`);
  // A declared checkpoint gap can be reported by `nextCheckpoint` alone, so
  // name the gap when the validator gave no message.
  const gapError = /** @type{string} */(validation.error
    || `Declared checkpoint documents are missing before handoff: ${validation.nextCheckpoint}. Create and commit ${validation.nextCheckpoint}.md before handoff.`);
  // When the next missing checkpoint is known, carry the continuation contract
  // into the kernel's diagnostic. Without it the agent repairs one checkpoint
  // and exits again, which is the loop this bounce exists to end.
  const nextCheckpoint = validation.nextCheckpoint || nextMissingCheckpointFromError(gapError);
  const checkpointError = nextCheckpoint
    ? `${gapError}\n\n${buildCheckpointContinuationPrompt(slug, worktree, nextCheckpoint, isTypedCheckpointEvidenceFailure(gapError))}`
    : gapError;
  const outcome = await rebound({ kind: 'handoff-verification', error: checkpointError }, {
    slug, worktree, implementer: agent, startAgent: reboundLaunchPort,
    verify: async () => {
      const retry = await validateCheckpointsBeforeHandoffFn(slug, worktree, { log, error });
      return { ok: Boolean(retry.ok), diagnostic: retry.error || '' };
    },
    log, error,
  });
  if (outcome.outcome === 'fixed') { return true; }
  // exhausted / human-only — re-read the final state so the operator
  // instruction names the checkpoint gap that actually remains.
  const finalValidation = await validateCheckpointsBeforeHandoffFn(slug, worktree, { log, error });
  if (finalValidation.ok) { return true; }
  error(`       ${checkpointValidationNextAction(/** @type {string} */ (finalValidation.error || checkpointError), slug, worktree)}`);
  return false;
}

/**
 * Bounce a relaunchable handoff failure through the kernel. `verify` re-runs
 * `performHandoff` itself, so the refreshed result — carried on `holder` — flows
 * into the gatekeeper-pushback and review-loop branches.
 */
async function reboundFailedHandoff(holder, classification, context): Promise<void> {
  const { slug, worktree, agent, reboundLaunchPort, performHandoffFn, log, error } = context;
  // SC4: the bounded `maxRelaunches` loop is gone.
  log(`\nRelaunchable error detected (${classification.failureClass}). Bouncing to the implementer...`);
  const gateFailure = holder.result.gateFailure;
  const failureReason = gateFailure
    ? { kind: 'gate-failure', ...gateFailure }
    : { kind: 'handoff-verification', error: /** @type{string} */(holder.result.error), gateOutput: flattenGateOutput(holder.result.gateOutput) };
  const outcome = await rebound(failureReason, {
    slug, worktree, implementer: agent, startAgent: reboundLaunchPort,
    verify: async () => {
      holder.result = await performHandoffFn(slug, { forgejoUser: agent, worktree, force: true });
      return {
        ok: Boolean(holder.result.ok),
        diagnostic: holder.result.error || '',
        reason: holder.result.gateFailure ? { kind: 'gate-failure', ...holder.result.gateFailure } : undefined,
      };
    },
    log, error,
  });
  if (outcome.outcome === 'exhausted' && !holder.result.ok) {
    holder.result.error = `Gate failure persisting after ${DEFAULT_REBOUND_ATTEMPTS} relaunch attempts. Manual intervention required.`;
  }
}

/** Single repair for routine hygiene issues (dirty artifacts, rebase needed). */
async function repairHygieneHandoff(holder, context): Promise<void> {
  const { slug, worktree, agent, taskFile, reboundLaunchPort, performHandoffFn, repairHandoffFn, log, error } = context;
  log(`\nAutomated handoff failed: ${holder.result.error}`);
  log(`Attempting post-execute repair...`);
  const { repaired, blocker } = await /** @type{Function} */(repairHandoffFn)(slug, worktree, /** @type{string} */(holder.result.error), { taskFile, log, error });
  if (repaired) {
    log(`Repair successful. Retrying automated handoff...`);
    holder.result = await performHandoffFn(slug, { forgejoUser: agent, worktree, force: true });
    return;
  }
  if (blocker) {
    // If repair failed but provided a specific blocker (e.g. rebase failure),
    // report that blocker as the final error instead of the original handoff error.
    holder.result.error = blocker;
    return;
  }
  if (!repairHandoff.isRelaunchableError(holder.result.error)) { return; }
  // Attempt agent relaunch for repairable content errors (missing goal-check
  // table). SC4: it routes through the kernel too, with the same
  // re-run-`performHandoff` verify — so a content repair is only believed once
  // the handoff actually completes.
  log(`Content error detected. Attempting agent relaunch to fix...`);
  const contentError = /** @type{string} */(holder.result.error);
  const outcome = await rebound({ kind: 'handoff-verification', error: contentError }, {
    slug, worktree, implementer: agent, startAgent: reboundLaunchPort,
    verify: async () => {
      holder.result = await performHandoffFn(slug, { forgejoUser: agent, worktree, force: true });
      return { ok: Boolean(holder.result.ok), diagnostic: holder.result.error || '' };
    },
    log, error,
  });
  if (outcome.outcome !== 'fixed' && !holder.result.ok) {
    holder.result.error = `Post-relaunch handoff failed: ${holder.result.error || 'unknown'}`;
  }
}

/**
 * Repair a failed handoff. ADR 0048 C1: relaunchable classes
 * (AutoSendBack/AutoRepair, excluding GitBlockers, which repairHandoff
 * auto-repairs) bounce through the kernel; InfraBlocker and
 * StateMachineViolation are HumanOnly and fall through to the manual-handoff
 * message the caller emits.
 */
async function repairFailedHandoff(holder, context): Promise<void> {
  const classification = holder.result.error ? repairHandoff.classifyError(holder.result.error) : null;
  const relaunchable = classification
    ? classification.dispatchAction !== 'HumanOnly' && classification.failureClass !== 'GitBlockers'
    : false;
  if (relaunchable) { await reboundFailedHandoff(holder, classification, context); return; }
  await repairHygieneHandoff(holder, context);
}

async function runHandoffAndReview(slug, worktree, agent, options = {}) {
  const {
    taskFile = null,
    onAgentLaunched = undefined,
    onAutonomousStop = undefined,
    loadRecordedCheckpointsFn = undefined,
    validateCheckpointsBeforeHandoffFn = (/** @type{string} */ s, /** @type{string} */ w, /** @type{object} */ o) => validateCheckpointsBeforeHandoff(s, w, { ...o, loadRecordedCheckpointsFn }),
    performHandoff: _performHandoff = (/** @type{string} */ s, /** @type{object} */ o) => handoff.performHandoff(s, o),
    startReviewLoop: _startReviewLoop = (/** @type{string} */ s, /** @type{object} */ o) => startReviewLoop(s, o),
    repairHandoffFn = /** @type{(s: string, w: string, e: string, o: object) => Promise<{repaired: boolean, blocker?: string}>} */(repairHandoff.default),
    startAgentFn = agents.startAgent,
    workflowLauncherStatusFn = agents.workflowLauncherStatus,
    log = fmt.log.plain,
    error = fmt.log.plainError
  } = options;
  const reboundLaunchPort = createReboundLaunchPort({ agent, slug, worktree, startAgentFn, workflowLauncherStatusFn, log });
  const repairContext = {
    slug, worktree, agent, taskFile, reboundLaunchPort,
    performHandoffFn: _performHandoff, repairHandoffFn, validateCheckpointsBeforeHandoffFn, log, error,
  };

  // Pre-handoff checkpoint enforcement: validate checkpoints exist before calling
  // performHandoff(). This catches missing checkpoints immediately after the
  // execute agent exits, before the repair flow runs.
  const validation = await validateCheckpointsBeforeHandoffFn(slug, worktree, { log, error });
  if (!validation.ok && !await repairCheckpointsBeforeHandoff(validation, repairContext)) { return false; }

  const holder = { result: await _performHandoff(slug, { forgejoUser: agent, worktree }) };
  if (!holder.result.ok) { await repairFailedHandoff(holder, repairContext); }
  const handoffResult = holder.result;

  if (!handoffResult.ok) {
    error(`Automated handoff failed: ${handoffResult.error}`);
    error('       You may need to complete the handoff manually:');
    error(`       ${fmt.command(`px review ${slug} --submit`)}`);
    return false;
  }

  /** @type{{ok: boolean, error?: string, gatekeeperPushedBack?: boolean}} */
  const hr = handoffResult;
  if (hr.gatekeeperPushedBack) {
    log(`\nGatekeeper posted pushback for ${fmt.slug(slug)}; skipping autonomous review loop until artifacts are fixed.`);
    return true;
  }

  log(`\nStarting autonomous review loop (implementer: ${fmt.agent(agent)})...`);
  // The review loop launches other families on this same mission. Hand the
  // caller's publication seam straight through so the board follows the
  // reviewer and the implementer answering findings (TASK-2373).
  // SC3: handoff already ran in this function. Tell the loop to skip its own
  // handoff without flipping it into resume mode: px active post-execute is a
  // fresh review start, not a --continue, so it must not take the resume-only
  // behaviors (reviewer reuse, existing-review/disposition skip-poll) and must
  // not run performHandoff a second time (which would resubmit/mutate the
  // Review the active path just created).
  await _startReviewLoop(slug, { implementer: agent, worktree, skipHandoff: true, recordStageStatsSafeFn: recordStageStatsSafe, onAgentLaunched, onAutonomousStop });
  return true;
}

/** @param {string} slug */
function buildCheckpointContext(slug) {
  const missionDir = findMissionDir(slug);
  if (!missionDir) {return 'No checkpoint documents found. Start from CP-1.';}

  const checkpoints = findCheckpoints(missionDir);
  if (checkpoints.length === 0) {return 'No checkpoint documents found. Start from CP-1.';}

  const latest = checkpoints[checkpoints.length - 1];
  const firstLine = getFirstLine(latest);
  return `Most recent checkpoint: ${path.basename(latest)} — ${firstLine}\nResume from there, or start the next checkpoint if that one is complete.`;
}

/**
 * Resolve the Backlog task path for an execute prompt, or null when there is
 * no real task file (task-2468, F5). An adhoc mission has no Backlog backing in
 * an adhoc-only repository, so the builder must not fabricate a path — the
 * previous `<${slug}>.md` placeholder pointed at a file that does not exist and
 * instructed the execute agent to preserve a literal path of angle brackets.
 * The task file is a best-effort one-way mirror; its absence is not a failure.
 *
 * @param {string} slug
 * @param {string} rootDir
 * @returns {string | null}
 */
function resolveExecuteTaskPath(slug, rootDir) {
  const resolution = resolveTaskFile(slug, rootDir);
  if (resolution && resolution.ok && resolution.taskFile) {
    return resolution.taskFile;
  }
  // Backlog-backed (`task-<N>`) missions anchor to their task file. When none
  // exists yet the shared execute prompt still names the canonical slot so the
  // agent preserves the right file once it is drafted; adhoc identities never
  // reach this branch's rendered output because buildExecutePrompt strips the
  // Backlog-task lines for them (isDbAdhocIdentity below).
  return path.join(rootDir, 'backlog', 'tasks', `<${slug}>.md`);
}

/** @param {string} slug @param {string} checkpointContext @param {{rootDir?: string}} [options] */
function buildExecutePrompt(slug, checkpointContext, options = {}) {
  const { rootDir = process.cwd() } = options;
  const overridePath = resolvePromptOverride(rootDir);
  const template = assembleStagePrompt('execute', { overridePath });
  const year = getMissionYear(slug, rootDir) || String(new Date().getFullYear());
  const missionPath = path.join(missionDirForSlug(rootDir, slug), 'MISSION.md');
  const missionDir = path.dirname(missionPath);
  const taskPath = resolveExecuteTaskPath(slug, rootDir);

  // Backlog task instructions are adhoc-inapplicable (task-2468, F5): a
  // DB-owned adhoc mission has no Backlog backing in an adhoc-only repository,
  // so the shared execute prompt must not carry the `Backlog task:` header, the
  // "Backlog task presence" preflight bullet, or the preserve/lifecycle-
  // metadata instructions that reference a file that does not exist. Strip
  // those Backlog-task lines only for a DB-owned adhoc identity; Backlog-backed
  // (`task-<N>`) missions keep them even when the task file is not yet on disk.
  const adhocNoTaskFile = isDbAdhocIdentity(slug);
  let body = template;
  if (adhocNoTaskFile) {
    body = body
      .split('\n')
      .filter((line) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('Backlog task:')) {return false;}
        if (trimmed === '- Backlog task presence') {return false;}
        if (/preserve `\{\{taskPath\}\}`/.test(line)) {return false;}
        if (/do not change the Backlog task's status/.test(line)) {return false;}
        return true;
      })
      .join('\n');
  }

  return body
    .replaceAll('{{slug}}', slug)
    .replaceAll('YYYY', year)
    .replaceAll('{{missionPath}}', missionPath)
    .replaceAll('{{missionDir}}', missionDir)
    .replaceAll('{{taskPath}}', taskPath || '')
    .replaceAll('{{checkpoint_context}}', checkpointContext || '');
}

// git status --porcelain wraps any path containing a space or other unusual
// byte in double quotes and C-escapes the contents (\\, \", \t, \n, \r, and
// \NNN octal for bytes >= 0x80 under the default core.quotePath). Those quotes
// and escapes are display syntax, not part of the on-disk path, so they must be
// decoded before the value is handed to `git add --` — otherwise git treats the
// quote-wrapped string as a pathspec that matches no file and aborts staging.
/** @param {string} rawPath */
function unquoteGitStatusPath(rawPath) {
  if (rawPath.length < 2 || rawPath[0] !== '"' || rawPath[rawPath.length - 1] !== '"') {
    return rawPath;
  }
  const inner = rawPath.slice(1, -1);
  const simple = { a: 0x07, b: 0x08, t: 0x09, n: 0x0a, v: 0x0b, f: 0x0c, r: 0x0d, '"': 0x22, '\\': 0x5c };
  const chunks = [];
  let literal = '';
  const flush = () => {
    if (literal) {
      chunks.push(Buffer.from(literal, 'utf8'));
      literal = '';
    }
  };
  let offset = 0;
  while (offset < inner.length) {
    const ch = inner[offset];
    if (ch !== '\\') {
      literal += ch;
      offset++;
      continue;
    }
    const next = inner[offset + 1];
    if (next >= '0' && next <= '7') {
      const { octal, end } = readOctalEscape(inner, offset + 1);
      flush();
      chunks.push(Buffer.from([parseInt(octal, 8) & 0xff]));
      offset = end;
      continue;
    }
    const decoded = decodeSimpleEscape(simple, next);
    if (decoded === null) { literal += next === undefined ? '\\' : next; offset += 1 + Number(next !== undefined); }
    else { flush(); chunks.push(Buffer.from([decoded])); offset += 2; }
  }
  flush();
  return Buffer.concat(chunks).toString('utf8');
}

function readOctalEscape(text, start) {
  let end = start;
  while (end < text.length && end - start < 3 && text[end] >= '0' && text[end] <= '7') { end++; }
  return { octal: text.slice(start, end), end };
}

function decodeSimpleEscape(simple, value) {
  return Object.prototype.hasOwnProperty.call(simple, value) ? simple[value] : null;
}

/** @param {string} entry */
function parseDirtyEntry(entry) {
  const match = entry.match(/^(.{1,2})\s+(.*)$/);
  const status = (match ? match[1] : entry.slice(0, 2)).padEnd(2, ' ');
  const rawPath = (match ? match[2] : entry.slice(2)).trim();
  // For renames git reports `<old> -> <new>`; each side is independently quoted
  // and the ` -> ` separator is always literal, so split before unquoting and
  // keep staging the destination path.
  const renamed = rawPath.includes(' -> ') ? (rawPath.split(' -> ').pop() || rawPath) : rawPath;
  const filePath = unquoteGitStatusPath(renamed.trim());
  return { status, filePath };
}

/** @param {string} filePath */
function isExecuteIgnoredPath(filePath) {
  return isWorkflowGeneratedArtifact(filePath);
}

/** @param {{slug: string, worktree: string, dirtyEntries?: Array<{status: string, filePath: string}>, gitImpl?: Function}} opts */
function enforceExecuteCommitSafety(opts) {
  const { slug, worktree, dirtyEntries = getWorktreeStatus(worktree), gitImpl = git } = opts;
  const parsedEntries = /** @type{Array<{status: string, filePath: string}>} */(/** @type{Array<string>} */(dirtyEntries).map(parseDirtyEntry));
  const relevantEntries = parsedEntries.filter(entry => !isExecuteIgnoredPath(entry.filePath));
  const conflictEntries = relevantEntries.filter(entry =>
    ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(entry.status.trim())
  );

  if (conflictEntries.length > 0) {
    throw new Error(
      `Execute safety harness found unresolved conflicts: ${conflictEntries.map(entry => entry.filePath).join(', ')}`
    );
  }

  if (relevantEntries.length === 0) {
    fmt.log.pass('Execute safety harness: no uncommitted mission changes left behind.');
    return false;
  }

  fmt.log.warn('Execute safety harness: execute agent left uncommitted changes. Creating fallback commit.');
  for (const entry of relevantEntries) {
    fmt.log.plain(`  ${entry.status} ${entry.filePath}`);
  }

  const stagePaths = relevantEntries.map(entry => entry.filePath);
  gitImpl(['-C', worktree, 'add', '--', ...stagePaths]);
  const commitMessage = `execute(${slug}): capture agent output`;
  const commitResult = gitImpl([
    '-C',
    worktree,
    'commit',
    '-m',
    commitMessage,
    '-m',
    'Safety harness: capture implementation changes left uncommitted by the execute agent.'
  ]);

  if (commitResult.status !== 0) {
    throw new Error('Execute safety harness could not create fallback commit.');
  }

  fmt.log.pass(`Execute safety harness committed remaining changes with "${commitMessage}".`);
  return true;
}

/** @type {typeof active & {buildExecutePrompt: typeof buildExecutePrompt, buildCheckpointContext: typeof buildCheckpointContext, runHandoffAndReview: typeof runHandoffAndReview, applyExecuteFallback: typeof applyExecuteFallback, selectLaunchAndRecord: typeof selectLaunchAndRecord, validateCheckpointsBeforeHandoff: typeof validateCheckpointsBeforeHandoff, enforceExecuteCommitSafety: typeof enforceExecuteCommitSafety, unquoteGitStatusPath: typeof unquoteGitStatusPath}} */
const _activeExport = Object.assign(active, { buildExecutePrompt, buildCheckpointContext, runHandoffAndReview, applyExecuteFallback, selectLaunchAndRecord, validateCheckpointsBeforeHandoff, enforceExecuteCommitSafety, unquoteGitStatusPath, renderActiveProgress });
export default _activeExport;
export { _activeExport as active, buildExecutePrompt, buildCheckpointContext, runHandoffAndReview, applyExecuteFallback, selectLaunchAndRecord, validateCheckpointsBeforeHandoff, enforceExecuteCommitSafety, unquoteGitStatusPath, renderActiveProgress };
