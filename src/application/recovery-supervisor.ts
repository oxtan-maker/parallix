import type { OperatorJudgmentResult } from './operator-judgment.js';
/**
 * Fleet-level recovery supervisor (ADR 0059).
 *
 * Command-local recovery (ADR 0048 and the rebound kernel) repairs a known
 * failure inside the command that saw it. This supervises the different case:
 * a mission that has stopped progressing *between* commands, with no agent
 * working it and no command left running to bounce it.
 *
 * What the supervisor reacts to is exactly what the board already puts in front
 * of a human: the "needs your attention" queue
 * (`projections/board.ts`). That queue already knows a working mission needs
 * nobody, already carries the reason a mission is on it, and already resolves
 * the typed command the operator would press. The supervisor presses it, and
 * when pressing it does not clear the item, it sends a fresh agent to work out
 * why. Nothing invents a second notion of "stuck".
 *
 * One supervisor run is deterministic orchestration. It watches the board, not
 * a mission handed to it, and holds no second mission state machine: every
 * lifecycle move is the existing application workflow.
 *
 * The run is a loop. Each pass re-reads the queue and takes at most one step per
 * mission, so a mission waiting on a recovery agent never holds up the rest of
 * the fleet and an item that appears mid-run is picked up. Callers may keep
 * watching after the queue has no work they can act on.
 *
 * Per attention item, per pass:
 *
 *  1. an item the human owns — anything that resolves to `px integrate` — is
 *     left alone. The supervisor never integrates anything;
 *  2. the action the item advertises is run, once per distinct state;
 *  3. when that does not clear the item, a fresh recovery agent runs in the
 *     mission worktree, under a budget counted per failure;
 *  4. a failure that survives its budget is escalated with what was observed.
 *
 * Recovery success is never the agent's own exit status: the next pass re-reads
 * the board, and an item that is gone is the only proof that it was cleared.
 *
 * Application layer: all I/O arrives through the injected port.
 */

export * from './recovery-contract.js';
import { attentionDetail, failureFingerprint, recoveryInstruction, isLeadLane, HUMAN_ONLY_ACTIONS, ACTION_ATTEMPTS, RECOVERY_BUDGET, DEFAULT_POLL_MS, BOARD_READ_ATTEMPTS, type AttentionObservation, type SupervisorPort, type SupervisionOutcome, type MissionSupervision, type RecoveryRequest } from './recovery-contract.js';

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** What one pass did to one mission, which is what tells the loop whether to wait. */
type PassResult = 'settled' | 'watching' | 'acted';

/** One mission's state across the passes of a run. Process-scoped, never persisted. */
interface MissionRun {
  readonly missionId: string;
  readonly steps: string[];
  /** Board actions already pressed against exactly those facts, so none repeats. */
  readonly pressed: Set<string>;
  /** Failed board-command attempts against one state, bounded before recovery. */
  readonly actionAttempts: Map<string, number>;
  /** Recovery agents spent per failure fingerprint — the budget is per failure. */
  readonly attempts: Map<string, number>;
  lastAction: string;
  outcome: SupervisionOutcome | null;
  /** The failure that was escalated; a new failure is a new recovery occurrence. */
  settledFailure: string | null;
  summary: string;
}

function newRun(mission: string): MissionRun {
  return {
    missionId: mission,
    steps: [],
    pressed: new Set<string>(),
    actionAttempts: new Map<string, number>(),
    attempts: new Map<string, number>(),
    lastAction: 'none — the board offered no action for this item',
    outcome: null,
    settledFailure: null,
    summary: '',
  };
}

function settle(run: MissionRun, outcome: SupervisionOutcome, summary: string): PassResult {
  run.outcome = outcome;
  run.settledFailure = outcome === 'escalated' ? run.settledFailure : null;
  run.summary = summary;
  return 'settled';
}

function report(run: MissionRun): MissionSupervision {
  return {
    missionId: run.missionId,
    outcome: run.outcome ?? 'open',
    steps: run.steps,
    summary: run.outcome ? run.summary : `${run.missionId} is still on the board's attention queue.`,
  };
}

/**
 * One pass over one attention item: press its action, or recover the mission.
 *
 * Nothing here decides whether a mission needs attention — the board decided
 * that, and a mission with a live agent never reaches this function because the
 * queue leaves it out.
 */
async function superviseItem(
  port: SupervisorPort,
  run: MissionRun,
  observed: AttentionObservation,
  budget: number,
  signal?: AbortSignal,
): Promise<PassResult> {
  run.steps.push(`${attentionDetail(observed.reason)} — board offers ${observed.action.display}`);

  // 1. The board is asking the human to land this. The supervisor never does.
  if (HUMAN_ONLY_ACTIONS.has(observed.action.kind)) {
    return settle(
      run,
      'human',
      `${run.missionId} is waiting for you: ${observed.action.display}. The supervisor never integrates.`,
    );
  }

  // 2. Press what the board advertises — the same command the operator would,
  //    through its existing use case. Pressed once per distinct state, so a
  //    command that does not clear the item is not pressed forever.
  //
  //    Liveness is rechecked first, and not only before a recovery launch: the
  //    queue ranks a blocking reason or a failed gate above liveness, so a
  //    mission with a live agent *can* be on it, and dispatching a command onto
  //    a running agent is the one thing the supervisor must never do.
  const key = `${observed.action.kind}@${observed.progress}@${failureFingerprint(observed)}`;
  if (!run.pressed.has(key)) {
    const beforeDispatch = await port.liveness(run.missionId);
    assertSupervisionRunning(signal);
    if (beforeDispatch.working) {
      run.steps.push(`not dispatching ${observed.action.display}: ${beforeDispatch.detail ?? 'an agent is working this mission'}`);
      return 'watching';
    }
    run.lastAction = observed.action.display;
    try {
      await port.runAction(run.missionId, observed.action, observed, signal);
      run.pressed.add(key);
      run.steps.push(`ran ${run.lastAction}`);
    } catch (error) {
      run.steps.push(`${run.lastAction} failed: ${errorText(error)}`);
      const attempts = (run.actionAttempts.get(key) ?? 0) + 1;
      run.actionAttempts.set(key, attempts);
      if (attempts < ACTION_ATTEMPTS) { return 'watching'; }
      run.pressed.add(key);
      run.steps.push(`${run.lastAction} failed ${attempts}/${ACTION_ATTEMPTS} times; recovery may now diagnose it`);
    }
    return 'acted';
  }

  // 3. The board's own action did not clear the item. No failure classification
  //    is required to go further: the supervisor answers "this mission is still
  //    stuck", not "this known failure needs this known repair".
  const failure = failureFingerprint(observed);
  const spentOnFailure = run.attempts.get(failure) ?? 0;
  if (spentOnFailure >= budget) {
    run.settledFailure = failure;
    return settle(
      run,
      'escalated',
      `${run.missionId} still needs attention in lane ${observed.lane}: ${attentionDetail(observed.reason)} `
      + `survived ${observed.action.display} and ${spentOnFailure} recovery attempt(s). `
      + 'Next: inspect the mission worktree yourself.',
    );
  }

  const release = await port.claimRecovery(run.missionId);
  if (!release) {
    run.steps.push('another supervisor run holds the recovery claim');
    return 'watching';
  }
  try {
    // Liveness is rechecked inside the claim: the window between reading the
    // queue and launching is exactly where an agent would appear.
    const beforeLaunch = await port.liveness(run.missionId);
    assertSupervisionRunning(signal);
    if (beforeLaunch.working) {
      run.steps.push(`work started before the recovery agent could: ${beforeLaunch.detail ?? 'current work is live'}`);
      return 'watching';
    }
    const judgment = await judgeRecoveryStep(port, run, failure);
    if (typeof judgment === 'string') { return judgment; }
    run.attempts.set(failure, spentOnFailure + 1);
    const request = recoveryRequest(run, observed, judgment);
    const detail = await port.launchRecovery({ ...request, instruction: recoveryInstruction(request) });
    run.steps.push(`recovery agent ${spentOnFailure + 1}/${budget} for this failure: ${detail}`);
  } catch (error) {
    run.steps.push(`recovery agent ${spentOnFailure + 1}/${budget} for this failure could not run: ${errorText(error)}`);
  } finally {
    await release();
  }

  // 4. The agent's exit is not evidence. The next pass re-reads the queue, and
  //    an item that is gone is the only proof that it cleared.
  return 'acted';
}

function recoveryRequest(run: MissionRun, observed: AttentionObservation, judgment: OperatorJudgmentResult): Omit<RecoveryRequest, 'instruction'> {
  return { missionId: run.missionId, lane: observed.lane, diagnostic: attentionDetail(observed.reason),
    attemptedOperation: run.lastAction, ...(judgment.admission ? { admission: judgment.admission } : {}), judgment: judgment.summary };
}

/** Judgment is admitted inside the recovery claim; live work still wins afterward. */
async function judgeRecoveryStep(port: SupervisorPort, run: MissionRun, failure: string): Promise<PassResult | OperatorJudgmentResult> {
  const decision: OperatorJudgmentResult = port.judgeRecovery ? await port.judgeRecovery(run.missionId)
    : { action: 'escalate', summary: 'Operator judgment capability unavailable.' };
  run.steps.push(`operator judgment ${decision.action}: ${decision.summary}`);
  if (decision.action === 'wait') { return 'watching'; }
  if (decision.action !== 'continue') {
    run.settledFailure = failure;
    return settle(run, 'escalated', `${decision.action}: ${decision.summary}`);
  }
  const afterJudgment = await port.liveness(run.missionId);
  if (afterJudgment.working) {
    run.steps.push('work started during judgment; no recovery launched');
    return 'watching';
  }
  if (!decision.admission) {
    run.settledFailure = failure;
    return settle(run, 'escalated', 'Operator continuation is missing its admitted identity; no recovery launched.');
  }
  return decision;
}

export interface SuperviseFleetOptions {
  readonly signal?: AbortSignal;
  /** Fresh recovery agents per failure. */
  readonly budget?: number;
  /** Watch only these missions instead of the whole attention queue. */
  readonly missions?: readonly string[];
  /** One pass over the queue, then stop. */
  readonly once?: boolean;
  /** Keep polling after the queue has no actionable work. */
  readonly keepWatching?: boolean;
  /** How long to wait before reading the queue again. */
  readonly pollMs?: number;
  /** Reported after each pass, for an operator watching the run. */
  readonly onPass?: (_pass: number, _results: readonly MissionSupervision[]) => void;
  /** Report a failed board read before retrying or handing it to the operator. */
  readonly onBoardReadFailure?: (_error: Error, _attempt: number) => void;
}

/**
 * Watch the board's attention queue and work it down.
 *
 * The queue is re-read every pass, so an item that appears, clears, or changes
 * during the run is seen without restarting. A mission that leaves the queue is
 * cleared; one that asks for integration is the human's; one that survives its
 * recovery budget is escalated. The loop ends when nothing is left that the
 * supervisor may act on unless the caller asks it to keep watching. One
 * mission's failure never stops the rest.
 */
export async function superviseFleet(
  port: SupervisorPort,
  options: SuperviseFleetOptions = {},
): Promise<MissionSupervision[]> {
  const budget = options.budget ?? RECOVERY_BUDGET;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const only = options.missions ? new Set(options.missions) : null;
  const runs = new Map<string, MissionRun>();
  /**
   * The step still running for a mission. It is both the fleet's concurrency
   * (a mission whose agent is still running does not stop the next mission from
   * being supervised) and its per-mission exclusion (a mission with a step in
   * flight is skipped until that step finishes).
   */
  const inFlight = new Map<string, Promise<unknown>>();
  // Consecutive board-read failures accumulate here; a successful read resets
  // the counter, so it measures back-to-back read failures, not the run total.
  const state = { boardReadFailures: 0, boardReadError: null as Error | null };

  let pass = 0;
  // True when a step has actually moved something since the last pass. A step
  // that only reports `watching` — a live agent, a claim held elsewhere — is not
  // progress, and treating its instant return as a wake-up would spin the loop.
  let actedSinceLastPass = false;
  const start = (run: MissionRun, observed: AttentionObservation): void => {
    const step = superviseItem(port, run, observed, budget, options.signal)
      .then((result) => { if (result !== 'watching') { actedSinceLastPass = true; } })
      .catch((error) => { run.steps.push(`supervising this item failed: ${errorText(error)}`); })
      .finally(() => { inFlight.delete(run.missionId); });
    inFlight.set(run.missionId, step);
  };

  for (; !supervisionStopped(options.signal);) {
    pass += 1;
    let queue: readonly AttentionObservation[];
    try {
      queue = (await port.attention()).filter((item) => isLeadLane(item.lane) && (!only || only.has(item.missionId)));
    } catch (error) {
      const outcome = await handleBoardReadFailure(port, error, pollMs, options, runs, state);
      if (outcome.error) { state.boardReadError = outcome.error; break; }
      continue;
    }
    if (supervisionStopped(options.signal)) { break; }
    state.boardReadFailures = 0;
    const onQueue = new Set(queue.map((item) => item.missionId));

    const watching = await clearIdleMissions(runs, inFlight, onQueue, port, options);
    if (supervisionStopped(options.signal)) { break; }
    const open = processAttentionQueue(queue, runs, inFlight, start);
    options.onPass?.(pass, [...runs.values()].map(report));

    if (options.once) { break; }
    if (fleetIsIdle(options, open, inFlight.size, watching)) { break; }
    // Wake on whichever comes first: a step finishing, or the polling interval.
    // Racing the interval too is what lets a mission that becomes stuck while
    // every running agent is slow still be discovered.
    await wakeFleet(port, pollMs, inFlight, actedSinceLastPass, options.signal);
    actedSinceLastPass = false;
  }

  // Steps still running own mission state, so the run does not report until
  // they are done.
  await Promise.all(inFlight.values());
  if (state.boardReadError) { throw state.boardReadError; }
  return [...runs.values()].map(report);
}

/**
 * A board read threw. Accumulate the consecutive failure, record it on every
 * open run, and decide whether to give up or wait and retry. The counter lives
 * in `state` so a successful read in the caller can reset it to zero.
 */
async function handleBoardReadFailure(
  port: SupervisorPort,
  error: unknown,
  pollMs: number,
  options: SuperviseFleetOptions,
  runs: Map<string, MissionRun>,
  state: { boardReadFailures: number; boardReadError: Error | null },
): Promise<{ error: Error | null }> {
  state.boardReadFailures += 1;
  const failure = new Error(`Could not read the board (${state.boardReadFailures}/${BOARD_READ_ATTEMPTS}): ${errorText(error)}`);
  options.onBoardReadFailure?.(failure, state.boardReadFailures);
  for (const run of runs.values()) {
    if (run.outcome === null) { run.steps.push(`board read failed: ${failure.message}`); }
  }
  if (options.once || state.boardReadFailures >= BOARD_READ_ATTEMPTS) {
    state.boardReadError = failure;
    return { error: failure };
  }
  const poll = port.wait(pollMs);
  try { await interruptiblePause(poll.elapsed, options.signal); } finally { poll.cancel(); }
  return { error: null };
}

/**
 * A live mission is absent from the queue by design. It is cleared only after
 * both the queue and the current-work authority agree it is idle. Return whether
 * at least one mission is still working, so the loop does not mistake a fleet of
 * live agents for an empty queue.
 */
async function clearIdleMissions(
  runs: Map<string, MissionRun>,
  inFlight: Map<string, Promise<unknown>>,
  onQueue: Set<string>,
  port: SupervisorPort,
  options: SuperviseFleetOptions,
): Promise<boolean> {
  let watching = false;
  for (const run of runs.values()) {
    if (run.outcome === null && !onQueue.has(run.missionId) && !inFlight.has(run.missionId)) {
      try {
        const liveness = await port.liveness(run.missionId);
        if (liveness.working) {
          watching = true;
          continue;
        }
      } catch (error) {
        // A bounded caller returns the unresolved item; the long-running
        // lead keeps polling because unreadable liveness is not clearance.
        watching = options.keepWatching === true;
        run.steps.push(`not clearing while current work is unreadable: ${errorText(error)}`);
        continue;
      }
      settle(run, 'cleared', `${run.missionId} left the board's attention queue.`);
    }
  }
  return watching;
}

/**
 * Reconcile each queued mission against its run state, then start a step for
 * each mission that is open and not already in flight. One step per mission at a
 * time: a step that runs for an hour must not stop the rest of the fleet from
 * being supervised. Return how many missions are open, so the loop can tell an
 * idle fleet from one that is simply waiting on in-flight steps.
 */
function processAttentionQueue(
  queue: readonly AttentionObservation[],
  runs: Map<string, MissionRun>,
  inFlight: Map<string, Promise<unknown>>,
  start: (_run: MissionRun, _observed: AttentionObservation) => void,
): number {
  let open = 0;
  for (const observed of queue) {
    const run = runs.get(observed.missionId) ?? newRun(observed.missionId);
    runs.set(observed.missionId, run);
    // A mission that cleared and came back is stuck again. So is an escalated
    // mission whose board reason changed: attempts are per failure, not per
    // mission. Integration remains terminal for this supervisor.
    if (run.outcome === 'cleared' || (run.outcome === 'escalated' && run.settledFailure !== failureFingerprint(observed))) {
      run.outcome = null;
      run.settledFailure = null;
      run.steps.push('back on the attention queue after clearing or with a different failure');
    }
    if (run.outcome !== null) { continue; }
    open += 1;
    if (!inFlight.has(observed.missionId)) { start(run, observed); }
  }
  return open;
}

/**
 * The loop stops when the operator asked for one pass, or when nothing is open,
 * nothing is in flight, and no mission is still working. The four facts are
 * passed in so this stays a one-line predicate instead of another nested guard
 * in the loop.
 */
function fleetIsIdle(
  options: SuperviseFleetOptions,
  open: number,
  inFlightSize: number,
  watching: boolean,
): boolean {
  return !options.keepWatching && open === 0 && inFlightSize === 0 && !watching;
}

/**
 * Pause until a step finishes or the polling interval elapses, whichever comes
 * first. Racing the interval too is what lets a mission that becomes stuck while
 * every running agent is slow still be discovered. If nothing moved since the
 * last pass, wait out the full interval rather than spinning on steps that
 * return immediately.
 */
async function wakeFleet(
  port: SupervisorPort,
  pollMs: number,
  inFlight: Map<string, Promise<unknown>>,
  actedSinceLastPass: boolean,
  signal?: AbortSignal,
): Promise<void> {
  const poll = port.wait(pollMs);
  try {
    await interruptiblePause(Promise.race([...inFlight.values(), poll.elapsed]), signal);
    if (!actedSinceLastPass) { await interruptiblePause(poll.elapsed, signal); }
  } finally {
    poll.cancel();
  }
}

/** Wake a polling caller promptly without retaining a signal listener. */
async function interruptiblePause(wait: Promise<unknown>, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) { return; }
  let wake: () => void = () => {};
  const interrupted = new Promise<void>(resolve => { wake = resolve; });
  signal?.addEventListener('abort', wake, { once: true });
  try { await Promise.race([wait, interrupted]); }
  finally { signal?.removeEventListener('abort', wake); }
}

function supervisionStopped(signal?: AbortSignal): boolean { return signal?.aborted === true; }
function assertSupervisionRunning(signal?: AbortSignal): void {
  if (supervisionStopped(signal)) { throw new Error('Supervision interrupted'); }
}
