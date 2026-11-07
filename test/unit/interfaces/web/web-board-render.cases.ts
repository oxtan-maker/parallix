import './web-board-card-facts.cases.js';
import './web-refinement-render.cases.js';
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
import { Board, EMPTY_FLIGHT_LANE_WIDTH_PX, FLIGHT_LANE_MIN_WIDTH_PX } from '../../../../web/src/board.js';
import { CheckpointDetail } from '../../../../web/src/checkpoint-detail.js';
import { CheckpointPips } from '../../../../web/src/checkpoint-pips.js';
import './web-operation-log-render.cases.js';
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
    attentionQueue: [{ ...makeAttentionItem(blocked, { kind: 'blocking', detail: 'two blocking findings' }, 1),
      action: { kind: 'active:execute', display: 'px active task-0001' } }],
    availableActions: [{ command: 'draft', enabled: true, reason: null }],
    operationLog: [{ operationId: 'op-1', phase: 'checkpoint', message: 'CP-2 committed', timestamp: '2026-08-30T10:00:00.000Z' }],
    sourceFacts: [{ source: 'git', status: 'fresh', value: 'main@abcdef' }, { source: 'stats', status: 'unavailable' }],
    metrics: {
      ...emptyMetrics,
      agentAvailability: [
        metric({ family: agentFamily('codex'), runningSessions: 0 }),
        metric({ family: agentFamily('claude'), available: false, blockedForMs: 90_000, reason: 'usage limit hit', runningSessions: 1 }),
        metric({ family: agentFamily('mistral'), available: false, blockedForMs: Number.POSITIVE_INFINITY, reason: 'manual block' }),
      ],
      weeklyCumulativeFlow: { series: [{ at: '2026-08-30T23:59:59.999Z', counts: { backlog: 0, refined: 0, active: 0, review: 0, integration: 0, done: 21 }, observationCount: 21 }], missingHistoryFallback: 'estimate', window: { startDate: '2026-08-24', endDate: '2026-08-30', label: '2026-08-24 → 2026-08-30' } },
    },
  });
}

test('settled review recovery renders explicit guidance, evidence and Resume review control (TASK-2839)', () => {
  const recovery = { action: 'acknowledge-and-resume' as const, humanStop: 'MAX_ATTEMPTS',
    guidance: 'Owned review work settled; acknowledge the stop and resume.',
    evidence: ['Review stopped for human review: MAX_ATTEMPTS', 'no open workflow operation'] };
  const card = makeCard({ lane: 'review', status: 'review', reviewRound: 5, reviewPhase: 'reviewing', reviewRecovery: recovery,
    commands: [{ command: 'review', enabled: true, reason: null }] });
  const html = render(snapshotOf({ stages: makeProjection({ review: [card] }).stages }));
  assert.match(html, /Review recovery · acknowledge-and-resume/);
  assert.match(html, /Owned review work settled; acknowledge the stop and resume\./);
  assert.match(html, /Review stopped for human review: MAX_ATTEMPTS/);
  assert.match(html, /Resume review/);
});

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
          { command: 'review', enabled: true, reason: null, targetLane: 'review', label: "record review preparation" },
        ],
      })],
    }],
  }));
  assert.match(html, /px review task-2657-mixed — enabled/);
  assert.doesNotMatch(html, /px active task-2657-mixed/);
});

test('normal server projections keep compact cards across all unfinished lanes (TASK-2705)', () => {
  for (const lane of ['backlog', 'refined', 'active', 'review', 'integration'] as const) {
    const mission = fixtureMission('task-2705-compact', { status: lane, checkpoints: [] });
    const commands = availableBoardCommands(mission, { reviewApproval: null });
    const card = makeCard({ id: mission.id, lane, status: lane, commands });
    const board = toWebBoardSnapshot(makeProjection({ [lane]: [card] }));
    const html = render(board);
    const runnable = commands.filter(command => command.command !== 'cancel' && command.enabled).length;
    assert.equal((html.match(/data-action-kind=/g) ?? []).length, Math.max(1, runnable) + 2, `${lane}: Cancel, Edit and each eligible command, or one explanatory fallback`);
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
  assert.match(html, /claude<\/span><span[^>]*>blocked · 1m 30s · 1<\/span>/, 'a confirmed count follows the block');
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
  for (const name of ['board.tsx', 'flight-column.tsx', 'lane-header.tsx', 'intake-column.tsx', 'done-rail.tsx', 'attention-rail.tsx', 'top-bar.tsx', 'action-button.tsx', 'checkpoint-pips.tsx', 'operation-log.tsx',
    'flow-panel.tsx', 'flow-graph.tsx', 'flow-time-table.tsx', 'flow-format.ts']) {
    const text = sourceOf(name);
    assert.match(text, /from '\.\/palette\.js'/, `${name} does not import the design authority`);
    assert.match(text, /\b(SPACE|RADIUS|TYPE|TRACK|DISPLAY|FLOW|FLOW_TYPE)\b/, `${name} does not consume a shared design scale`);
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
  const live = makeCard({ execution: { observedAt: '2026-10-16T10:00:00Z', limitations: [], invocations: [{ runId: 'execute-codex-a1-test', operationId: 'op', family: agentFamily('codex') }] }, id: fixtureMissionId('task-1111') as MissionCard['id'], currentWork: { operationId: 'op', phase: 'implement', summary: 'live work', agent: agentFamily('codex'), updatedAt: '2026-08-30T00:00:00.000Z', freshness: 'live' }, liveSession: { missionId: fixtureMissionId('task-1111') as MissionCard['id'], family: agentFamily('codex') } });
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
        const card = makeCard({ execution: freshness !== 'stale' && agent !== null ? { observedAt: '2026-10-16T10:00:00Z', limitations: [], invocations: [{ runId: 'execute-codex-a1-test', operationId: 'op', family: agent }] } : undefined, currentWork: { operationId: 'op', phase: 'integrate', summary: 'work in progress', agent, updatedAt: '2026-08-30T00:00:00.000Z', freshness }, liveSession });
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
          execution: (state === 'live' || state === 'unverified') && agent !== null ? { observedAt: '2026-10-16T10:00:00Z', limitations: [], invocations: [{ runId: 'execute-codex-a1-test', operationId: 'op', family: agent }] } : undefined,
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
  const buttons: string[] = Array.from(html.match(/<button[^>]*>/g) ?? []).filter((button) => !button.includes('data-view-nav=') && !button.includes('aria-haspopup="dialog"'));
  assert.ok(buttons.length > 0, 'the fixture renders at least one action');
  for (const button of buttons) {
    assert.match(button, /aria-disabled="(?:true|false)"/, `action states availability: ${button}`);
  }
  assert.match(html, /px active task-0001/, "the server's explicit display string is rendered verbatim");
  assert.match(html, /aria-label="px active task-0001 — unavailable: command is not eligible for this mission"/, 'the unavailable projected control retains the server reason');
  const reviewCard = makeCard({ lane: 'review', status: 'review', blockingReason: 'Workflow exited with status 1',
    commands: [{ command: 'review', enabled: true, reason: null }] });
  const reviewHtml = render(toWebBoardSnapshot({ ...makeProjection({ review: [reviewCard] }),
    attentionQueue: [makeAttentionItem(reviewCard, { kind: 'blocking', detail: reviewCard.blockingReason! }, 1)] }));
  assert.match(reviewHtml, /aria-label="px review task-9999 — enabled"/, 'production-derived review recovery is rendered verbatim (TASK-2814)');
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

/** The style of the lane wrapper the board puts around one flight column. */
function laneWrapperStyle(html: string, lane: string): string {
  const wrapper = html.match(new RegExp(`<div([^>]*)><section aria-label="${lane} stage"`))?.[1] ?? '';
  const style = wrapper.match(/style="([^"]*)"/)?.[1];
  assert.ok(style !== undefined, `the ${lane} lane carries a wrapper layout style`);
  return style!;
}

/** One rendered flight column, header and body together. */
function flightSection(html: string, lane: string): string {
  const start = html.indexOf(`<section aria-label="${lane} stage"`);
  assert.ok(start >= 0, `${lane} renders as a named stage`);
  return html.slice(start, html.indexOf('</section>', start));
}

test('an empty in-flight lane claims a compact column instead of the populated allocation (TASK-2773.06)', () => {
  const compact = `flex:0 0 ${EMPTY_FLIGHT_LANE_WIDTH_PX}px`;
  const populatedAllocation = `flex:1`;

  // All three in-flight lanes empty: every one is compact, none keeps 318.
  const empty = render(toWebBoardSnapshot(makeProjection({})));
  for (const lane of ['active', 'review', 'integration']) {
    const style = laneWrapperStyle(empty, lane).split(';');
    assert.ok(style.includes(compact), `${lane}: an empty lane is a fixed compact column`);
    assert.ok(style.includes(`min-width:${EMPTY_FLIGHT_LANE_WIDTH_PX}px`), `${lane}: the compact column never squeezes further`);
    assert.ok(style.includes('min-height:0'), `${lane}: the lane keeps its own vertical scrolling`);
    assert.ok(!style.includes(String(FLIGHT_LANE_MIN_WIDTH_PX)), `${lane}: an empty lane does not claim the populated minimum`);
    // Discoverability survives compaction: heading, server count, drop body.
    const section = flightSection(empty, lane);
    assert.ok(section.includes(`>${lane.toUpperCase()}</h2>`), `${lane}: the heading stays on screen`);
    assert.ok(section.includes('0 cards'), `${lane}: the server count stays beside the heading`);
    assert.ok(section.includes('overflow-y:auto'), `${lane}: the drop body stays a scrollable region`);
    assert.ok(section.includes('no missions in this stage'), `${lane}: emptiness is stated, not hidden`);
  }

  // Mixed: the empty lanes give their width back to the lane that carries cards.
  const mixed = render(toWebBoardSnapshot(makeProjection({ active: makeCards(2, 'active') })));
  assert.ok(laneWrapperStyle(mixed, 'active').split(';').includes(populatedAllocation), 'a populated lane still grows');
  assert.ok(laneWrapperStyle(mixed, 'active').includes(`min-width:${FLIGHT_LANE_MIN_WIDTH_PX}px`), 'a populated lane keeps the reference minimum');
  for (const lane of ['review', 'integration']) {
    assert.ok(laneWrapperStyle(mixed, lane).split(';').includes(compact), `${lane}: an empty neighbour stays compact`);
  }

  // Fully populated: nothing about the allocation changes for a loaded board.
  const full = render(toWebBoardSnapshot(makeProjection({
    active: makeCards(1, 'active'), review: makeCards(1, 'review'), integration: makeCards(1, 'integration'),
  })));
  for (const lane of ['active', 'review', 'integration']) {
    const style = laneWrapperStyle(full, lane).split(';');
    assert.ok(style.includes(populatedAllocation), `${lane}: a populated lane keeps its share`);
    assert.ok(style.includes(`min-width:${FLIGHT_LANE_MIN_WIDTH_PX}px`), `${lane}: card width stays usable`);
  }
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
  const referenceVocabularyOwners: Readonly<Record<string, readonly string[]>> = {
    'flow-panel.tsx': ['missions/wk', 'throughput', 'cycle time'],
    'flow-graph.tsx': ['median'],
    'flow-time-table.tsx': ['median'],
    'top-bar.tsx': ['missions/wk', 'throughput'],
    'palette.ts': ['throughput'],
  };
  for (const file of browserSources) {
    assert.ok(!/task-\d/.test(file.text), `${file.name} must not embed a mission id`);
    for (const invented of ['missions/wk', 'median', 'throughput', 'bottleneck', 'cycle time']) {
      if (referenceVocabularyOwners[file.name]?.includes(invented)) { continue; }
      assert.ok(!file.text.toLowerCase().includes(invented.toLowerCase()), `${file.name} must not invent ${invented}`);
    }
  }
});

const layoutLaneLines = new Set([
  "const INTAKE_LANES: readonly string[] = ['refined', 'backlog'];",
  "const SHIPPED_LANE = 'done';",
  "case 'refine->implement:flow': return { points: [[191, r.y + r.h], [191, i.y]], label: [203, r.y + r.h + 17], suffix: 'refined' };",
  "const refined = flow.stateDwell.find(state => state.state === 'refined');",
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
    assert.ok(!/'px (?!lead')/.test(file.text), `${file.name} must not embed a px command string`);
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

test('attention rail shows manual blocker and lead investigation next step without a run control (TASK-2799)', () => {
  const card = makeCard({ id: missionId('task-human'), blockingReason: 'Review authority requires operator decision' });
  const snapshot = toWebBoardSnapshot({ ...makeProjection({ active: [card] }),
    attentionQueue: [makeAttentionItem(card, { kind: 'blocking', detail: card.blockingReason! }, 1)] });
  const html = render(snapshot);
  assert.match(html, /Review authority requires operator decision/);
  assert.match(html, /px lead task-human --once/);
  assert.match(html, /lead investigation/);
  assert.doesNotMatch(html, /data-action-kind="manual"/);
  assert.doesNotMatch(html, /px integrate task-human/);
});

test('a failed provider observation is rendered as a dated diagnostic on its own mission only (px-0027 F2)', () => {
  const failing = makeCard({ id: fixtureMissionId('task-diag-a') as MissionCard['id'], lane: 'active', status: 'active',
    execution: { observedAt: '2026-11-02T10:00:00.000Z', limitations: ['execute-codex-a1-x: provider process probe unavailable'], invocations: [] } });
  const healthy = makeCard({ id: fixtureMissionId('task-diag-b') as MissionCard['id'], lane: 'active', status: 'active',
    execution: { observedAt: '2026-11-02T10:00:00.000Z', limitations: [], invocations: [] } });
  const html = render(snapshotOf({ stages: makeProjection({ active: [failing, healthy] }).stages }));
  assert.equal((html.match(/data-execution-diagnostic/g) ?? []).length, 1, 'only the failing mission carries the diagnostic');
  assert.match(html, /Provider observation at 2026-11-02T10:00:00\.000Z: execute-codex-a1-x: provider process probe unavailable/);
});
