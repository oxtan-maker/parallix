/**
 * SC1/SC2/SC5/SC7 — LaneColumn and MissionCard render semantics.
 *
 * Rendering goes through Ink's `renderToString`, and every assertion is on
 * rendered text content rather than a snapshot. Components are loaded with a
 * dynamic import() because ink 6 is ESM-only with top-level await and cannot be
 * statically required from the CommonJS test runner.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ALL_LANES,
  makeCard,
  makeCards,
  makeFullCard,
  makeStage,
} from './fixtures/board-projection.js';

/** A title well past the 80-character mark used by the truncation criterion. */
const LONG_TITLE = `Wave two lane columns and mission cards with a deliberately very long title `
  + `that runs past eighty characters so truncation has something to cut`;

async function renderLaneColumn(props: Record<string, unknown>): Promise<string> {
  const ink = await import('ink');
  const React = await import('react');
  const { LaneColumn } = await import('../src/interfaces/tui/lane-column.js');
  return ink.renderToString(React.createElement(LaneColumn, props as never), { columns: 40 });
}

async function renderMissionCard(props: Record<string, unknown>): Promise<string> {
  const ink = await import('ink');
  const React = await import('react');
  const { MissionCard } = await import('../src/interfaces/tui/mission-card.js');
  return ink.renderToString(React.createElement(MissionCard, props as never), { columns: 80 });
}

describe('LaneColumn renders one BoardStage', () => {
  it('renders lane header with WIP count from the projection', async () => {
    const output = await renderLaneColumn({
      stage: makeStage('active', [makeCard()]),
      count: 3,
    });

    assert.ok(output.includes('ACTIVE'), `Lane header must name the lane. Got: ${output}`);
    assert.ok(output.includes('ACTIVE 3'), `Lane header must show the wipCounts value. Got: ${output}`);
  });

  it('renders an explicit empty-lane message naming the lane', async () => {
    for (const lane of ALL_LANES) {
      const output = await renderLaneColumn({ stage: makeStage(lane), count: 0 });
      assert.ok(
        output.includes(`nothing in ${lane}`),
        `Empty ${lane} lane must render a message naming the lane. Got: ${output}`,
      );
    }
  });

  it('renders every lane header for all six lanes', async () => {
    const expected = ['BACKLOG', 'REFINED', 'ACTIVE', 'REVIEW', 'INTEGRATION', 'DONE'];
    for (const [index, lane] of ALL_LANES.entries()) {
      const output = await renderLaneColumn({ stage: makeStage(lane), count: index });
      assert.ok(
        output.includes(`${expected[index]} ${index}`),
        `Lane ${lane} must render header "${expected[index]} ${index}". Got: ${output}`,
      );
    }
  });

  it('renders one card row per card in the stage', async () => {
    const output = await renderLaneColumn({
      stage: makeStage('active', makeCards(3, 'active')),
      count: 3,
    });

    for (const slug of ['task-0001', 'task-0002', 'task-0003']) {
      assert.ok(output.includes(slug), `Lane must render card ${slug}. Got: ${output}`);
    }
    assert.ok(
      !output.includes('nothing in active'),
      `A populated lane must not render the empty message. Got: ${output}`,
    );
  });

  it('renders a "+N more" indicator for a lane with more cards than fit', async () => {
    const output = await renderLaneColumn({
      stage: makeStage('backlog', makeCards(12, 'backlog')),
      count: 12,
    });

    assert.ok(output.includes('+4 more'), `12 cards with 8 visible must show "+4 more". Got: ${output}`);
    assert.ok(output.includes('task-0008'), `The 8th card must still render. Got: ${output}`);
    assert.ok(!output.includes('task-0009'), `The 9th card must be folded into the indicator. Got: ${output}`);
  });

  it('renders no overflow indicator when every card fits', async () => {
    const output = await renderLaneColumn({
      stage: makeStage('backlog', makeCards(8, 'backlog')),
      count: 8,
    });

    assert.ok(!output.includes('more'), `8 cards with 8 visible must not overflow. Got: ${output}`);
  });
});

describe('MissionCard renders projection facts', () => {
  it('renders every fact of a fully populated card', async () => {
    const output = await renderMissionCard({ card: makeFullCard(), width: 60 });

    assert.ok(output.includes('task-1234'), `Card must render the slug. Got: ${output}`);
    assert.ok(output.includes('Full card title'), `Card must render the title. Got: ${output}`);
    assert.ok(output.includes('custom'), `Card must render the agent. Got: ${output}`);
    assert.ok(output.includes('CP-2'), `Card must render the checkpoint (without .md suffix). Got: ${output}`);
    assert.ok(output.includes('\u2713'), `Card must render the gate check mark. Got: ${output}`);
    assert.ok(output.includes('run the verification gate'), `Card must render the next step. Got: ${output}`);
    assert.ok(output.includes('PR #42'), `Card must render the pull-request number. Got: ${output}`);
    assert.ok(output.includes('review approved'), `Card must indicate review approval. Got: ${output}`);
    assert.ok(output.includes('waiting on upstream fix'), `Card must render the blocking reason. Got: ${output}`);
  });

  it('renders "unavailable" for every absent projection fact', async () => {
    const output = await renderMissionCard({
      card: makeCard({ title: '', gate: null as never }),
      width: 60,
    });

    assert.ok(output.includes('task-9999'), `Card must still render the slug. Got: ${output}`);
    assert.ok(output.includes('unavailable'), `Absent checkpoint must render "unavailable". Got: ${output}`);
    assert.ok(output.includes('\u00b7'), `Absent gate must render the "gate · no-op" treatment. Got: ${output}`);
    assert.ok(output.includes('next: unavailable'), `Absent next step must render "unavailable". Got: ${output}`);
    assert.ok(output.includes('PR unavailable'), `Absent pull request must render "unavailable". Got: ${output}`);

    const lines = output.split('\n');
    assert.ok(
      lines.some((line) => line.includes('task-9999') && line.includes('unavailable')),
      `Absent agent must render "unavailable" beside the slug. Got: ${output}`,
    );
    assert.ok(
      lines.some((line) => line.trim() === 'unavailable'),
      `An absent title must render "unavailable" on its own line. Got: ${output}`,
    );
  });

  it('renders the projection gate value rather than deriving one', async () => {
    for (const [gate, expected] of [
      ['passed', '\u2713'],
      ['failed', '\u2717 FAIL'],
      ['running', 'gate · running'],
      ['unknown', 'gate · no-op'],
    ] as const) {
      const output = await renderMissionCard({ card: makeCard({ gate }), width: 60 });
      assert.ok(output.includes(expected), `Gate "${gate}" must render "${expected}". Got: ${output}`);
    }
  });

  it('renders "review pending" when the projection reports no approval', async () => {
    const output = await renderMissionCard({
      card: makeFullCard({ reviewApproved: false }),
      width: 60,
    });

    assert.ok(output.includes('review pending'), `Unapproved review must render "review pending". Got: ${output}`);
    assert.ok(!output.includes('review approved'), `Unapproved review must not claim approval. Got: ${output}`);
  });

  it('omits the blocking flag when the projection reports no blocker', async () => {
    const output = await renderMissionCard({
      card: makeFullCard({ blockingReason: null }),
      width: 60,
    });

    assert.ok(!output.includes('▲'), `An unblocked card must not render the red flag. Got: ${output}`);
  });
});

describe('long titles truncate inside the card area', () => {
  it('truncates a title longer than 80 characters instead of rendering it verbatim', async () => {
    assert.ok(LONG_TITLE.length > 80, 'The fixture title must exceed 80 characters');

    const output = await renderMissionCard({
      card: makeCard({ title: LONG_TITLE }),
      width: 40,
    });

    assert.ok(
      !output.includes(LONG_TITLE),
      `The full 80+ character title must not appear verbatim. Got: ${output}`,
    );
    assert.ok(output.includes('…'), `A truncated title must be marked with an ellipsis. Got: ${output}`);
    assert.ok(
      output.includes('Wave two lane columns'),
      `The leading part of the title must survive truncation. Got: ${output}`,
    );
    for (const line of output.split('\n')) {
      assert.ok(line.length <= 40, `No card line may exceed the card width. Got line: "${line}"`);
    }
  });

  it('truncates a long title inside a lane column without breaking the column', async () => {
    const output = await renderLaneColumn({
      stage: makeStage('active', [makeCard({ title: LONG_TITLE })]),
      count: 1,
      width: 26,
    });

    assert.ok(!output.includes(LONG_TITLE), `Lane column must truncate the long title. Got: ${output}`);
    assert.ok(output.includes('…'), `Truncation inside a lane must be marked. Got: ${output}`);
    assert.ok(output.includes('ACTIVE 1'), `The lane header must still render. Got: ${output}`);
  });

  it('truncates a long next-step line to the card width', async () => {
    const output = await renderMissionCard({
      card: makeCard({ nextActionText: LONG_TITLE }),
      width: 30,
    });

    assert.ok(!output.includes(LONG_TITLE), `A long next step must be truncated. Got: ${output}`);
    assert.ok(output.includes('next: Wave two'), `The next-step prefix must survive. Got: ${output}`);
  });

  it('truncate() cuts to the requested width and marks the cut', async () => {
    const { truncate } = await import('../src/interfaces/tui/mission-card.js');

    assert.equal(truncate('short', 10), 'short');
    assert.equal(truncate('exactly-10', 10), 'exactly-10');
    assert.equal(truncate('elevenchars', 10), 'elevencha…');
    assert.equal(truncate('anything', 1), '…');
    assert.equal(truncate('anything', 0), '');
  });
});

describe('the board renders lane overflow through the full shell', () => {
  it('shows a "+N more" indicator for a 12-card lane in the stacked layout', async () => {
    const ink = await import('ink');
    const React = await import('react');
    const { makeProjection } = await import('./fixtures/board-projection.js');
    const { BoardShell } = await import('../src/interfaces/tui/shell.js');

    const projection = makeProjection({ backlog: makeCards(12, 'backlog') });
    const output = ink.renderToString(
      React.createElement(BoardShell, { projection, columns: 60, rows: 80 } as never),
      { columns: 60 },
    );

    assert.ok(output.includes('BACKLOG 12'), `The lane header must report all 12 cards. Got: ${output}`);
    assert.ok(/\+\d+ more/.test(output), `A 12-card lane must show a "+N more" indicator. Got: ${output}`);
    assert.ok(output.includes('task-0001'), `The first card must still render. Got: ${output}`);
    assert.ok(!output.includes('task-0012'), `The 12th card must be folded into the indicator. Got: ${output}`);
  });

  it('keeps a 12-card lane inside the wide six-column layout', async () => {
    const ink = await import('ink');
    const React = await import('react');
    const { makeProjection } = await import('./fixtures/board-projection.js');
    const { BoardLayout } = await import('../src/interfaces/tui/board-layout.js');

    const projection = makeProjection({ backlog: makeCards(12, 'backlog') });
    const output = ink.renderToString(
      React.createElement(BoardLayout, { projection, columns: 120, rows: 40 } as never),
      { columns: 120 },
    );

    assert.ok(/\+\d+ more/.test(output), `A 12-card lane must overflow rather than grow. Got: ${output}`);
    for (const line of output.split('\n')) {
      assert.ok(line.length <= 120, `No board line may exceed the terminal width. Got line: "${line}"`);
    }
  });
});

describe('SC6: TUI components stay pure over the projection', () => {
  const forbidden = [
    'node:fs', 'node:child_process', 'node:os', 'node:net',
    'simple-git', 'sqlite', 'better-sqlite3',
    '../../adapters/', '../../workflow/',
  ];

  it('no lane, card, or layout module imports fs, subprocess, git, sqlite, or an adapter', () => {
    const tuiDir = path.join(process.cwd(), 'src', 'interfaces', 'tui');
    const componentFiles = ['lane-column.tsx', 'mission-card.tsx', 'board-layout.tsx', 'shell.tsx'];
    const violations: string[] = [];

    for (const file of componentFiles) {
      const source = fs.readFileSync(path.join(tuiDir, file), 'utf8');
      for (const line of source.split('\n')) {
        const match = /(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/.exec(line);
        if (!match) { continue; }
        const specifier = match[1] ?? '';
        if (forbidden.some((banned) => specifier.includes(banned))) {
          violations.push(`${file}: ${line.trim()}`);
        }
      }
    }

    assert.deepEqual(violations, [], `TUI components must stay pure over the projection. Violations:\n${violations.join('\n')}`);
  });
});
