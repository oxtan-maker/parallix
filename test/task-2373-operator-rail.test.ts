import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'ink';
import { BoardShell } from '../src/interfaces/tui/shell.js';
import { makeAttentionItem, makeCard, makeProjection } from './fixtures/board-projection.js';

test('SC15: WORKING count either renders every live mission or states the hidden overflow', () => {
  const cards = Array.from({ length: 4 }, (_unused, index) => makeCard({
    id: `task-working-${index + 1}` as never,
    currentWork: {
      operationId: `work-${index + 1}`,
      phase: 'execute',
      summary: 'working',
      agent: 'qwen' as never,
      updatedAt: new Date().toISOString(),
      freshness: 'live',
    },
  }));
  const output = renderToString(React.createElement(BoardShell, {
    projection: makeProjection({ active: cards }), columns: 120, rows: 30,
  }), { columns: 120 });

  // The invented `WORKING` label is gone; the rail still shows the count as its
  // own row (the only rail row that begins with a digit) plus the overflow.
  assert.doesNotMatch(output, /WORKING/);
  assert.match(output, /^│ 4/m);
  assert.match(output, /\+1 more/);
});

test('SC16: bounded recovery evidence remains visibly WORKING with an uncertainty label', () => {
  const card = makeCard({
    id: 'task-recovery' as never,
    liveSession: { missionId: 'task-recovery' as never, family: 'qwen' as never },
  });
  const output = renderToString(React.createElement(BoardShell, {
    projection: makeProjection({ active: [card] }), columns: 120, rows: 30,
  }), { columns: 200 });

  assert.doesNotMatch(output, /WORKING/);
  assert.match(output, /^│ 1/m);
  assert.match(output, /task-recovery · recovery[\s\S]*evidence · qwen/);
});

test('SC17 and SC18: unavailable review and integration actions never render a green runnable affordance', () => {
  const review = makeCard({ id: 'task-review' as never, lane: 'review', status: 'review' });
  const integration = makeCard({ id: 'task-integrate' as never, lane: 'integration', status: 'integration' });
  const projection = makeProjection({ review: [review], integration: [integration] });
  const output = renderToString(React.createElement(BoardShell, {
    projection: {
      ...projection,
      attentionQueue: [
        makeAttentionItem(review, { kind: 'review-lane', detail: 'Awaiting review decision' }, 2),
        makeAttentionItem(integration, { kind: 'integrate-lane', detail: 'Awaiting integration' }, 3),
      ],
    },
    columns: 200,
    rows: 30,
  }), { columns: 200 });

  assert.match(output, /\$ px review task-review[\s\S]*unavailable/);
  assert.match(output, /\$ px integrate task-integrate[\s\S]*unavailable/);
  assert.doesNotMatch(output, /px (?:review|integrate) task-(?:review|integrate)\s+run ▶/);
});
