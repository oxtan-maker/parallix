import { webProjection } from '../../../fixtures/web-projection.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateWebBoardSnapshot } from '../../../../src/interfaces/web/transport.js';
import { makeFullCard, makeProjection } from '../../../fixtures/board-projection.js';
import type { MissionCard } from '../../../../src/application/projections/mission-board.js';

function payloadFor(card: MissionCard): Record<string, unknown> {
  return JSON.parse(JSON.stringify(webProjection.snapshot(makeProjection({ [card.lane]: [card] }))));
}

function cardPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const stages = payload.stages as Record<string, unknown>[];
  return stages.flatMap(stage => stage.cards as Record<string, unknown>[])[0];
}

const budget = { attemptsUsed: 2, maxAttempts: 2, exhausted: true };

const hit = { actionSequence: 40, limit: 40, recordedAt: '2026-11-23T10:00:00.000Z' };

test('review actions and repair budget travel as separate card facts (TASK-2845, TASK-2859.21)', () => {
  const payload = payloadFor(makeFullCard({ reviewRound: 6, reviewActions: { used: 40, limit: 40, limitHit: hit }, repairBudget: budget }));
  const validation = validateWebBoardSnapshot(payload);
  assert.equal(validation.ok, true);
  if (!validation.ok) { return; }
  const card = validation.value.stages.flatMap(stage => stage.cards)[0];
  assert.equal(card.reviewRound, 6);
  assert.deepEqual(card.reviewActions, { used: 40, limit: 40, limitHit: hit });
  assert.deepEqual(card.repairBudget, budget);
});
test('unknown review actions stay null and an absent repair budget is not inferred from reviewRound (TASK-2845, TASK-2859.21)', () => {
  const payload = payloadFor(makeFullCard({ reviewRound: 6, reviewActions: null }));
  const card = cardPayload(payload);
  delete card.repairBudget;
  const validation = validateWebBoardSnapshot(payload);
  assert.equal(validation.ok, true);
  if (!validation.ok) { return; }
  const validated = validation.value.stages.flatMap(stage => stage.cards)[0];
  assert.equal(validated.reviewActions, null);
  assert.equal(validated.repairBudget, undefined);
});

test('malformed budget facts fail closed (TASK-2845)', () => {
  const basePayload = payloadFor(makeFullCard({ reviewRound: 6 }));
  const base = cardPayload(basePayload);
  const actions = { used: 3, limit: 40, limitHit: null };
  const missingActions = payloadFor(makeFullCard({ reviewRound: 6 }));
  delete cardPayload(missingActions).reviewActions;
  assert.equal(validateWebBoardSnapshot(missingActions).ok, false, 'transport v5 requires the review-actions fact');
  for (const reviewActions of [
    { ...actions, used: -1 },
    { ...actions, used: 1.5 },
    { ...actions, used: '3' },
    { ...actions, limit: 0 },
    { ...actions, limit: 2.5 },
    { ...actions, limit: undefined },
    { used: 3, limit: 40 },
    { ...actions, extra: true },
    { ...actions, limitHit: { ...hit, actionSequence: 0 } },
    { ...actions, limitHit: { ...hit, limit: 0 } },
    { ...actions, limitHit: { ...hit, recordedAt: 'yesterday' } },
    { ...actions, limitHit: { ...hit, actionSequence: 39 } },
    { used: 39, limit: 40, limitHit: hit },
    { ...actions, limitHit: 'yes' },
    'reached',
  ]) {
    const payload = payloadFor(makeFullCard({ reviewRound: 6 }));
    payload.stages = [{ lane: 'review', count: 1, cards: [{ ...base, reviewActions }] }];
    assert.equal(validateWebBoardSnapshot(payload).ok, false, JSON.stringify(reviewActions));
  }
  for (const repairBudget of [
    { ...budget, attemptsUsed: -1 },
    { ...budget, attemptsUsed: 1.5 },
    { ...budget, attemptsUsed: 3 },
    { ...budget, maxAttempts: 0 },
    { ...budget, exhausted: false },
    { attemptsUsed: 1, maxAttempts: 2, exhausted: true },
  ]) {
    const payload = payloadFor(makeFullCard({ reviewRound: 6 }));
    payload.stages = [{ lane: 'review', count: 1, cards: [{ ...base, repairBudget }] }];
    assert.equal(validateWebBoardSnapshot(payload).ok, false);
  }
});

test('review actions accept an unknown limit and never infer a limit hit from the count (TASK-2859.21)', () => {
  for (const reviewActions of [null, { used: 0, limit: null, limitHit: null }, { used: 40, limit: 40, limitHit: null }]) {
    const payload = payloadFor(makeFullCard({ reviewRound: 6, reviewActions }));
    const validation = validateWebBoardSnapshot(payload);
    assert.equal(validation.ok, true, JSON.stringify(reviewActions));
    if (validation.ok) { assert.deepEqual(validation.value.stages.flatMap(stage => stage.cards)[0].reviewActions, reviewActions); }
  }
});
