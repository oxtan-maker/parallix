import test from 'node:test';
import assert from 'node:assert/strict';
import { agentFamily } from '../src/domain/agents.js';
import { countUnattributedSessions, projectAgentAvailability } from '../src/application/projections/agent-status.js';
import type { AgentAvailabilityMetric } from '../src/application/projections/board.js';
import React from 'react';
import { renderToString } from 'ink';
import { AgentStrip } from '../src/interfaces/tui/agent-strip.js';

// ---------------------------------------------------------------------------
// AgentStrip rendering + projectAgentAvailability block projection.
//
// The strip is the board's top row: one entry per known agent family, green dot
// when available, red dot plus remaining-block countdown and reason when blocked.
// ---------------------------------------------------------------------------

const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, 'g');
const plain = (value: string): string => value.replace(ANSI, '');

const NOW_MS = Date.parse('2026-08-08T12:00:00Z');
const FORTY_FIVE_MINUTES_MS = 45 * 60 * 1000;

function renderStrip(
  agentAvailability: readonly AgentAvailabilityMetric[],
  unattributedRunningSessions?: number | null,
): string {
  return plain(renderToString(
    React.createElement(AgentStrip, { agentAvailability, unattributedRunningSessions }),
    { columns: 120 },
  ));
}

test('AgentStrip renders a red dot and countdown for a family blocked until a future timestamp', async () => {
  const rows = projectAgentAvailability(
    [
      { family: agentFamily('codex'), launcherAvailable: true, block: { kind: 'none' } },
      {
        family: agentFamily('claude'),
        launcherAvailable: true,
        block: { kind: 'until', untilMs: NOW_MS + FORTY_FIVE_MINUTES_MS, reason: 'usage limit' },
      },
    ],
    NOW_MS,
  );

  const frame = await renderStrip(rows);

  assert.ok(!frame.includes('agents: unavailable'), `strip must render entries. Got: ${frame}`);
  assert.ok(frame.includes('claude'), `strip must name the blocked family. Got: ${frame}`);
  assert.ok(frame.includes('codex'), `strip must name the available family. Got: ${frame}`);
  assert.ok(frame.includes('●'), `strip must render availability dots. Got: ${frame}`);
  assert.ok(frame.includes('45m'), `strip must render the formatCountdown value. Got: ${frame}`);
  assert.ok(frame.includes('px cmd unknown'), `unobserved liveness must read as unknown. Got: ${frame}`);
  assert.ok(!frame.includes('wip:'), `the strip must not stand in board cards for sessions. Got: ${frame}`);
});

/** Collect every `<Text>` node's color prop and rendered text from an element tree. */
function textNodes(node: unknown, found: Array<{ color: unknown; text: string }> = []): Array<{ color: unknown; text: string }> {
  if (node === null || node === undefined || typeof node === 'boolean') { return found; }
  if (Array.isArray(node)) {
    for (const child of node) { textNodes(child, found); }
    return found;
  }
  if (typeof node !== 'object') { return found; }
  const element = node as { type?: unknown; props?: Record<string, unknown> };
  const props = element.props ?? {};
  const typeName = typeof element.type === 'function'
    ? (element.type as { name?: string }).name
    : String(element.type);
  if (typeName === 'Text') {
    found.push({ color: props.color, text: String(props.children ?? '') });
  }
  textNodes(props.children, found);
  return found;
}

test('AgentStrip gives the blocked family a red dot and the available family a green dot', async () => {
  const { AgentStrip } = await import('../src/interfaces/tui/agent-strip.js');
  const rows = projectAgentAvailability(
    [
      { family: agentFamily('codex'), launcherAvailable: true, block: { kind: 'none' } },
      {
        family: agentFamily('claude'),
        launcherAvailable: true,
        block: { kind: 'until', untilMs: NOW_MS + FORTY_FIVE_MINUTES_MS, reason: 'usage limit' },
      },
    ],
    NOW_MS,
  );

  const nodes = textNodes(AgentStrip({ agentAvailability: rows }));

  const dots = nodes.filter((entry) => entry.text === '●').map((entry) => entry.color);
  assert.deepEqual(dots, ['green', 'red'], `dot colors must track availability. Got: ${JSON.stringify(nodes)}`);
});

test('AgentStrip renders the block reason for a blocked family', async () => {
  const rows = projectAgentAvailability(
    [
      {
        family: agentFamily('claude'),
        launcherAvailable: true,
        block: { kind: 'until', untilMs: NOW_MS + FORTY_FIVE_MINUTES_MS, reason: 'usage limit' },
      },
    ],
    NOW_MS,
  );

  const frame = await renderStrip(rows);

  assert.ok(frame.includes('usage limit'), `strip must surface the block reason. Got: ${frame}`);
});

test('AgentStrip renders "agents: unavailable" when the availability list is empty', async () => {
  const frame = await renderStrip([]);

  assert.ok(
    frame.includes('agents: unavailable'),
    `the empty-state fallback must survive. Got: ${frame}`,
  );
});

test('AgentStrip renders an available family without a countdown or reason', async () => {
  const rows = projectAgentAvailability(
    [{ family: agentFamily('codex'), launcherAvailable: true, block: { kind: 'none' } }],
    NOW_MS,
  );

  const frame = await renderStrip(rows);

  assert.ok(frame.includes('codex'), `strip must name the family. Got: ${frame}`);
  assert.ok(!frame.includes('∞'), `an available family must carry no countdown. Got: ${frame}`);
});

test('projectAgentAvailability reports an unblocked family as available with zero remaining time', () => {
  const [row] = projectAgentAvailability(
    [{ family: agentFamily('codex'), launcherAvailable: true, block: { kind: 'none' } }],
    NOW_MS,
  );

  assert.equal(row?.available, true, 'a {kind:none} block must be available');
  assert.equal(row?.blockedForMs, 0, 'a {kind:none} block must have no remaining time');
  assert.equal(row?.reason, null, 'a {kind:none} block must carry no reason');
});

test('projectAgentAvailability reports a future until-block as unavailable with the remaining time', () => {
  const untilMs = NOW_MS + FORTY_FIVE_MINUTES_MS;
  const [row] = projectAgentAvailability(
    [{
      family: agentFamily('claude'),
      launcherAvailable: true,
      block: { kind: 'until', untilMs, reason: 'usage limit' },
    }],
    NOW_MS,
  );

  assert.equal(row?.available, false, 'a future until-block must be unavailable');
  assert.equal(row?.blockedForMs, untilMs - NOW_MS, 'remaining time must be untilMs - nowMs');
  assert.equal(row?.reason, 'usage limit', 'the block reason must reach the row');
  assert.equal(row?.expiresAtMs, untilMs, 'the row must carry the block expiry');
});

test('projectAgentAvailability reports an expired until-block as available', () => {
  const [row] = projectAgentAvailability(
    [{
      family: agentFamily('claude'),
      launcherAvailable: true,
      block: { kind: 'until', untilMs: NOW_MS - 1000, reason: 'usage limit' },
    }],
    NOW_MS,
  );

  assert.equal(row?.available, true, 'an expired until-block must be available again');
  assert.equal(row?.blockedForMs, 0, 'an expired until-block must have no remaining time');
});

test('projectAgentAvailability reports an indefinite block as unavailable for Infinity', () => {
  const [row] = projectAgentAvailability(
    [{
      family: agentFamily('vibe'),
      launcherAvailable: true,
      block: { kind: 'indefinite', reason: 'manually disabled' },
    }],
    NOW_MS,
  );

  assert.equal(row?.available, false, 'an indefinite block must be unavailable');
  assert.equal(row?.blockedForMs, Infinity, 'an indefinite block must never expire');
});

test('projectAgentAvailability keeps a launcher-unavailable family unavailable despite no block', async () => {
  const rows = projectAgentAvailability(
    [{ family: agentFamily('custom'), launcherAvailable: false, block: { kind: 'none' } }],
    NOW_MS,
  );

  assert.equal(rows[0]?.available, false, 'a missing launcher must not be masked by an absent block');
  assert.equal(rows[0]?.blockedForMs, 0, 'a missing launcher carries no block countdown');

  const frame = await renderStrip(rows);
  assert.ok(frame.includes('custom'), `strip must still list the family. Got: ${frame}`);
  assert.ok(!frame.includes('agents: unavailable'), `strip must not take the empty branch. Got: ${frame}`);
});

test('projectAgentAvailability explains a missing launcher in the row reason', async () => {
  const rows = projectAgentAvailability(
    [{
      family: agentFamily('custom'),
      launcherAvailable: false,
      launcherDetail: 'launcher missing',
      block: { kind: 'none' },
    }],
    NOW_MS,
  );

  assert.equal(rows[0]?.available, false, 'a missing launcher is not available');
  assert.equal(rows[0]?.reason, 'launcher missing', 'the probe detail must reach the row');

  const frame = await renderStrip(rows);
  assert.ok(frame.includes('launcher missing'), `the strip must explain the red dot. Got: ${frame}`);
});

test('projectAgentAvailability falls back to a generic launcher reason without probe detail', () => {
  const [row] = projectAgentAvailability(
    [{ family: agentFamily('custom'), launcherAvailable: false, block: { kind: 'none' } }],
    NOW_MS,
  );

  assert.equal(row?.reason, 'launcher unavailable', 'an unexplained probe failure still needs a reason');
});

test('projectAgentAvailability prefers the block reason over the launcher reason while blocked', () => {
  const [row] = projectAgentAvailability(
    [{
      family: agentFamily('claude'),
      launcherAvailable: false,
      launcherDetail: 'launcher missing',
      block: { kind: 'until', untilMs: NOW_MS + FORTY_FIVE_MINUTES_MS, reason: 'usage limit' },
    }],
    NOW_MS,
  );

  assert.equal(row?.reason, 'usage limit', 'an active block is the more specific explanation');
});

test('AgentStrip reports observed live px commands per family without calling them agents', async () => {
  const rows = projectAgentAvailability(
    [
      { family: agentFamily('codex'), launcherAvailable: true, block: { kind: 'none' } },
      { family: agentFamily('claude'), launcherAvailable: true, block: { kind: 'none' } },
    ],
    NOW_MS,
    [
      { missionId: 'task-2328' as never, family: agentFamily('claude') },
      { missionId: 'task-2340' as never, family: agentFamily('claude') },
    ],
  );

  const frame = await renderStrip(rows);

  assert.ok(frame.includes('claude 2 px cmd live'), `observed px processes must be counted. Got: ${frame}`);
  assert.ok(frame.includes('codex 0 px cmd live'), `an observed idle family is zero. Got: ${frame}`);
  assert.ok(!/\d+ running/.test(frame), `coordinator evidence must never read as a running-agent count. Got: ${frame}`);
});

test('AgentStrip says px command liveness is unknown when liveness was not observed', async () => {
  const rows = projectAgentAvailability(
    [{ family: agentFamily('codex'), launcherAvailable: true, block: { kind: 'none' } }],
    NOW_MS,
    null,
  );

  const frame = await renderStrip(rows);

  assert.equal(rows[0]?.runningSessions, null, 'unobserved liveness must stay null');
  assert.ok(frame.includes('px cmd unknown'), `unknown must not render as 0. Got: ${frame}`);
  assert.ok(!frame.includes('0 px cmd live'), `unknown must never be shown as zero. Got: ${frame}`);
});

test('AgentStrip shows no trace of a block whose until has elapsed', async () => {
  const rows = projectAgentAvailability(
    [{ family: agentFamily('vibe'), launcherAvailable: true, block: { kind: 'until', untilMs: NOW_MS - 1, reason: 'exit 1' } }],
    NOW_MS,
    [],
  );

  const frame = await renderStrip(rows);

  assert.equal(rows[0]?.available, true, 'an elapsed block releases the family');
  assert.equal(rows[0]?.reason, null, 'a past block is not current state');
  assert.ok(!frame.includes('expired'), `only current and future state belongs on the strip. Got: ${frame}`);
  assert.ok(!frame.includes('exit 1'), `a lapsed block reason must not linger. Got: ${frame}`);
});

test('AgentStrip counts a session no family can claim instead of dropping it', async () => {
  const rows = projectAgentAvailability(
    [{ family: agentFamily('claude'), launcherAvailable: true, block: { kind: 'none' } }],
    NOW_MS,
    [{ missionId: 'task-2328' as never, family: null }],
  );

  const frame = await renderStrip(rows, countUnattributedSessions([{ missionId: 'task-2328' as never, family: null }]));

  assert.ok(frame.includes('claude 0 px cmd live'), `no family may claim the process. Got: ${frame}`);
  assert.ok(frame.includes('1 px cmd live · family unknown'), `the process must still be counted. Got: ${frame}`);
});

test('AgentStrip omits the unattributed entry when every session is attributed', async () => {
  const sessions = [{ missionId: 'task-2328' as never, family: agentFamily('claude') }];
  const rows = projectAgentAvailability(
    [{ family: agentFamily('claude'), launcherAvailable: true, block: { kind: 'none' } }],
    NOW_MS,
    sessions,
  );

  const frame = await renderStrip(rows, countUnattributedSessions(sessions));

  assert.ok(frame.includes('claude 1 px cmd live'), `the attributed process belongs to its family. Got: ${frame}`);
  assert.ok(!frame.includes('family unknown'), `nothing is unattributed here. Got: ${frame}`);
});
