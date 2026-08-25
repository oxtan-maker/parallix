import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'ink';
import { BoardShell } from '../src/interfaces/tui/shell.js';
import { makeAttentionItem, makeCard, makeProjection } from './fixtures/board-projection.js';
import type { AgentAvailabilityMetric } from '../src/application/projections/board.js';

// ---------------------------------------------------------------------------
// Reproduction for task-2408: the operator rail must not render unsupported
// content above its heading, and the agent strip must not leak a raw persisted
// agent-block reason into the operator view.
//
// Rendered on the mission parent commit both assertions fail (red): the rail
// carries a live-work count and the `task-… · phase · agent` working row above
// `▲ NEEDS YOU NEXT`, and the family's stored reason (a quota-matching regular
// expression) is rendered verbatim on the strip. After the display-boundary
// repair both pass (green).
// ---------------------------------------------------------------------------

/** The raw stored reason that must never reach the operator view. */
const RAW_REASON =
  'parsed: (?:\\b429\\b[^\\n]*?\\bAllocated quota exceeded\\b|\\bQuota exhausted:[\\s\\S]{0,500}\\bcause:\\s*insufficient_quota:\\s*429\\b)';

const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, 'g');
const plain = (value: string): string => value.replace(ANSI, '');

function makeUnavailableAgent(): AgentAvailabilityMetric {
  return {
    family: 'qwen' as never,
    available: false,
    blockedForMs: 0,
    reason: RAW_REASON,
    runningSessions: 1,
  };
}

function renderBoard(): string {
  const live = makeCard({
    id: 'task-2406' as never,
    currentWork: {
      operationId: 'work-1',
      phase: 'execute',
      summary: 'working',
      agent: 'codex' as never,
      updatedAt: new Date().toISOString(),
      freshness: 'live',
    },
  });
  const attention = makeCard({ id: 'task-9000' as never, lane: 'review', status: 'review' });
  const base = makeProjection({ active: [live] });
  const projection = {
    ...base,
    metrics: { ...base.metrics, agentAvailability: [makeUnavailableAgent()] },
    attentionQueue: [
      makeAttentionItem(attention, { kind: 'review-lane', detail: 'Awaiting review decision' }, 1),
    ],
  };

  return plain(
    renderToString(React.createElement(BoardShell, { projection, columns: 120, rows: 30 }), {
      columns: 120,
    }),
  );
}

test('task-2408: the operator rail begins with ▲ NEEDS YOU NEXT and shows no live-work rows', () => {
  const output = renderBoard();

  // The rail's first content is exactly the heading with the attention count.
  assert.match(output, /▲ NEEDS YOU NEXT 1/, `rail must begin with the attention heading`);
  // No live-work count or `task-… · phase · agent` row precedes the heading.
  assert.doesNotMatch(output, /task-2406 · execute · codex/, `no working row may precede the heading`);
  // Supported behaviour is retained: the attention item and ranking footer stay.
  assert.match(output, /task-9000/, `the attention mission must remain`);
  assert.match(output, /ranked: integrate>review>active/, `the ranking footer must remain`);
});

test('task-2408: a raw persisted agent-block reason is not rendered on the agent strip', () => {
  const output = renderBoard();

  assert.ok(!output.includes('parsed:'), `the raw reason must not leak. Got:\n${output}`);
  // The family still renders as unavailable with its liveness evidence.
  assert.match(output, /qwen/, `the unavailable family must still be named`);
  assert.match(output, /px cmd live/, `the family's px cmd liveness evidence must remain`);
  // The authoritative work summary stays in the agent strip.
  assert.match(output, /work: 1 live/, `the agent-strip work summary must remain`);
});
