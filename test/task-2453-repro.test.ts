import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { toWebBoardSnapshot } from '../src/interfaces/web/transport.js';
import { isSpinning } from '../web/src/format.js';
import { ActionButton } from '../web/src/action-button.js';
import { makeCard, makeProjection } from './fixtures/board-projection.js';
import { agentFamily } from '../src/domain/agents.js';
import { agentIsWorking } from '../src/application/projections/mission-board.js';

test('TASK-2453 SC1: deterministic integration does not spin the web fan', () => {
  const card = makeCard({
    currentWork: {
      operationId: 'integrate-1', phase: 'integrate', summary: 'running integration gates',
      agent: null, updatedAt: '2026-09-05T00:00:00.000Z', freshness: 'unverified',
    },
    liveSession: { missionId: 'task-9999' as never, family: agentFamily('codex') },
  });
  const snapshot = toWebBoardSnapshot({ ...makeProjection({ integration: [card] }), attentionQueue: [], operationLog: [] });
  const webCard = snapshot.stages.flatMap((stage) => stage.cards).find((candidate) => candidate.id === card.id);

  assert.ok(webCard, 'the authoritative current-work fact must reach the web projection');
  assert.equal(isSpinning(webCard), false);
});

test('TASK-2453 SC3: a pending action changes from starting to working with current-work', () => {
  const action = { kind: 'integrate:merge' as const, display: 'px integrate task-2453', state: 'enabled' as const, reason: null, targetLane: 'integration' as const };

  assert.match(renderToStaticMarkup(React.createElement(ActionButton, { action, pending: true })), /starting…/);
  assert.match(renderToStaticMarkup(React.createElement(ActionButton, { action, pending: true, working: true })), /working…/);
});

test('TASK-2453 SC2/SC4: web session activity stays separate from Ink work freshness', () => {
  for (const [freshness, expected] of [['live', true], ['unverified', true], ['stale', false]] as const) {
    const card = makeCard({
      currentWork: {
        operationId: `execute-${freshness}`, phase: 'execute', summary: 'implementer running',
        agent: agentFamily('codex'), updatedAt: '2026-09-05T00:00:00.000Z', freshness,
      },
      liveSession: { missionId: 'task-9999' as never, family: agentFamily('codex') },
    });
    const snapshot = toWebBoardSnapshot({ ...makeProjection({ integration: [card] }), attentionQueue: [], operationLog: [] });
    const webCard = snapshot.stages.flatMap((stage) => stage.cards).find((candidate) => candidate.id === card.id);

    assert.ok(webCard);
    assert.equal(isSpinning(webCard), expected, `web session ${freshness}`);
    assert.equal(agentIsWorking(card), expected, `Ink ${freshness}`);
  }
  const cleared = makeCard({ currentWork: null });
  const snapshot = toWebBoardSnapshot({ ...makeProjection({ integration: [cleared] }), attentionQueue: [], operationLog: [] });
  const webCard = snapshot.stages.flatMap((stage) => stage.cards).find((candidate) => candidate.id === cleared.id);

  assert.ok(webCard);
  assert.equal(isSpinning(webCard), false, 'web cleared');
  assert.equal(agentIsWorking(cleared), false, 'Ink cleared');
});
