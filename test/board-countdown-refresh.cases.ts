import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import React from 'react';
import { render } from 'ink';
import { subscribeToBoardProjection, type BoardSubscriptionOptions } from '../src/application/projections/board-subscription.js';
import type { BoardShellProps } from '../src/interfaces/tui/shell.js';
import { agentFamily } from '../src/domain/agents.js';
import { makeAttentionItem, makeCard, makeProjection } from './fixtures/board-projection.js';
import type { AgentAvailabilityMetric, BoardProjection } from '../src/application/projections/board.js';
import type { SourceFact } from '../src/application/contracts.js';
import type { MissionId } from '../src/domain/mission.js';

// ---------------------------------------------------------------------------
// task-2442 regression coverage.
//
// A blocked agent that is days from expiry gets a new raw `blockedForMs` on
// every 2 s poll even though the strip keeps rendering the same day label
// (`3d`). The refresh fingerprint must compare the *displayed* countdown,
// not the raw millisecond count, or a long-running `px ui` repaints an
// identical frame forever and exhausts the heap.
//
// Every test drives the existing `setTimer`/`clearTimer` seam with a fake
// scheduler and deterministic projections: no real-time sleep, no retry loop,
// no forced GC, no heap-size setting, no memory threshold.
// ---------------------------------------------------------------------------

/** 3d 1h of remaining block time — renders as `3d`. */
const THREE_DAYS_ONE_HOUR_MS = 3 * 86_400_000 + 3_600_000;
/** One poll earlier. Still renders as `3d` — the visible text is unchanged. */
const ONE_POLL_EARLIER_MS = THREE_DAYS_ONE_HOUR_MS - 2_000;

function withBlockedAgent(
  metricsOverrides: Partial<BoardProjection['metrics']> = {},
  agentOverrides: Partial<AgentAvailabilityMetric> = {},
): BoardProjection {
  const projection = makeProjection();
  const metric: AgentAvailabilityMetric = {
    family: agentFamily('custom'),
    available: false,
    blockedForMs: THREE_DAYS_ONE_HOUR_MS,
    reason: 'usage limit',
    runningSessions: 1,
    ...agentOverrides,
  };
  (projection as { metrics: BoardProjection['metrics'] }).metrics = {
    ...projection.metrics,
    ...metricsOverrides,
    agentAvailability: [metric],
  };
  return projection;
}

interface TickDriver {
  readonly fire: () => void;
  readonly builds: () => number;
  readonly notifications: () => number;
  readonly stop: () => void;
}

/**
 * Drive `subscribeToBoardProjection` with a fake scheduler. One `fire()` per
 * scheduled tick; each tick resolves the deterministic projection for its
 * build index.
 */
function driveSubscription(
  build: () => Promise<BoardProjection>,
  onNotification?: (projection: BoardProjection) => void,
  // This file locks the Ink board's display-aligned behavior, so the default
  // mirrors the production TUI wiring (ui-command opts into displayedCountdown).
  options: BoardSubscriptionOptions = { displayedCountdown: true },
): TickDriver {
  const timers: Array<() => void> = [];
  let builds = 0;
  let notifications = 0;
  const unsubscribe = subscribeToBoardProjection(
    async () => { builds += 1; return build(); },
    (projection) => { notifications += 1; onNotification?.(projection); },
    { setTimer: (callback: () => void) => { timers.push(callback); return callback; }, clearTimer: () => {}, ...options },
  );
  return {
    fire: () => { timers.shift()!(); },
    builds: () => builds,
    notifications: () => notifications,
    stop: () => unsubscribe(),
  };
}

/** Two scheduled ticks with deterministic projections; returns observed counts. */
async function twoTicks(
  first: BoardProjection,
  second: BoardProjection,
  onNotification?: (projection: BoardProjection) => void,
  options?: BoardSubscriptionOptions,
): Promise<{ builds: number; notifications: number }> {
  let index = 0;
  const driver = driveSubscription(async () => { index += 1; return index === 1 ? first : second; }, onNotification, options);
  driver.fire();
  await new Promise<void>((resolve) => setImmediate(resolve));
  driver.fire();
  await new Promise<void>((resolve) => setImmediate(resolve));
  const observed = { builds: driver.builds(), notifications: driver.notifications() };
  driver.stop();
  return observed;
}

/**
 * Drain a bounded number of event-loop turns so that a scheduled React/Ink
 * commit — if one exists — has already written its frame. Turn-based, not
 * wall-clock: no sleep, no polling.
 */
async function settle(turns = 40): Promise<void> {
  for (let index = 0; index < turns; index += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    await Promise.resolve();
  }
}

/**
 * Resolve when the mounted stream has written at least `count` frames.
 * Event-driven (the `write` emission is the signal); the timer exists only to
 * turn a silent miss into a loud failure.
 */
function waitForFrame(stream: FrameSink, count: number): Promise<void> {
  if (stream.frames.length >= count) { return Promise.resolve(); }
  return new Promise<void>((resolve, reject) => {
    const onWrite = (): void => {
      if (stream.frames.length < count) { return; }
      clearTimeout(guard);
      stream.off('write', onWrite);
      resolve();
    };
    const guard = setTimeout(() => {
      stream.off('write', onWrite);
      reject(new Error(`timed out waiting for frame ${count}: the stream has ${stream.frames.length} frame(s)`));
    }, 900);
    stream.on('write', onWrite);
  });
}

class FrameSink extends EventEmitter {
  public columns = 200;
  public rows = 50;
  public readonly isTTY = true;
  public readonly frames: string[] = [];
  write(value: string): boolean { this.frames.push(String(value)); this.emit('write'); return true; }
  setRawMode(_enabled: boolean): void {}
  setEncoding(_encoding: string): void {}
  resume(): void {}
  ref(): void {}
  unref(): void {}
  read(): string | null { return null; }
  send(_value: string): void {}
}

test('SC1: a same-label blocked countdown emits one notification and no second mounted Ink frame', async () => {
  // Imported inside the test so the module-level import graph of this file
  // stays as small as the other subscription tests.
  const { BoardShell } = await import('../src/interfaces/tui/shell.js');
  const stdout = new FrameSink();
  const stdin = new FrameSink();
  let builds = 0;
  let notifications = 0;
  const timers: Array<() => void> = [];

  const props: BoardShellProps = {
    projection: withBlockedAgent({}),
    subscribeProjection: (onChange) =>
      subscribeToBoardProjection(
        async () => {
          builds += 1;
          return builds === 1
            ? withBlockedAgent({})
            : withBlockedAgent({}, { blockedForMs: ONE_POLL_EARLIER_MS });
        },
        (projection) => { notifications += 1; onChange(projection); },
        // Production TUI wiring: the Ink board compares the displayed label.
        { displayedCountdown: true, setTimer: (callback: () => void) => { timers.push(callback); return callback; }, clearTimer: () => {} },
      ),
  };

  const instance = render(
    React.createElement(BoardShell, props),
    {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      patchConsole: false,
      exitOnCtrlC: false,
      // Unthrottled render mode: every render commit writes a frame, so a
      // commit caused by an invisible precision change is observable.
      debug: true,
    },
  );

  await settle();
  const mountFrames = stdout.frames.length;
  assert.ok(mountFrames > 0, 'the mounted shell must render its initial frame');

  // Tick 1: first scheduled projection. Publishes and repaints.
  timers.shift()!();
  await waitForFrame(stdout, mountFrames + 1);
  const afterFirstPublish = stdout.frames.length;
  assert.ok(stdout.frames[afterFirstPublish - 1].includes('3d'), `the repainted frame must still show the 3d label. Got: ${stdout.frames[afterFirstPublish - 1]}`);
  assert.ok(stdout.frames[afterFirstPublish - 1].includes('usage limit'), 'the frame must keep the displayed block reason');

  // Tick 2: raw blockedForMs moved by exactly one poll, rendered label is
  // still `3d`. Nothing visible changed, so nothing may be published.
  timers.shift()!();
  await settle();

  // Assert before unmount: unmounting a debug-mode Ink instance emits its own
  // final frame and would pollute the content-frame count.
  assert.equal(builds, 2, 'SC2: every scheduled tick must invoke the projection builder');
  assert.equal(notifications, 1, `SC1: an invisible raw-duration change must not publish a second notification (raw ${THREE_DAYS_ONE_HOUR_MS}ms -> ${ONE_POLL_EARLIER_MS}ms both render 3d)`);
  assert.equal(stdout.frames.length, afterFirstPublish, 'SC1: no second Ink content frame for an unchanged visible countdown');

  instance.unmount();
});

test('the default subscription republishes on raw blockedForMs movement so own-countdown consumers keep updating', async () => {
  // The web host (src/interfaces/web/host.ts) is the other production caller of
  // subscribeToBoardProjection: its publish is the only board-change detector in
  // web code, and the browser renders its own second-resolution `durationText`
  // (e.g. `3d 1h`, `45s`), which moves while the Ink label is still. It stays on
  // the default raw comparison, so a raw one-poll movement must republish here.
  let calls = 0;
  const driver = driveSubscription(async () => {
    calls += 1;
    return withBlockedAgent({}, { blockedForMs: calls === 1 ? THREE_DAYS_ONE_HOUR_MS : ONE_POLL_EARLIER_MS });
  }, undefined, {});

  driver.fire();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(driver.notifications(), 1, 'the first scheduled projection publishes');

  driver.fire();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(driver.builds(), 2, 'the second tick still rebuilds the authoritative projection');
  assert.equal(
    driver.notifications(),
    2,
    `the raw comparison must keep publishing while raw ${THREE_DAYS_ONE_HOUR_MS}ms -> ${ONE_POLL_EARLIER_MS}ms both render 3d to the Ink strip`,
  );

  driver.stop();
});

test('SC1: a raw blockedForMs change that renders the same countdown does not re-publish', async () => {
  let calls = 0;
  const driver = driveSubscription(async () => {
    calls += 1;
    return withBlockedAgent({}, { blockedForMs: calls === 1 ? THREE_DAYS_ONE_HOUR_MS : ONE_POLL_EARLIER_MS });
  });

  driver.fire();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(driver.builds(), 1, 'the first tick rebuilds the projection');
  assert.equal(driver.notifications(), 1, 'the first scheduled projection publishes');

  driver.fire();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(driver.builds(), 2, 'SC2: the second tick still rebuilds the authoritative projection');
  assert.equal(driver.notifications(), 1, 'SC1: the same displayed countdown must not publish a second time');

  driver.stop();
});

test('SC2: every scheduled tick invokes the projection builder even when the fingerprint is unchanged', async () => {
  let calls = 0;
  const driver = driveSubscription(async () => {
    calls += 1;
    return withBlockedAgent({}, { blockedForMs: THREE_DAYS_ONE_HOUR_MS - calls * 2_000 });
  });

  for (let tick = 0; tick < 5; tick += 1) {
    driver.fire();
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.equal(calls, 5, 'no tick may skip the projection build, whatever the fingerprint says');
  assert.equal(driver.notifications(), 1, 'the whole run renders one visible state, so exactly one notification is legal');
  driver.stop();
});



// ---------------------------------------------------------------------------
// Display-boundary crossings: each visible label change must publish exactly
// one additional notification on the next scheduled projection.
// ---------------------------------------------------------------------------

/** 2d 23h 59m remaining — renders as `2d`. */
const TWO_DAYS_TWENTY_THREE_HOURS_FIFTY_NINE_MINUTES_MS = 259_140_000;
/** 3d 0h 0m — the day label has moved to `3d`. */
const THREE_DAYS_MS = 259_200_000;

test('SC3: a displayed day-boundary crossing publishes one additional notification', async () => {
  const observed = await twoTicks(
    withBlockedAgent({}, { blockedForMs: TWO_DAYS_TWENTY_THREE_HOURS_FIFTY_NINE_MINUTES_MS }),
    withBlockedAgent({}, { blockedForMs: THREE_DAYS_MS }),
  );
  assert.equal(observed.builds, 2, 'both ticks rebuild the projection');
  assert.equal(observed.notifications, 2, 'the 2d -> 3d label change must repaint exactly once');
});

/** 5h 59m remaining — renders as `5h 59m`. */
const FIVE_HOURS_FIFTY_NINE_MINUTES_MS = 21_540_000;
/** 6h 0m — the hour label has moved to `6h`. */
const SIX_HOURS_MS = 21_600_000;

test('SC3: a displayed hour-boundary crossing publishes one additional notification', async () => {
  const observed = await twoTicks(
    withBlockedAgent({}, { blockedForMs: FIVE_HOURS_FIFTY_NINE_MINUTES_MS }),
    withBlockedAgent({}, { blockedForMs: SIX_HOURS_MS }),
  );
  assert.equal(observed.builds, 2, 'both ticks rebuild the projection');
  assert.equal(observed.notifications, 2, 'the 5h 59m -> 6h label change must repaint exactly once');
});

test('SC3: a displayed minute-boundary crossing publishes one additional notification', async () => {
  const observed = await twoTicks(
    withBlockedAgent({}, { blockedForMs: 44 * 60_000 }),
    withBlockedAgent({}, { blockedForMs: 45 * 60_000 }),
  );
  assert.equal(observed.builds, 2, 'both ticks rebuild the projection');
  assert.equal(observed.notifications, 2, 'the 44m -> 45m label change must repaint exactly once');
});

test('SC3: an elapsed block renders the family available on its next scheduled projection', async () => {
  let notified: BoardProjection | null = null;
  const observed = await twoTicks(
    withBlockedAgent({}, { blockedForMs: 120_000 }),
    withBlockedAgent({}, { available: true, blockedForMs: 0, reason: null }),
    (projection) => { notified = projection; },
  );
  assert.equal(observed.builds, 2, 'both ticks rebuild the projection');
  assert.equal(observed.notifications, 2, 'the expiry flipping the family to available must repaint');
  assert.equal(notified?.metrics.agentAvailability[0].available, true, 'the repainted state must show the family available, not keep claiming a block');
});

test('SC3: an indefinite block keeps one visible state across polls', async () => {
  const observed = await twoTicks(
    withBlockedAgent({}, { blockedForMs: Infinity }),
    withBlockedAgent({}, { blockedForMs: Infinity }),
  );
  assert.equal(observed.builds, 2, 'both ticks still rebuild the projection');
  assert.equal(observed.notifications, 1, 'an unchanged ∞ label must not repaint');
});

// ---------------------------------------------------------------------------
// SC4: every non-countdown state the board displays still republishes.
// ---------------------------------------------------------------------------

test('SC4: a displayed block-reason change publishes on the next scheduled projection', async () => {
  const observed = await twoTicks(
    withBlockedAgent({}, { blockedForMs: THREE_DAYS_ONE_HOUR_MS }),
    withBlockedAgent({}, { blockedForMs: THREE_DAYS_ONE_HOUR_MS, reason: 'rate limited' }),
  );
  assert.equal(observed.notifications, 2, 'a visible reason change must repaint even when the countdown label is unchanged');
});

test('SC4: an agent family identity change publishes on the next scheduled projection', async () => {
  const observed = await twoTicks(
    withBlockedAgent({}, { blockedForMs: THREE_DAYS_ONE_HOUR_MS }),
    withBlockedAgent({}, { family: agentFamily('codex'), blockedForMs: THREE_DAYS_ONE_HOUR_MS }),
  );
  assert.equal(observed.notifications, 2, 'a family identity change must repaint');
});

test('SC4: an attributed live-process count change publishes on the next scheduled projection', async () => {
  const observed = await twoTicks(
    withBlockedAgent({}, { blockedForMs: THREE_DAYS_ONE_HOUR_MS, runningSessions: 1 }),
    withBlockedAgent({}, { blockedForMs: THREE_DAYS_ONE_HOUR_MS, runningSessions: 3 }),
  );
  assert.equal(observed.notifications, 2, 'a live-process count change must repaint even when the countdown label is unchanged');
});

test('SC4: an unattributed live-process count change publishes on the next scheduled projection', async () => {
  const observed = await twoTicks(
    withBlockedAgent({ unattributedRunningSessions: null }, { available: true, blockedForMs: 0 }),
    withBlockedAgent({ unattributedRunningSessions: 2 }, { available: true, blockedForMs: 0 }),
  );
  assert.equal(observed.notifications, 2, 'an unattributed live-process count change must repaint');
});

test('SC4: a card state change publishes on the next scheduled projection', async () => {
  const card = (status: 'active' | 'review') => makeCard({
    id: 'task-2442' as MissionId,
    lane: 'active',
    status,
    rawStatus: status,
  });
  const observed = await twoTicks(
    makeProjection({ active: [card('active')] }),
    makeProjection({ active: [card('review')] }),
  );
  assert.equal(observed.notifications, 2, 'a card state change must repaint');
});

test('SC4: an attention state change publishes on the next scheduled projection', async () => {
  const card = makeCard({ id: 'task-2442' as MissionId, lane: 'active', status: 'active', rawStatus: 'active' });
  const withAttention = makeProjection({ active: [card] });
  const item = makeAttentionItem(card, { kind: 'blocking', detail: 'usage limit' }, 1);
  const observed = await twoTicks(
    withAttention,
    { ...withAttention, attentionQueue: [item] },
  );
  assert.equal(observed.notifications, 2, 'an attention queue change must repaint');
});

test('SC4: a source status change publishes on the next scheduled projection', async () => {
  const fact = (status: 'fresh' | 'stale'): SourceFact<string> => ({ source: 'git', status });
  const observed = await twoTicks(
    { ...makeProjection(), sourceFacts: [fact('fresh')] },
    { ...makeProjection(), sourceFacts: [fact('stale')] },
  );
  assert.equal(observed.notifications, 2, 'a source freshness change must repaint');
});

test('SC4: a current-work state change publishes on the next scheduled projection', async () => {
  const work = {
    operationId: 'op-2442',
    phase: 'execute',
    summary: 'implementing the countdown seam',
    agent: agentFamily('custom'),
    updatedAt: '2026-08-30T12:00:00.000Z',
    freshness: 'live' as const,
  };
  const observed = await twoTicks(
    makeProjection({ active: [makeCard({ id: 'task-2442' as MissionId, lane: 'active', currentWork: null })] }),
    makeProjection({ active: [makeCard({ id: 'task-2442' as MissionId, lane: 'active', currentWork: work })] }),
  );
  assert.equal(observed.notifications, 2, 'a current-work change must repaint');
});
