import test from 'node:test';
import assert from 'node:assert/strict';
import { agentFamily } from '../../../../src/domain/agents.js';
import { missionId } from '../../../../src/domain/mission.js';
import type { BoardProjection } from '../../../../src/application/projections/board.js';
import type { WebMissionCard } from '../../../../src/interfaces/web/transport.js';
import { createSharedProjection } from '../../../../src/interfaces/web/shared-build.js';
import { makeCard, makeProjection } from '../../../fixtures/board-projection.js';
import { flowReferenceProjection } from '../../../fixtures/flow-reference.js';
import { webFreshness, webProjection } from '../../../fixtures/web-projection.js';

/**
 * Bound for the current workflow family alone (stages, attention, actions,
 * wip, operation log, agent availability, source facts, identity, freshness).
 * Historical metrics and mission detail ride their own reads, so this bound
 * never pays for a populated FLOW window.
 */
const WORKFLOW_PAYLOAD_BOUND_BYTES = 64 * 1024;

const CARD_COUNT = 12;
const CHECKPOINT_COUNT = 6;
const REVIEW_ROUND_COUNT = 4;

function representativeProjection(): BoardProjection {
  const cards = Array.from({ length: CARD_COUNT }, (_unused, cardIndex) => makeCard({
    id: missionId(`task-payload-${String(cardIndex).padStart(2, '0')}`),
    lane: 'review', status: 'review', reviewRound: REVIEW_ROUND_COUNT, reviewPhase: 'fixing',
    checkpointEvidence: Array.from({ length: CHECKPOINT_COUNT }, (_checkpoint, checkpointIndex) => ({
      name: `CP-${checkpointIndex + 1}`,
      description: `Checkpoint ${checkpointIndex + 1} for representative mission ${cardIndex}`,
      state: checkpointIndex < 3 ? 'completed' as const : 'future' as const,
      goalCheck: Array.from({ length: 3 }, (_row, rowIndex) => ({
        criterion: `criterion ${rowIndex} for checkpoint ${checkpointIndex}`,
        evidence: `test evidence ${cardIndex}-${checkpointIndex}-${rowIndex} ${'x'.repeat(120)}`,
      })),
    })),
    reviewHistory: Array.from({ length: REVIEW_ROUND_COUNT }, (_round, roundIndex) => ({
      number: roundIndex + 1,
      reviewer: agentFamily('custom'), implementer: agentFamily('codex'), phase: 'fixing' as const,
      disposition: 'REQUEST_CHANGES', comment: `representative review comment ${'y'.repeat(180)}`,
      findingSummaries: [`finding ${roundIndex} ${'z'.repeat(120)}`], pushbacks: [], fixes: [`fix ${roundIndex}`],
    })),
  }));
  return makeProjection({ review: cards });
}

test('common projection delivery keeps representative bulk detail deferred and bytes bounded (PX-0058.04)', async () => {
  const projection = representativeProjection();
  const snapshot = webProjection.snapshot(projection);
  const detailById = new Map(snapshot.stages.flatMap(stage => [...stage.cards, ...stage.historyCards ?? []])
    .map(card => [card.id, webProjection.detail(projection, card.id)] as const));
  const enrich = (card: WebMissionCard) => {
    const detail = detailById.get(card.id)!;
    return { ...card, checkpointEvidence: detail.checkpointEvidence, reviewHistory: detail.reviewHistory };
  };
  const legacyCommon = { ...snapshot, stages: snapshot.stages.map(stage => ({
    ...stage,
    cards: stage.cards.map(enrich),
    ...(stage.historyCards === undefined ? {} : { historyCards: stage.historyCards.map(enrich) }),
  })) };

  const commonBytes = Buffer.byteLength(JSON.stringify(snapshot));
  const legacyBytes = Buffer.byteLength(JSON.stringify(legacyCommon));
  assert.ok(commonBytes < legacyBytes * 0.3,
    `common HTTP snapshot must retain at least 70% reduction: ${commonBytes} vs ${legacyBytes}`);
  assert.ok(commonBytes > 0, 'residual bytes retain card summaries, actions, metrics, identity, and freshness');
  assert.doesNotMatch(JSON.stringify(snapshot), /representative review comment|test evidence/,
    'unopened checkpoint rows and review comments never enter the common snapshot');
  assert.match(JSON.stringify([...detailById.values()]), /representative review comment|test evidence/,
    'the same facts remain available through application-owned detail reads');

  const projectionBytes = Buffer.byteLength(JSON.stringify(projection));
  const repeatedIpcBytes = projectionBytes * 3;
  let builds = 0;
  let sharedIpcBytes = 0;
  const source = createSharedProjection(async () => {
    builds += 1;
    sharedIpcBytes += projectionBytes;
    return projection;
  }, value => webFreshness(value).revision ?? '');
  await Promise.all([source.read(), source.read(), source.read()]);
  assert.equal(builds, 1, 'three concurrent clients reuse one completed projection');
  assert.ok(sharedIpcBytes <= repeatedIpcBytes * 0.34,
    `one retained completion must cut identical three-client IPC bytes by at least 66%: ${sharedIpcBytes} vs ${repeatedIpcBytes}`);
});

test('the current workflow payload carries no historical metrics and stays bounded (TASK-2854.04)', () => {
  // Representative populated workload: bulk card detail on the workflow side
  // and a fully populated FLOW window on the historical side.
  const populated = { ...representativeProjection(), metrics: flowReferenceProjection().metrics };
  const snapshot = webProjection.snapshot(populated);
  const workflowBytes = Buffer.byteLength(JSON.stringify(snapshot));
  const historicalBytes = Buffer.byteLength(JSON.stringify(populated.metrics));

  assert.ok(!('metrics' in snapshot),
    'historical metrics ride their own read path; the current workflow payload never carries them');
  assert.ok(historicalBytes > workflowBytes,
    `the representative workload really is dominated by historical metrics: ${workflowBytes} vs ${historicalBytes}`);
  assert.ok(workflowBytes <= WORKFLOW_PAYLOAD_BOUND_BYTES,
    `current workflow family stays within its bound: ${workflowBytes} > ${WORKFLOW_PAYLOAD_BOUND_BYTES}`);
});
