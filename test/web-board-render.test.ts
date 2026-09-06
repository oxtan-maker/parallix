/**
 * Focused component tests for the read-only browser board (TASK-2434).
 *
 * Every fixture is transport-shaped: it is built from the shared board
 * projection fixtures and passed through `toWebBoardSnapshot`, so no domain
 * rule is duplicated here. The second half of this file scans the production
 * browser sources for the anti-slop boundary the mission fixes: no mock data,
 * no domain-rule mapping, no Node or concrete-adapter import, no browser
 * persistence, and no mutation path.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Board } from '../web/src/board.js';
import { FlowPanel } from '../web/src/flow-panel.js';
import { appendProgress, OPERATION_LOG_LIMIT } from '../web/src/operation-log.js';
import { Shell } from '../web/src/shell.js';
import { durationText } from '../web/src/format.js';
import { toWebBoardSnapshot, validateWebBoardSnapshot } from '../src/interfaces/web/transport.js';
import type { WebBoardSnapshot } from '../src/interfaces/web/transport.js';
import type { BoardProjection } from '../src/application/projections/board.js';
import type { AgentAvailabilityMetric } from '../src/application/projections/board.js';
import type { MissionCard } from '../src/application/projections/mission-board.js';
import { agentFamily } from '../src/domain/agents.js';
import { emptyMetrics, makeAttentionItem, makeCard, makeProjection } from './fixtures/board-projection.js';

const webSrc = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'src');
const browserSources = fs.readdirSync(webSrc)
  .filter((name) => /\.(?:ts|tsx|css)$/.test(name))
  .map((name) => ({ name, text: fs.readFileSync(path.join(webSrc, name), 'utf8') }));

const render = (snapshot: WebBoardSnapshot): string =>
  renderToStaticMarkup(React.createElement(Board, { snapshot, onRefresh: async () => {} }));

const renderFlow = (metrics: WebBoardSnapshot['metrics']): string =>
  renderToStaticMarkup(React.createElement(FlowPanel, { metrics }));

const snapshotOf = (overrides: Partial<BoardProjection>): WebBoardSnapshot =>
  toWebBoardSnapshot({ ...makeProjection(), ...overrides });

function metric(overrides: Partial<AgentAvailabilityMetric>): AgentAvailabilityMetric {
  return { family: agentFamily('custom'), available: true, blockedForMs: 0, reason: null, ...overrides };
}

/** A snapshot with a card in every lane, an attention item, and agent facts. */
function populated(): WebBoardSnapshot {
  const blocked = makeCard({
    id: 'task-0001' as MissionCard['id'],
    title: 'blocked mission',
    lane: 'review',
    status: 'review',
    agent: agentFamily('claude'),
    checkpoint: 'CP-2.md',
    checkpointDescription: 'CP-2: components extracted',
    nextActionText: 'act on reviewer findings',
    gate: 'failed',
    pullRequest: { kind: 'pull-request', provider: 'forgejo', id: '47', url: 'https://example.invalid/pr/47', sourceBranch: 'mission/task-0001', targetBranch: 'main' },
    reviewRound: 2,
    reviewHistory: [
      { number: 1, reviewer: agentFamily('codex'), implementer: agentFamily('claude'), phase: 'approved', disposition: 'APPROVED', comment: null, findingSummaries: [], pushbacks: [], fixes: [] },
      { number: 2, reviewer: agentFamily('codex'), implementer: agentFamily('claude'), phase: 'reviewing', disposition: null, comment: null, findingSummaries: [], pushbacks: [], fixes: [] },
    ],
    blockingReason: 'two blocking findings',
    flags: ['review_blocking'],
    commands: [{ command: 'integrate', enabled: false, reason: 'review is not approved', targetLane: 'integration' }],
  });
  const base = makeProjection({
    backlog: [makeCard({ id: 'task-0002' as MissionCard['id'], title: 'backlog mission', lane: 'backlog', status: 'backlog' })],
    refined: [makeCard({ id: 'task-0003' as MissionCard['id'], title: 'refined mission', lane: 'refined', status: 'refined' })],
    active: [makeCard({ id: 'task-0004' as MissionCard['id'], title: 'active mission', lane: 'active', status: 'active' })],
    review: [blocked],
    integration: [makeCard({ id: 'task-0005' as MissionCard['id'], title: 'integration mission', lane: 'integration', status: 'integration' })],
    done: [makeCard({ id: 'task-0006' as MissionCard['id'], title: 'shipped mission', lane: 'done', status: 'done', closed: true })],
  });
  return toWebBoardSnapshot({
    ...base,
    attentionQueue: [makeAttentionItem(blocked, { kind: 'blocking', detail: 'two blocking findings' }, 1)],
    availableActions: [{ command: 'draft', enabled: true, reason: null }],
    operationLog: [{ operationId: 'op-1', phase: 'checkpoint', message: 'CP-2 committed', timestamp: '2026-08-30T10:00:00.000Z' }],
    sourceFacts: [{ source: 'git', status: 'fresh', value: 'main@abcdef' }, { source: 'stats', status: 'unavailable' }],
    metrics: {
      ...emptyMetrics,
      agentAvailability: [
        metric({ family: agentFamily('codex'), runningSessions: 0 }),
        metric({ family: agentFamily('claude'), available: false, blockedForMs: 90_000, reason: 'usage limit hit', runningSessions: null }),
        metric({ family: agentFamily('mistral'), available: false, blockedForMs: Number.POSITIVE_INFINITY, reason: 'manual block' }),
      ],
      unattributedRunningSessions: null,
    },
  });
}

// ---------------------------------------------------------------------------
// Populated rendering (SC1)
// ---------------------------------------------------------------------------

test('a populated snapshot renders repository identity and all six received stages in received order', () => {
  const html = render(populated());
  assert.match(html, /test-repo/);
  const positions = ['REFINED', 'BACKLOG', 'ACTIVE', 'REVIEW', 'INTEGRATION', 'DONE'].map((label) => html.indexOf(label));
  assert.ok(positions.every((position) => position >= 0), 'every received lane renders');
  // The intake pair stacks in the design authority's order; every other lane
  // keeps the order the server sent.
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, 'lanes render in the board order');
});

test('the top bar WIP counts only in-flight lanes, not backlog or done', () => {
  // populated() puts one card in every lane, so the all-lane sum is 6 but the
  // reference WIP is refined + active + review + approved (this board's
  // `integration` lane) = 4. Backlog is intake and done is terminal.
  const html = render(populated());
  const match = html.match(/wip <span[^>]*>(\d+)<\/span>/);
  assert.ok(match, 'the top bar renders a WIP count');
  assert.equal(match![1], '4', 'WIP excludes backlog and done');
});

test('a card action renders the server\'s verb for the mission\'s state', () => {
  // `px active` is the resume command as well as the launch command, so the
  // server sends the word for this state; the browser prints it and keeps the
  // command itself as the accessible name.
  const html = render(snapshotOf({
    stages: [{
      lane: 'review',
      count: 1,
      cards: [makeCard({
        id: 'task-0009' as MissionCard['id'],
        lane: 'review',
        status: 'review',
        commands: [{ command: 'active', enabled: true, reason: null, targetLane: 'active', label: 'act on review' }],
      })],
    }],
  }));
  assert.match(html, /act on review/);
  assert.match(html, /aria-label="px active task-0009 — enabled"/);
});

test('a card with no runnable action omits its disabled lifecycle controls', () => {
  const html = render(snapshotOf({
    stages: [{
      lane: 'review',
      count: 1,
      cards: [makeCard({
        id: 'task-0010' as MissionCard['id'],
        lane: 'review',
        status: 'review',
        commands: [
          { command: 'active', enabled: false, reason: 'Resuming a review mission requires reviewer findings to act on', targetLane: 'active', label: 'activate' },
          { command: 'review', enabled: false, reason: 'review is in progress', targetLane: null },
        ],
      })],
    }],
  }));
  assert.doesNotMatch(html, /px active task-0010/);
  assert.doesNotMatch(html, /px review task-0010/);
});

test('every received card renders in its stage, including the collapsible done history', () => {
  const html = render(populated());
  for (const id of ['task-0001', 'task-0002', 'task-0003', 'task-0004', 'task-0005', 'task-0006']) {
    assert.ok(html.includes(id), `${id} renders`);
  }
  assert.match(html, /shipped mission/);
  assert.match(html, /<details class="shipped" aria-label="done stage">/);
});

test('attention items render the server rank, reason kind, detail and action display', () => {
  const html = render(populated());
  assert.match(html, /01/);
  assert.match(html, /blocking/);
  assert.match(html, /two blocking findings/);
});

test('card facts render from the server without substitution', () => {
  const html = render(populated());
  assert.match(html, /CP-2\.md/);
  assert.match(html, /gate ✗ FAIL/);
  assert.match(html, /act on reviewer findings/);
  assert.match(html, /round 2\/5/);
  assert.match(html, /href="https:\/\/example\.invalid\/pr\/47"/);
  assert.match(html, /review round 2/);
  assert.match(html, /CP-2\.md<\/span>/, 'the checkpoint is a visible marker');
  assert.match(html, /review_blocking/);
});

test('the operation log renders the server entry rather than a reconstructed one', () => {
  const html = render(populated());
  assert.match(html, /2026-08-30T10:00:00\.000Z/);
  assert.match(html, /CP-2 committed/);
});

test('operation progress deduplicates reconnects and evicts oldest entries', () => {
  const snapshot = populated();
  const progress = { kind: 'progress' as const, transportVersion: 2 as const, operationId: 'op-reconnect', sequence: 1, phase: 'run', message: 'one', timestamp: '2026-08-30T11:00:00.000Z' };
  const once = appendProgress(snapshot, progress);
  assert.equal(appendProgress(once, progress).operationLog.length, once.operationLog.length);
  let bounded = once;
  for (let sequence = 2; sequence <= OPERATION_LOG_LIMIT + 2; sequence += 1) bounded = appendProgress(bounded, { ...progress, sequence });
  assert.equal(bounded.operationLog.length, OPERATION_LOG_LIMIT);
  assert.equal(bounded.operationLog.at(-1)?.sequence, OPERATION_LOG_LIMIT + 2);
});

test('FLOW keeps the reference two-panel layout when projected history is unavailable', () => {
  const html = renderFlow(toWebBoardSnapshot({ ...makeProjection(), metrics: emptyMetrics }).metrics);
  assert.match(html, /CUMULATIVE FLOW/);
  assert.match(html, /MEDIAN TIME IN STATE/);
  assert.doesNotMatch(html, /READ/);
  assert.doesNotMatch(html, /weekly throughput/);
});

test('FLOW renders populated projected values with their observation counts', () => {
  const html = renderFlow(toWebBoardSnapshot({ ...makeProjection(), metrics: {
    ...emptyMetrics,
    health: { state: 'healthy' },
    provenance: { ...emptyMetrics.provenance, sampleSize: 4 },
    cumulativeFlowByState: { series: [{ at: '2026-08-30', counts: { active: 2, review: 1 }, observationCount: 3 }], missingHistoryFallback: 'skip' } as unknown as typeof emptyMetrics.cumulativeFlowByState,
    medianCycleTimeByState: { series: [{ lane: 'active', value: 42, observationCount: 2 }], missingHistoryFallback: 'null' } as typeof emptyMetrics.medianCycleTimeByState,
    weeklyThroughput: { series: [{ at: '2026-08-30', value: 3, observationCount: 3 }], missingHistoryFallback: 'skip' },
  } }).metrics);
  assert.match(html, /Cumulative flow chart/);
  assert.match(html, /active/);
  assert.match(html, /42m \(n=2\)/);
  assert.match(html, /cycle time/);
  assert.match(html, /42m/);
  assert.match(html, /refined → done, median/);
});

test('FLOW charts the server-owned weekly series and never the historical stock beside it', () => {
  const html = renderFlow(toWebBoardSnapshot({ ...makeProjection(), metrics: {
    ...emptyMetrics,
    // The all-history series still carries every pre-window completion...
    cumulativeFlowByState: { series: [
      { at: '2026-08-23T23:59:59.000Z', counts: { old: 99 }, observationCount: 99 },
    ], missingHistoryFallback: 'estimate' } as unknown as typeof emptyMetrics.cumulativeFlowByState,
    // ...and FLOW charts the weekly series the projection published instead.
    weeklyCumulativeFlow: { series: [
      { at: '2026-08-24T23:59:59.999Z', counts: { active: 2 }, observationCount: 2 },
      { at: '2026-08-30T23:59:59.999Z', counts: { active: 2 }, observationCount: 2 },
    ], missingHistoryFallback: 'estimate', window: { startDate: '2026-08-24', endDate: '2026-08-30', label: '2026-08-24 → 2026-08-30' } } as unknown as NonNullable<typeof emptyMetrics.weeklyCumulativeFlow>,
  } }).metrics);
  assert.match(html, /2026-08-24 → 2026-08-30/);
  assert.match(html, / active<\/span>/);
  assert.doesNotMatch(html, / old<\/span>/);
});

test('the web transport carries the weekly cumulative-flow series and its window unchanged', () => {
  const weekly = {
    series: [
      { at: '2026-08-25T23:59:59.999Z', counts: { backlog: 0, refined: 0, active: 1, review: 0, integration: 0, done: 0 }, observationCount: 1 },
      { at: '2026-08-26T23:59:59.999Z', counts: { backlog: 0, refined: 0, active: 0, review: 0, integration: 0, done: 1 }, observationCount: 1 },
    ],
    missingHistoryFallback: 'estimate',
    window: { startDate: '2026-08-25', endDate: '2026-08-26', label: '2026-08-25 → 2026-08-26' },
  } as unknown as NonNullable<typeof emptyMetrics.weeklyCumulativeFlow>;
  const snapshot = toWebBoardSnapshot({ ...makeProjection(), metrics: { ...emptyMetrics, weeklyCumulativeFlow: weekly } });
  assert.deepEqual(snapshot.metrics.weeklyCumulativeFlow, JSON.parse(JSON.stringify(weekly)));
  assert.deepEqual(validateWebBoardSnapshot(JSON.parse(JSON.stringify(snapshot))).ok, true);
});

test('a snapshot without a weekly series is still a valid transport payload', () => {
  const snapshot = toWebBoardSnapshot({ ...makeProjection(), metrics: emptyMetrics });
  assert.equal(snapshot.metrics.weeklyCumulativeFlow, undefined);
  assert.deepEqual(validateWebBoardSnapshot(JSON.parse(JSON.stringify(snapshot))).ok, true);
});

test('FLOW draws every published weekly point without rebasing or inferring lane movement', () => {
  const points = [0, 1, 2, 3, 4, 5, 6].map((offset) => ({
    at: `2026-08-2${5 + offset > 9 ? 5 + offset - 10 : 5 + offset}T23:59:59.999Z`,
    counts: { backlog: 0, refined: 0, active: offset < 4 ? 1 : 0, review: 0, integration: 0, done: offset < 4 ? 0 : 1 },
    observationCount: 1,
  }));
  const html = renderFlow(toWebBoardSnapshot({ ...makeProjection(), metrics: {
    ...emptyMetrics,
    weeklyCumulativeFlow: { series: points, missingHistoryFallback: 'estimate', window: { startDate: '2026-08-25', endDate: '2026-08-31', label: '2026-08-25 → 2026-08-31' } } as unknown as NonNullable<typeof emptyMetrics.weeklyCumulativeFlow>,
  } }).metrics);
  // One polygon per lane; every one plots all seven published points (7 up + 7 down).
  const polygons = [...html.matchAll(/points="([^"]+)"/g)].map((match) => match[1]!.split(' '));
  assert.equal(polygons.length, 6);
  assert.ok(polygons.every((polygon) => polygon.length === 14), 'every lane band must plot all seven published points');
  // The `done` band (topmost stacked layer) has zero thickness on the four days
  // the projection published `done: 0`, and thickness only where it published a
  // completion — the browser adds no accumulation of its own.
  const doneBand = polygons[5]!;
  const thickness = [0, 1, 2, 3, 4, 5, 6].map((index) =>
    Number(doneBand[13 - index]!.split(',')[1]) - Number(doneBand[index]!.split(',')[1]));
  assert.deepEqual(thickness.slice(0, 4), [0, 0, 0, 0]);
  assert.ok(thickness.slice(4).every((height) => height > 0), 'in-window completions must raise the done band');
});

test('the browser never filters, rebases, or infers the weekly flow it renders', () => {
  const flowPanel = browserSources.find((source) => source.name === 'flow-panel.tsx')!.text;
  assert.doesNotMatch(flowPanel, /cumulativeFlowByState\.series\.filter/);
  assert.doesNotMatch(flowPanel, /startDate|endDate/, 'the browser must not re-derive the reporting window');
  assert.match(flowPanel, /metrics\.weeklyCumulativeFlow \?\? metrics\.cumulativeFlowByState/);
});

// ---------------------------------------------------------------------------
// Empty, unavailable and unknown values (SC2)
// ---------------------------------------------------------------------------

test('an empty snapshot states each region is empty and never shows a zero metric as a fact', () => {
  const html = render(snapshotOf({}));
  assert.equal(html.split('no missions in this stage').length - 1, 6);
  assert.match(html, /nothing in the attention queue/);
  assert.match(html, /no operations recorded/);
  assert.ok(!html.includes('running'), 'no agent session count is invented for an empty snapshot');
});

test('an unknown gate renders as unknown, never as a pass', () => {
  const html = render(snapshotOf({
    stages: makeProjection({ active: [makeCard({ checkpoint: 'CP-1.md', gate: 'unknown' })] }).stages,
  }));
  assert.match(html, /gate · unknown/);
  assert.ok(!html.includes('gate ✓'), 'unknown never renders as passed');
});

test('an absent implementer renders as absent, never as an idle or named agent', () => {
  const html = render(snapshotOf({
    stages: makeProjection({ active: [makeCard({ agent: null })] }).stages,
  }));
  assert.match(html, /no implementer/);
});

test('omitted, null and observed-zero running sessions each render as themselves', () => {
  const html = render(populated());
  assert.match(html, /0 command sessions/, 'an observed zero renders as zero');
  assert.match(html, /command sessions unknown/, 'an unobserved liveness renders as unknown');
  // mistral has no runningSessions key at all: it contributes no session text.
  assert.equal(html.split('sessions unknown').length - 1, 1, 'only the agent-pill null case prints unknown');
  assert.doesNotMatch(html, /unattributed sessions unknown/);
});

test('the audited reference treatment omits non-reference source and attribution text and retains its scrollbar', () => {
  const html = render(populated());
  assert.doesNotMatch(html, /sources: git, stats/);
  assert.doesNotMatch(html, /unattributed sessions unknown/);
  const css = browserSources.find((file) => file.name === 'style.css')?.text ?? '';
  assert.match(css, /::-webkit-scrollbar\s*\{[^}]*width: 9px;[\s\S]*height: 9px;/);
  assert.match(css, /::-webkit-scrollbar-thumb\s*\{[^}]*border-radius: 5px;/);
});

test('activity, coordinator recovery evidence, and reduced motion stay truthful', () => {
  const live = makeCard({ id: 'task-1111' as MissionCard['id'], currentWork: { operationId: 'op', phase: 'implement', summary: 'live work', agent: agentFamily('codex'), updatedAt: '2026-08-30T00:00:00.000Z', freshness: 'live' } });
  const uncertain = makeCard({ id: 'task-1112' as MissionCard['id'], currentWork: { ...live.currentWork!, freshness: 'unverified' } });
  const stale = makeCard({ id: 'task-1113' as MissionCard['id'], currentWork: { ...live.currentWork!, freshness: 'stale' }, liveSession: { missionId: 'task-1113' as MissionCard['id'], family: agentFamily('codex') } });
  const blocked = makeCard({ id: 'task-1114' as MissionCard['id'], blockingReason: 'waiting' });
  const idle = makeCard({ id: 'task-1115' as MissionCard['id'] });
  const html = render(snapshotOf({ stages: makeProjection({ active: [live, uncertain, stale, blocked, idle] }).stages }));
  assert.match(html, /working · live/);
  assert.match(html, /working · unknown/);
  assert.match(html, /working · stale/);
  assert.match(html, /blocked/);
  assert.match(html, /idle/);
  assert.match(html, /recovery evidence: coordinator live \(codex\)/);
  assert.match(html, /active worker family: codex/, 'the live worker is the header agent, not a stale assignee');
  assert.ok(!html.includes('undefined'), 'a missing assignee never leaks as header text');
  assert.match(html, /class="live-indicator"/, 'live work has the reference-style blinking indicator');
  assert.equal((html.match(/fan spin/g) ?? []).length, 4, 'authoritative live and unverified work spin their two fans');
  const css = browserSources.find((file) => file.name === 'style.css')?.text ?? '';
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.fan\.spin[\s\S]*animation: none/);
  assert.match(css, /\.live-indicator[\s\S]*animation: blink/);
});

test('an indefinite agent block never renders as a numeric duration', () => {
  const html = render(populated());
  assert.match(html, /blocked · indefinite/);
  assert.match(html, /blocked · 1m 30s/);
});

test('agent-block durations use human-sized units', () => {
  assert.equal(durationText({ kind: 'finite', ms: 3_625 * 60_000 }), '2d 12h');
  assert.equal(durationText({ kind: 'finite', ms: 400 * 24 * 60 * 60_000 }), '1y 1mo');
});

// ---------------------------------------------------------------------------
// Read-only boundary and reference-preserving overflow (SC4, SC5)
// ---------------------------------------------------------------------------

test('each card renders at most one enabled projected action', () => {
  const html = render(populated());
  const buttons: string[] = Array.from(html.match(/<button[^>]*>/g) ?? []).filter((button) => !button.includes('aria-controls="flow-metrics"'));
  assert.ok(buttons.length > 0, 'the fixture renders at least one action');
  for (const button of buttons) {
    assert.match(button, /aria-disabled="(?:true|false)"/, `action states availability: ${button}`);
  }
  assert.match(html, /px active task-0001/, "the server's display string is rendered verbatim");
  assert.doesNotMatch(html, /aria-label="px integrate task-0001/, 'a card does not fall back to an unavailable lifecycle control');
});

test('advertised actions dispatch directly without a confirmation dialog', () => {
  assert.ok(!browserSources.find((file) => file.name === 'board.tsx')?.text.includes('CommandDialog'));
  assert.match(browserSources.find((file) => file.name === 'board.tsx')?.text ?? '', /Starting \$\{action\.display\}/,
    'click and drop both announce that the projected action is starting');
});

test('the rendered board exposes drag only through server-projected target lanes', () => {
  const html = render(populated());
  // No static drag/drop help text is shipped: a drop is governed entirely by
  // the server-projected target lanes the browser receives on the wire.
  assert.doesNotMatch(html, /Drag a card only to the lane named/);
  assert.doesNotMatch(html, /id="drop-help"/);
  assert.ok(browserSources.find((file) => file.name === 'board.tsx')?.text.includes('action.targetLane === lane'));
  assert.ok(browserSources.find((file) => file.name === 'board.tsx')?.text.includes('dragActionForTarget'));
  assert.ok(browserSources.find((file) => file.name === 'board.tsx')?.text.includes('setDragImage'), 'drag uses a compact custom preview rather than a cloned card');
});

test('narrow viewports scroll the board horizontally instead of dropping lanes', () => {
  const html = render(populated());
  assert.match(html, /overflow-x:auto/, 'the lane row scrolls horizontally like the reference');
  assert.match(html, /min-width:318px/, 'in-flight lanes keep the reference minimum width');
  assert.ok(!html.includes('display:none'), 'no lane or action is hidden at any width');
});

// ---------------------------------------------------------------------------
// Landmarks, headings, accessible names and visible focus (SC7)
// ---------------------------------------------------------------------------

test('the shell renders a main landmark and marks itself busy while the snapshot loads', () => {
  // renderToStaticMarkup runs no effects, so this is the pre-fetch state.
  const html = renderToStaticMarkup(React.createElement(Shell));
  assert.match(html, /<main[^>]*aria-busy="true"/);
  assert.match(html, /role="status"/);
  assert.match(html, /<h1[^>]*>LOADING BOARD<\/h1>/);
});

test('every board region is a named landmark and every lane carries a heading', () => {
  const html = render(populated());
  for (const region of ['Agent availability', 'Operation log']) {
    assert.ok(html.includes(`aria-label="${region}"`), `${region} is a named region`);
  }
  assert.match(html, /aria-labelledby="attention-heading"/);
  for (const lane of ['backlog', 'refined', 'active', 'review', 'integration', 'done']) {
    assert.ok(html.includes(`aria-label="${lane} stage"`), `${lane} is a named region`);
  }
  assert.equal((html.match(/<h1[^>]*>/g) ?? []).length, 1, 'the board has exactly one h1');
  const headings = html.match(/<h2[^>]*>/g) ?? [];
  assert.ok(headings.length >= 7, 'the attention rail and every lane carry an h2');
});

test('every action control has an accessible name carrying the server display and state', () => {
  const html = render(populated());
  const names = [...html.matchAll(/<button[^>]*aria-label="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(names.length > 0, 'the fixture renders at least one action');
  for (const name of names) {
    assert.match(name ?? '', / — (?:enabled|ineligible|unavailable)/, `accessible name states availability: ${String(name)}`);
  }
  assert.ok(
    names.some((name) => (name ?? '').includes('command is not eligible for this mission')),
    "a non-enabled action's server reason reaches its accessible name",
  );
});

test('the done-history disclosure is a native, keyboard-operable control rather than a scripted toggle', () => {
  const html = render(populated());
  assert.match(html, /<details class="shipped" aria-label="done stage"><summary>/);
  assert.ok(!/tabindex="[1-9]/i.test(html), 'focus order has no positive tabindex override');
});

test('board and attention cards share a keyboard-selectable presentation selection', () => {
  const html = render(populated());
  for (const source of ['attention-rail.tsx', 'intake-column.tsx', 'flight-column.tsx']) {
    assert.ok(browserSources.find((file) => file.name === source)?.text.includes('data-board-card'), `${source} joins the shared selection`);
  }
  const board = browserSources.find((file) => file.name === 'board.tsx')?.text ?? '';
  assert.match(board, /onKeyDown=\{moveSelection\}/);
  assert.match(board, /ArrowUp/);
  assert.match(board, /ArrowDown/);
  // No static keyboard-help blurb is shipped; navigation is the only affordance.
  assert.doesNotMatch(html, /Keyboard help/);
});

test('the browser stylesheet defines a visible focus indicator', () => {
  const css = browserSources.find((file) => file.name === 'style.css');
  assert.ok(css !== undefined, 'the client ships a stylesheet');
  assert.match(css.text, /:focus-visible\s*\{[^}]*outline:/);
});

// ---------------------------------------------------------------------------
// Anti-slop source scan of the production browser code (SC8)
// ---------------------------------------------------------------------------

test('production browser code imports no Node built-in, concrete adapter, or server module', () => {
  for (const file of browserSources) {
    for (const forbidden of ["'node:", 'src/adapters/', 'child_process', 'better-sqlite3', 'simple-git', "'fastify'"]) {
      assert.ok(!file.text.includes(forbidden), `${file.name} must not reference ${forbidden}`);
    }
  }
  const transportImports = browserSources.filter((file) => file.text.includes('/src/interfaces/web/transport.js'));
  assert.ok(transportImports.length > 0, 'the client reuses the shared transport contract');
});

test('production browser code uses no browser persistence or cached snapshot', () => {
  for (const file of browserSources) {
    for (const forbidden of ['localStorage', 'sessionStorage', 'indexedDB', 'document.cookie', 'caches.', 'setInterval']) {
      assert.ok(!file.text.includes(forbidden), `${file.name} must not use ${forbidden}`);
    }
  }
});

test('production browser code reads snapshots and uses the single guarded mutation route', () => {
  const fetches = browserSources.flatMap((file) => (file.text.match(/\bfetch\(/g) ?? []).map(() => file.name));
  assert.deepEqual(fetches, ['board-data.ts', 'board-data.ts'], 'snapshot and command requests stay in the typed client');
  const data = browserSources.find((file) => file.name === 'board-data.ts')?.text ?? '';
  assert.match(data, /COMMANDS_PATH = '\/api\/commands'/);
  assert.match(data, /method: 'POST'/);
  for (const file of browserSources.filter((file) => file.name !== 'board-data.ts')) {
    for (const verb of ["'POST'", "'PUT'", "'PATCH'", "'DELETE'", 'method:']) {
      assert.ok(!file.text.includes(verb), `${file.name} cannot build a mutation (${verb})`);
    }
  }
});

test('production browser code contains no mock mission data or invented metric', () => {
  for (const file of browserSources) {
    assert.ok(!/task-\d/.test(file.text), `${file.name} must not embed a mission id`);
    if (file.name === 'flow-panel.tsx') { continue; }
    for (const invented of ['missions/wk', 'median', 'throughput', 'bottleneck', 'cycle time']) {
      assert.ok(!file.text.toLowerCase().includes(invented.toLowerCase()), `${file.name} must not invent ${invented}`);
    }
  }
});

test('production browser code maps no lane to a lifecycle rule or command', () => {
  const laneLiteral = /'(?:backlog|refined|active|review|integration|done)'/;
  const allowed = new Set([
    "const INTAKE_LANES: readonly string[] = ['refined', 'backlog'];",
    "const SHIPPED_LANE = 'done';",
  ]);
  for (const file of browserSources) {
    for (const line of file.text.split('\n')) {
      if (laneLiteral.test(line)) {
        assert.ok(allowed.has(line.trim()), `${file.name} maps a lane outside the layout buckets: ${line.trim()}`);
      }
    }
    assert.ok(!/'px /.test(file.text), `${file.name} must not embed a px command string`);
  }
});

test('the client adds no router, browser state framework, server-rendering layer, or design system', () => {
  for (const file of browserSources) {
    for (const forbidden of ['react-router', 'redux', 'zustand', 'mobx', 'jotai', 'recoil', '@tanstack', 'react-dom/server', 'styled-components', '@emotion', '@mui', 'tailwind', 'bootstrap']) {
      assert.ok(!file.text.includes(forbidden), `${file.name} must not depend on ${forbidden}`);
    }
  }
  const imports = browserSources.flatMap((file) => [...file.text.matchAll(/from '([^']+)'/g)].map((match) => match[1]));
  const external = imports.filter((specifier) => specifier !== undefined && !specifier.startsWith('.'));
  assert.deepEqual([...new Set(external)].sort(), ['react', 'react-dom/client'], 'the client depends on React and React DOM only');
});
