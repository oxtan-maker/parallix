// @ts-nocheck
import { git, getWorktreeStatus } from '../../git/git.js';
import * as path from 'node:path';
import * as fmt from '../../../application/presentation/cli-format.js';
import * as agents from '../../agents/agents.js';
import { findMissionDir, findCheckpoints, getFirstLine, readMissionFile, inferSlug, getMissionYear, missionDirForSlug, isWorkflowGeneratedArtifact } from '../../filesystem/mission-utils.js';
import * as handoff from './handoff.js';
import { resolveTaskFile, transitionTask, getTaskStatus, getTaskImplementer } from '../../backlog/backlog.js';
import { recordStageStatsSafe, startReviewLoop } from '../../review/review-loop.js';
import * as repairHandoff from './repair-handoff.js';
import { runtimeAssetStore } from '../../assets/runtime-assets.js';

function renderActiveProgress(event, logFn) {
  if (event.phase === 'launch') {
    logFn('Launching execute agent...');
  } else if (event.phase === 'handoff') {
    logFn(`\nExecute agent (${fmt.agent(event.agent)}) completed successfully. Starting automated handoff...`);
  }
}

/**
 * @param {string[]} args
 * @param {{inferSlugFn?: Function, service?: {execute: Function}, rootDir?: string, exitFn?: Function, logFn?: Function, errorFn?: Function}} [options]
 */
async function active(args, options = {}) {
  const {
    inferSlugFn = inferSlug,
    service,
    serviceFactory,
    rootDir = process.cwd(),
    exitFn = process.exit,
    logFn = fmt.log.info,
    errorFn = fmt.log.fail
  } = options;
  const explicitSlug = args[0];
  const slug = inferSlugFn(explicitSlug);
  if (!slug) {
    errorFn('Usage: px active [<slug>] [--implementer <family>]');
    exitFn(1);
    return;
  }

  const normalizedSlug = slug.toLowerCase();

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

  logFn('Running execute preflight...');
  const renderProgress = event => renderActiveProgress(event, logFn);
  const executeService = service || (typeof serviceFactory === 'function' ? await serviceFactory(rootDir, renderProgress) : null);
  if (!executeService) { throw new Error('active command requires an injected execute-mission service'); }
  const outcome = await executeService.execute({
    operationId: `active:${normalizedSlug}`,
    slug: normalizedSlug,
    agent: preselectedImplementer,
    capabilities: new Set(['active:execute']),
  });
  if (outcome.status !== 'completed' || !outcome.value) {
    const message = outcome.error?.message || 'Could not launch execute agent.';
    const status = /exited with status (\d+)/.exec(message);
    if (message === 'execute preflight failed') {
      errorFn('Preflight failed. Fix blockers above before launching the execute agent.');
    } else if (message === 'dedicated execute worktree is required') {
      errorFn(`Could not locate dedicated worktree for mission/${fmt.slug(normalizedSlug)}. Run "px draft ${normalizedSlug}" first or create the worktree manually.`);
    } else {
      errorFn(message);
    }
    exitFn(status ? Number(status[1]) : 1);
    return;
  }
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
 * @param {{slug: string, worktree: string, preselectedAgent?: string | null, agentConfig: object, taskResolution: object, prompt: string, startAgentFn?: Function, transitionTaskFn?: Function, getTaskStatusFn?: Function, getTaskImplementerFn?: Function, selectAgentFn?: Function, log?: Function, sessionMarkerPort?: object | null}} opts
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
  } = opts;
  const preselected = preselectedAgent || selectAgentFn('active', { config: agentConfig });
  const taskResolutionTyped = /** @type{{ok: boolean, taskFile?: string} | undefined} */(taskResolution);
  const taskFile = taskResolutionTyped && taskResolutionTyped.ok && taskResolutionTyped.taskFile
    ? taskResolutionTyped.taskFile
    : null;
  const priorStatus = taskFile ? getTaskStatusFn(taskFile) : null;
  const priorImplementer = taskFile ? getTaskImplementerFn(taskFile) : null;
  let launchRecorded = false;
  let launchTransitionFailed = false;
  let rebaseDeferred = false;
  let launchedAgent = null;
  const rollbackIfNeeded = async ({ throwOnFailure = true } = {}) => {
    if (!launchRecorded || !priorStatus) {
      return;
    }

    log(fmt.status('WARN', `Execute launch for ${fmt.slug(slug)} did not complete cleanly; rolling task state back to ${priorStatus} / ${priorImplementer || 'none'}.`));
    /** @type{{rootDir: string, log: Function, implementer?: string, clearAssignee?: boolean}} */
    const rollbackOpts = { rootDir: worktree, log };
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
      sessionMarkerPort: sessionMarkerPort ?? undefined,
      onLaunch: async (/** @type{{agent: string}} */ { agent }) => {
        launchedAgent = agent;
        if (!(taskResolutionTyped && taskResolutionTyped.ok)) {
          return;
        }

        log(`Recording implementer ${fmt.agent(agent)} and status=active for ${fmt.slug(slug)}...`);
        if (!await transitionTaskFn(slug, 'active', {
          implementer: agent,
          rootDir: worktree,
          log,
          // The agent process is already running when onLaunch fires. Never
          // rebase its worktree concurrently; the post-execute lifecycle check
          // synchronizes the clean, committed worktree before handoff.
          deferMissionRebase: true,
        })) {
          launchTransitionFailed = true;
          return;
        }

        launchRecorded = true;
        rebaseDeferred = true;
      },
      onLimitHit: () => {
        // Roll back the intermediate active write so the retry's onLaunch starts
        // from a clean state, preventing a spurious committed implementer entry.
        rollbackIfNeeded({ throwOnFailure: false });
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
    void transitionTaskFn(slug, 'active', { implementer: actual, rootDir: worktree, log }).catch(() => {});
  }
  return actual;
}

/**
 * Attempt to relaunch an agent to fix a repairable handoff error.
 * For resume-capable agents, the startAgent function handles resume flags internally.
 *
 * @param {string} slug - Mission slug
 * @param {string} worktree - Path to the mission worktree
 * @param {string} errorMsg - The error message from the failed handoff
 * @param {string} agent - The agent family to relaunch
 * @param {object} [options]
 * @returns {Promise<{relaunched: boolean, error?: string}>} Result of relaunch attempt
 */
/**
  * @param {string} slug
  * @param {string} worktree
  * @param {string} errorMsg
  * @param {string} agent
 * @param {{isRelaunchableErrorFn?: Function, buildRelaunchPromptFn?: Function, workflowLauncherStatusFn?: Function, startAgentFn?: Function, log?: Function, error?: Function, gateOutput?: {stdout: string, stderr: string}, promptOverride?: string}} [options]
  */
 async function attemptAgentRelaunch(slug, worktree, errorMsg, agent, options = {}) {
   const {
     isRelaunchableErrorFn = repairHandoff.isRelaunchableError,
     buildRelaunchPromptFn = repairHandoff.buildRelaunchPrompt,
     workflowLauncherStatusFn = agents.workflowLauncherStatus,
     startAgentFn = agents.startAgent,
     log = fmt.log.plain,
     error = fmt.log.plainError,
     gateOutput,
     promptOverride
   } = options;
   // A declared checkpoint gap has an explicit continuation contract and is
   // therefore relaunchable even though generic error classification does not
   // recognize its diagnostic text.
   const nextCheckpoint = nextMissingCheckpointFromError(errorMsg);
   // When a custom prompt is provided (e.g. gatekeeper pushback), bypass the
   // relaunchability check so the agent can act on explicit artifact-creation
   // instructions even when the error message doesn't match known patterns.
   if (!promptOverride && !nextCheckpoint && !isRelaunchableErrorFn(errorMsg)) {
     log(`Error is not relaunchable: ${errorMsg}`);
     return { relaunched: false, error: 'Error is not relaunchable for agent relaunch' };
   }

   // Check if the agent launcher is available
   const status = workflowLauncherStatusFn(agent);
   if (!status.supported) {
     error(`Agent ${fmt.agent(agent)} is not available for relaunch: ${status.detail || status.reason || 'unknown'}`);
     return { relaunched: false, error: `Agent ${agent} launcher is not available` };
   }

   // A missing declared checkpoint means the agent must continue the same mission,
   // not repair a generic Goal Check artifact and terminate again.
   // Build the relaunch prompt, passing captured gate output if available (architecture migration).
   // promptOverride (e.g. gatekeeper pushback) takes precedence over the derived prompt.
   const prompt = promptOverride || (nextCheckpoint
     ? buildCheckpointContinuationPrompt(slug, worktree, nextCheckpoint)
     : buildRelaunchPromptFn(errorMsg, slug, worktree, gateOutput));

  log(`Attempting to relaunch ${fmt.agent(agent)} to fix repairable handoff error...`);
  // startAgent handles resume flags internally for resume-capable agents (codex, claude, gemini, custom)

  try {
    const result = await startAgentFn('active', {
      prompt,
      worktree,
      agent,
      slug,
      role: 'implementer',
      // startAgent will use RESUME_CAPABLE set and session markers to decide resume
      onLaunch: (/** @type{{agent: string}} */ { agent: launchedAgent }) => {
        log(`Relaunched ${fmt.agent(launchedAgent)} for repair. Session persistence will be used if available.`);
      }
    });

    if (result.error) {
      error(`Relaunch failed: ${result.error.message || String(result.error)}`);
      return { relaunched: false, error: result.error.message || String(result.error) };
    }

    if (typeof result.result.status === 'number' && result.result.status !== 0) {
      error(`Relaunch agent exited with status ${result.result.status}`);
      return { relaunched: false, error: `Agent exited with status ${result.result.status}` };
    }

    log(`Relaunch successful. ${fmt.agent(agent)} is now running to fix the handoff error.`);
    return { relaunched: true };
  } catch (err) {
    error(`Relaunch failed with exception: ${/** @type{Error} */(err).message}`);
    return { relaunched: false, error: /** @type{Error} */(err).message };
  }
}

/** @param {string} errorMsg */
function nextMissingCheckpointFromError(errorMsg) {
  const match = /Declared checkpoint documents are missing before handoff:\s*([^.]*)\./.exec(errorMsg);
  return match ? /CP-\d+/.exec(match[1])?.[0] || null : null;
}

/** @param {string} slug @param {string} worktree @param {string} nextCheckpoint */
function buildCheckpointContinuationPrompt(slug, worktree, nextCheckpoint) {
  return `Mission ${slug} is incomplete: ${nextCheckpoint}. Continue the existing execute mission in ${worktree} from ${nextCheckpoint}. ` +
    `Complete and commit ${nextCheckpoint}.md, then immediately continue to every remaining declared checkpoint and mission gate. ` +
    `Do not exit or send a final response until every declared checkpoint is committed and every mission-declared gate passes, unless a mission stop rule applies or a genuine external dependency blocks progress.`;
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

/** @param {string} slug @param {string} worktree @param {{findMissionDirFn?: Function, findCheckpointsFn?: Function, readMissionFileFn?: Function, runFn?: Function, log?: Function, error?: Function}} [options] */
function validateCheckpointsBeforeHandoff(slug, worktree, options = {}) {
  const {
    findMissionDirFn = findMissionDir,
    findCheckpointsFn = findCheckpoints,
    readMissionFileFn = readMissionFile,
    runFn = git,
    log = fmt.log.plain,
    error = fmt.log.plainError
  } = options;
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
    const msg = `No checkpoint documents found in ${fmt.path(missionDir)}. The execute agent must create checkpoint documents (CP-N.md) with a Goal Check table before handoff. Create at least CP-1 documenting your implementation, including a Goal Check table with real evidence (file:line, test names).`;
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
  if (/MISSION\.md.*## Checkpoints|Malformed checkpoint declaration/i.test(errorMsg)) {
    return `Update ${fmt.path(path.join(missionDirForSlug(worktree, slug), 'MISSION.md'))} with valid - CP N: <name> or - CP-N: <name> declarations, then re-run: ${fmt.command(`px review ${slug} --submit`)}.`;
  }
  return `Create a checkpoint document (CP-N.md) in ${fmt.path(missionDirForSlug(worktree, slug))} with a Goal Check table. Then re-run: ${fmt.command(`px review ${slug} --submit`)}.`;
}

/**
 * @param {string} slug
 * @param {string} worktree
 * @param {string} agent
  * @param {{taskFile?: string | null, validateCheckpointsBeforeHandoffFn?: Function, performHandoff?: Function, startReviewLoop?: Function, repairHandoffFn?: {isRelaunchableError: Function, buildRelaunchPrompt: Function}, attemptAgentRelaunchFn?: Function, log?: Function, error?: Function}} [options]
 */
async function runHandoffAndReview(slug, worktree, agent, options = {}) {
  const {
    taskFile = null,
    validateCheckpointsBeforeHandoffFn = validateCheckpointsBeforeHandoff,
    performHandoff: _performHandoff = (/** @type{string} */ s, /** @type{object} */ o) => handoff.performHandoff(s, o),
    startReviewLoop: _startReviewLoop = (/** @type{string} */ s, /** @type{object} */ o) => startReviewLoop(s, o),
    repairHandoffFn = /** @type{(s: string, w: string, e: string, o: object) => Promise<{repaired: boolean, blocker?: string}>} */(repairHandoff.default),
    attemptAgentRelaunchFn = attemptAgentRelaunch,
    log = fmt.log.plain,
    error = fmt.log.plainError
  } = options;
  // Pre-handoff checkpoint enforcement: validate checkpoints exist before calling performHandoff()
  // This catches missing checkpoints immediately after the execute agent exits,
  // before the repair flow runs, and provides an explicit instruction to create them.
  const validation = validateCheckpointsBeforeHandoffFn(slug, worktree, { log, error });
  if (!validation.ok) {
    // architecture migration: classify the checkpoint validation error and attempt a targeted
    // agent relaunch (repair bounce) instead of only emitting stranded manual
    // instructions. Missing checkpoints and malformed Goal Check tables are
    // IncompleteEvidence — dispatchable to the implementer for repair.
    const checkpointClassification = validation.error
      ? repairHandoff.classifyError(validation.error)
      : null;
    // architecture migration: restrict targeted relaunch to IncompleteEvidence only.
    // Non-incomplete-evidence errors (e.g. GitBlockers/dirty checkpoints,
    // InfraBlockers) retain their existing handling paths.
    const isCheckpointRelaunchable = validation.nextCheckpoint || (checkpointClassification
      ? checkpointClassification.failureClass === repairHandoff.FailureClass.IncompleteEvidence
      : false);

    if (isCheckpointRelaunchable) {
      // architecture migration: bounded retry loop for pre-handoff checkpoint validation.
      // Repeated absent or invalid checkpoint evidence reaches a configured
      // exhaustion boundary without review submission.
      let checkpointRelaunchCount = 0;
      const maxCheckpointRelaunches = 2;

      while (checkpointRelaunchCount < maxCheckpointRelaunches) {
        checkpointRelaunchCount++;
        log(`Checkpoint validation failed (${checkpointClassification?.failureClass ?? 'DeclaredCheckpointGap'}). Targeted repair relaunch attempt ${checkpointRelaunchCount}/${maxCheckpointRelaunches}...`);
        const { relaunched, error: relaunchError } = await attemptAgentRelaunchFn(
          slug, worktree, /** @type{string} */(validation.error), agent,
          { log, error }
        );
        if (relaunched) {
          log('Agent relaunched for checkpoint repair. Re-validating checkpoints...');
          // After relaunch, re-validate and proceed to performHandoff if checkpoints
          // are now present. The agent is expected to create/update the CP-N.md
          // before the next handoff attempt.
          const retryValidation = validateCheckpointsBeforeHandoffFn(slug, worktree, { log, error });
          if (retryValidation.ok) {
            // Checkpoints now valid — fall through to performHandoff below
            break;
          }
          // Checkpoint still missing/invalid after this relaunch; continue loop
        } else {
          log(`Agent relaunch failed: ${relaunchError || 'unknown error'}`);
          break; // Relaunch itself failed; stop
        }
      }

      // Re-validate after the loop to check final state
      const finalValidation = validateCheckpointsBeforeHandoffFn(slug, worktree, { log, error });
      if (!finalValidation.ok) {
        // Checkpoint still missing/invalid after all relaunch attempts — exhaustion
        error(`       ${checkpointValidationNextAction(/** @type {string} */ (finalValidation.error), slug, worktree)}`);
        return false;
      }
      // Fall through to performHandoff below
    } else {
      // Non-relaunchable checkpoint error — emit manual instruction
      error(`       ${checkpointValidationNextAction(/** @type {string} */ (validation.error), slug, worktree)}`);
      return false;
    }
  }

  let handoffResult = await _performHandoff(slug, { forgejoUser: agent, worktree });

  if (!handoffResult.ok) {
    // Check for relaunchable failure (architecture migration, ADR 0048 C1): automatic relaunch
    // with captured output. Delegates to repairHandoff.classifyError() for full
    // 8-class dispatch; relaunchable classes (AutoSendBack/AutoRepair, excluding
    // GitBlockers which are handled by repairHandoff auto-repair) trigger the
    // relaunch path. InfraBlocker and StateMachineViolation are HumanOnly and
    // fall through to the manual-handoff error message below.
    const classification = handoffResult.error
      ? repairHandoff.classifyError(handoffResult.error)
      : null;
    const isRelaunchableError = classification
      ? classification.dispatchAction !== 'HumanOnly' && classification.failureClass !== 'GitBlockers'
      : false;

    if (isRelaunchableError) {
      // Automatic relaunch with captured gate output, bounded to max 2 attempts
      let relaunchCount = 0;
      const maxRelaunches = 2;

      while (relaunchCount < maxRelaunches) {
        relaunchCount++;
        log(`\nRelaunchable error detected (${classification.failureClass}). Relaunch attempt ${relaunchCount}/${maxRelaunches}...`);
        const { relaunched, error: relaunchError } = await attemptAgentRelaunchFn(
          slug, worktree, /** @type{string} */(handoffResult.error), agent,
          { log, error, gateOutput: handoffResult.gateOutput }
        );
        if (relaunched) {
          handoffResult = await _performHandoff(slug, { forgejoUser: agent, worktree, force: true });
          if (handoffResult.ok) {
            break; // Success — proceed to review loop
          }
          // Handoff still failed; continue loop for another relaunch attempt
        } else {
          log(`Agent relaunch failed: ${relaunchError || 'unknown error'}`);
          break; // Relaunch itself failed; stop
        }
      }

      if (!handoffResult.ok && relaunchCount >= maxRelaunches) {
        handoffResult.error = `Gate failure persisting after ${maxRelaunches} relaunch attempts. Manual intervention required.`;
      }
    } else {
      // Original logic: attempt single repair for routine hygiene issues (dirty artifacts, rebase needed)
      log(`\nAutomated handoff failed: ${handoffResult.error}`);
      log(`Attempting post-execute repair...`);
      const { repaired, blocker } = await /** @type{Function} */(repairHandoffFn)(slug, worktree, /** @type{string} */(handoffResult.error), { taskFile, log, error });
      if (repaired) {
        log(`Repair successful. Retrying automated handoff...`);
        handoffResult = await _performHandoff(slug, { forgejoUser: agent, worktree, force: true });
      } else if (blocker) {
        // If repair failed but provided a specific blocker (e.g. rebase failure),
        // report that blocker as the final error instead of the original handoff error.
        handoffResult.error = blocker;
      } else if (!repaired && repairHandoff.isRelaunchableError(handoffResult.error)) {
        // Attempt agent relaunch for repairable content errors (missing goal-check table)
        log(`Content error detected. Attempting agent relaunch to fix...`);
        const { relaunched, error: relaunchError } = await attemptAgentRelaunchFn(
          slug, worktree, /** @type{string} */(handoffResult.error), agent, { log, error }
        );
        if (relaunched) {
          // Agent was relaunched successfully; re-invoke performHandoff to verify
          // the handoff-to-review transition actually completed, matching the
          // contract of the repair-success path above.
          log(`Agent relaunched. It will fix the checkpoint and retry handoff.`);
          handoffResult = await _performHandoff(slug, { forgejoUser: agent, worktree, force: true });
          if (!handoffResult.ok) {
            handoffResult.error = `Post-relaunch handoff failed: ${handoffResult.error || 'unknown'}`;
          }
          // Fall through to gatekeeper pushback / review loop / failure handling below.
        } else {
          // Relaunch failed or was not possible
          log(`Agent relaunch failed: ${relaunchError || 'unknown error'}`);
          // Fall through to manual handoff message
        }
      }
    }
  }

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
  await _startReviewLoop(slug, { implementer: agent, worktree, recordStageStatsSafeFn: recordStageStatsSafe });
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

/** @param {string} slug @param {string} rootDir */
function resolveExecuteTaskPath(slug, rootDir) {
  const resolution = resolveTaskFile(slug, rootDir);
  if (resolution && resolution.ok && resolution.taskFile) {
    return resolution.taskFile;
  }
  return path.join(rootDir, 'backlog', 'tasks', `<${slug}>.md`);
}

/** @param {string} slug @param {string} checkpointContext @param {{rootDir?: string}} [options] */
function buildExecutePrompt(slug, checkpointContext, options = {}) {
  const { rootDir = process.cwd() } = options;
  const template = runtimeAssetStore.readText('prompts/execute.md');
  const year = getMissionYear(slug, rootDir) || String(new Date().getFullYear());
  const missionPath = path.join(missionDirForSlug(rootDir, slug), 'MISSION.md');
  const missionDir = path.dirname(missionPath);
  const taskPath = resolveExecuteTaskPath(slug, rootDir);
  return template
    .replaceAll('{{slug}}', slug)
    .replaceAll('YYYY', year)
    .replaceAll('{{missionPath}}', missionPath)
    .replaceAll('{{missionDir}}', missionDir)
    .replaceAll('{{taskPath}}', taskPath)
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
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch !== '\\') {
      literal += ch;
      continue;
    }
    const next = inner[i + 1];
    if (next >= '0' && next <= '7') {
      let octal = '';
      let j = i + 1;
      while (j < inner.length && octal.length < 3 && inner[j] >= '0' && inner[j] <= '7') {
        octal += inner[j];
        j++;
      }
      flush();
      chunks.push(Buffer.from([parseInt(octal, 8) & 0xff]));
      i = j - 1;
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(simple, next)) {
      flush();
      chunks.push(Buffer.from([/** @type{number} */(simple[/** @type{keyof typeof simple} */(next)])]));
      i++;
    } else {
      // Unknown or trailing escape: keep the following character literally.
      literal += next === undefined ? '\\' : next;
      if (next !== undefined) {i++;}
    }
  }
  flush();
  return Buffer.concat(chunks).toString('utf8');
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

/** @type {typeof active & {buildExecutePrompt: typeof buildExecutePrompt, buildCheckpointContext: typeof buildCheckpointContext, runHandoffAndReview: typeof runHandoffAndReview, applyExecuteFallback: typeof applyExecuteFallback, selectLaunchAndRecord: typeof selectLaunchAndRecord, validateCheckpointsBeforeHandoff: typeof validateCheckpointsBeforeHandoff, attemptAgentRelaunch: typeof attemptAgentRelaunch, enforceExecuteCommitSafety: typeof enforceExecuteCommitSafety, unquoteGitStatusPath: typeof unquoteGitStatusPath}} */
const _activeExport = Object.assign(active, { buildExecutePrompt, buildCheckpointContext, runHandoffAndReview, applyExecuteFallback, selectLaunchAndRecord, validateCheckpointsBeforeHandoff, attemptAgentRelaunch, enforceExecuteCommitSafety, unquoteGitStatusPath, renderActiveProgress });
export default _activeExport;
export { _activeExport as active, buildExecutePrompt, buildCheckpointContext, runHandoffAndReview, applyExecuteFallback, selectLaunchAndRecord, validateCheckpointsBeforeHandoff, attemptAgentRelaunch, enforceExecuteCommitSafety, unquoteGitStatusPath, renderActiveProgress };
