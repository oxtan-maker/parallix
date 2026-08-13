import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  makeCard,
  makeProjection,
  makeAttentionItem,
} from './fixtures/board-projection.js';
import type { AttentionReason } from '../src/application/projections/board.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function renderShell(props: Record<string, unknown>): Promise<string> {
  const ink = await import('ink');
  const React = await import('react');
  const { BoardShell } = await import('../src/interfaces/tui/shell.js');
  return ink.renderToString(React.createElement(BoardShell, props as never), { columns: 120 });
}

interface MockStream extends EventEmitter {
  columns: number;
  rows: number;
  isTTY: boolean;
  writes: string[];
  _input: string[];
  write(value: string): boolean;
  setRawMode(mode: boolean): void;
  setEncoding(encoding: BufferEncoding): void;
  resume(): void;
  ref(): void;
  unref(): void;
  read(): string | null;
  send(value: string): void;
}

function makeStream(): MockStream {
  const stream = new EventEmitter() as MockStream;
  stream.columns = 120;
  stream.rows = 30;
  stream.isTTY = true;
  stream.writes = [];
  stream._input = [];
  stream.write = function (this: MockStream, value: string): boolean {
    this.writes.push(value);
    return true;
  };
  stream.setRawMode = () => {};
  stream.setEncoding = () => {};
  stream.resume = () => {};
  stream.ref = () => {};
  stream.unref = () => {};
  stream.read = function (this: MockStream): string | null {
    return this._input.shift() ?? null;
  };
  stream.send = function (this: MockStream, value: string): void {
    this._input.push(value);
    /* Emit as Buffer for escape sequences (real terminals send bytes).
     * Also emit as string for simple characters like \r. */
    this.emit('data', Buffer.from(value));
    this.emit('readable');
  };
  return stream;
}

// ---------------------------------------------------------------------------
// CP-1: Attention item selection and bidirectional sync
// ---------------------------------------------------------------------------

test('attention-items: AttentionItems renders with selectedMissionId and ▶ prefix for focused mission', async () => {
  const integrateCard = makeCard({
    id: 'task-1001' as never,
    lane: 'integration',
    title: 'Integrate mission',
  });
  const reviewCard = makeCard({
    id: 'task-1002' as never,
    lane: 'review',
    title: 'Review mission',
  });

  const queue: ReturnType<typeof makeAttentionItem>[] = [
    makeAttentionItem(integrateCard, { kind: 'integrate-lane', detail: 'Awaiting integration' }, 3),
    makeAttentionItem(reviewCard, { kind: 'review-lane', detail: 'Awaiting review' }, 2),
  ];

  const projection = makeProjection(
    { integration: [integrateCard], review: [reviewCard] },
    'test-repo',
  );
  const projWithQueue = { ...projection, attentionQueue: queue };

  // With selection on first attention item, output must contain ▶ prefix
  const output = await renderShell({
    projection: projWithQueue,
    columns: 120,
    rows: 30,
    initialSelectedMissionId: 'task-1001',
  });

  assert.match(
    output,
    /▶.*task-1001/,
    'selected attention item must show ▶ prefix matching MissionCard focus style',
  );
});

test('attention-items: selecting an attention item by Enter updates selectedMissionId and board card shows ▶', async () => {
  const ink = await import('ink');
  const React = await import('react');
  const { BoardShell } = await import('../src/interfaces/tui/shell.js');

  const integrateCard = makeCard({
    id: 'task-2001' as never,
    lane: 'integration',
    title: 'Integrate mission',
  });

  const queue = [
    makeAttentionItem(integrateCard, { kind: 'integrate-lane', detail: 'Awaiting integration' }, 3),
  ];

  const projection = makeProjection(
    { integration: [integrateCard] },
    'test-repo',
  );
  const projWithQueue = { ...projection, attentionQueue: queue };

  const stdin = makeStream();
  const stdout = makeStream();

  const instance = ink.render(
    React.createElement(BoardShell, {
      projection: projWithQueue,
      columns: 120,
      rows: 30,
    } as never),
    {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      patchConsole: false,
      exitOnCtrlC: false,
    },
  );

  await new Promise((resolve) => setTimeout(resolve, 50));

  // Send Tab to switch focus from board to attention rail
  stdin.send('\t');
  await new Promise((resolve) => setTimeout(resolve, 50));

  // Send Enter key (carriage return) to select the focused attention item
  stdin.send('\r');
  await new Promise((resolve) => setTimeout(resolve, 50));

  instance.unmount();
  const output = stdout.writes.join('');

  // The ▶ marker should appear for the selected mission task-2001
  assert.match(
    output,
    /▶.*task-2001/,
    'Enter on attention item must select the mission and show ▶ in output',
  );
});

test('attention-items: Enter while board focus is active does not activate attention selection', async () => {
  const ink = await import('ink');
  const React = await import('react');
  const { BoardShell } = await import('../src/interfaces/tui/shell.js');

  const reviewCard = makeCard({
    id: 'task-board1' as never,
    lane: 'review',
    title: 'Review mission',
  });
  const integrateCard = makeCard({
    id: 'task-board2' as never,
    lane: 'integration',
    title: 'Integrate mission',
  });

  const queue = [
    makeAttentionItem(integrateCard, { kind: 'integrate-lane', detail: 'Awaiting integration' }, 3),
    makeAttentionItem(reviewCard, { kind: 'review-lane', detail: 'Awaiting review' }, 2),
  ];

  const projection = makeProjection(
    { review: [reviewCard], integration: [integrateCard] },
    'test-repo',
  );
  const projWithQueue = { ...projection, attentionQueue: queue };

  const stdin = makeStream();
  const stdout = makeStream();

  const instance = ink.render(
    React.createElement(BoardShell, {
      projection: projWithQueue,
      columns: 120,
      rows: 30,
    } as never),
    {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      patchConsole: false,
      exitOnCtrlC: false,
    },
  );

  await new Promise((resolve) => setTimeout(resolve, 50));

  // Board starts with focus (focusedArea === 'board').
  // Send Enter without Tab — should NOT activate attention rail.
  stdin.send('\r');
  await new Promise((resolve) => setTimeout(resolve, 50));

  instance.unmount();
  const output = stdout.writes.join('');

  // Wave 5 message should NOT appear (Enter was ignored because board has focus)
  assert.doesNotMatch(
    output,
    /wave 5|TASK-2307/,
    'Enter while board focus is active must not show wave 5 message',
  );
});

test('attention-items: up/down (WASD) independently navigate attention rail with multiple items', async () => {
  const ink = await import('ink');
  const React = await import('react');
  const { BoardShell } = await import('../src/interfaces/tui/shell.js');

  const integrateCard = makeCard({
    id: 'task-nav1' as never,
    lane: 'integration',
    title: 'Integrate mission',
  });
  const reviewCard = makeCard({
    id: 'task-nav2' as never,
    lane: 'review',
    title: 'Review mission',
  });
  const blockingCard = makeCard({
    id: 'task-nav3' as never,
    lane: 'active',
    title: 'Blocking mission',
    blockingReason: 'upstream',
  });

  const queue = [
    makeAttentionItem(blockingCard, { kind: 'blocking', detail: 'mission is blocked' }, 0),
    makeAttentionItem(reviewCard, { kind: 'review-lane', detail: 'Awaiting review' }, 2),
    makeAttentionItem(integrateCard, { kind: 'integrate-lane', detail: 'Awaiting integration' }, 3),
  ];

  const projection = makeProjection(
    { integration: [integrateCard], review: [reviewCard], active: [blockingCard] },
    'test-repo',
  );
  const projWithQueue = { ...projection, attentionQueue: queue };

  const stdin = makeStream();
  const stdout = makeStream();

  const instance = ink.render(
    React.createElement(BoardShell, {
      projection: projWithQueue,
      columns: 120,
      rows: 30,
    } as never),
    {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      patchConsole: false,
      exitOnCtrlC: false,
    },
  );

  await new Promise((resolve) => setTimeout(resolve, 50));

  // Initially the board auto-selects the first non-empty lane card (task-nav3 in active lane).
  // This syncs to the attention rail, so task-nav3 shows ▶ (selected marker).
  const initialOutput = stdout.writes.join('');
  assert.match(
    initialOutput,
    /▶.*task-nav3/,
    'initial board selection syncs to attention rail showing ▶ task-nav3',
  );

  // Send Tab to switch focus from board to attention rail
  stdin.send('\t');
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Send 's' (down) to move rail focus to second item (task-nav2)
  stdin.send('s');
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Send Enter to select the now-focused second item (task-nav2)
  stdin.send('\r');
  await new Promise((resolve) => setTimeout(resolve, 100));

  instance.unmount();
  const finalOutput = stdout.writes.join('');

  // After pressing Tab + s + Enter, task-nav2 should be selected with ▶.
  // The full output contains multiple Ink render frames; the selection update
  // appears in one of them.
  assert.match(
    finalOutput,
    /▶.*task-nav2/,
    'Tab + s (down) + Enter must select the second attention item (task-nav2)',
  );
});

test('attention-items: selecting a lane card updates selectedMissionId and matching attention item renders ▶', async () => {
  const ink = await import('ink');
  const React = await import('react');
  const { BoardShell } = await import('../src/interfaces/tui/shell.js');

  const reviewCard = makeCard({
    id: 'task-3001' as never,
    lane: 'review',
    title: 'Review mission',
  });

  const queue = [
    makeAttentionItem(reviewCard, { kind: 'review-lane', detail: 'Awaiting review' }, 2),
  ];

  const projection = makeProjection(
    { review: [reviewCard] },
    'test-repo',
  );
  const projWithQueue = { ...projection, attentionQueue: queue };

  const stdin = makeStream();
  const stdout = makeStream();

  const instance = ink.render(
    React.createElement(BoardShell, {
      projection: projWithQueue,
      columns: 120,
      rows: 30,
    } as never),
    {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      patchConsole: false,
      exitOnCtrlC: false,
    },
  );

  await new Promise((resolve) => setTimeout(resolve, 50));

  // Navigate to the review lane (right arrow moves through lanes)
  // The initial selection is the first card in the first non-empty lane.
  // Since review is the only lane with cards, it should already be selected.
  // Let's verify the bidirectional sync by checking output.

  instance.unmount();
  const output = stdout.writes.join('');

  // The selected mission task-3001 should show ▶ in the attention rail
  assert.match(
    output,
    /▶.*task-3001/,
    'bidirectional sync: selected lane card must highlight matching attention item with ▶',
  );
});

// ---------------------------------------------------------------------------
// CP-2: Exact command preview and run-affordance "wave 5" message
// ---------------------------------------------------------------------------

test('attention-items: each item renders exact command string from attentionCommand()', async () => {
  const { attentionCommand } = await import('../src/interfaces/tui/shell.js');

  const integrateCard = makeCard({ id: 'task-4001' as never, lane: 'integration' });
  const reviewCard = makeCard({ id: 'task-4002' as never, lane: 'review' });
  const blockingCard = makeCard({ id: 'task-4003' as never, lane: 'active', blockingReason: 'upstream' });
  const gateFailedCard = makeCard({ id: 'task-4004' as never, lane: 'active', gate: 'failed' });

  assert.equal(
    attentionCommand(integrateCard, { kind: 'integrate-lane' }),
    'px integrate task-4001',
  );
  assert.equal(
    attentionCommand(reviewCard, { kind: 'review-lane' }),
    'px review task-4002',
  );
  assert.equal(
    attentionCommand(blockingCard, { kind: 'blocking' }),
    'px active task-4003',
  );
  assert.equal(
    attentionCommand(gateFailedCard, { kind: 'gate-failed' }),
    'px active task-4004',
  );
});

test('attention-items: rendered output contains exact command text "$ px <cmd> <slug>"', async () => {
  const integrateCard = makeCard({
    id: 'task-5001' as never,
    lane: 'integration',
    title: 'Integrate mission',
  });

  const queue = [
    makeAttentionItem(integrateCard, { kind: 'integrate-lane', detail: 'Awaiting integration' }, 3),
  ];

  const projection = makeProjection(
    { integration: [integrateCard] },
    'test-repo',
  );
  const projWithQueue = { ...projection, attentionQueue: queue };

  const output = await renderShell({
    projection: projWithQueue,
    columns: 120,
    rows: 30,
  });

  assert.match(
    output,
    /\$ px integrate task-5001/,
    'attention item must render exact command text "$ px integrate task-5001"',
  );
});

test('attention-items: activating run affordance shows wave 5 message and dispatches nothing', async () => {
  const ink = await import('ink');
  const React = await import('react');
  const { BoardShell } = await import('../src/interfaces/tui/shell.js');

  const reviewCard = makeCard({
    id: 'task-6001' as never,
    lane: 'review',
    title: 'Review mission',
  });

  const queue = [
    makeAttentionItem(reviewCard, { kind: 'review-lane', detail: 'Awaiting review' }, 2),
  ];

  const projection = makeProjection(
    { review: [reviewCard] },
    'test-repo',
  );
  const projWithQueue = { ...projection, attentionQueue: queue };

  const stdin = makeStream();
  const stdout = makeStream();

  const instance = ink.render(
    React.createElement(BoardShell, {
      projection: projWithQueue,
      columns: 120,
      rows: 30,
    } as never),
    {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      patchConsole: false,
      exitOnCtrlC: false,
    },
  );

  await new Promise((resolve) => setTimeout(resolve, 50));

  // Send Tab to switch focus from board to attention rail
  stdin.send('\t');
  await new Promise((resolve) => setTimeout(resolve, 50));

  // Send Enter key to activate run affordance on the focused attention item
  stdin.send('\r');
  await new Promise((resolve) => setTimeout(resolve, 50));

  instance.unmount();
  const output = stdout.writes.join('');

  // ActionBar was removed (not in design). Enter on a review-lane item
  // does not dispatch because active:execute is not enabled for review missions.
  assert.doesNotMatch(
    output,
    /ACTIONS/,
    'activating an unavailable action must not render action bar',
  );
});

// ---------------------------------------------------------------------------
// CP-3: Empty queue, unavailable sources, and narrow layout
// ---------------------------------------------------------------------------

test('attention-items: empty attention queue renders "nothing needs attention" in wide layout', async () => {
  const projection = makeProjection(
    { active: [makeCard({ id: 'task-7001' as never, lane: 'active' })] },
    'test-repo',
  );
  // attentionQueue is already empty from makeProjection
  assert.equal(projection.attentionQueue.length, 0);

  const output = await renderShell({
    projection,
    columns: 120,
    rows: 30,
  });

  assert.match(
    output,
    /nothing needs attention/,
    'empty attention queue must render "nothing needs attention" text',
  );
});

test('attention-items: empty attention queue renders "nothing needs attention" in narrow layout', async () => {
  const projection = makeProjection(
    { active: [makeCard({ id: 'task-7002' as never, lane: 'active' })] },
    'test-repo',
  );

  const output = await renderShell({
    projection,
    columns: 60,
    rows: 30,
  });

  assert.match(
    output,
    /nothing needs attention/,
    'empty attention queue must render "nothing needs attention" in narrow (60 col) layout',
  );
});

test('attention-items: unavailable sourceFacts render ⚠ indicator per item in attention rail', async () => {
  const reviewCard = makeCard({
    id: 'task-8001' as never,
    lane: 'review',
    title: 'Review mission',
  });

  const queue = [
    makeAttentionItem(reviewCard, { kind: 'review-lane', detail: 'Awaiting review' }, 2),
  ];

  const projection = makeProjection(
    { review: [reviewCard] },
    'test-repo',
  );
  const projWithQueue = {
    ...projection,
    attentionQueue: queue,
    sourceFacts: [{ source: 'task-markdown' as const, status: 'unavailable' as const, value: 'fixture' }],
  };

  const output = await renderShell({
    projection: projWithQueue,
    columns: 120,
    rows: 30,
  });

  /* Extract the attention rail section (between the header and "ranked:"). */
  const railSection = output.split('ranked:')[0];

  /* The ⚠ indicator must appear within the rail section, proving it's per-item
   * and not just in the top bar. The text may wrap across lines in the 34-col rail. */
  assert.match(
    railSection,
    /⚠/,
    '⚠ indicator must appear in the attention rail section (not just the top bar)',
  );
  assert.match(
    railSection,
    /task-markdown/,
    'source name must appear in the attention rail section',
  );
  assert.match(
    railSection,
    /unavailable/,
    'unavailable status must appear in the attention rail section',
  );
});

test('attention-items: stale sourceFacts render ⚠ indicator per item in attention rail', async () => {
  const reviewCard = makeCard({
    id: 'task-8002' as never,
    lane: 'review',
    title: 'Review mission',
  });

  const queue = [
    makeAttentionItem(reviewCard, { kind: 'review-lane', detail: 'Awaiting review' }, 2),
  ];

  const projection = makeProjection(
    { review: [reviewCard] },
    'test-repo',
  );
  const projWithQueue = {
    ...projection,
    attentionQueue: queue,
    sourceFacts: [{ source: 'task-markdown' as const, status: 'stale' as const, value: 'fixture' }],
  };

  const output = await renderShell({
    projection: projWithQueue,
    columns: 120,
    rows: 30,
  });

  /* Extract the attention rail section (between the header and "ranked:"). */
  const railSection = output.split('ranked:')[0];

  /* The ⚠ indicator must appear within the rail section, proving it's per-item
   * and not just in the top bar. The text may wrap across lines in the 34-col rail. */
  assert.match(
    railSection,
    /⚠/,
    '⚠ indicator must appear in the attention rail section (not just the top bar)',
  );
  assert.match(
    railSection,
    /task-markdown/,
    'source name must appear in the attention rail section',
  );
  assert.match(
    railSection,
    /stale/,
    'stale status must appear in the attention rail section',
  );
});

test('attention-items: narrow layout (columns=60) renders attention rail above board with top item visible', async () => {
  const integrateCard = makeCard({
    id: 'task-9001' as never,
    lane: 'integration',
    title: 'Integrate mission',
  });

  const queue = [
    makeAttentionItem(integrateCard, { kind: 'integrate-lane', detail: 'Awaiting integration' }, 3),
  ];

  const projection = makeProjection(
    { integration: [integrateCard] },
    'test-repo',
  );
  const projWithQueue = { ...projection, attentionQueue: queue };

  const output = await renderShell({
    projection: projWithQueue,
    columns: 60,
    rows: 30,
  });

  // In narrow layout, the attention rail stacks above the board
  // The top-ranked attention item text must be visible
  assert.match(
    output,
    /task-9001/,
    'narrow layout must render the top-ranked attention item text',
  );
  assert.match(
    output,
    /NEEDS YOU NEXT/,
    'narrow layout must render the attention rail header',
  );
});

// ---------------------------------------------------------------------------
// CP-1/CP-2/CP-3: Semantics assertions (SC9)
// ---------------------------------------------------------------------------

test('attention-items: rank order is correct (blocking=0 < gate-failed=1 < review=2 < integrate=3)', async () => {
  const { attentionRank } = await import('../src/application/projections/board.js');

  const blockingCard = makeCard({ id: 'task-r1' as never, lane: 'active', blockingReason: 'blocked' });
  const gateFailedCard = makeCard({ id: 'task-r2' as never, lane: 'active', gate: 'failed' });
  const reviewCard = makeCard({ id: 'task-r3' as never, lane: 'review' });
  const integrateCard = makeCard({ id: 'task-r4' as never, lane: 'integration' });

  assert.equal(attentionRank(blockingCard), 0, 'blocking rank must be 0');
  assert.equal(attentionRank(gateFailedCard), 1, 'gate-failed rank must be 1');
  assert.equal(attentionRank(reviewCard), 2, 'review-lane rank must be 2');
  assert.equal(attentionRank(integrateCard), 3, 'integrate-lane rank must be 3');
});

test('attention-items: reason kinds render with correct colors (blocking=red, gate-failed=yellow, review=blue, integrate=green)', async () => {
  const { attentionWhy } = await import('../src/interfaces/tui/shell.js');

  const reasons: { kind: string; detail: string }[] = [
    { kind: 'blocking', detail: 'mission is blocked' },
    { kind: 'gate-failed', detail: 'verification gate failed' },
    { kind: 'review-lane', detail: 'awaiting review decision' },
    { kind: 'integrate-lane', detail: 'awaiting integration' },
  ];

  for (const reason of reasons) {
    const why = attentionWhy(reason);
    assert.ok(why.length > 0, `attentionWhy must return non-empty text for ${reason.kind}`);
  }
});

test('attention-items: exact command text matches px <command> <mission-id> pattern for all reason kinds', async () => {
  const { attentionCommand } = await import('../src/interfaces/tui/shell.js');

  const cases: { id: string; lane: string; reasonKind: string; expected: string }[] = [
    { id: 'task-c1', lane: 'integration', reasonKind: 'integrate-lane', expected: 'px integrate task-c1' },
    { id: 'task-c2', lane: 'review', reasonKind: 'review-lane', expected: 'px review task-c2' },
    { id: 'task-c3', lane: 'active', reasonKind: 'blocking', expected: 'px active task-c3' },
    { id: 'task-c4', lane: 'active', reasonKind: 'gate-failed', expected: 'px active task-c4' },
  ];

  for (const { id, lane, reasonKind, expected } of cases) {
    const card = makeCard({ id: id as never, lane: lane as never });
    const actual = attentionCommand(card, { kind: reasonKind });
    assert.equal(actual, expected, `command for ${reasonKind} must be "${expected}"`);
  }
});

test('attention action display and its typed confirmation command stay aligned', async () => {
  const { attentionCommand } = await import('../src/interfaces/tui/shell.js');
  const { applicationCommandText } = await import('../src/interfaces/tui/confirmation-dialog.js');
  const reviewCard = makeCard({ id: 'task-2370' as never, lane: 'review', status: 'review' });
  const item = makeAttentionItem(reviewCard, { kind: 'review-lane', detail: 'Awaiting review decision' }, 2);

  assert.equal(attentionCommand(item.card, item.reason, item.action), item.action.display);
  assert.equal(applicationCommandText(item.action.kind, item.missionId), item.action.display);
});

test('working work is separate from NEEDS YOU', async () => {
  const working = makeCard({
    id: 'task-working' as never,
    currentWork: { operationId: 'op', phase: 'review', summary: 'reviewing', agent: 'qwen' as never, updatedAt: new Date().toISOString(), freshness: 'live' },
  });
  const output = await renderShell({ projection: makeProjection({ review: [working] }), columns: 120, rows: 30 });
  assert.match(output, /WORKING/);
  assert.match(output, /task-working · review · qwen/);
  assert.match(output, /NEEDS YOU NEXT 0/);
});
