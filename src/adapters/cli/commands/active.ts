import { ActiveLaunchRecorder } from './active-launch-recorder.js';
import type { ProgressEvent, ApplicationOutcome } from '../../../application/contracts.js';
import type { Log, Exit, ActiveOptions, ActiveExecution, LaunchOptions } from './active-adapter-types.js';
import { unquoteGitStatusPath } from '../../git/porcelain-path.js';
import { randomUUID } from 'node:crypto';
import { git, getWorktreeStatus } from '../../git/git.js';
import * as path from 'node:path';
import * as fmt from '../../../application/presentation/cli-format.js';
import * as agents from '../../agents/agents.js';
import { findMissionDir, findCheckpoints, getFirstLine, inferSlug, getMissionYear, missionDirForSlug, isWorkflowGeneratedArtifact } from '../../filesystem/mission-utils.js';
import { resolveTaskFile, transitionTask } from '../../backlog/backlog.js';
import { assembleStagePrompt } from '../../assets/runtime-assets.js';
import { resolvePromptConfiguration } from '../../config/product-config.js';
import { isDbAdhocIdentity } from '../../../domain/mission.js';

function renderActiveProgress(event: { phase: string; agent?: string }, logFn: Log) {
  if (event.phase === 'review-preparation') {
    logFn(fmt.status('PASS', `Implementation complete (${event.agent === undefined ? event.agent : fmt.agent(event.agent)}).`));
  }
}

/**
 * `missionTitleFn` resolves the headline title from the same authority `px status`
 * reports (composition supplies it); without one the headline names only the slug.
 */
async function active(args: string[], options: ActiveOptions = {}) {
  const cancellation = { requested: false, stopOwnedWorkflow: true };
  const interrupt = () => { cancellation.requested = true; };
  // Retain handlers during settlement so a second signal cannot abandon it.
  process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
  try { return await runActive(args, options, cancellation); }
  finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt); }
}

async function runActive(args: string[], options: ActiveOptions, cancellation: { requested: boolean; stopOwnedWorkflow: boolean }) {
  const { operatorInvocation = false } = options;
  const { inferSlugFn, service, controller, controllerFactory, serviceFactory, rootDir, exitFn, logFn, errorFn, missionTitleFn } = activeCommandBindings(options);
  const explicitSlug = args[0];
  const slug = inferSlugFn(explicitSlug);
  if (!slug) {
    errorFn('Usage: px active [<slug>] [--implementer <family>] [--reviewer <preferred-family>] (eligible runtime fallback applies)');
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
  // shape, not just `task-NNNN` (e.g. `px-<NNNN>` adhoc slugs).
  // The `<Title>` draft scaffold is not a title, so it is never shown.
  const stripTrailingId = (t: string) => t.replace(/\s*\([\w.-]+\)\s*$/i, '');
  const recordedTitle = stripTrailingId((await missionTitleFn(normalizedSlug)) ?? '');
  const title = recordedTitle.startsWith('<Title>') ? '' : recordedTitle;
  logFn(`Mission ${fmt.slug(normalizedSlug)}${title ? `: ${title}` : ''}`);

  // Allow operators to pin the implementer agent family via CLI flag instead of WORKFLOW_AGENT env var.
  function flagValue(arr: string[], flag: string, name: string) {
    const i = arr.indexOf(flag);
    if (i === -1) { return null; }
    const v = arr[i + 1];
    if (!v || v.startsWith('--')) {
      errorFn(fmt.status('FAIL', `Missing value for --${name}. Usage: px active <slug> --${name} <family>`));
      exitFn(1);
      return null;
    }
    return v;
  }
  const preselectedImplementer = flagValue(args, '--implementer', 'implementer');
  if (args.includes('--implementer') && !preselectedImplementer) { return; }
  // The explicit reviewer is the first family attempted by automatic review;
  // bounded runtime fallback remains within the configured eligible pool.
  const requestedReviewer = flagValue(args, '--reviewer', 'reviewer');
  if (args.includes('--reviewer') && !requestedReviewer) { return; }

  const renderProgress = (event: Pick<ProgressEvent, 'phase' | 'agent'>) => renderActiveProgress(event, logFn);
  const operationId = `active:${normalizedSlug}:${randomUUID()}`;
  const outcome = await executeActiveCommand({ cancellation, operatorInvocation, controller, controllerFactory, service, serviceFactory, rootDir, renderProgress, operationId, slug: normalizedSlug, agent: preselectedImplementer, reviewer: requestedReviewer });
  if (outcome.status !== 'completed' || !outcome.value) {
    reportActiveFailure(outcome, normalizedSlug, errorFn, exitFn);
    return;
  }
}

async function executeActiveCommand({ cancellation, operatorInvocation, controller, controllerFactory, service, serviceFactory, rootDir, renderProgress, operationId, slug, agent, reviewer }: ActiveExecution) {
  const dispatcher = controller || (typeof controllerFactory === 'function' ? await controllerFactory(rootDir, renderProgress) : null);
  if (dispatcher) { return dispatcher.dispatch({ kind: 'active:execute', missionId: slug, operationId, agent, reviewer, capabilities: new Set(['active:execute']), detached: false, operatorInvocation, cancellation }); }
  const executeService = service || (typeof serviceFactory === 'function' ? await serviceFactory(rootDir, renderProgress) : null);
  if (!executeService) { throw new Error('active command requires an injected execute-mission service'); }
  return executeService.execute({ cancellation, operatorInvocation, operationId, slug, agent, reviewer: reviewer ?? undefined, capabilities: new Set(['active:execute']) });
}

function reportActiveFailure(outcome: ApplicationOutcome<unknown>, slug: string, errorFn: Log, exitFn: Exit) {
  const message = ('error' in outcome ? outcome.error?.message : undefined) || 'Could not launch execute agent.';
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
// immediately after the launcher successfully spawns the process.
// The execution use case owns any pre-launch compensation.

async function selectLaunchAndRecord(opts: LaunchOptions) {
  const { slug, worktree, preselectedAgent, agentConfig, taskResolution, prompt, startAgentFn, transitionTaskFn, selectAgentFn, log, sessionMarkerPort, onAgentLaunched, unrefChild } = activeLaunchBindings(opts);
  const preselected = preselectedAgent || selectAgentFn('active', { config: agentConfig, runtimeBlocklist: opts.runtimeBlocklist, configuration: opts.configuration });
  const taskResolutionTyped = taskResolution;
  const recorder = new ActiveLaunchRecorder({
    slug, worktree, preselected, taskResolution: taskResolutionTyped,
    transitionTaskFn, log, onAgentLaunched
  });

  let actual;
  let result;
  ({ agent: actual, result } = await startAgentFn('active', {
      configuration: opts.configuration,
      prompt,
      worktree,
      agent: preselected,
      pinnedAgent: opts.pinnedAgent,
      slug: slug,
      role: 'implementer',
      unrefChild,
      sessionMarkerPort: sessionMarkerPort ?? undefined,
      onLaunch: launch => recorder.record(launch),
      // The agent's own terminal stream is the progress record. Keep only
      // conditions an operator must act on; the normal launcher trace is debug detail.
      log
    }));

  // `actual` is the family that actually ran (may differ from `preselected` after
  // a limit-hit fallback inside startAgent). Use it as the canonical implementer.
  const agent = actual || recorder.launchedAgent || preselected;
  if (recorder.launchTransitionFailed) {
    throw new Error(`Failed to record task ${fmt.slug(slug)} as active after execute launch.`);
  }

  return { preselected, agent, result, rebaseDeferred: recorder.rebaseDeferred };
}

function buildCheckpointContext(slug: string) {
  const missionDir = findMissionDir(slug);
  if (!missionDir) { return 'No checkpoint documents found. Start from CP-1.'; }

  const checkpoints = findCheckpoints(missionDir);
  if (checkpoints.length === 0) { return 'No checkpoint documents found. Start from CP-1.'; }

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
 */
function resolveExecuteTaskPath(slug: string, rootDir: string) {
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

function buildExecutePrompt(slug: string, checkpointContext: string, options: { rootDir?: string; dbOwnedNoMirror?: boolean } = {}) {
  const { rootDir = process.cwd(), dbOwnedNoMirror = false } = options;
  const promptConfiguration = resolvePromptConfiguration(rootDir);
  const template = assembleStagePrompt('execute', promptConfiguration);
  const year = getMissionYear(slug, rootDir) || String(new Date().getFullYear());
  const missionPath = path.join(missionDirForSlug(rootDir, slug), 'MISSION.md');
  const missionDir = path.dirname(missionPath);
  const taskPath = resolveExecuteTaskPath(slug, rootDir);

  // Backlog task instructions are inapplicable to DB-owned missions without a
  // mirror (task-2468 F5 and PX-0030 F6): neither an adhoc mission nor a wave
  // child has Backlog backing, so the shared execute prompt must not carry the
  // `Backlog task:` header, the
  // "Backlog task presence" preflight bullet, or the preserve/lifecycle-
  // metadata instructions that reference a file that does not exist. Strip
  // those Backlog-task lines only for a DB-owned taskless mission; Backlog-backed
  // (`task-<N>`) missions keep them even when the task file is not yet on disk.
  const dbOwnedNoTaskFile = isDbAdhocIdentity(slug) || dbOwnedNoMirror;
  let body = template;
  if (dbOwnedNoTaskFile) {
    body = body
      .split('\n')
      .filter((line) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('Backlog task:')) { return false; }
        if (trimmed === '- Backlog task presence') { return false; }
        if (/preserve `\{\{taskPath\}\}`/.test(line)) { return false; }
        if (/do not change the Backlog task's status/.test(line)) { return false; }
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

function parseDirtyEntry(entry: string) {
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

function isExecuteIgnoredPath(filePath: string) {
  return isWorkflowGeneratedArtifact(filePath);
}

function enforceExecuteCommitSafety(opts: { slug: string; worktree: string; dirtyEntries?: readonly string[]; gitImpl?: (_args: string[]) => { status: number | null; stdout?: string; stderr?: string } }) {
  const { slug, worktree, dirtyEntries = getWorktreeStatus(worktree), gitImpl = git } = opts;
  const parsedEntries = dirtyEntries.map(parseDirtyEntry);
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

const _activeExport = Object.assign(active, { buildExecutePrompt, buildCheckpointContext, selectLaunchAndRecord, enforceExecuteCommitSafety, unquoteGitStatusPath, renderActiveProgress });
export default _activeExport;
export { _activeExport as active, buildExecutePrompt, buildCheckpointContext, selectLaunchAndRecord, enforceExecuteCommitSafety, unquoteGitStatusPath, renderActiveProgress };

function activeCommandBindings(options: ActiveOptions) {
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
    missionTitleFn = () => null
  } = options;
  return { inferSlugFn, service, controller, controllerFactory, serviceFactory, rootDir, exitFn, logFn, errorFn, missionTitleFn };
}

function activeLaunchBindings(opts: LaunchOptions) {
  const {
    slug,
    worktree,
    preselectedAgent = null,
    agentConfig,
    taskResolution,
    prompt,
    startAgentFn = agents.startAgent,
    transitionTaskFn = transitionTask,
    selectAgentFn = agents.selectAgent,
    log = fmt.log.plain,
    sessionMarkerPort = null,
    // Reports every family the launcher actually starts, including each
    // automatic failover after a usage block. The application layer turns that
    // into the mission's current work; this adapter draws no conclusion.
    onAgentLaunched = null,
    // Board fire-and-forget dispatch: unref the child so the board process can
    // exit on q/Ctrl+C while the action runs on (CP-4 ownership rule).
    unrefChild = false,
  } = opts;
  return { slug, worktree, preselectedAgent, agentConfig, taskResolution, prompt, startAgentFn, transitionTaskFn, selectAgentFn, log, sessionMarkerPort, onAgentLaunched, unrefChild };
}
