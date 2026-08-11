import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildMetrics } from '../src/application/projections/metrics.js';
import type { BoardMetrics } from '../src/application/projections/board.js';
import { weeklyDecisionWindows } from '../src/application/services/decision-window.js';
import {
  CURRENT_WINDOW_LABEL,
  NOW,
  PREVIOUS_WINDOW_LABEL,
  contaminatedHistory,
} from './fixtures/task-2363-decision-window-fixture.js';

const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, 'g');
const plain = (value: string): string => value.replace(ANSI, '');

// ---------------------------------------------------------------------------
// TASK-2363 — FLOW makes the decision window visible, and formats only.
// ---------------------------------------------------------------------------

function metrics(): BoardMetrics {
  const history = contaminatedHistory();
  return buildMetrics({
    initialStates: history.initialStates,
    transitions: history.transitions,
    outcomes: history.outcomes,
    instants: [NOW],
    asOf: NOW,
    decisionWindows: weeklyDecisionWindows(NOW),
  }) as BoardMetrics;
}

async function render(columns: number): Promise<string> {
  const ink = await import('ink');
  const React = await import('react');
  const { FlowPanel } = await import('../src/interfaces/tui/flow-panel.js');
  return plain(ink.renderToString(
    React.createElement(FlowPanel, { metrics: metrics(), columns }),
    { columns },
  ));
}

describe('TASK-2363: FLOW renders the weekly decision window', () => {
  it('shows the current rolling-7-day date range in the header', async () => {
    const output = await render(200);
    assert.ok(
      output.includes(`decision window ${CURRENT_WINDOW_LABEL}`),
      `FLOW must name the current window. Got: ${output}`,
    );
  });

  it('shows the previous window beside the current one', async () => {
    const output = await render(200);
    assert.ok(output.includes(`current ${CURRENT_WINDOW_LABEL}`), output);
    assert.ok(output.includes(`previous ${PREVIOUS_WINDOW_LABEL}`), output);
  });

  it('shows the observation count for each main decision metric', async () => {
    const output = await render(200);
    // 31 completed in the current window, 28 in the previous one.
    assert.match(output, /Completed missions\s+n=31\s+n=28/);
    assert.match(output, /Lifecycle cycle median\s+40 min \(n=31\)\s+140\.5 min \(n=28\)/);
    assert.match(output, /Agent runtime median\s+15 min \(n=11\)/);
    // 5 of 31 current-window missions bounced once: 0.16.
    assert.match(output, /Review bounce rate\s+0\.16 \(n=31\)\s+1\.00 \(n=28\)/);
  });

  it('does not present the all-history population as the decision sample', async () => {
    const output = await render(200);
    assert.match(output, /population n=\d+ \(all recorded history, not the decision sample\)/);
  });

  it('separates current-state flow from completed-mission decision metrics', async () => {
    const output = await render(200);
    assert.ok(output.includes('DECISION WINDOW · completed missions'), output);
    assert.ok(output.includes('CURRENT FLOW · state now'), output);
    assert.ok(output.indexOf('DECISION WINDOW') < output.indexOf('CURRENT FLOW'), output);
  });

  it('keeps every decision figure readable in the narrow layout', async () => {
    const output = await render(60);
    assert.ok(output.includes('FLOW · textual'), output);
    // Ink wraps at 60 columns, so assert the parts rather than one unbroken line.
    assert.match(output, /Lifecycle cycle median: 40 min \(n=31\)/);
    assert.match(output, /previous 140\.5 min\s*\(n=28\)/);
  });

  it('calculates no statistics in the panel', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      new URL('../src/interfaces/tui/flow-panel.tsx', import.meta.url),
      'utf8',
    );
    // FLOW formats projection-supplied figures. Any of these would mean it had
    // started deciding what the figures are.
    for (const forbidden of ['.filter(', '.sort(', '.reduce(', 'Date.parse', 'setUTCDate']) {
      assert.ok(
        !source.includes(forbidden),
        `flow-panel.tsx must not compute statistics; found ${forbidden}`,
      );
    }
  });
});
