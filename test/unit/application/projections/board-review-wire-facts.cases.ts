import { webProjection } from '../../../fixtures/web-projection.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFullCard, makeProjection } from '../../../fixtures/board-projection.js';
import { agentFamily } from '../../../../src/domain/agents.js';
import type { ReviewRoundSummary } from '../../../../src/application/projections/mission-board.js';
import { MissionId } from '../../../../src/domain/mission.js';

/**
 * Red reproduction for TASK-2447: the shared MissionCard carries the
 * server-owned pull-request reference, review approval, and review history,
 * but the versioned web transport dropped them from the wire card, so the
 * browser cannot truthfully render the checkpoint indicator's PR line or the
 * review round meter. The common card retains the attempt identity and
 * disposition needed by that meter; the full source rounds survive through
 * the on-demand mission-detail read.
 */

const reviewHistory: readonly ReviewRoundSummary[] = [
  {
    number: 1,
    reviewer: agentFamily('codex'),
    implementer: agentFamily('custom'),
    phase: 'fixing',
    disposition: 'REQUEST_CHANGES',
    comment: 'Two findings on the gate wiring.',
    findingSummaries: ['transport.ts: missing validation for review fields'],
    pushbacks: [],
    fixes: [],
  },
  {
    number: 2,
    reviewer: agentFamily('claude'),
    implementer: agentFamily('custom'),
    phase: 'reviewing',
    disposition: null,
    comment: null,
    findingSummaries: ['web card omits the PR link'],
    pushbacks: ['F-2: url is null for a local review surface'],
    fixes: ['F-1: projected pullRequest one-to-one'],
  },
];

test('wire board card carries review summaries and on-demand detail from the MissionCard', () => {
  const card = makeFullCard({ reviewHistory });

  const projection = makeProjection({ review: [card] });
  const snapshot = webProjection.snapshot(projection);
  const parsed = JSON.parse(JSON.stringify(snapshot)) as typeof snapshot;
  const wire = parsed.stages.flatMap((stage) => stage.cards).find((c) => c.id === card.id);
  assert.ok(wire !== undefined, 'the card must appear in the wire snapshot');

  assert.deepStrictEqual(wire.pullRequest, card.pullRequest, 'wire pullRequest must equal the source reference');
  assert.strictEqual(wire.reviewApproved, card.reviewApproved, 'wire reviewApproved must equal the source');
  assert.deepStrictEqual(wire.reviewHistory, card.reviewHistory.map(({ number, disposition }) => ({ number, disposition })),
    'common wire reviewHistory must retain only the attempt identity and outcome');
  assert.deepStrictEqual(webProjection.detail(projection, card.id).reviewHistory, card.reviewHistory,
    'on-demand detail must retain every source review fact');
});
