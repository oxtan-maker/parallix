import type { BoardProjection } from './board.js';
import { formatCountdown } from './agent-countdown.js';

/**
 * Re-query the shared board projection when board-relevant state changes.
 *
 * Why this lives in the application layer: the interactive board must notice
 * work another `px` process started, an `AgentBlock` another process wrote,
 * and a block or current-work fact that simply expired with time. Every one of
 * those answers already comes from `BoardProjectionBuilder`, so the fix is to
 * rebuild *that* — not to teach an Ink component to poll SQLite, Git, and
 * `/proc` for itself (ADR 0051, and the mission's UI-neutrality guardrail).
 *
 * The mechanism is deliberately the dullest one that works: rebuild on an
 * interval and publish only when the result differs. That covers externally
 * caused changes and time-driven expiry with the same code path, needs no
 * daemon, no watcher, no event bus, and no scheduler, and it cannot leave a
 * partially-applied projection on screen.
 *
 * `subscribe` is only ever wired up for an interactive terminal. A piped
 * `px board` renders one frame and returns, so nothing here can make headless
 * output non-finite.
 */

/** How often the interactive board re-queries the shared projection. */
export const BOARD_REFRESH_INTERVAL_MS = 2_000;

export interface BoardSubscriptionOptions {
  readonly intervalMs?: number;
  /** Timer seam so tests can drive the loop without waiting on a real clock. */
  readonly setTimer?: (_callback: () => void, _ms: number) => unknown;
  readonly clearTimer?: (_handle: unknown) => void;
  /**
   * Reports a failed rebuild. A transient failure (a locked database, a Git
   * command that lost a race) must not tear the board down: the next tick
   * tries again and the operator keeps the last good frame.
   */
  readonly onError?: (_error: unknown) => void;
  /**
   * Compare the *displayed* countdown label instead of the raw `blockedForMs`
   * (task-2442). The interactive Ink board opts in: it renders the day/hour/minute
   * label `AgentStrip` produces, so invisible raw-millisecond movement must not
   * repaint it. Consumers that display their own countdown keep the default raw
   * comparison — e.g. the web host publishes the invalidation that drives the
   * browser's second-resolution `durationText` refetch, and its visible text must
   * keep moving while the Ink label is still.
   */
  readonly displayedCountdown?: boolean;
}

export type BoardProjectionListener = (_projection: BoardProjection) => void;

/**
 * Start re-querying. Returns the unsubscribe function; calling it stops the
 * loop and drops any in-flight rebuild's result, so an unmounted TUI cannot be
 * updated after the fact.
 */
export function subscribeToBoardProjection(
  build: () => Promise<BoardProjection>,
  onChange: BoardProjectionListener,
  options: BoardSubscriptionOptions = {},
): () => void {
  const intervalMs = options.intervalMs ?? BOARD_REFRESH_INTERVAL_MS;
  const setTimer = options.setTimer ?? defaultSetTimer;
  const clearTimer = options.clearTimer ?? defaultClearTimer;
  const displayedCountdown = options.displayedCountdown ?? false;

  let stopped = false;
  let handle: unknown = null;
  let lastFingerprint: string | null = null;

  const tick = async () => {
    try {
      const projection = await build();
      if (stopped) { return; }
      const fingerprint = boardFingerprint(projection, { displayedCountdown });
      if (fingerprint !== lastFingerprint) {
        lastFingerprint = fingerprint;
        onChange(projection);
      }
    } catch (error) {
      options.onError?.(error);
    } finally {
      if (!stopped) { handle = setTimer(() => { void tick(); }, intervalMs); }
    }
  };

  handle = setTimer(() => { void tick(); }, intervalMs);

  return () => {
    stopped = true;
    clearTimer(handle);
    handle = null;
  };
}

/**
 * A stable digest of everything the board displays as state.
 *
 * Metrics series are deliberately excluded except agent availability: a
 * recomputed timestamp inside a chart must not count as "the board changed"
 * and repaint on every tick.
 *
 * Agent availability defaults to the raw metric, so every poll that moves
 * `blockedForMs` republishes. Interactive consumers whose displayed countdown is
 * coarser than the raw value opt into `displayedCountdown` (task-2442): the Ink
 * board renders the day/hour/minute label, so a block that is days from expiry
 * must not repaint while the strip keeps showing the same `3d`. The display
 * form comes from the same pure formatter `AgentStrip` renders from, including
 * the `AgentStrip` guard itself (available agents and zero/elapsed blocks never
 * render a countdown), so day, hour, minute, zero/expired, and indefinite
 * values repaint exactly when the visible text changes. Consumers that render
 * their own, finer countdown (the web board's second-resolution `durationText`)
 * must stay on the raw comparison.
 */
export function boardFingerprint(
  projection: BoardProjection,
  options: { readonly displayedCountdown?: boolean } = {},
): string {
  return JSON.stringify({
    repositoryId: projection.repositoryId,
    cards: projection.stages.flatMap((stage) => stage.cards.map((card) => ({
      id: card.id,
      lane: card.lane,
      status: card.status,
      gate: card.gate,
      agent: card.agent,
      reviewPhase: card.reviewPhase,
      reviewRound: card.reviewRound,
      reviewApproved: card.reviewApproved,
      blockingReason: card.blockingReason,
      currentWork: card.currentWork,
      liveSession: card.liveSession ?? null,
    }))),
    attention: projection.attentionQueue.map((item) => [item.missionId, item.reason.kind, item.action.kind]),
    agents: options.displayedCountdown
      ? projection.metrics.agentAvailability.map((agent) => ({
          family: agent.family,
          available: agent.available,
          countdown: agent.available || agent.blockedForMs <= 0 ? null : formatCountdown(agent.blockedForMs),
          reason: agent.reason ?? null,
          runningSessions: agent.runningSessions ?? null,
        }))
      : projection.metrics.agentAvailability,
    unattributedRunningSessions: projection.metrics.unattributedRunningSessions,
    sourceFacts: projection.sourceFacts,
  });
}

function defaultSetTimer(callback: () => void, ms: number): unknown {
  const handle = setTimeout(callback, ms);
  // An unreferenced timer cannot hold the event loop open, so a board that is
  // closing exits immediately rather than waiting out the last interval.
  (handle as { unref?: () => void }).unref?.();
  return handle;
}

function defaultClearTimer(handle: unknown): void {
  if (handle !== null) { clearTimeout(handle as ReturnType<typeof setTimeout>); }
}
