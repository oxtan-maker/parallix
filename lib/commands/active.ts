// @ts-nocheck
import { git, getWorktreeStatus } from '../core/git.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as fmt from '../core/fmt.js';
import missionStart from './mission-start.js';
import * as agents from '../agents/agents.js';
import { findMissionDir, findCheckpoints, getFirstLine, resolveWorktree, inferSlug, getMissionYear, missionDirForSlug, isWorkflowGeneratedArtifact } from '../core/mission-utils.js';
import * as handoff from './handoff.js';
import { resolveTaskFile, transitionTask, getTaskStatus, getTaskImplementer } from '../tools/backlog.js';
import { resolveAgentModel } from '../core/product-config.js';
import * as review from '../review/review.js';
import * as repairHandoff from './repair-handoff.js';
import * as stats from './stats.js';
import { resolveStageTelemetry } from '../agents/stage-telemetry.js';

const EXECUTE_PROMPT_PATH = path.join(__dirname, '..', '..', 'prompts', 'execute.md');

/**
 * @param {string[]} args
 * @param {{inferSlugFn?: Function, missionStartFn?: Function, resolveWorktreeFn?: Function, readAgentConfigOrExitFn?: Function, resolveTaskFileFn?: Function, buildCheckpointContextFn?: Function, buildExecutePromptFn?: Function, selectLaunchAndRecordFn?: Function, enforceExecuteCommitSafetyFn?: Function, runHandoffAndReviewFn?: Function, exitFn?: Function, logFn?: Function, errorFn?: Function}} [options]
 */
async function active(args, options = {}) {
  const {
    inferSlugFn = inferSlug,
    missionStartFn = missionStart,
    resolveWorktreeFn = resolveWorktree,
    readAgentConfigOrExitFn = agents.readAgentConfigOrExit,
    resolveTaskFileFn = resolveTaskFile,
    buildCheckpointContextFn = buildCheckpointContext,
    buildExecutePromptFn = buildExecutePrompt,
    selectLaunchAndRecordFn = selectLaunchAndRecord,
    enforceExecuteCommitSafetyFn = enforceExecuteCommitSafety,
    runHandoffAndReviewFn = runHandoffAndReview,
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

  logFn('Running execute preflight...');
  const preflight = missionStartFn([normalizedSlug], { returnResult: true });
  if (!preflight.pass) {
    errorFn('Preflight failed. Fix blockers above before launching the execute agent.');
    exitFn(1);
    return;
  }

  const worktree = resolveWorktreeFn(normalizedSlug);
  if (!worktree) {
    errorFn(
      `Could not locate dedicated worktree for mission/${fmt.slug(normalizedSlug)}. ` +
      `Run "px draft ${normalizedSlug}" first or create the worktree manually.`
    );
    exitFn(1);
    return;
  }

  const agentConfig = readAgentConfigOrExitFn();
  const taskResolution = resolveTaskFileFn(normalizedSlug, worktree);
  const checkpointContext = buildCheckpointContextFn(normalizedSlug);
  const prompt = buildExecutePromptFn(normalizedSlug, checkpointContext, { rootDir: worktree });

  logFn('Launching execute agent...');
  let launchResult;
  try {
    launchResult = await selectLaunchAndRecordFn({
      slug: normalizedSlug,
      worktree,
      preselectedAgent: preselectedImplementer,
      agentConfig,
      taskResolution,
      prompt
    });
  } catch (err) {
    errorFn(`Could not launch execute agent: ${/** @type{Error} */(err).message}`);
    exitFn(1);
    return;
  }

  const { agent, result } = launchResult;

  if (result.error) {
    errorFn(`Could not start execute agent (${fmt.agent(agent)}): ${result.error.message}`);
    exitFn(1);
    return;
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    errorFn(`Execute agent (${fmt.agent(agent)}) exited with status ${result.status}.`);
    exitFn(result.status || 1);
    return;
  }

  try {
    enforceExecuteCommitSafetyFn({ slug: normalizedSlug, worktree });
  } catch (error) {
    errorFn(fmt.status('FAIL', /** @type{Error} */(error).message));
    exitFn(1);
    return;
  }

  // Automation: Post-active handoff
  logFn(`\nExecute agent (${fmt.agent(agent)}) completed successfully. Recording execute-phase stats...`);
  try {
    const result = launchResult.result;
    const sinceMs = result && result.startedAt ? Date.parse(result.startedAt) : 0;
    stats.recordActiveStats(
      /** @type{Parameters<typeof stats.recordActiveStats>[0]} */({
      slug: normalizedSlug,
      rootDir: worktree,
      implementer: agent,
      model: resolveAgentModel(agent, worktree),
      // Use the windowed Codex rollout (bounded by sinceMs) when present, else
      // the launcher-attached telemetry — same resolution as the review hook,
      // so the execute phase records this stage's delta, not cumulative usage.
      telemetry: resolveStageTelemetry({ worktree, result, sinceMs }),
      durationMinutes: result && result.startedAt && result.endedAt
        ? (Date.parse(result.endedAt) - Date.parse(result.startedAt)) / 60000
        : 0,
    })
    );
  } catch (err) {
    logFn(fmt.status('WARN', `Could not record execute stats for ${fmt.slug(normalizedSlug)}: ${/** @type{Error} */(err).message}`));
  }
  logFn(`\nExecute agent (${fmt.agent(agent)}) completed successfully. Starting automated handoff...`);
  const ok = await runHandoffAndReviewFn(normalizedSlug, worktree, agent, {
    taskFile: taskResolution.ok ? taskResolution.taskFile : null
  });
  if (!ok) {
    exitFn(1);
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
 * @param {{slug: string, worktree: string, preselectedAgent?: string | null, agentConfig: object, taskResolution: object, prompt: string, startAgentFn?: Function, transitionTaskFn?: Function, getTaskStatusFn?: Function, getTaskImplementerFn?: Function, selectAgentFn?: Function, log?: Function}} opts
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
    log = fmt.log.plain
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
  let launchedAgent = null;
  const rollbackIfNeeded = ({ throwOnFailure = true } = {}) => {
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
    if (!transitionTaskFn(slug, priorStatus, rollbackOpts)) {
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
      onLaunch: (/** @type{{agent: string}} */ { agent }) => {
        launchedAgent = agent;
        if (!(taskResolutionTyped && taskResolutionTyped.ok)) {
          return;
        }

        log(`Recording implementer ${fmt.agent(agent)} and status=active for ${fmt.slug(slug)}...`);
        if (!transitionTaskFn(slug, 'active', { implementer: agent, rootDir: worktree, log })) {
          launchTransitionFailed = true;
          return;
        }

        launchRecorded = true;
      },
      onLimitHit: () => {
        // Roll back the intermediate active write so the retry's onLaunch starts
        // from a clean state, preventing a spurious committed implementer entry.
        rollbackIfNeeded({ throwOnFailure: false });
      }
    }));
  } catch (err) {
    rollbackIfNeeded();
    throw err;
  }

  // `actual` is the family that actually ran (may differ from `preselected` after
  // a limit-hit fallback inside startAgent). Use it as the canonical implementer.
  const agent = actual || launchedAgent || preselected;
  const launchSucceeded = !result.error && (typeof result.status !== 'number' || result.status === 0);

  if (!launchSucceeded) {
    rollbackIfNeeded();
  }

  if (launchTransitionFailed) {
    throw new Error(`Failed to record task ${fmt.slug(slug)} as active after execute launch.`);
  }

  return { preselected, agent, result };
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
    transitionTaskFn(slug, 'active', { implementer: actual, rootDir: worktree, log });
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
 * @param {{isRelaunchableErrorFn?: Function, buildRelaunchPromptFn?: Function, workflowLauncherStatusFn?: Function, startAgentFn?: Function, log?: Function, error?: Function}} [options]
 */
async function attemptAgentRelaunch(slug, worktree, errorMsg, agent, options = {}) {
  const {
    isRelaunchableErrorFn = repairHandoff.isRelaunchableError,
    buildRelaunchPromptFn = repairHandoff.buildRelaunchPrompt,
    workflowLauncherStatusFn = agents.workflowLauncherStatus,
    startAgentFn = agents.startAgent,
    log = fmt.log.plain,
    error = fmt.log.plainError
  } = options;
  // Check if this is a relaunchable error
  if (!isRelaunchableErrorFn(errorMsg)) {
    log(`Error is not relaunchable: ${errorMsg}`);
    return { relaunched: false, error: 'Error is not relaunchable for agent relaunch' };
  }

  // Check if the agent launcher is available
  const status = workflowLauncherStatusFn(agent);
  if (!status.supported) {
    error(`Agent ${fmt.agent(agent)} is not available for relaunch: ${status.detail || status.reason || 'unknown'}`);
    return { relaunched: false, error: `Agent ${agent} launcher is not available` };
  }

  // Build the relaunch prompt
  const prompt = buildRelaunchPromptFn(errorMsg, slug, worktree);

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

/** @param {string} slug @param {string} worktree @param {{findMissionDirFn?: Function, findCheckpointsFn?: Function, runFn?: Function, log?: Function, error?: Function}} [options] */
function validateCheckpointsBeforeHandoff(slug, worktree, options = {}) {
  const {
    findMissionDirFn = findMissionDir,
    findCheckpointsFn = findCheckpoints,
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

  const checkpoints = findCheckpointsFn(missionDir);
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

  log(fmt.status('PASS', `Found ${checkpoints.length} checkpoint document(s) in ${fmt.path(missionDir)}.`));
  return { ok: true };
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
    startReviewLoop: _startReviewLoop = (/** @type{string} */ s, /** @type{object} */ o) => review.startReviewLoop(s, o),
    repairHandoffFn = /** @type{(s: string, w: string, e: string, o: object) => Promise<{repaired: boolean, blocker?: string}>} */(repairHandoff),
    attemptAgentRelaunchFn = attemptAgentRelaunch,
    log = fmt.log.plain,
    error = fmt.log.plainError
  } = options;
  // Pre-handoff checkpoint enforcement: validate checkpoints exist before calling performHandoff()
  // This catches missing checkpoints immediately after the execute agent exits,
  // before the repair flow runs, and provides an explicit instruction to create them.
  const validation = validateCheckpointsBeforeHandoffFn(slug, worktree, { log, error });
  if (!validation.ok) {
    // Don't attempt repair for missing checkpoints — instruct the agent to create them
    error(`       Create a checkpoint document (CP-N.md) in ${fmt.path(missionDirForSlug(worktree, slug))} with a Goal Check table.`);
    error(`       Then re-run: ${fmt.command(`px review ${slug} --submit`)}`);
    return false;
  }

  let handoffResult = await _performHandoff(slug, { forgejoUser: agent, worktree });

  if (!handoffResult.ok) {
    // Attempt single repair for routine hygiene issues (dirty artifacts, rebase needed)
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
  _startReviewLoop(slug, { implementer: agent, worktree, recordStageStatsSafeFn: review.recordStageStatsSafe });
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
  const template = fs.readFileSync(EXECUTE_PROMPT_PATH, 'utf8');
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
const _activeExport = Object.assign(active, { buildExecutePrompt, buildCheckpointContext, runHandoffAndReview, applyExecuteFallback, selectLaunchAndRecord, validateCheckpointsBeforeHandoff, attemptAgentRelaunch, enforceExecuteCommitSafety, unquoteGitStatusPath });
export default _activeExport;
export { _activeExport as active, buildExecutePrompt, buildCheckpointContext, runHandoffAndReview, applyExecuteFallback, selectLaunchAndRecord, validateCheckpointsBeforeHandoff, attemptAgentRelaunch, enforceExecuteCommitSafety, unquoteGitStatusPath };

// CJS compat: ensure require() returns the function directly
declare const module: { exports: any } | undefined;
if (typeof module !== 'undefined') { module.exports = _activeExport; }
