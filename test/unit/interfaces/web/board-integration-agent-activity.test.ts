import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Board } from '../../../../web/src/board.js';
import { toWebBoardSnapshot } from '../../../../src/interfaces/web/transport.js';
import { agentFamily } from '../../../../src/domain/agents.js';
import { makeCard, makeProjection } from '../../../fixtures/board-projection.js';

function render(agent: string | null, phase = 'integrate'): string {
  const card = makeCard({
    id: 'task-2576' as never,
    lane: 'integration',
    status: 'integration',
    agent: null,
    currentWork: {
      operationId: `${phase}:task-2576`, phase, summary: `${phase} in progress`,
      agent: agent === null ? null : agentFamily(agent), updatedAt: new Date().toISOString(), freshness: 'live',
    },
    liveSession: { missionId: 'task-2576' as never, family: agentFamily('codex') },
  });
  return renderToStaticMarkup(React.createElement(Board, {
    snapshot: toWebBoardSnapshot(makeProjection({ integration: [card] })),
    onRefresh: async () => {},
  }));
}

test('TASK-2576: deterministic integration work is progress, not running-agent activity', () => {
  const deterministic = render(null);
  const liveAgent = render('codex', 'execute');

  assert.doesNotMatch(deterministic, /working · live/, 'deterministic work omits redundant header signals');
  assert.equal((deterministic.match(/fan spin/g) ?? []).length, 2, 'fans show work even when no agent is identified');
  assert.doesNotMatch(deterministic, /no implementer/, 'an unidentified agent has no implementer label');
  assert.doesNotMatch(deterministic, /class="live-indicator"/, 'a live coordinator does not mean an agent is running');
  assert.doesNotMatch(deterministic, /active worker family: codex/, 'a coordinator family is not a running-agent identity');
  assert.doesNotMatch(liveAgent, /class="live-indicator"|working · live/);
  assert.equal((liveAgent.match(/fan spin/g) ?? []).length, 2);
  assert.match(liveAgent, /active worker family: codex/, 'an observed agent session supplies the running-agent identity');
});
