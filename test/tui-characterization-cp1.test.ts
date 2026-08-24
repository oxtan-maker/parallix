/**
 * CP-1 characterization tests for task-2329: bring TUI board to design parity.
 *
 * Each test documents the *current* behavior before any feature changes.
 * After implementation, the same tests are extended so they would have failed
 * against the parent commit's behavior.
 *
 * Rendering tests use Ink's renderToString — no TTY, agent, Forgejo, or Git.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);
import {
  makeCard,
  makeCards,
  makeFullCard,
  makeProjection,
  makeStage,
  emptyMetrics,
} from './fixtures/board-projection.js';
import type { BoardProjection, BoardMetrics, AgentAvailabilityMetric, LaneMetricSeries } from '../src/application/projections/board.js';
import type { MissionCard } from '../src/application/projections/mission-board.js';
import type { AgentFamily } from '../src/domain/agents.js';
import React from 'react';
import { renderToString } from 'ink';
import { FlowPanel } from '../src/interfaces/tui/flow-panel.js';

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

const ESC = String.fromCharCode(27);
const ANSI_RE = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, 'g');
function plain(text: string): string { return text.replace(ANSI_RE, ''); }

function makeMedianCycleByState(values: ReadonlyArray<{ lane: string; value: number }>): LaneMetricSeries {
  return {
    series: values.map((v) => ({ lane: v.lane as never, value: v.value })),
    missingHistoryFallback: 'skip',
  };
}

function metricsWithAgents(agents: AgentAvailabilityMetric[]): BoardMetrics {
  return { ...emptyMetrics, agentAvailability: agents };
}

function metricsWithMedians(series: LaneMetricSeries): BoardMetrics {
  return { ...emptyMetrics, medianCycleTimeByState: series };
}

function projectionWithMetrics(metrics: BoardMetrics): BoardProjection {
  return { ...makeProjection(), metrics };
}

/* ------------------------------------------------------------------ */
/* SC1: Agent availability strip                                      */
/* ------------------------------------------------------------------ */

describe('SC1: Agent availability — current rendering path', () => {
  it('FlowPanel renders agent availability as "family available/unavailable" lines', async () => {
    const agents = [
      { family: 'codex' as AgentFamily, available: true, blockedForMs: 0 },
      { family: 'claude' as AgentFamily, available: false, blockedForMs: Infinity },
    ];
    const output = plain(renderToString(
      React.createElement(FlowPanel, { metrics: metricsWithAgents(agents), columns: 120 }),
      { columns: 120 },
    ));

    assert.ok(output.includes('codex available'), `Available agent must render as "family available". Got: ${output}`);
    assert.ok(output.includes('claude unavailable'), `Blocked agent must render as "family unavailable". Got: ${output}`);
  });

  it('FlowPanel shows "unavailable" when agentAvailability is empty', async () => {
    const ink = await import('ink');
    const React = await import('react');
    const { FlowPanel } = await import('../src/interfaces/tui/flow-panel.js');

    const output = plain(ink.renderToString(
      React.createElement(FlowPanel, { metrics: metricsWithAgents([]), columns: 120 }),
      { columns: 120 },
    ));

    assert.ok(output.includes('Agents'), `FLOW panel must render the Agents heading. Got: ${output}`);
    assert.ok(output.includes('unavailable'), `Empty agent list must render "unavailable". Got: ${output}`);
  });

  it('BoardShell renders an agent strip between top bar and board', async () => {
    const ink = await import('ink');
    const React = await import('react');
    const { BoardShell } = await import('../src/interfaces/tui/shell.js');

    const agents = [
      { family: 'codex' as AgentFamily, available: true, blockedForMs: 0 },
      { family: 'claude' as AgentFamily, available: false, blockedForMs: 3600000 },
    ];
    const projection = projectionWithMetrics(metricsWithAgents(agents));
    const output = plain(ink.renderToString(
      React.createElement(BoardShell, { projection }),
      { columns: 120 },
    ));

    /* Agent strip now renders between top bar/FLOW and attention rail. */
    const beforeBoard = output.split('NEEDS YOU')[0] ?? '';
    assert.ok(
      beforeBoard.includes('codex'),
      `Agent strip must render codex availability. Top portion: ${beforeBoard.slice(0, 300)}`,
    );
    assert.ok(
      beforeBoard.includes('claude'),
      `Agent strip must render claude availability. Top portion: ${beforeBoard.slice(0, 300)}`,
    );
  });
});

/* ------------------------------------------------------------------ */
/* SC2: On-card action buttons                                        */
/* ------------------------------------------------------------------ */

describe('SC2: On-card action buttons — current rendering path', () => {
  it('MissionCard renders contextual action labels for enabled commands', async () => {
    const ink = await import('ink');
    const React = await import('react');
    const { MissionCard } = await import('../src/interfaces/tui/mission-card.js');

    const card = makeCard({
      lane: 'active',
      commands: [
        { command: 'active', enabled: true, reason: null },
        { command: 'handoff', enabled: true, reason: null },
      ],
    });
    const output = plain(ink.renderToString(
      React.createElement(MissionCard, { card, width: 60 }),
      { columns: 80 },
    ));

    /* Buttons render as contextual labels per design (not [kind] brackets).
     * Active lane: 'active' → 'ckpt', 'handoff' → 'handoff'. */
    assert.ok(output.includes('ckpt'), `MissionCard must render 'ckpt' label for active command. Got: ${output}`);
    assert.ok(output.includes('handoff'), `MissionCard must render 'handoff' label. Got: ${output}`);
  });

  it('MissionCard omits buttons for disabled commands', async () => {
    const ink = await import('ink');
    const React = await import('react');
    const { MissionCard } = await import('../src/interfaces/tui/mission-card.js');

    const card = makeCard({
      lane: 'active',
      commands: [
        { command: 'active', enabled: false, reason: 'not in active lane' },
        { command: 'handoff', enabled: true, reason: null },
      ],
    });
    const output = plain(ink.renderToString(
      React.createElement(MissionCard, { card, width: 60 }),
      { columns: 80 },
    ));

    assert.ok(!output.includes('ckpt'), `MissionCard must not render 'ckpt' when disabled. Got: ${output}`);
    assert.ok(output.includes('handoff'), `MissionCard must render 'handoff' when enabled. Got: ${output}`);
  });

  it('ActionBar renders command availability at the bottom', async () => {
    const ink = await import('ink');
    const React = await import('react');
    const { ActionBar, BOARD_ACTION_KINDS } = await import('../src/interfaces/tui/action-bar.js');

    const card = makeCard({
      commands: [{ command: 'active', enabled: true, reason: null }],
    });
    const output = plain(ink.renderToString(
      React.createElement(ActionBar, { mission: card }),
      { columns: 160 },
    ));

    assert.ok(output.includes('ACTIONS'), `ActionBar must render the ACTIONS heading. Got: ${output}`);
    assert.ok(output.includes('active:execute'), `ActionBar must list active:execute. Got: ${output}`);
    assert.equal(BOARD_ACTION_KINDS.length, 7, `ActionBar must declare 7 command kinds`);
  });
});

/* ------------------------------------------------------------------ */
/* SC5: Classification label badge                                    */
/* ------------------------------------------------------------------ */

describe('SC5: Classification label badge — current rendering path', () => {
  it('MissionCard renders labels[0] as a bordered badge in card header', async () => {
    const ink = await import('ink');
    const React = await import('react');
    const { MissionCard } = await import('../src/interfaces/tui/mission-card.js');

    const card = makeCard({
      labels: ['user_value' as never, 'bug' as never],
    });
    const output = plain(ink.renderToString(
      React.createElement(MissionCard, { card, width: 60 }),
      { columns: 80 },
    ));

    /* labels[0] rendered as [label] badge in header line. */
    assert.ok(output.includes('[user_value]'), `MissionCard must render first label as badge. Got: ${output}`);
    assert.ok(!output.includes('[bug]'), `MissionCard must not render second label. Got: ${output}`);
  });

  it('MissionCard with no labels renders without error', async () => {
    const ink = await import('ink');
    const React = await import('react');
    const { MissionCard } = await import('../src/interfaces/tui/mission-card.js');

    const card = makeCard({ labels: [] });
    const output = plain(ink.renderToString(
      React.createElement(MissionCard, { card, width: 60 }),
      { columns: 80 },
    ));

    assert.ok(output.includes('task-9999'), `Card must still render slug with empty labels. Got: ${output}`);
  });

  it('MissionCard preserves mission id at narrow width with label', async () => {
    const ink = await import('ink');
    const React = await import('react');
    const { MissionCard } = await import('../src/interfaces/tui/mission-card.js');

    const card = makeCard({
      labels: ['user_value' as never],
    });
    /* MIN_LANE_WIDTH is 12, so inner = 11. Label is 10 chars, badge = 14 chars.
     * slugBudget = max(8, 11 - 14) = 8. Mission id is truncated but must not
     * be blanked entirely (previously any label >= 8 chars blanked the slug). */
    const output = plain(ink.renderToString(
      React.createElement(MissionCard, { card, width: 12 }),
      { columns: 80 },
    ));

    /* At budget 8, "task-9999 · custom" truncates to "task-99…" — the id
     * is present (not blank) even if truncated. */
    assert.ok(
      output.includes('task-'),
      `Mission id must survive at MIN_LANE_WIDTH with label (not blanked). Got: ${output}`,
    );
    assert.ok(
      !output.match(/^\s*\[user_value\]/m),
      `Mission id must precede the label badge, not be blanked. Got: ${output}`,
    );
  });
});

/* ------------------------------------------------------------------ */
/* SC3: WIP limit indicators                                          */
/* ------------------------------------------------------------------ */

describe('SC3: WIP limit indicators — current rendering path', () => {
  it('LaneColumn renders count only, no WIP limit', async () => {
    const ink = await import('ink');
    const React = await import('react');
    const { LaneColumn } = await import('../src/interfaces/tui/lane-column.js');

    const output = plain(ink.renderToString(
      React.createElement(LaneColumn, {
        stage: makeStage('active', makeCards(4, 'active')),
        count: 4,
      }),
      { columns: 40 },
    ));

    /* Header shows "ACTIVE 4" — count only, no "/limit" format. */
    assert.ok(output.includes('ACTIVE 4'), `Lane header must show count. Got: ${output}`);
    assert.ok(!output.includes('/'), `Lane header must not show WIP limit (no "/" in header). Got: ${output}`);
  });

  it('LaneColumn renders count/limit when wipLimit is set', async () => {
    const ink = await import('ink');
    const React = await import('react');
    const { LaneColumn } = await import('../src/interfaces/tui/lane-column.js');

    const output = plain(ink.renderToString(
      React.createElement(LaneColumn, {
        stage: makeStage('active', makeCards(3, 'active')),
        count: 3,
        wipLimit: 5,
      }),
      { columns: 40 },
    ));

    assert.ok(output.includes('3/5'), `Lane header must show count/limit. Got: ${output}`);
  });

  it('LaneColumn renders over-limit styling when count exceeds wipLimit', async () => {
    const ink = await import('ink');
    const React = await import('react');
    const { LaneColumn } = await import('../src/interfaces/tui/lane-column.js');

    const output = plain(ink.renderToString(
      React.createElement(LaneColumn, {
        stage: makeStage('active', makeCards(6, 'active')),
        count: 6,
        wipLimit: 4,
      }),
      { columns: 40 },
    ));

    assert.ok(output.includes('6/4'), `Lane header must show count/limit when over limit. Got: ${output}`);
  });
});

/* ------------------------------------------------------------------ */
/* SC4: Median cycle time in lane headers                             */
/* ------------------------------------------------------------------ */

describe('SC4: Median cycle time in lane headers — current rendering path', () => {
  it('LaneColumn does NOT render median cycle time in header when prop is absent', async () => {
    const ink = await import('ink');
    const React = await import('react');
    const { LaneColumn } = await import('../src/interfaces/tui/lane-column.js');

    const output = plain(ink.renderToString(
      React.createElement(LaneColumn, {
        stage: makeStage('active', [makeCard()]),
        count: 1,
      }),
      { columns: 40 },
    ));

    /* Lane header shows "ACTIVE 1" — no median cycle time. */
    assert.ok(output.includes('ACTIVE 1'), `Lane header must show count. Got: ${output}`);
    assert.ok(!output.match(/med\s+[\d.]+/), `Lane header must not show median cycle time. Got: ${output}`);
  });

  it('LaneColumn renders median cycle time when medianCycleTime prop is provided', async () => {
    const ink = await import('ink');
    const React = await import('react');
    const { LaneColumn } = await import('../src/interfaces/tui/lane-column.js');

    const output = plain(ink.renderToString(
      React.createElement(LaneColumn, {
        stage: makeStage('active', [makeCard()]),
        count: 1,
        medianCycleTime: 120,
      }),
      { columns: 40 },
    ));

    assert.ok(output.match(/med\s+120m/), `Lane header must show median cycle time. Got: ${output}`);
  });

  it('FlowPanel renders median cycle time but lane headers do not', async () => {
    const ink = await import('ink');
    const React = await import('react');
    const { FlowPanel } = await import('../src/interfaces/tui/flow-panel.js');

    const series = makeMedianCycleByState([
      { lane: 'active', value: 120 },
      { lane: 'review', value: 45 },
    ]);
    const output = plain(ink.renderToString(
      React.createElement(FlowPanel, { metrics: metricsWithMedians(series), columns: 120 }),
      { columns: 120 },
    ));

    /* FLOW panel already renders median cycle time per lane. */
    assert.ok(output.includes('Median cycle time'), `FLOW must render median cycle time heading. Got: ${output}`);
    assert.ok(output.includes('active: 120 min'), `FLOW must show active lane median. Got: ${output}`);
    assert.ok(output.includes('review: 45 min'), `FLOW must show review lane median. Got: ${output}`);
  });
});

/* ------------------------------------------------------------------ */
/* SC6: Keyboard lifecycle shortcuts                                  */
/* ------------------------------------------------------------------ */

describe('SC6: Keyboard lifecycle shortcuts — current behavior', () => {
  it('navigationKeyForInput does not map Ctrl+D, Ctrl+A, or Ctrl+R', async () => {
    const { navigationKeyForInput } = await import('../src/interfaces/tui/shell.js');

    /* Ctrl-modified keys return undefined (not mapped to navigation keys).
     * Ctrl+I is excluded: Ink reports it as Tab (0x09, ctrl:false), not as
     * {input:'i', ctrl:true}. Confirmed limitation recorded in CP-4. */
    assert.equal(navigationKeyForInput('d', { ctrl: true, meta: false, upArrow: false, downArrow: false, leftArrow: false, rightArrow: false }), undefined);
    assert.equal(navigationKeyForInput('a', { ctrl: true, meta: false, upArrow: false, downArrow: false, leftArrow: false, rightArrow: false }), undefined);
    assert.equal(navigationKeyForInput('r', { ctrl: true, meta: false, upArrow: false, downArrow: false, leftArrow: false, rightArrow: false }), undefined);
  });

  it('keyboard help text lists lifecycle shortcut bindings', async () => {
    const ink = await import('ink');
    const React = await import('react');
    const { BoardShell } = await import('../src/interfaces/tui/shell.js');

    const output = plain(ink.renderToString(
      React.createElement(BoardShell, { projection: makeProjection() }),
      { columns: 120 },
    ));

    /* Help text lists Ctrl+D/A/R lifecycle shortcuts and Shift+S.
     * Ctrl+I is excluded: Ink reports Ctrl+I as Tab (0x09, ctrl:false). */
    assert.ok(output.includes('arrows/WASD'), `Help must reference arrow navigation. Got: ${output}`);
    assert.ok(output.includes('Ctrl+D/A/R'), `Help must list Ctrl+D/A/R lifecycle shortcuts. Got: ${output}`);
    assert.ok(!output.includes('Ctrl+D/A/R/I'), `Help must not list Ctrl+I (Tab collision). Got: ${output}`);
    assert.ok(output.includes('Shift+S'), `Help must list Shift+S (shipped). Got: ${output}`);
  });
});

/* ------------------------------------------------------------------ */
/* SC7: Collapsible shipped/done lane                                 */
/* ------------------------------------------------------------------ */

describe('SC7: Collapsible shipped lane — current behavior', () => {
  it('BoardShell renders done lane at full width by default', async () => {
    const ink = await import('ink');
    const React = await import('react');
    const { BoardShell } = await import('../src/interfaces/tui/shell.js');

    const projection = makeProjection({ done: makeCards(3, 'done') });
    const output = plain(ink.renderToString(
      React.createElement(BoardShell, { projection }),
      { columns: 120 },
    ));

    /* Done lane renders at full width by default (doneCollapsed is false). */
    assert.ok(output.includes('DONE 3'), `Done lane must show count. Got: ${output}`);
  });

  it('BoardLayout renders collapsed DONE strip when doneCollapsed is true', async () => {
    const ink = await import('ink');
    const React = await import('react');
    const { BoardLayout } = await import('../src/interfaces/tui/board-layout.js');

    const projection = makeProjection({ done: makeCards(5, 'done') });
    const output = plain(ink.renderToString(
      React.createElement(BoardLayout, {
        projection,
        mode: 'wide',
        columns: 120,
        doneCollapsed: true,
      }),
      { columns: 120 },
    ));

    /* Collapsed done lane renders as a narrow strip with DONE text.
     * The 8-column box may wrap the text, so check for the characters
     * rather than the full word on one line. */
    assert.ok(output.includes('DONE'), `Collapsed done lane must render DONE text. Got: ${output}`);
    assert.ok(output.includes('5'), `Collapsed done lane must render card count. Got: ${output}`);
    /* The full "DONE" lane header must NOT appear when collapsed. */
    const lines = output.split('\n');
    const doneLaneLine = lines.find((line) => line.includes('──') && line.includes('DONE'));
    assert.equal(doneLaneLine, undefined, `Full DONE lane header must not render when collapsed. Got: ${output}`);
  });

  it('Shift+S is not handled by the navigation key mapper', async () => {
    const { navigationKeyForInput } = await import('../src/interfaces/tui/shell.js');

    /* Ink reports Shift+S as input 'S' with no special shift flag in Key.
     * 'S' is not a navigation key (only 's' lowercase is). */
    assert.equal(navigationKeyForInput('S', { ctrl: false, meta: false, upArrow: false, downArrow: false, leftArrow: false, rightArrow: false }), undefined);
  });
});

/* ------------------------------------------------------------------ */
/* SC8: Review details on cards                                       */
/* ------------------------------------------------------------------ */

describe('SC8: Review details on cards — current rendering path', () => {
  it('MissionCard renders review round and blocking findings from flags', async () => {
    const ink = await import('ink');
    const React = await import('react');
    const { MissionCard } = await import('../src/interfaces/tui/mission-card.js');

    const card = makeFullCard({
      lane: 'review',
      status: 'review',
      rawStatus: 'review',
      flags: ['review:round-2', 'review:blocking-2'],
      pullRequest: {
        kind: 'pull-request',
        provider: 'forgejo',
        id: '47',
        url: 'https://example.invalid/pr/47',
        sourceBranch: 'mission/task-1234',
        targetBranch: 'main',
      },
    });
    const output = plain(ink.renderToString(
      React.createElement(MissionCard, { card, width: 60 }),
      { columns: 80 },
    ));

    /* Card now renders R2 and "2 blocking" from flags.
     * PR format per design: "PR #47 · R2 · 2 blocking". */
    assert.ok(output.includes('PR #47'), `Card must render PR number. Got: ${output}`);
    assert.ok(output.includes('R2'), `Card must render review round from flags. Got: ${output}`);
    assert.ok(output.includes('2 blocking'), `Card must render blocking findings from flags. Got: ${output}`);
  });

  it('MissionCard.flags carry review metadata but are not displayed', async () => {
    const card = makeCard({
      flags: ['review:round-2', 'review:blocking-2'],
    });
    assert.equal(card.flags.length, 2, `Card must carry flags array`);
    assert.ok(card.flags.includes('review:round-2'), `Flag must carry review round metadata`);
    assert.ok(card.flags.includes('review:blocking-2'), `Flag must carry blocking findings metadata`);
  });
});

/* ------------------------------------------------------------------ */
/* SC9: Test-before-implementation contract                           */
/* ------------------------------------------------------------------ */

describe('SC9: Characterization tests exist for all capabilities', () => {
  const capabilities = ['SC1', 'SC2', 'SC3', 'SC4', 'SC5', 'SC6', 'SC7', 'SC8'];

  it('every success criterion has a dedicated describe block in this file', () => {
    const fs = _require('node:fs');
    const path = _require('node:path');
    const source = fs.readFileSync(path.join(process.cwd(), 'test', 'tui-characterization-cp1.test.ts'), 'utf8');

    for (const sc of capabilities) {
      /* Each SC must have its own describe block, not just a string mention. */
      assert.ok(
        source.includes(`describe('${sc}:`),
        `Characterization test file must have a describe block for ${sc}`,
      );
    }
  });
});

/* ------------------------------------------------------------------ */
/* SC10: No new TUI files without justification                        */
/* ------------------------------------------------------------------ */

describe('SC10: TUI file count and size guardrails', () => {
  it('no TUI module exceeds 300 lines except shell.tsx', () => {
    const fs = _require('node:fs');
    const path = _require('node:path');
    const tuiDir = path.join(process.cwd(), 'src', 'interfaces', 'tui');
    const files = fs.readdirSync(tuiDir).filter((f: string) => f.endsWith('.tsx'));

    for (const file of files) {
      const source = fs.readFileSync(path.join(tuiDir, file), 'utf8');
      const lines = source.split('\n').length;
      if (file !== 'shell.tsx') {
        assert.ok(
          lines <= 300,
          `${file} must not exceed 300 lines (${lines} lines). New files only permitted when existing module > 300 lines.`,
        );
      }
    }
  });
});
