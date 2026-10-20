import type { BoardLane } from '../../../../src/application/projections/mission-board.js';
const laneCounts = (values: Partial<Record<BoardLane, number>>) => ({ backlog: 0, refined: 0, active: 0, review: 0, integration: 0, done: 0, ...values });

import { missionId as fixtureMissionId } from '../../../../src/domain/mission.js';
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
import { Board } from '../../../../web/src/board.js';
import { CheckpointDetail } from '../../../../web/src/checkpoint-detail.js';
import { CheckpointPips } from '../../../../web/src/checkpoint-pips.js';
import { FlowPanel } from '../../../../web/src/flow-panel.js';
import { EMPTY_LIVE_PROGRESS, OPERATION_LOG_LIMIT, recordProgress } from '../../../../web/src/operation-log.js';
import { Shell } from '../../../../web/src/shell.js';
import { durationText, isSpinning } from '../../../../web/src/format.js';
import { C, TYPE } from '../../../../web/src/palette.js';
import { toWebBoardSnapshot, validateWebBoardSnapshot } from '../../../../src/interfaces/web/transport.js';
import type { WebBoardSnapshot } from '../../../../src/interfaces/web/transport.js';
import type { BoardProjection } from '../../../../src/application/projections/board.js';
import type { AgentAvailabilityMetric } from '../../../../src/application/projections/board.js';
import type { MissionCard } from '../../../../src/application/projections/mission-board.js';
import { missionId } from '../../../../src/domain/mission.js';
import { agentFamily } from '../../../../src/domain/agents.js';
import { emptyMetrics, makeAttentionItem, makeCard, makeCards, makeProjection } from '../../../fixtures/board-projection.js';
import { fixtureMission } from '../../../fixtures/mission-builders.js';
import { availableBoardCommands } from '../../../../src/application/projections/mission-board.js';

const webSrc = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'web', 'src');
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
    id: fixtureMissionId('task-0001') as MissionCard['id'],
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
    backlog: [makeCard({ id: fixtureMissionId('task-0002') as MissionCard['id'], title: 'backlog mission', lane: 'backlog', status: 'backlog' })],
    refined: [makeCard({ id: fixtureMissionId('task-0003') as MissionCard['id'], title: 'refined mission', lane: 'refined', status: 'refined' })],
    active: [makeCard({ id: fixtureMissionId('task-0004') as MissionCard['id'], title: 'active mission', lane: 'active', status: 'active' })],
    review: [blocked],
    integration: [makeCard({ id: fixtureMissionId('task-0005') as MissionCard['id'], title: 'integration mission', lane: 'integration', status: 'integration' })],
    done: [makeCard({ id: fixtureMissionId('task-0006') as MissionCard['id'], title: 'shipped mission', lane: 'done', status: 'done', closed: true })],
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
      weeklyCumulativeFlow: { series: [{ at: '2026-08-30T23:59:59.999Z', counts: { backlog: 0, refined: 0, active: 0, review: 0, integration: 0, done: 21 }, observationCount: 21 }], missingHistoryFallback: 'estimate', window: { startDate: '2026-08-24', endDate: '2026-08-30', label: '2026-08-24 → 2026-08-30' } },
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
        id: fixtureMissionId('task-0009') as MissionCard['id'],
        lane: 'review',
        status: 'review',
        commands: [{ command: 'active', enabled: true, reason: null, targetLane: 'active', label: 'act on review' }],
      })],
    }],
  }));
  assert.match(html, /act on review/);
  assert.match(html, /aria-label="px active task-0009 — enabled"/);
});

test('a card with no runnable action exposes its disabled projected control and reason', () => {
  const html = render(snapshotOf({
    stages: [{
      lane: 'review',
      count: 1,
      cards: [makeCard({
        id: fixtureMissionId('task-0010') as MissionCard['id'],
        lane: 'review',
        status: 'review',
        commands: [
          { command: 'active', enabled: false, reason: 'Resuming a review mission requires reviewer findings to act on', targetLane: 'active', label: 'activate' },
          { command: 'review', enabled: false, reason: 'review is in progress', targetLane: null },
        ],
      })],
    }],
  }));
  assert.match(html, /px active task-0010 — unavailable: Resuming a review mission requires reviewer findings to act on/);
  assert.match(html, /aria-disabled="true"/);
  assert.doesNotMatch(html, /px review task-0010/);
});

test('a card shows runnable projected controls without unrelated unavailable buttons (TASK-2705)', () => {
  const html = render(snapshotOf({
    stages: [{
      lane: 'active', count: 1, cards: [makeCard({
        id: fixtureMissionId('task-2657-mixed') as MissionCard['id'], lane: 'active', status: 'active', commands: [
          { command: 'active', enabled: false, reason: 'not eligible', targetLane: 'active' },
          { command: 'handoff', enabled: true, reason: null, targetLane: 'review', label: 'record handoff' },
        ],
      })],
    }],
  }));
  assert.match(html, /px handoff task-2657-mixed — enabled/);
  assert.doesNotMatch(html, /px active task-2657-mixed/);
});

test('normal server projections keep compact cards across all unfinished lanes (TASK-2705)', () => {
  for (const lane of ['backlog', 'refined', 'active', 'review', 'integration'] as const) {
    const mission = fixtureMission('task-2705-compact', { status: lane, checkpoints: [] });
    const commands = availableBoardCommands(mission, { reviewApproval: null });
    const card = makeCard({ id: mission.id, lane, status: lane, commands });
    const board = toWebBoardSnapshot(makeProjection({ [lane]: [card] }));
    const html = render(board);
    assert.equal((html.match(/data-action-kind=/g) ?? []).length, 3, `${lane}: Cancel, Edit and one command or explanatory fallback`);
    for (const action of board.stages.flatMap((stage) => stage.cards)[0].actions.filter((action) => action.state === 'enabled')) {
      assert.ok(html.includes(`${action.display} — enabled`), `${lane}: every enabled action remains reachable`);
    }
  }
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
  assert.doesNotMatch(html, /future attempts|round 2 of 5/, 'rounds that may not happen are not announced');
  assert.match(html, /href="https:\/\/example\.invalid\/pr\/47"/);
  assert.match(html, /aria-label="Review attempts"/, 'the budget is a named group, not a progress track');
  assert.match(html, /Recorded: CP-2\.md/, 'the checkpoint remains available in track metadata');
  assert.match(html, /review_blocking/);
});

test('a checkpoint with evidence renders a clickable label that opens its detail', () => {
  const snapshot = snapshotOf({
    stages: makeProjection({
      review: [makeCard({
        id: fixtureMissionId('task-0100') as MissionCard['id'],
        lane: 'review',
        status: 'review',
        checkpoint: 'CP-2.md',
        checkpointDescription: 'CP-2: components extracted',
        checkpointEvidence: [
          { name: 'CP-1', description: 'CP-1: plan', goalCheck: [{ criterion: 'runs the gate', evidence: 'npm test' }] },
          { name: 'CP-2', description: 'CP-2: components extracted', goalCheck: [{ criterion: 'adds rows', evidence: 'test/unit/x' }, { criterion: 'wires the wire', evidence: 'src/interfaces/web/transport.ts' }] },
        ],
      })],
    }).stages,
  });
  const html = render(snapshot);
  // The label is a clickable affordance only when evidence exists.
  assert.match(html, /<button[^>]*aria-label="View checkpoint evidence for CP-2\.md:/);
  assert.match(html, /Recorded: CP-2\.md/, 'recorded checkpoint remains in accessible track metadata');
});

test('the checkpoint detail renders the description and every evidence row', () => {
  const snapshot = snapshotOf({
    stages: makeProjection({
      review: [makeCard({
        id: fixtureMissionId('task-0100') as MissionCard['id'],
        checkpoint: 'CP-2.md',
        checkpointDescription: 'CP-2: components extracted',
        checkpointEvidence: [
          { name: 'CP-1', description: 'CP-1: plan', goalCheck: [{ criterion: 'runs the gate', evidence: 'npm test' }] },
          { name: 'CP-2', description: 'CP-2: components extracted', goalCheck: [{ criterion: 'adds rows', evidence: 'test/unit/x' }, { criterion: 'wires the wire', evidence: 'src/interfaces/web/transport.ts' }] },
        ],
      })],
    }).stages,
  });
  const card = snapshot.stages.flatMap((stage) => stage.cards).find((wireCard) => wireCard.checkpoint !== null);
  assert.ok(card);
  const html = renderToStaticMarkup(React.createElement(CheckpointDetail, { card, initial: 'CP-2.md', onClose: () => {} }));
  // The opened checkpoint is CP-2, so its description and every one of its
  // Goal Check rows render; the unopened CP-1 rows do not.
  assert.match(html, /CP-2: components extracted/, 'the checkpoint description renders');
  assert.match(html, /adds rows/);
  assert.match(html, /wires the wire/);
  assert.match(html, /test\/unit\/x/);
  assert.match(html, /src\/interfaces\/web\/transport\.ts/);
  assert.doesNotMatch(html, /runs the gate/, 'an unopened checkpoint keeps its rows hidden');
});

test('the checkpoint detail takes the board color authority and the title/body type steps (TASK-2773.02)', () => {
  const snapshot = snapshotOf({
    stages: makeProjection({
      review: [makeCard({
        id: fixtureMissionId('task-0100') as MissionCard['id'],
        checkpoint: 'CP-2.md',
        checkpointEvidence: [{ name: 'CP-2', description: 'CP-2: components extracted', goalCheck: [{ criterion: 'adds rows', evidence: 'test/unit/x' }] }],
      })],
    }).stages,
  });
  const card = snapshot.stages.flatMap((stage) => stage.cards).find((wireCard) => wireCard.checkpoint !== null);
  assert.ok(card);
  const html = renderToStaticMarkup(React.createElement(CheckpointDetail, { card, initial: 'CP-2.md', onClose: () => {} }));
  // The panel is the board's own card surface and edge, not a modal palette.
  assert.ok(html.includes(`background:${C.card}`), 'the dialog surface is the board card token');
  assert.ok(html.includes(`border:1px solid ${C.cardEdge}`), 'the dialog edge is the board card edge token');
  assert.match(html, /font-size:18px/, 'the dialog title sits at the title step of the shared ladder');
  assert.match(html, /font-size:12px/, 'evidence rows sit at the body step, never smaller');
  assert.ok(TYPE.title > TYPE.heading && TYPE.heading > TYPE.body && TYPE.body > TYPE.meta && TYPE.meta >= TYPE.micro && TYPE.micro >= 11,
    'the shared ladder keeps title above heading above body, with metadata at or above the 11px floor');
});

test('the checkpoint detail renders nothing when the card carries no evidence rows', () => {
  const snapshot = snapshotOf({
    stages: makeProjection({ review: [makeCard({ checkpoint: 'CP-1.md', checkpointEvidence: [] })] }).stages,
  });
  const card = snapshot.stages.flatMap((stage) => stage.cards).find((wireCard) => wireCard.checkpoint !== null);
  assert.ok(card);
  const html = renderToStaticMarkup(React.createElement(CheckpointDetail, { card, initial: 'CP-1.md', onClose: () => {} }));
  assert.equal(html, '', 'an empty mission keeps its layout with no panel');
});

test('the operation log renders the server entry rather than a reconstructed one', () => {
  const html = render(populated());
  assert.match(html, /2026-08-30T10:00:00\.000Z/);
  assert.match(html, /CP-2 committed/);
});

test('operation progress deduplicates reconnects and evicts oldest entries', () => {
  const progress = { kind: 'progress' as const, transportVersion: 2 as const, operationId: 'op-reconnect', sequence: 1, phase: 'run', message: 'one', timestamp: '2026-08-30T11:00:00.000Z' } satisfies Partial<NonNullable<Parameters<typeof recordProgress>[1]>>;
  const once = recordProgress(EMPTY_LIVE_PROGRESS, progress);
  assert.equal(recordProgress(once, progress).entries.length, once.entries.length);
  let bounded = once;
  for (let sequence = 2; sequence <= OPERATION_LOG_LIMIT + 2; sequence += 1) bounded = recordProgress(bounded, { ...progress, sequence });
  assert.equal(bounded.entries.length, OPERATION_LOG_LIMIT);
  assert.equal(bounded.entries.at(-1)?.sequence, OPERATION_LOG_LIMIT + 2);
});

test('FLOW keeps the reference two-panel layout when projected history is unavailable', () => {
  const html = renderFlow(toWebBoardSnapshot({ ...makeProjection(), metrics: emptyMetrics }).metrics);
  assert.match(html, /CUMULATIVE FLOW/);
  assert.match(html, /MEDIAN TIME IN STATE/);
  assert.doesNotMatch(html, /READ/);
  assert.doesNotMatch(html, /weekly throughput/);
});

test('FLOW renders populated projected values with whole-number display formatting', () => {
  const html = renderFlow(toWebBoardSnapshot({ ...makeProjection(), metrics: {
    ...emptyMetrics,
    health: { state: 'healthy' },
    provenance: { ...emptyMetrics.provenance, sampleSize: 4 },
    cumulativeFlowByState: { series: [{ at: '2026-08-30', counts: laneCounts({ active: 2, review: 1 }), observationCount: 3 }], missingHistoryFallback: 'skip' } satisfies typeof emptyMetrics.cumulativeFlowByState,
    medianCycleTimeByState: { series: [{ lane: 'active', value: 42.5, observationCount: 2.5 }, { lane: 'review', value: 0.4, observationCount: 1 }], missingHistoryFallback: 'null' } as typeof emptyMetrics.medianCycleTimeByState,
  } }).metrics);
  assert.match(html, /Cumulative flow chart/);
  assert.match(html, /active/);
  assert.match(html, /43m \(n=3\)/);
  assert.match(html, /0m \(n=1\)/);
  assert.match(html, /cycle time/);
  assert.match(html, /43m/);
  assert.doesNotMatch(html, /42\.5m/);
  assert.match(html, /refined → done, median/);
});

test('FLOW charts the server-owned weekly series and never the historical stock beside it', () => {
  const html = renderFlow(toWebBoardSnapshot({ ...makeProjection(), metrics: {
    ...emptyMetrics,
    // The all-history series still carries every pre-window completion...
    cumulativeFlowByState: { series: [
      { at: '2026-08-23T23:59:59.000Z', counts: laneCounts({ done: 99 }), observationCount: 99 },
    ], missingHistoryFallback: 'estimate' } satisfies typeof emptyMetrics.cumulativeFlowByState,
    // ...and FLOW charts the weekly series the projection published instead.
    weeklyCumulativeFlow: { series: [
      { at: '2026-08-24T23:59:59.999Z', counts: laneCounts({ active: 2 }), observationCount: 2 },
      { at: '2026-08-30T23:59:59.999Z', counts: laneCounts({ active: 2 }), observationCount: 2 },
    ], missingHistoryFallback: 'estimate', window: { startDate: '2026-08-24', endDate: '2026-08-30', label: '2026-08-24 → 2026-08-30' } } satisfies NonNullable<typeof emptyMetrics.weeklyCumulativeFlow>,
  } }).metrics);
  assert.match(html, /2026-08-24 → 2026-08-30/);
  assert.match(html, / active<\/span>/);
  assert.doesNotMatch(html, />99<\//);
});

test('the web transport carries the weekly cumulative-flow series and its window unchanged', () => {
  const weekly = {
    series: [
      { at: '2026-08-25T23:59:59.999Z', counts: { backlog: 0, refined: 0, active: 1, review: 0, integration: 0, done: 0 }, observationCount: 1 },
      { at: '2026-08-26T23:59:59.999Z', counts: { backlog: 0, refined: 0, active: 0, review: 0, integration: 0, done: 1 }, observationCount: 1 },
    ],
    missingHistoryFallback: 'estimate',
    window: { startDate: '2026-08-25', endDate: '2026-08-26', label: '2026-08-25 → 2026-08-26' },
  } satisfies NonNullable<typeof emptyMetrics.weeklyCumulativeFlow>;
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
    weeklyCumulativeFlow: { series: points, missingHistoryFallback: 'estimate', window: { startDate: '2026-08-25', endDate: '2026-08-31', label: '2026-08-25 → 2026-08-31' } } satisfies NonNullable<typeof emptyMetrics.weeklyCumulativeFlow>,
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

test('each observed non-passing gate state renders distinctly, never as a pass (TASK-2775)', () => {
  for (const [gate, text] of [
    ['unavailable', 'gate · unavailable'], ['not-run', 'gate · not run'], ['unconfigured', 'gate · none configured'],
    ['stale', 'gate · stale'], ['running', 'gate · running'], ['failed', 'gate ✗ FAIL'],
  ] as const) {
    const html = render(snapshotOf({
      stages: makeProjection({ active: [makeCard({ checkpoint: 'CP-1.md', gate })] }).stages,
    }));
    assert.ok(html.includes(text), `${gate} renders ${text}`);
    assert.ok(!html.includes('gate ✓'), `${gate} never renders as passed`);
  }
});

test('an unidentified agent omits the implementer label and its activity dot', () => {
  const html = render(snapshotOf({
    stages: makeProjection({ active: [makeCard({ agent: null })] }).stages,
  }));
  assert.doesNotMatch(html, /no implementer|class="live-indicator"/);
});

test('running-agent summaries retain observed counts without command-session wording', () => {
  const html = render(populated());
  assert.match(html, /codex<\/span><span[^>]*>0<\/span>/, 'an observed zero remains beside its agent');
  assert.match(html, /claude<\/span><span[^>]*>blocked · 1m 30s · unknown<\/span>/, 'unknown liveness remains explicit');
  assert.doesNotMatch(html, /command sessions?/, 'agent summaries omit the command-session phrase');
  assert.doesNotMatch(html, /unattributed sessions unknown/);
});

test('the top bar renders the server-owned decision-window completion count between WIP and attention', () => {
  const html = renderToStaticMarkup(React.createElement(Board, {
    snapshot: { ...populated(), inFlightWip: 5, metrics: { ...populated().metrics, weeklyCompletedMissions: 21 } }, onRefresh: async () => {},
  }));
  assert.match(html, /wip <span[^>]*>5<\/span> · 21 missions\/wk · attention <span[^>]*>1<\/span>/);
});

test('board, card, lane and modal surfaces consume one design token authority (TASK-2773.02)', () => {
  // The separate green modal palette is gone from every browser surface; the
  // dialogs reuse the board's card/edge/text tokens and green status accent.
  const removedModalPalette = ['#101c16', '#2f5a3f', '#cbd9cf', '#e0b973', '#16241c', '#2f4a3a', '#264030', '#68f6a7', '#43e891', '#102419', '#0c1712'];
  for (const file of browserSources.filter((source) => /\.tsx?$/.test(source.name))) {
    for (const value of removedModalPalette) {
      assert.ok(!file.text.includes(value), `${file.name} still carries the removed modal palette value ${value}`);
    }
  }
  const sourceOf = (name: string): string => {
    const text = browserSources.find((source) => source.name === name)?.text ?? '';
    assert.ok(text, `${name} is not a browser source`);
    return text;
  };
  for (const name of ['board.tsx', 'flight-column.tsx', 'lane-header.tsx', 'intake-column.tsx', 'done-rail.tsx', 'attention-rail.tsx', 'top-bar.tsx', 'action-button.tsx', 'checkpoint-pips.tsx', 'flow-panel.tsx', 'operation-log.tsx']) {
    const text = sourceOf(name);
    assert.match(text, /from '\.\/palette\.js'/, `${name} does not import the design authority`);
    assert.match(text, /\b(SPACE|RADIUS|TYPE)\b/, `${name} does not consume a shared spacing, radius or type scale`);
  }
  for (const name of ['checkpoint-detail.tsx', 'mission-history.tsx', 'cancel-confirmation.tsx', 'create-mission-dialog.tsx']) {
    assert.match(sourceOf(name), /\bMODAL\./, `${name} does not consume the semantic modal surfaces`);
  }
  // The stylesheet mirrors the same tokens instead of defining a second scale.
  const css = sourceOf('style.css');
  assert.match(css, /--card-edge: #232a31;/, 'the stylesheet keeps a token mirror of the palette edge');
  assert.match(css, /var\(--card-edge\)/, 'the stylesheet consumes its token mirror');
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
  const live = makeCard({ execution: { observedAt: '2026-10-16T10:00:00Z', complete: true, limitations: [], invocations: [{ runId: 'execute-codex-a1-test', operationId: 'op', family: agentFamily('codex') }] }, id: fixtureMissionId('task-1111') as MissionCard['id'], currentWork: { operationId: 'op', phase: 'implement', summary: 'live work', agent: agentFamily('codex'), updatedAt: '2026-08-30T00:00:00.000Z', freshness: 'live' }, liveSession: { missionId: fixtureMissionId('task-1111') as MissionCard['id'], family: agentFamily('codex') } });
  const uncertain = makeCard({ id: fixtureMissionId('task-1112') as MissionCard['id'], currentWork: { ...live.currentWork!, freshness: 'unverified' } });
  const stale = makeCard({ id: fixtureMissionId('task-1113') as MissionCard['id'], currentWork: { ...live.currentWork!, freshness: 'stale' }, liveSession: { missionId: fixtureMissionId('task-1113') as MissionCard['id'], family: agentFamily('codex') } });
  const blocked = makeCard({ id: fixtureMissionId('task-1114') as MissionCard['id'], blockingReason: 'waiting' });
  const idle = makeCard({ id: fixtureMissionId('task-1115') as MissionCard['id'] });
  const html = render(snapshotOf({ stages: makeProjection({ active: [live, uncertain, stale, blocked, idle] }).stages }));
  assert.doesNotMatch(html, /working · (?:live|unknown|stale)/);
  assert.match(html, /waiting/);
  assert.match(html, /no work observed/);
  assert.match(html, /recovery evidence: coordinator live \(codex\)/);
  assert.match(html, /active worker family: codex/, 'the live worker is the header agent, not a stale assignee');
  assert.ok(!html.includes('undefined'), 'a missing assignee never leaks as header text');
  assert.doesNotMatch(html, /class="live-indicator"/);
  assert.equal((html.match(/fan spin/g) ?? []).length, 4, 'live and unverified current work spin; stale, blocked and idle work do not');
  const css = browserSources.find((file) => file.name === 'style.css')?.text ?? '';
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.fan\.spin[\s\S]*animation: none/);
  assert.doesNotMatch(css, /\.live-indicator/);
});

test('fans retain the pre-TASK-2576 work behavior independently of agent identity and coordinator scans', () => {
  for (const freshness of ['live', 'unverified', 'stale'] as const) {
    for (const agent of [null, agentFamily('codex')]) {
      for (const liveSession of [undefined, null, { missionId: fixtureMissionId('task-9999') as MissionCard['id'], family: agentFamily('codex') }]) {
        const card = makeCard({ execution: freshness !== 'stale' && agent !== null ? { observedAt: '2026-10-16T10:00:00Z', complete: true, limitations: [], invocations: [{ runId: 'execute-codex-a1-test', operationId: 'op', family: agent }] } : undefined, currentWork: { operationId: 'op', phase: 'integrate', summary: 'work in progress', agent, updatedAt: '2026-08-30T00:00:00.000Z', freshness }, liveSession });
        const snapshot = snapshotOf({ stages: makeProjection({ active: [card] }).stages });
        const webCard = snapshot.stages.flatMap(stage => stage.cards)[0];
        const html = render(snapshot);
        assert.equal(isSpinning(webCard), freshness !== 'stale');
        assert.equal((html.match(/fan spin/g) ?? []).length, freshness === 'stale' ? 0 : 2);
        assert.doesNotMatch(html, /no implementer/);
        assert.doesNotMatch(html, /class="live-indicator"|working · (?:live|unknown|stale)/,
          'worker identity does not introduce an activity blink (TASK-2687)');
        if (freshness !== 'stale' && agent !== null) {
          assert.match(html, /title="active worker family: codex"/);
        } else {
          assert.doesNotMatch(html, /active worker family:/);
        }
      }
    }
  }
});

test('a blocked or idle card keeps its implementer tooltip without an activity dot (TASK-2687)', () => {
  const blocked = makeCard({ id: fixtureMissionId('task-blocked') as MissionCard['id'], agent: agentFamily('codex'), blockingReason: 'waiting' });
  const idle = makeCard({ id: fixtureMissionId('task-idle') as MissionCard['id'], agent: agentFamily('codex') });
  for (const card of [blocked, idle]) {
    const snapshot = snapshotOf({ stages: makeProjection({ active: [card] }).stages });
    const webCard = snapshot.stages.flatMap(stage => stage.cards)[0];
    const html = render(snapshot);
    assert.equal(isSpinning(webCard), false, 'a blocked or idle card never spins');
    assert.doesNotMatch(html, /class="live-indicator"/);
    assert.match(html, /title="implementer family: codex"/);
  }
});

test('flight headers omit work badges and agent dots in every flight lane (TASK-2687)', () => {
  for (const lane of ['active', 'review', 'integration'] as const) {
    for (const state of ['live', 'unverified', 'stale', 'idle', 'blocked'] as const) {
      for (const agent of [null, agentFamily('codex')]) {
        const card = makeCard({
          lane, status: lane, agent,
          execution: (state === 'live' || state === 'unverified') && agent !== null ? { observedAt: '2026-10-16T10:00:00Z', complete: true, limitations: [], invocations: [{ runId: 'execute-codex-a1-test', operationId: 'op', family: agent }] } : undefined,
          blockingReason: state === 'blocked' ? 'waiting' : null,
          currentWork: state === 'idle' || state === 'blocked' ? null : {
            operationId: 'op', phase: 'integrate', summary: 'work in progress',
            agent, updatedAt: '2026-08-30T00:00:00.000Z', freshness: state,
          },
        });
        const html = render(snapshotOf({ stages: makeProjection({ [lane]: [card] }).stages }));
        const header = html.slice(html.indexOf('<article'), html.indexOf('<p', html.indexOf('<article')));
        assert.doesNotMatch(header, /working ·|>idle<|>blocked<|●|live-indicator/);
        assert.equal((header.match(/title="(?:active worker|implementer) family: codex"/g) ?? []).length,
          agent !== null && state !== 'stale' ? 1 : 0);
      }
    }
  }
});

test('blocked and idle body activity dots stay static and distinguish blocked work (TASK-2687)', () => {
  const blocked = makeCard({ id: fixtureMissionId('task-blocked') as MissionCard['id'], agent: agentFamily('codex'), blockingReason: 'waiting' });
  const idle = makeCard({ id: fixtureMissionId('task-idle') as MissionCard['id'], agent: agentFamily('codex') });
  for (const card of [blocked, idle]) {
    const snapshot = snapshotOf({ stages: makeProjection({ active: [card] }).stages });
    const webCard = snapshot.stages.flatMap(stage => stage.cards)[0];
    const html = render(snapshot);
    assert.equal(isSpinning(webCard), false, 'a blocked or idle card never spins');
    // The body activity dot conveys the actor state; the header has no dot.
    const header = html.slice(html.indexOf('<article'), html.indexOf('<p', html.indexOf('<article')));
    assert.doesNotMatch(header, /●|live-indicator/);
    const dotSpan = html.match(/<span aria-hidden="true"[^>]*>●/);
    assert.ok(dotSpan, `a ${card.id} card renders the body activity dot`);
    const dotColor = dotSpan[0].match(/color:([^";]+)/);
    assert.ok(dotColor, `a ${card.id} dot has a color`);
    assert.equal(dotColor[1], card.blockingReason !== null ? C.red : C.faint,
      `a ${card.id} body dot distinguishes blocked work from idle work`);
    assert.doesNotMatch(dotSpan[0], /live-indicator/, `a ${card.id} dot carries no blink class`);
  }
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

test('each card renders projected action availability without inventing a runnable fallback', () => {
  const html = render(populated());
  const buttons: string[] = Array.from(html.match(/<button[^>]*>/g) ?? []).filter((button) => !button.includes('aria-controls="flow-metrics"') && !button.includes('aria-haspopup="dialog"'));
  assert.ok(buttons.length > 0, 'the fixture renders at least one action');
  for (const button of buttons) {
    assert.match(button, /aria-disabled="(?:true|false)"/, `action states availability: ${button}`);
  }
  assert.match(html, /px active task-0001/, "the server's display string is rendered verbatim");
  assert.match(html, /aria-label="px active task-0001 — unavailable: command is not eligible for this mission"/, 'the unavailable projected control retains the server reason');
});

test('advertised actions dispatch directly without a confirmation dialog', () => {
  assert.ok(!browserSources.find((file) => file.name === 'board.tsx')?.text.includes('CommandDialog'));
  assert.match(browserSources.find((file) => file.name === 'board-command-controller.ts')?.text ?? '', /Starting \$\{action\.display\}/,
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

test('the board root fills the viewport flex chain for empty and populated lanes (TASK-2773.01)', () => {
  const shell = renderToStaticMarkup(React.createElement(Shell));
  const page = shell.match(/<main style="([^"]*)"/)?.[1] ?? '';
  assert.match(page, /height:100vh/);
  assert.match(page, /display:flex/);
  assert.match(page, /flex-direction:column/);
  for (const active of [[], makeCards(1, 'active'), makeCards(40, 'active')]) {
    const html = render(toWebBoardSnapshot(makeProjection({ active })));
    const root = html.match(/^<div\b[^>]*style="([^"]*)"/)?.[1] ?? '';
    for (const style of ['flex:1', 'display:flex', 'flex-direction:column', 'min-height:0']) {
      assert.ok(root.split(';').includes(style), `Board root carries ${style} with ${active.length} active cards`);
    }
  }
});

test('narrow viewports scroll the board horizontally instead of dropping lanes', () => {
  const html = render(populated());
  assert.match(html, /overflow-x:auto/, 'the lane row scrolls horizontally like the reference');
  assert.match(html, /min-width:318px/, 'in-flight lanes keep the reference minimum width');
  assert.ok(!html.includes('display:none'), 'no lane or action is hidden at any width');
});

test('a board taller than the viewport exposes vertical scrolling without removing horizontal lane scrolling', () => {
  // One lane with 40 cards: content far taller than any viewport height.
  const tall = makeCards(40, 'active');
  const html = render(snapshotOf({ stages: makeProjection({ active: tall }).stages }));
  for (const card of tall) {
    assert.ok(html.includes(card.id), `${card.id} renders — no ticket is dropped from the markup`);
  }
  // renderToStaticMarkup runs no effects, but the shell's page container is
  // present in the pre-fetch markup carrying its full layout style.
  const shell = renderToStaticMarkup(React.createElement(Shell));
  const page = shell.match(/<main style="([^"]*)"/)?.[1] ?? '';
  assert.match(page, /height:100vh/, 'the page container is viewport-height');
  assert.match(page, /overflow-y:auto/, 'content past the viewport is vertically reachable');
  assert.doesNotMatch(page, /overflow(-x|-y)?:hidden/, 'the page container never clips overflow');
  assert.match(html, /overflow-x:auto/, 'the lane row keeps its horizontal lane scrolling');
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

test('production browser code uses no browser persistence; history polling is confined to the read-only mission view', () => {
  for (const file of browserSources) {
    for (const forbidden of ['localStorage', 'sessionStorage', 'indexedDB', 'document.cookie', 'caches.']) {
      assert.ok(!file.text.includes(forbidden), `${file.name} must not use ${forbidden}`);
    }
  }
  const pollers = browserSources.filter((file) => /setInterval\(/.test(file.text)).map((file) => file.name);
  assert.deepEqual(pollers, ['mission-history.tsx'], 'only the selected mission history view polls its GET-only reads (TASK-2749)');
  assert.match(browserSources.find((file) => file.name === 'mission-history.tsx')?.text ?? '', /const POLL_MS = 1000;/);
});

test('production browser code reads snapshots and mission history while keeping one guarded mutation route', () => {
  const fetches = browserSources.flatMap((file) => (file.text.match(/\bfetch\(/g) ?? []).map(() => file.name)).sort();
  assert.deepEqual(fetches, ['board-data.ts', 'board-data.ts', 'mission-history-data.ts'], 'snapshot, command and mission history requests stay in typed clients');
  const data = browserSources.find((file) => file.name === 'board-data.ts')?.text ?? '';
  assert.match(data, /COMMANDS_PATH = '\/api\/commands'/);
  assert.match(browserSources.find((file) => file.name === 'mission-history-data.ts')?.text ?? '', /`\/api\/terminal\/\$\{encodeURIComponent\(missionId\)\}`/);
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
    if (file.name === 'flow-panel.tsx' || file.name === 'top-bar.tsx') { continue; }
    for (const invented of ['missions/wk', 'median', 'throughput', 'bottleneck', 'cycle time']) {
      assert.ok(!file.text.toLowerCase().includes(invented.toLowerCase()), `${file.name} must not invent ${invented}`);
    }
  }
});

const layoutLaneLines = new Set([
  "const INTAKE_LANES: readonly string[] = ['refined', 'backlog'];",
  "const SHIPPED_LANE = 'done';",
]);

function laneRuleLines(text: string): string[] {
  const laneLiteral = /'(?:backlog|refined|active|review|integration|done)'/;
  return text.split('\n').filter((line) => {
    // The transport's work phase shares the word "review" with a board lane.
    // Mask only that comparison, never the whole line: a lane condition beside
    // it must still fail the boundary check (TASK-2686).
    const laneText = line.replace(/\bwork\.phase\s*===\s*'review'/g, 'work.phase === "work-phase"');
    return laneLiteral.test(laneText) && !layoutLaneLines.has(line.trim());
  });
}

test('lane boundary scanner distinguishes review work from lane rules (TASK-2686)', () => {
  assert.deepEqual(laneRuleLines("work.phase === 'review' && card.reviewPhase === 'reviewing'"), []);
  for (const lane of ['backlog', 'refined', 'active', 'review', 'integration', 'done']) {
    for (const condition of [
      `card.lane === '${lane}'`,
      `work.phase === 'review' && card.lane === '${lane}'`,
      `card.lane === '${lane}' && work.phase === 'review'`,
      `const targetLane = '${lane}';`,
    ]) {
      assert.deepEqual(laneRuleLines(condition), [condition]);
    }
  }
  assert.deepEqual(laneRuleLines("work.phase === 'active'"), ["work.phase === 'active'"]);
  assert.deepEqual(laneRuleLines("const lane = 'review';"), ["const lane = 'review';"]);
  for (const line of layoutLaneLines) { assert.deepEqual(laneRuleLines(line), []); }
});

test('production browser code maps no lane to a lifecycle rule or command', () => {
  for (const file of browserSources) {
    assert.deepEqual(laneRuleLines(file.text), [], `${file.name} maps a lane outside the layout buckets`);
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
  assert.deepEqual([...new Set(external)].sort(), ['react', 'react-dom', 'react-dom/client'], 'the client depends on React and React DOM only');
});

test('weekly missions use the delivery cohort instead of current DONE stock (TASK-2688)', () => {
  const snapshot = populated();
  const html = render({ ...snapshot, metrics: { ...snapshot.metrics, weeklyCompletedMissions: 3 } });
  assert.match(html, /3 missions\/wk/);
  assert.doesNotMatch(html, /21 missions\/wk/);
});


test('DONE exposes other retained history without adding it to the weekly count (TASK-2688)', () => {
  const projection = makeProjection({ done: [makeCard({ id: missionId('task-weekly'), lane: 'done' })] });
  const snapshot = toWebBoardSnapshot({ ...projection, stages: projection.stages.map(stage => stage.lane === 'done'
    ? { ...stage, historyCards: [makeCard({ id: missionId('task-unknown'), lane: 'done' })] } : stage) });
  const html = render(snapshot);
  assert.match(html, /DONE · 1/);
  assert.match(html, /Other completed history · 1/);
  assert.match(html, /task-weekly/);
  assert.match(html, /task-unknown/);
  assert.match(html, /<details aria-label="Other completed history">/);
});


test('checkpoint track is bounded and honest across supplied plan shapes (TASK-2773.04)', () => {
  const entry = (name: string, state?: 'completed' | 'current' | 'future') => ({
    name, description: `Deliver ${name}`, state, goalCheck: [{ criterion: 'contract', evidence: 'retained evidence' }],
  });
  const cases = [
    { plan: [entry('CP-2', 'completed'), entry('CP-9', 'current')], fill: '50%', label: '1/2 completed' },
    { plan: [entry('CP-2', 'completed'), entry('CP-9', 'completed')], fill: '100%', label: '2/2 completed' },
    { plan: [entry('CP-2'), entry('CP-9', 'current')], fill: '0%', label: 'Completion unknown' },
    { plan: Array.from({ length: 100 }, (_, i) => entry(`CP-${i}`, i < 25 ? 'completed' : 'future')), fill: '25%', label: '25/100 completed' },
    { plan: [], fill: '0%', label: 'Plan unavailable' },
  ];
  for (const { plan, fill, label } of cases) {
    for (const lane of ['backlog', 'refined', 'active', 'review', 'integration', 'done'] as const) {
      const card = makeCard({ lane, status: lane, checkpoint: 'CP-99', checkpointEvidence: plan });
      const snapshot = toWebBoardSnapshot(makeProjection({ [lane]: [card] }));
      const html = render(snapshot);
      assert.match(html, new RegExp(label));
      assert.match(html, /Recorded: CP-99/);
      if (plan.length) {
        assert.match(html, /data-checkpoint-track=""/);
        assert.equal((html.match(/data-checkpoint-fill=""/g) ?? []).length, 1);
        assert.ok(html.includes(`width:${fill}`));
        assert.match(html, /max-width:120px/);
      } else {
        assert.doesNotMatch(html, /data-checkpoint-track|data-checkpoint-fill|View checkpoint evidence/);
      }
      assert.doesNotMatch(html, /review-pip--running/);
      assert.doesNotMatch(html, />View checkpoints/);
      assert.equal((html.match(/data-checkpoint-complete=""/g) ?? []).length, fill === '100%' ? 1 : 0);
      if (plan.length) { assert.match(html, /aria-haspopup="dialog"/); }
      assert.doesNotMatch(html, /<details aria-label="Checkpoint descriptions/);
      if (plan.some(item => item.state === 'current')) { assert.match(html, /Current: CP-9/); }
    }
  }
  const absent = renderToStaticMarkup(React.createElement(CheckpointPips, {
    card: { ...toWebBoardSnapshot(makeProjection({ active: [makeCard()] })).stages.find(stage => stage.lane === 'active')!.cards[0], checkpointEvidence: undefined },
  }));
  assert.match(absent, /Plan unavailable/);
  assert.doesNotMatch(absent, /0\/0|completed|data-checkpoint-track|data-checkpoint-fill|View checkpoint evidence/);
});

test('recorded guidance and checkpoint evidence stay distinct from current activity (TASK-2776)', () => {
  const card = makeCard({ checkpoint: 'CP-1', checkpointDescription: 'Recorded step',
    nextActionText: 'Resume planned step', currentCheckpoint: 'CP-2',
    checkpointEvidence: [
      { name: 'CP-1', description: 'Recorded step', state: 'completed', goalCheck: [{ criterion: 'verified', evidence: 'npm test' }] },
      { name: 'CP-2', description: 'Planned step', state: 'current', goalCheck: [] },
    ], currentWork: { operationId: 'repair', phase: 'review-response', summary: 'Repairing reviewer findings', agent: null, updatedAt: 'now', freshness: 'live' },
  });
  const snapshot = toWebBoardSnapshot(makeProjection({ active: [card] }));
  const html = render(snapshot);
  assert.match(html, /Recorded: CP-1/);
  assert.match(html, /Current: CP-2/);
  assert.match(html, /recorded guidance \(CP-1\):/);
  assert.match(html, /Resume planned step/);
  assert.match(html, /Repairing reviewer findings/);
  assert.doesNotMatch(html, /review-pip--running/);
  const wire = snapshot.stages.flatMap(stage => stage.cards)[0];
  const detail = renderToStaticMarkup(React.createElement(CheckpointDetail, { card: wire, initial: 'CP-1', onClose: () => {} }));
  assert.match(detail, /Last recorded Goal Check evidence/);
  assert.match(detail, /Recorded step/);
  assert.match(detail, /verified/);
});

const refinementExecution = (family: string | null, complete = true): MissionCard['execution'] => ({
  observedAt: '2026-10-18T10:00:00Z', complete, limitations: complete ? [] : ['Provider execution could not be observed'],
  invocations: family === null ? [] : [{ runId: `draft-${family}-a1-test`, operationId: 'op-draft', family: agentFamily(family) }],
});
const refinementCard = (overrides: Partial<MissionCard>): MissionCard => makeCard({
  id: fixtureMissionId('task-refine') as MissionCard['id'], lane: 'backlog', status: 'backlog', agent: agentFamily('codex'), ...overrides,
});
const refinementWork = (overrides: Partial<NonNullable<MissionCard['currentWork']>> = {}): MissionCard['currentWork'] => ({
  operationId: 'op-draft', phase: 'draft', summary: 'refining acceptance criteria', agent: agentFamily('claude'),
  updatedAt: '2026-10-18T10:00:00.000Z', freshness: 'live', ...overrides,
});
const renderRefinement = (card: MissionCard): string => render(snapshotOf({ stages: makeProjection({ backlog: [card] }).stages }));

const intakeFan = (html: string): string => html.match(/class="fan[^"]*" style="[^"]*"/)?.[0] ?? '';
const headerOf = (html: string): string => {
  const start = html.indexOf('<article');
  return html.slice(start, html.indexOf('<p', start));
};

test('a refinement card shows the observed executing worker and published summary, not the assignee (TASK-2774)', () => {
  const html = renderRefinement(refinementCard({ currentWork: refinementWork(), execution: refinementExecution('claude') }));
  assert.match(html, /refining acceptance criteria/, 'the published work summary is visible');
  assert.match(html, /title="active worker family: claude"/, 'the header names the observed provider family');
  assert.match(intakeFan(html), /#d97757/, 'the fan takes the executing claude accent, not the codex assignee');
  assert.doesNotMatch(html, /codex/, 'assignment alone is never shown as the worker');
});

test('refinement cards keep preparing, handover, completion and blocked states distinct from execution (TASK-2774)', () => {
  const coordinator = { missionId: fixtureMissionId('task-refine') as MissionCard['id'], family: agentFamily('claude') };
  const preparing = renderRefinement(refinementCard({ currentWork: refinementWork({ summary: 'preparing draft context', agent: null }), execution: refinementExecution(null), liveSession: coordinator }));
  assert.match(preparing, /preparing draft context/);
  assert.doesNotMatch(preparing, /title="active worker|title="implementer/, 'a live coordinator and the assignee never name the worker');
  assert.doesNotMatch(intakeFan(preparing), /#d97757|#19b48c/, 'a live coordinator and the assignee never colour the worker fan');
  const handover = renderRefinement(refinementCard({ currentWork: refinementWork({ summary: 'handing over to reviewer' }), execution: refinementExecution(null), liveSession: coordinator }));
  assert.match(handover, /handing over to reviewer/);
  assert.doesNotMatch(handover, /title="active worker/, 'the previously published worker is not shown as executing');
  const completed = renderRefinement(refinementCard({ currentWork: null, execution: refinementExecution(null) }));
  assert.match(completed, /title="implementer family: codex"/, 'an idle card names its assignee as implementer in the header, as a flight card does');
  assert.doesNotMatch(completed, /no work observed|active worker|executing|execution unknown|data-provider-execution|working ·|>idle</, 'an idle intake card keeps its compact layout');
  assert.doesNotMatch(completed, /fan spin/);
  const blocked = renderRefinement(refinementCard({ blockingReason: 'draft needs operator answer', execution: refinementExecution(null) }));
  assert.match(blocked, /draft needs operator answer/);
  assert.match(blocked, /title="implementer family: codex"/, 'a blocked card names its assignee as implementer in the header, as a flight card does');
  assert.doesNotMatch(blocked, /fan spin|executing|title="active worker/);
});

test('refinement cards keep missing, stale and incomplete execution evidence uncertain (TASK-2774)', () => {
  const missing = renderRefinement(refinementCard({ currentWork: refinementWork(), execution: undefined }));
  assert.match(missing, /refining acceptance criteria/);
  assert.doesNotMatch(missing, /title="active worker|title="implementer|executing|execution unknown|codex/, 'no observation never prints a worker or a zero');
  assert.doesNotMatch(intakeFan(missing), /#d97757|#19b48c/);
  const stale = renderRefinement(refinementCard({ currentWork: refinementWork({ freshness: 'stale' }), execution: refinementExecution(null, false) }));
  assert.match(stale, /refining acceptance criteria/, 'the stale publication stays visible while no worker is claimed');
  assert.match(headerOf(stale), /class="fan"[^>]*#3f4a53/, 'a stale card colours no family and spins no fan');
  assert.doesNotMatch(stale, /title="active worker|0 executing|execution unknown|fan spin|working · /, 'an unreadable probe names no worker, never becomes a confirmed zero and prints no work badge');
  const incomplete = renderRefinement(refinementCard({ currentWork: refinementWork(), execution: refinementExecution('claude', false) }));
  assert.match(incomplete, /title="active worker family: claude"/, 'an incomplete probe still names the invocation it did observe');
  assert.doesNotMatch(incomplete, /1\+|executing|execution unknown/, 'the card states no count the probe could not confirm');
  for (const lane of ['backlog', 'refined'] as const) {
    const html = render(snapshotOf({ stages: makeProjection({ [lane]: [refinementCard({ lane, status: lane, currentWork: refinementWork(), execution: refinementExecution('claude') })] }).stages }));
    assert.match(html, /title="active worker family: claude"/, `${lane} intake cards name the executing worker`);
  }
});

test('refinement cards reuse the card design elements instead of a bespoke activity line (TASK-2774)', () => {
  assert.deepEqual(browserSources.filter((file) => /=\s*actorLine\(card\)/.test(file.text)).map((file) => file.name),
    ['card-activity.tsx'], 'one card element prints the published activity for every card design');
  assert.deepEqual(browserSources.filter((file) => /'active worker'/.test(file.text)).map((file) => file.name),
    ['card-activity.tsx'], 'one card element prints the worker identity for every card design');
  assert.deepEqual(browserSources.filter((file) => /data-provider-execution/.test(file.text)).map((file) => file.name),
    [], 'no card adds the execution count row the card design removed (px-0013)');
  for (const name of ['intake-column.tsx', 'flight-column.tsx']) {
    const text = browserSources.find((file) => file.name === name)!.text;
    assert.match(text, /<AgentLabel agent=\{(?:worker|agent)\}/, `${name} renders the shared worker label`);
    assert.match(text, /<ActorLine card=\{card\}/, `${name} renders the shared actor line`);
  }
  assert.deepEqual(browserSources.filter((file) => /workText|working · /.test(file.text)).map((file) => file.name),
    [], 'no card prints a work certainty badge; the other columns never did (TASK-2687)');
  const workerLabel = (markup: string): string | undefined => {
    const match = markup.match(/<span title="([^"]* family: [^"]*)"[^>]*>([^<]*)<\/span>/);
    return match ? `${match[1]} = ${match[2]}` : undefined;
  };
  const intake = renderRefinement(refinementCard({ currentWork: refinementWork(), execution: refinementExecution('claude') }));
  const flight = render(snapshotOf({ stages: makeProjection({ active: [refinementCard({ lane: 'active', status: 'active', currentWork: refinementWork(), execution: refinementExecution('claude') })] }).stages }));
  assert.ok(workerLabel(intake), 'the intake card states the worker in the design element, not in prose');
  assert.equal(workerLabel(intake), workerLabel(flight), 'an intake card states the worker exactly as a flight card does');
  assert.doesNotMatch(intake, /refining acceptance criteria[^<]*claude/, 'the published summary and the worker identity stay separate elements');
  const intakeHeader = headerOf(intake);
  const flightHeader = headerOf(flight);
  assert.match(intakeHeader, /title="active worker family: claude"/, 'the intake header carries the worker label where every other column carries it');
  assert.equal(workerLabel(intakeHeader), workerLabel(flightHeader), 'the label sits in the header, not beside the activity line');
  assert.match(intakeHeader, /family: claude"[^>]*>claude<\/span><\/div>$/, 'the label ends the header row, as it does on a flight card');
  assert.doesNotMatch(intakeHeader, /working ·|>idle<|>blocked<|●/, 'an intake header omits the work badge every flight lane omits (TASK-2687)');
  assert.doesNotMatch(intake, /working · (?:live|unknown|stale)/, 'an intake card prints no work certainty badge');
});
