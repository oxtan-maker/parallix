import test from 'node:test';
import assert from 'node:assert/strict';
import { toWebBoardSnapshot, validateWebBoardSnapshot } from '../../../../src/interfaces/web/transport.js';
import { makeFullCard, makeProjection } from '../../../fixtures/board-projection.js';
import type { MissionCard } from '../../../../src/application/projections/mission-board.js';

function payloadFor(card: MissionCard): Record<string, unknown> {
  return JSON.parse(JSON.stringify(toWebBoardSnapshot(makeProjection({ [card.lane]: [card] }))));
}

function cardPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const stages = payload.stages as Record<string, unknown>[];
  return stages.flatMap(stage => stage.cards as Record<string, unknown>[])[0];
}

const budget = { attemptsUsed: 2, maxAttempts: 2, exhausted: true };

test('review allowance and repair budget travel as separate card facts (TASK-2845)', () => {
  const payload = payloadFor(makeFullCard({ reviewRound: 6, reviewWindowAllowance: 5, repairBudget: budget }));
  const validation = validateWebBoardSnapshot(payload);
  assert.equal(validation.ok, true);
  if (!validation.ok) { return; }
  const card = validation.value.stages.flatMap(stage => stage.cards)[0];
  assert.equal(card.reviewRound, 6);
  assert.equal(card.reviewWindowAllowance, 5);
  assert.deepEqual(card.repairBudget, budget);
});
test('absent budget facts stay absent instead of being inferred from reviewRound (TASK-2845)', () => {
  const payload = payloadFor(makeFullCard({ reviewRound: 6 }));
  const card = cardPayload(payload);
  delete card.reviewWindowAllowance;
  delete card.repairBudget;
  const validation = validateWebBoardSnapshot(payload);
  assert.equal(validation.ok, true);
  if (!validation.ok) { return; }
  assert.equal(validation.value.stages.flatMap(stage => stage.cards)[0].repairBudget, undefined);
});

test('malformed budget facts fail closed (TASK-2845)', () => {
  const basePayload = payloadFor(makeFullCard({ reviewRound: 6 }));
  const base = cardPayload(basePayload);
  for (const reviewWindowAllowance of [0, -1, 2.5, '5']) {
    const payload = payloadFor(makeFullCard({ reviewRound: 6 }));
    payload.stages = [{ lane: 'review', count: 1, cards: [{ ...base, reviewWindowAllowance }] }];
    assert.equal(validateWebBoardSnapshot(payload).ok, false);
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
