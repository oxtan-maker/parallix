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
