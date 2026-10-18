import { authorizeMissionWrite } from '../../application/ports/mission-write-authorization.js';
import type { AgentProcessResult, AgentInvocation } from "./agent-process-types.js";
import { monotonicNowMs } from "../../application/lifecycle-timing.js";
import * as fmt from "../../application/presentation/cli-format.js";
import { DEFAULT_NO_OUTPUT_INITIAL_DELAY_MS, DRAFT_NO_OUTPUT_INITIAL_DELAY_MS } from "./launcher-selection.js";
import { withSandboxProfile } from "../process/bubblewrap.js";
import { openRunSession } from "./run-session.js";
import type { PreparedLaunch, StartAgentLoopDeps } from './agent-launch-context.js';
import { sessionMissionId } from './agent-launch-authority.js';


// A watchdog tick is only news once the agent's output has been silent this long.
export const QUIET_STREAM_REPORT_MS = 15_000;


export function formatElapsed(elapsedMs: number) {
  const seconds = Math.max(0, Math.round(elapsedMs / 1000));
  if (seconds < 60) {return `${seconds}s`;}
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`;
}


/**
 * Stop an already-spawned agent child after a launch callback rejects.
 * SIGTERM first, then SIGKILL escalation once the grace poll runs out. A
 * Bubblewrap-wrapped agent dies with its wrapper (--die-with-parent), so
 * signalling the direct child covers both wrapped and unwrapped launches.
 */
export async function stopLaunchedChild(child: { pid?: number } | null): Promise<void> {
  const pid = child?.pid;
  if (typeof pid !== 'number') { return; }
  const isAlive = (): boolean => {
    try { process.kill(pid, 0); return true; }
    catch (err) { return (err as NodeJS.ErrnoException).code === 'EPERM'; }
  };
  if (!isAlive()) { return; }
  try { process.kill(pid, 'SIGTERM'); } catch { return; }
  for (let attempt = 0; attempt < 40 && isAlive(); attempt += 1) {
    await new Promise((resolve) => { setTimeout(resolve, 50); });
  }
  if (isAlive()) {
    try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
  }
}


/** Run the launcher, announce the invocation, and await the result. */
export async function launchPrepared(prepared: PreparedLaunch, deps: Pick<StartAgentLoopDeps, 'step' | 'log' | 'slug' | 'unrefChild' | 'configuration' | 'worktree' | 'role' | 'onLaunch'>, chosen: string, attempt: number): Promise<{ invocation: AgentInvocation | null | undefined; result: AgentProcessResult }> {
  const { step, log, slug, unrefChild } = deps;
  const { launcher, agentEnv, resume, sessionId, model, watchdogConfig, customReservation, effectiveProfile, nativeSandbox, launchSessionMarkerPort, sessionRole, actualPrompt } = prepared;
  let invocation: AgentInvocation | null | undefined;
  let result: AgentProcessResult | undefined;
  let launchedChild: { pid?: number } | null = null;
  // The lifecycle persistence deadline (TASK-2582 SC8) is measured from
  // destination-work start to successful persistence. Destination work starts
  // when the agent's child process actually spawns, so the clock begins at the
  // real spawn (onSpawn), not before the launcher: pre-spawn launch prep is
  // environment-dependent and must not count against the persistence budget
  // (e.g. the custom family's synchronous CLI feature-detect, which shells out
  // to the agent's own binary and can take hundreds of ms on a loaded host).
  // The pre-launcher instant is the fallback for launchers that never report a
  // spawn, keeping the deadline conservative there rather than resetting it at
  // onLaunch.
  let startedAtMs = monotonicNowMs();
  // Durable run history and the optional tmux terminal host (TASK-2643).
  const runSession = openRunSession({ worktree: deps.worktree, slug, role: sessionRole ?? deps.role ?? step, family: chosen, attempt, log: (line) => log(line) }, { configuration: deps.configuration });
  try {
    await authorizeMissionWrite(slug ?? '');
    const launchResult = withSandboxProfile(effectiveProfile, () => launcher({
      configuration: deps.configuration,
      prompt: actualPrompt,
      worktree: deps.worktree!,
      env: agentEnv,
      resume,
      sessionId,
      model,
      sandbox: nativeSandbox,
      slug: slug === null ? null : sessionMissionId(slug),
      role: sessionRole,
      sessionMarkerPort: launchSessionMarkerPort,
      teeOptions: {
        ...runSession?.teeOptions,
        onSpawn: (child: {pid?: number}) => {
          // The child is spawned now: destination work has started, so the
          // lifecycle persistence deadline starts here (not pre-spawn).
          startedAtMs = monotonicNowMs();
          launchedChild = child;
          if (child.pid) { runSession?.observeExecution(child.pid); }
          customReservation?.bindChild(child.pid);
        },
        ...(unrefChild ? { unrefChild: true } : {}),
        ...(watchdogConfig
          ? {
              noOutputWatchdog: {
                ...watchdogConfig,
                onNoOutput: (evt) => {
                  // The watchdog keeps ticking after the agent's first output,
                  // so on a healthy run it announced "Still waiting ... last
                  // visible output 0s ago" while the agent was visibly
                  // streaming. Only speak up when the stream has actually
                  // gone quiet; a live agent is its own progress report.
                  if (evt.sawOutput && (evt.msSinceLastOutput ?? 0) < QUIET_STREAM_REPORT_MS) { return; }
                  const stage = evt.elapsedMs < (step === 'draft' ? DRAFT_NO_OUTPUT_INITIAL_DELAY_MS : DEFAULT_NO_OUTPUT_INITIAL_DELAY_MS)
                    ? 'starting up'
                    : 'running';
                  // The watchdog is observational and keeps reporting after
                  // the agent's first output, so the wording has to stay
                  // truthful once output has already been seen.
                  const detail = evt.sawOutput
                    ? `last visible output ${formatElapsed(evt.msSinceLastOutput ?? 0)} ago`
                    : 'stdout/stderr have not produced visible output';
                  log(fmt.status(
                    'INFO',
                    `${evt.sawOutput ? 'Still waiting on' : 'No output yet from'} ${fmt.agent(chosen)} for step "${step}" after ${formatElapsed(evt.elapsedMs)} ` +
                    `(pid ${evt.pid || 'unknown'}, agent ${stage}). ` +
                    `Launcher is still running; ${detail}.`
                  ));
                }
              }
            }
          : {})
      }
    }));
    const { invocation: launchedInvocation, resultPromise } = launchResult;
    invocation = launchedInvocation;
    // The spawned child's pid rides on the invocation so a launch callback
    // (and its diagnostics) can name the process it confirmed.
    // TypeScript's synchronous control-flow analysis cannot see the callback
    // assignment above, even though spawnAndTee invokes it before returning.
    const launchedPid = (launchedChild as { pid?: number } | null)?.pid;
    if (invocation && typeof launchedPid === 'number') {
      invocation.childPid = launchedPid;
    }
    if (invocation) {
      // The prompt is one of the args and runs to hundreds of lines. Echoing it
      // buries the launch line (and the rest of the run) in harness text nobody
      // reads, so summarize it by default and keep the verbatim command on DEBUG.
      const echoedArgs = invocation.args
        .map((arg: string) => (!deps.configuration.runtime.debug && String(arg).includes('\n') ? `<prompt: ${String(arg).length} chars>` : arg))
        .join(' ');
      log(fmt.status('INFO', `Launching: ${fmt.command(`${invocation.command} ${echoedArgs}`)}`));
      if (invocation.options && invocation.options.cwd) {
        // Keep this routine launch diagnostic distinct from the shell-init
        // transition sentinel emitted by `px draft`.
        log(fmt.status('INFO', `Agent working directory: ${fmt.path(invocation.options.cwd)}`));
      }
    }

    if (deps.onLaunch) {
      try {
        await deps.onLaunch({ agent: chosen, invocation, startedAtMs });
      } catch (err) {
        // A rejecting launch callback (a refused authoritative boundary, a
        // failed current-work publication) must not leave the already-spawned
        // agent running: stop it, then propagate the failure (TASK-2582 F4).
        await stopLaunchedChild(launchedChild);
        throw err;
      }
    }

    result = resultPromise ? await resultPromise : launchResult.result!;
  } finally {
    customReservation?.release();
    runSession?.finish(result);
  }
  return { invocation, result: result! };
}
