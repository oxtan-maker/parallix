import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { FlightColumn } from '../../../web/src/flight-column.js';
import { toWebBoardSnapshot, validateWebBoardSnapshot } from '../../../src/interfaces/web/transport.js';
import { agentFamily } from '../../../src/domain/agents.js';
import { makeFullCard, makeProjection } from '../../fixtures/board-projection.js';
import type { MissionCard } from '../../../src/application/projections/mission-board.js';
import type { WebMissionCard } from '../../../src/interfaces/web/transport.js';

function wireCard(card: MissionCard): WebMissionCard {
  const validation = validateWebBoardSnapshot(toWebBoardSnapshot(makeProjection({ [card.lane]: [card] })));
  assert.equal(validation.ok, true);
  if (!validation.ok) { throw new Error('unreachable'); }
  const wire = validation.value.stages.flatMap((stage) => stage.cards).find((candidate) => candidate.id === card.id);
  assert.ok(wire !== undefined);
  return wire;
}

function renderPips(card: WebMissionCard): string {
  return renderToString(createElement(FlightColumn, {
    stage: { lane: card.lane, count: 1, cards: [card] },
    style: {},
    onAction: () => {},
    onSelect: () => {},
    onDragStart: () => {},
    onDrop: () => {},
    selectedId: null,
    pendingCommands: new Map(),
    draggable: false,
  }));
}

test('review pips use completed-round disposition colors and a blinking current round (TASK-2666)', () => {
  const card = wireCard(makeFullCard({
    blockingReason: null,
    currentWork: { operationId: 'review-op', phase: 'review', summary: 'reviewing', agent: agentFamily('codex'), updatedAt: '2026-10-08T00:00:00Z', freshness: 'live' },
    reviewRound: 3,
    reviewPhase: 'reviewing',
    reviewHistory: [
      { number: 1, reviewer: agentFamily('codex'), implementer: agentFamily('custom'), phase: 'approved', disposition: 'APPROVED', comment: null, findingSummaries: [], pushbacks: [], fixes: [] },
      { number: 2, reviewer: agentFamily('codex'), implementer: agentFamily('custom'), phase: 'fixing', disposition: 'REQUEST_CHANGES', comment: null, findingSummaries: [], pushbacks: [], fixes: [] },
      { number: 3, reviewer: agentFamily('codex'), implementer: agentFamily('custom'), phase: 'reviewing', disposition: null, comment: null, findingSummaries: [], pushbacks: [], fixes: [] },
    ],
  }));

  const html = renderPips(card);

  assert.match(html, /title="round 1: APPROVED"[^>]*background:#5ee08a/);
  assert.match(html, /title="round 2: REQUEST_CHANGES"[^>]*background:#e8b84b/);
  assert.match(html, /class="review-pip--running"[^>]*title="round 3: reviewing"[^>]*background:#5ee08a/);
});

test('review pips remain absent without a review round (TASK-2666)', () => {
  const html = renderPips(wireCard(makeFullCard({ reviewRound: null, reviewPhase: null, reviewHistory: [] })));

  assert.doesNotMatch(html, /aria-label="review round/);
});

function activityCard(phase: string, freshness: 'live' | 'unverified' | 'stale' = 'live', reviewPhase: MissionCard['reviewPhase'] = 'reviewing'): WebMissionCard {
  return wireCard(makeFullCard({
    blockingReason: null,
    reviewRound: 3,
    reviewPhase,
    currentWork: { operationId: 'review-op', phase, summary: 'current work', agent: null, updatedAt: '2026-10-08T00:00:00Z', freshness },
  }));
}

for (const [phase, reviewPhase] of [['review', 'reviewing'], ['review-response', 'fixing']] as const) {
  for (const freshness of ['live', 'unverified'] as const) {
    test(`only current review pip blinks for ${freshness} ${phase} work (TASK-2686)`, () => {
      const html = renderPips(activityCard(phase, freshness, reviewPhase));
      const pips = /aria-label="review round 3"[^>]*>(.*?)<\/span><\/div>/.exec(html)?.[1];
      assert.ok(pips);
      const spans = pips.match(/<span[^>]*>/g) ?? [];
      assert.equal(spans.length, 5);
      assert.deepEqual(spans.map((span) => span.includes('review-pip--running')), [false, false, true, false, false]);
    });
  }
}

const inactive: readonly [string, WebMissionCard][] = [
  ['absent work', wireCard(makeFullCard({ reviewRound: 3, reviewPhase: 'reviewing' }))],
  ['idle work with a live coordinator', wireCard(makeFullCard({ reviewRound: 3, reviewPhase: 'reviewing', blockingReason: null, liveSession: { missionId: makeFullCard().id, family: agentFamily('codex') } }))],
  ['blocked work with a live coordinator', wireCard(makeFullCard({ reviewRound: 3, reviewPhase: 'fixing', liveSession: { missionId: makeFullCard().id, family: agentFamily('codex') } }))],
  ['stale reviewing', activityCard('review', 'stale')],
  ['stale fixing', activityCard('review-response', 'stale', 'fixing')],
  ['unrelated execute work', activityCard('execute')],
  ['unrelated integration work', activityCard('integrate')],
  ['review work while round is fixing', activityCard('review', 'live', 'fixing')],
  ['fixing work while round is reviewing', activityCard('review-response')],
  ['review work after round approval', activityCard('review', 'live', 'approved')],
  ['review work while awaiting approval', activityCard('review', 'live', 'pending-approval')],
  ['review work without a recorded phase', { ...activityCard('review'), reviewPhase: null }],
];
for (const [state, card] of inactive) {
  test(`review pips stay static for ${state} (TASK-2686)`, () => {
    const html = renderPips(card);
    assert.doesNotMatch(html, /review-pip--running/);
    assert.match(html, /aria-label="review round 3"/);
  });
}
