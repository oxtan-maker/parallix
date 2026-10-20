import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { FlightColumn } from '../../../web/src/flight-column.js';
import { toWebBoardSnapshot, validateWebBoardSnapshot } from '../../../src/interfaces/web/transport.js';
import { agentFamily } from '../../../src/domain/agents.js';
import { makeFullCard, makeProjection } from '../../fixtures/board-projection.js';
import type { ReviewDisposition } from '../../../src/domain/review.js';
import type { ReviewPhase } from '../../../src/domain/review-phase-policy.js';
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

test('a recorded review disposition stays off the reserved action green (TASK-2666)', () => {
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

  assert.deepEqual(states(html), ['approved', 'changes-requested', 'current']);
  assert.ok(!attempts(html).some((tag) => tag.includes('#5ee08a')), 'green marks only an actionable control or a passed gate');
  assert.doesNotMatch(html, /future attempts|of 5/, 'rounds that may not happen are not announced');
});

test('the attempt budget stays absent without a review round (TASK-2666)', () => {
  const html = renderPips(wireCard(makeFullCard({ reviewRound: null, reviewPhase: null, reviewHistory: [] })));

  assert.doesNotMatch(html, /aria-label="Review attempts|round \d+ of 5/);
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
    test(`only the card fans turn for ${freshness} ${phase} work (TASK-2686)`, () => {
      const html = renderPips(activityCard(phase, freshness, reviewPhase));

      assert.equal((html.match(/class="fan spin"/g) ?? []).length, 2, 'the fans carry the server work fact');
      assert.doesNotMatch(html, /review-pip--running|blink/);
      assert.deepEqual(states(html), ['unknown-outcome', 'unknown-outcome', 'current']);
    });
  }
}

/*
 * TASK-2773.05 — the review attempt budget is a countdown of five attempts, not
 * a progress bar. These cases pin the contract the presentation may and may not
 * claim from the supplied round facts.
 */

function reviewCard(overrides: Partial<MissionCard>): WebMissionCard {
  return wireCard(makeFullCard({ blockingReason: null, ...overrides }));
}

function round(number: number, disposition: ReviewDisposition | null): MissionCard['reviewHistory'][number] {
  return { number, reviewer: agentFamily('codex'), implementer: agentFamily('custom'), phase: 'reviewing', disposition, comment: null, findingSummaries: [], pushbacks: [], fixes: [] };
}

function attempts(html: string): string[] {
  return html.match(/<span[^>]*data-review-attempt="\d+"[^>]*>[\s\S]*?<\/span>/g) ?? [];
}

function marks(html: string): string {
  return attempts(html).join('');
}

function unknownRoundText(html: string): string {
  return /data-review-round="unknown"[^>]*>([^<]*)</.exec(html)?.[1] ?? '';
}

function states(html: string): string[] {
  return attempts(html).map((tag) => /data-review-state="([^"]+)"/.exec(tag)?.[1] ?? 'missing');
}

function labels(html: string): string[] {
  return attempts(html).map((tag) => /aria-label="([^"]+)"/.exec(tag)?.[1] ?? 'missing');
}

for (const roundNumber of [1, 2, 3, 4, 5]) {
  test(`round ${roundNumber} draws only the attempts so far, no future rounds (TASK-2773.05)`, () => {
    const html = renderPips(reviewCard({
      reviewRound: roundNumber,
      reviewPhase: 'reviewing',
      reviewHistory: Array.from({ length: roundNumber }, (_unused, index) => round(index + 1, null)),
    }));

    assert.equal(attempts(html).length, roundNumber, 'only attempts that happened are drawn');
    assert.doesNotMatch(html, /future attempts|round \d+ of 5|not yet used/, 'no future round is announced');
  });
}

test('round 5 draws five attempts and announces nothing further while the fifth is active (TASK-2773.05)', () => {
  const html = renderPips(reviewCard({
    reviewRound: 5,
    reviewPhase: 'reviewing',
    currentWork: { operationId: 'review-op', phase: 'review', summary: 'reviewing', agent: agentFamily('codex'), updatedAt: '2026-10-08T00:00:00Z', freshness: 'live' },
    reviewHistory: Array.from({ length: 5 }, (_unused, index) => round(index + 1, index === 4 ? null : 'REQUEST_CHANGES')),
  }));

  assert.equal(attempts(html).length, 5);
  assert.doesNotMatch(html, /future attempts|round 5 of 5/);
  assert.deepEqual(states(html), ['changes-requested', 'changes-requested', 'changes-requested', 'changes-requested', 'current']);
  assert.doesNotMatch(html, /exhausted|budget spent|no attempts left|terminated|failed review/i, 'an empty budget is not a lifecycle verdict');
});

test('recorded dispositions stay visible on past and current rounds through glyph and text (TASK-2773.05)', () => {
  const html = renderPips(reviewCard({
    reviewRound: 3,
    reviewPhase: 'approved',
    reviewDisposition: 'APPROVED',
    reviewHistory: [round(1, 'APPROVED'), round(2, 'REQUEST_CHANGES'), round(3, 'APPROVED')],
  }));

  assert.deepEqual(states(html), ['approved', 'changes-requested', 'approved']);
  assert.match(marks(html), /✓/);
  assert.match(marks(html), /✗/);
  assert.ok(!attempts(html).some((tag) => tag.includes('#5ee08a')), 'a review outcome never borrows the action green');
  assert.deepEqual(labels(html), [
    'attempt 1: outcome recorded: approved',
    'attempt 2: outcome recorded: changes requested',
    'attempt 3: outcome recorded: approved',
  ]);
  assert.ok(!attempts(html).some((tag) => tag.includes('#5ee08a')), 'a review outcome never borrows the action green');
});

test('a current attempt without a recorded disposition is distinct from a recorded one (TASK-2773.05)', () => {
  const html = renderPips(reviewCard({
    reviewRound: 2,
    reviewPhase: 'reviewing',
    reviewDisposition: null,
    reviewHistory: [round(1, 'REQUEST_CHANGES'), round(2, null)],
  }));

  assert.deepEqual(states(html), ['changes-requested', 'current']);
  assert.match(labels(html)[1], /current attempt, no outcome recorded/);
  assert.notEqual(attempts(html)[1], attempts(html)[0]);
});

test('missing history never invents an outcome for a past attempt (TASK-2773.05)', () => {
  const html = renderPips(reviewCard({ reviewRound: 3, reviewPhase: 'reviewing', reviewDisposition: null, reviewHistory: [] }));

  assert.deepEqual(states(html), ['unknown-outcome', 'unknown-outcome', 'current']);
  assert.match(labels(html)[0], /outcome not recorded/);
  assert.match(labels(html)[1], /outcome not recorded/);
  assert.doesNotMatch(marks(html), /approved|✓|✗/i, 'a round number alone is not an outcome');
});

test('a past round whose disposition is null stays unknown (TASK-2773.05)', () => {
  const html = renderPips(reviewCard({
    reviewRound: 2,
    reviewPhase: 'reviewing',
    reviewHistory: [{ ...round(1, null), phase: 'approved' satisfies ReviewPhase }],
  }));

  assert.deepEqual(states(html), ['unknown-outcome', 'current']);
  assert.match(labels(html)[0], /outcome not recorded/);
});

test('a disposition outside the two named outcomes is shown verbatim, not as approval (TASK-2773.05)', () => {
  const html = renderPips(reviewCard({ reviewRound: 2, reviewPhase: 'reviewing', reviewHistory: [round(1, 'PARKED')] }));

  assert.deepEqual(states(html), ['recorded', 'current']);
  assert.match(labels(html)[0], /outcome recorded: PARKED/);
  assert.doesNotMatch(labels(html)[0], /approved/i);
});

for (const invalid of [0, 6, -1, 2.5, 99]) {
  test(`an out-of-range or fractional round ${invalid} is unknown, never a relabeled budget (TASK-2773.05)`, () => {
    const html = renderPips(reviewCard({ reviewRound: invalid, reviewPhase: 'reviewing', reviewHistory: [round(1, 'APPROVED')] }));

    assert.equal(attempts(html).length, 0, 'no attempt circles are drawn for a round the budget cannot hold');
    assert.match(html, /review round unknown/);
    assert.doesNotMatch(html, /round \d+ of 5|future attempts remaining/);
    assert.doesNotMatch(unknownRoundText(html), /\d/, 'no clamped round and no negative remaining count is printed');
    assert.doesNotMatch(marks(html), /approved/i, 'no invented approval');
  });
}

test('an absent review round stays absent without a fabricated budget (TASK-2773.05)', () => {
  const html = renderPips(reviewCard({ reviewRound: null, reviewPhase: null, reviewDisposition: null, reviewHistory: [] }));

  assert.equal(attempts(html).length, 0);
  assert.doesNotMatch(html, /round \d+ of 5|future attempts remaining|review round unknown/);
});

test('review and checkpoint indicators never blink (TASK-2773.05)', () => {
  const html = renderPips(reviewCard({
    reviewRound: 2,
    reviewPhase: 'reviewing',
    currentWork: { operationId: 'review-op', phase: 'review', summary: 'reviewing', agent: agentFamily('codex'), updatedAt: '2026-10-08T00:00:00Z', freshness: 'live' },
    reviewHistory: [round(1, 'REQUEST_CHANGES'), round(2, null)],
  }));

  assert.doesNotMatch(html, /review-pip--running|blink/);
  for (const tag of attempts(html)) {
    assert.doesNotMatch(tag, /animation/, `attempt circle carries an animation: ${tag}`);
  }
  const css = readFileSync(new URL('../../../web/src/style.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /@keyframes blink|review-pip--running/, 'the blink keyframe is gone, not merely unused');
  assert.match(css, /@keyframes spin/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.fan\.spin[\s\S]*?animation: none/);
});

test('fans keep server-backed liveness and reduced-motion support (TASK-2773.05)', () => {
  const live = renderPips(reviewCard({
    reviewRound: 2,
    reviewPhase: 'reviewing',
    currentWork: { operationId: 'review-op', phase: 'review', summary: 'reviewing', agent: agentFamily('codex'), updatedAt: '2026-10-08T00:00:00Z', freshness: 'live' },
    reviewHistory: [round(1, 'REQUEST_CHANGES')],
  }));
  const stale = renderPips(reviewCard({
    reviewRound: 2,
    reviewPhase: 'reviewing',
    currentWork: { operationId: 'review-op', phase: 'review', summary: 'reviewing', agent: agentFamily('codex'), updatedAt: '2026-10-08T00:00:00Z', freshness: 'stale' },
    reviewHistory: [round(1, 'REQUEST_CHANGES')],
  }));

  assert.equal((live.match(/class="fan spin"/g) ?? []).length, 2, 'both card fans follow the server work fact');
  assert.equal((live.match(/animation-duration:/g) ?? []).length, 2);
  assert.doesNotMatch(stale, /class="fan spin"/);
  assert.doesNotMatch(stale, /animation-duration:/);
});

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
  test(`the attempt budget reads the same for ${state} (TASK-2686)`, () => {
    const html = renderPips(card);

    assert.doesNotMatch(html, /review-pip--running|blink/);
    for (const tag of attempts(html)) {
      assert.doesNotMatch(tag, /animation/, `attempt circle carries an animation: ${tag}`);
    }
    assert.match(html, /aria-label="Review attempts"/);
    assert.deepEqual(states(html), ['unknown-outcome', 'unknown-outcome', 'current'],
      'work state cannot change what the attempt budget claims');
  });
}

test('review status prose is not printed beside the PR link and attempt icons (TASK-2773.05)', () => {
  const html = renderPips(reviewCard({
    reviewRound: 2,
    reviewPhase: 'fixing',
    reviewDisposition: 'REQUEST_CHANGES',
    reviewHistory: [round(1, 'REQUEST_CHANGES'), round(2, 'REQUEST_CHANGES')],
  }));
  const visible = html.replace(/<[^>]*>/g, ' ');

  assert.doesNotMatch(visible, /REQUEST_CHANGES|fixing|reviewing/i, 'icons carry the status; no prose repeats it');
  assert.match(html, /aria-label="attempt 2: outcome recorded: changes requested"/, 'the icon keeps its accessible description');
});
