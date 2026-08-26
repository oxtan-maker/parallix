import test from 'node:test';
import assert from 'node:assert/strict';
import { agentFamily } from '../src/domain/agents.js';
import { projectAgentAvailability } from '../src/application/projections/agent-status.js';
import { reconcileCurrentWork } from '../src/application/projections/current-work.js';
import {
  describeCoordinatorEvidence,
  describeMissionWork,
  projectMissionActivity,
  summarizeMissionActivity,
  type MissionActivity,
  type MissionActivitySource,
} from '../src/application/projections/mission-activity.js';
import { renderStatus } from '../src/interfaces/cli/status.js';
import type { StatusResult } from '../src/application/status-command-use-case.js';
import type { AgentAvailabilityMetric } from '../src/application/projections/board.js';
import { projectMissionCard, type CurrentWorkFreshness, type MissionCard, type MissionOperationalFacts } from '../src/application/projections/mission-board.js';
import 'react';
import 'ink';
import '../src/interfaces/tui/agent-strip.js';
import '../src/interfaces/tui/mission-card.js';

// ---------------------------------------------------------------------------
// The shared mission-activity read model and both operator renderings.
//
// One rule is under test everywhere in this file: authoritative work (what the
// operation published) and coordinator evidence (a live `px` process) are two
// different facts with two different authorities, and no surface may present
// the second as a count of running agents.
// ---------------------------------------------------------------------------

const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, 'g');
const plain = (value: string): string => value.replace(ANSI, '');

/** A card-shaped source with authoritative work at the given certainty. */
function working(freshness: CurrentWorkFreshness, overrides: Partial<MissionActivitySource> = {}): MissionActivitySource {
  return {
    currentWork: {
      operationId: 'op-1',
      phase: 'execute',
      summary: 'running checkpoint 2',
      agent: agentFamily('claude'),
      updatedAt: '2026-08-22T10:00:00Z',
      freshness,
    },
    blockingReason: null,
    ...overrides,
  };
}

// ---------- projection: authoritative work ----------

test('projectMissionActivity reports live authoritative work with live certainty', () => {
  const activity = projectMissionActivity(working('live'));

  assert.equal(activity.work.kind, 'working');
  assert.equal(activity.work.kind === 'working' && activity.work.certainty, 'live');
  assert.equal(describeMissionWork(activity.work), '(live): execute');
});

test('projectMissionActivity reports an unverifiable work fact as unconfirmed, never as idle', () => {
  const activity = projectMissionActivity(working('unverified'));

  assert.equal(activity.work.kind === 'working' && activity.work.certainty, 'unknown');
  assert.equal(describeMissionWork(activity.work), '(unconfirmed): execute');
});

test('projectMissionActivity keeps a stale work fact visible and marked stale', () => {
  const activity = projectMissionActivity(working('stale'));

  assert.equal(activity.work.kind === 'working' && activity.work.certainty, 'stale');
  assert.equal(describeMissionWork(activity.work), '(stale): execute');
});

test('projectMissionActivity reports blocked work with its recorded reason', () => {
  const activity = projectMissionActivity({
    currentWork: null,
    blockingReason: 'usage limit reached',
  });

  assert.equal(activity.work.kind, 'blocked');
  assert.equal(describeMissionWork(activity.work), 'blocked: usage limit reached');
});

test('projectMissionActivity reports idle work when no fact and no blocking reason exist', () => {
  const activity = projectMissionActivity({ currentWork: null, blockingReason: null });

  assert.equal(activity.work.kind, 'idle');
  assert.equal(describeMissionWork(activity.work), 'none recorded');
});

// ---------- projection: coordinator evidence ----------

test('projectMissionActivity calls a live px process recovery evidence, not a running agent', () => {
  const activity = projectMissionActivity({
    currentWork: null,
    blockingReason: null,
    liveSession: { missionId: 'task-2389' as never, family: agentFamily('claude') },
  });

  assert.equal(activity.coordinator.state, 'live');
  const text = describeCoordinatorEvidence(activity.coordinator);
  assert.equal(text, 'live px command (claude) — recovery evidence only');
  assert.ok(!/running/.test(text), `coordinator evidence must not claim a running agent. Got: ${text}`);
});

test('projectMissionActivity separates an observed-stopped coordinator from an unobserved one', () => {
  const observed = projectMissionActivity({ currentWork: null, blockingReason: null, liveSession: null });
  const unobserved = projectMissionActivity({ currentWork: null, blockingReason: null });

  assert.equal(observed.coordinator.state, 'stopped');
  assert.equal(unobserved.coordinator.state, 'unknown');
  assert.equal(describeCoordinatorEvidence(observed.coordinator), 'no live px command');
  assert.equal(describeCoordinatorEvidence(unobserved.coordinator), 'px command liveness unknown');
});

test('projectMissionCard preserves unobserved coordinator liveness for mission activity', () => {
  const card = projectMissionCard({
    id: 'task-2389' as never,
    repositoryId: 'parallix' as never,
    title: 'Mission activity',
    labels: [] as never,
    status: 'active',
    rawStatus: 'active',
    closedAt: null,
    assignee: null,
    checkpoints: [],
    review: null,
    netEngineeringLines: null,
  }, {
    latestGate: 'unknown',
    liveSession: undefined,
    reviewApproval: null,
    currentWork: null,
    blockingReason: null,
    flags: [],
  });

  assert.equal(card.liveSession, undefined);
  assert.equal(projectMissionActivity(card).coordinator.state, 'unknown');
});

test('projectMissionActivity leaves an unattributed coordinator family null instead of guessing one', () => {
  const activity = projectMissionActivity({
    currentWork: null,
    blockingReason: null,
    liveSession: { missionId: 'task-2389' as never, family: null },
  });

  assert.equal(activity.coordinator.state === 'live' && activity.coordinator.family, null);
  assert.equal(describeCoordinatorEvidence(activity.coordinator), 'live px command — recovery evidence only');
});

test('projectMissionActivity restates the one operation the reconciler resolved for overlapping operations', () => {
  // Two operations overlap and the older one ends last. Durable order, not
  // wall clock, decides which fact stands; the projection must not merge them
  // or turn two operations into a count.
  const facts = reconcileCurrentWork(
    [
      { missionId: 'task-2389' as never, operationId: 'op-old', state: 'running', phase: 'draft', summary: 'old', agent: null, occurredAt: '2026-08-22T10:00:00Z', processId: null, sequence: 1 },
      { missionId: 'task-2389' as never, operationId: 'op-new', state: 'running', phase: 'execute', summary: 'new', agent: null, occurredAt: '2026-08-22T10:01:00Z', processId: null, sequence: 2 },
      { missionId: 'task-2389' as never, operationId: 'op-old', state: 'ended', phase: 'draft', summary: 'old', agent: null, occurredAt: '2026-08-22T10:02:00Z', processId: null, sequence: 3 },
    ] as never,
    { nowMs: Date.parse('2026-08-22T10:02:30Z'), ttlMs: 5 * 60 * 1000 },
  );

  const activity = projectMissionActivity({
    currentWork: facts.get('task-2389' as never)?.currentWork ?? null,
    blockingReason: facts.get('task-2389' as never)?.blockingReason ?? null,
  });

  assert.equal(activity.work.kind, 'working');
  assert.equal(activity.work.kind === 'working' && activity.work.operationId, 'op-new');
  assert.equal(describeMissionWork(activity.work), '(unconfirmed): execute');
});

test('summarizeMissionActivity tallies work states and sums no coordinator evidence', () => {
  const totals = summarizeMissionActivity([
    projectMissionActivity(working('live')),
    projectMissionActivity(working('unverified')),
    projectMissionActivity(working('stale')),
    projectMissionActivity({ currentWork: null, blockingReason: 'gate failed' }),
    projectMissionActivity({ currentWork: null, blockingReason: null, liveSession: { missionId: 'task-1' as never, family: null } }),
  ]);

  assert.deepEqual(totals, { live: 1, unknown: 1, stale: 1, blocked: 1, idle: 1 });
});

// ---------- TUI rendering ----------

async function renderStrip(
  agentAvailability: readonly AgentAvailabilityMetric[],
  missionActivity?: readonly MissionActivity[],
  unattributedRunningSessions?: number | null,
): Promise<string> {
  const ink = await import('ink');
  const React = await import('react');
  const { AgentStrip } = await import('../src/interfaces/tui/agent-strip.js');
  return plain(ink.renderToString(
    React.createElement(AgentStrip, { agentAvailability, missionActivity, unattributedRunningSessions }),
    { columns: 200 },
  ));
}

const ONE_FAMILY: readonly AgentAvailabilityMetric[] = projectAgentAvailability(
  [{ family: agentFamily('claude'), launcherAvailable: true, block: { kind: 'none' } }],
  Date.parse('2026-08-22T10:00:00Z'),
  [],
);

test('AgentStrip renders live authoritative work separately from coordinator evidence', async () => {
  const frame = await renderStrip(ONE_FAMILY, [projectMissionActivity(working('live'))]);

  assert.ok(frame.includes('work: 1 live'), `authoritative work must be named. Got: ${frame}`);
  assert.ok(frame.includes('px cmd live'), `coordinator evidence must stay a px-command count. Got: ${frame}`);
  assert.ok(!/\d+ running/.test(frame), `no surface may render an exact running-agent count. Got: ${frame}`);
});

test('AgentStrip renders recovery-only live coordinator evidence without claiming mission work', async () => {
  const recoveryOnly = projectMissionActivity({
    currentWork: null,
    blockingReason: null,
    liveSession: { missionId: 'task-2389' as never, family: agentFamily('claude') },
  });
  const rows = projectAgentAvailability(
    [{ family: agentFamily('claude'), launcherAvailable: true, block: { kind: 'none' } }],
    Date.parse('2026-08-22T10:00:00Z'),
    [{ missionId: 'task-2389' as never, family: agentFamily('claude') }],
  );

  const frame = await renderStrip(rows, [recoveryOnly]);

  assert.ok(frame.includes('1 px cmd live'), `the live px process must be shown. Got: ${frame}`);
  assert.ok(frame.includes('work: 1 idle'), `a live coordinator is not authoritative work. Got: ${frame}`);
  assert.ok(!frame.includes('1 live '), `recovery evidence must not become live work. Got: ${frame}`);
});

test('AgentStrip renders unknown coordinator evidence as unknown rather than zero', async () => {
  const rows = projectAgentAvailability(
    [{ family: agentFamily('claude'), launcherAvailable: true, block: { kind: 'none' } }],
    Date.parse('2026-08-22T10:00:00Z'),
    null,
  );

  const frame = await renderStrip(rows, [projectMissionActivity({ currentWork: null, blockingReason: null })]);

  assert.ok(frame.includes('px cmd unknown'), `unobserved liveness must read unknown. Got: ${frame}`);
  assert.ok(!frame.includes('0 px cmd live'), `unknown must never render as zero. Got: ${frame}`);
});

test('AgentStrip renders stale, blocked and idle authoritative work in the work summary', async () => {
  const frame = await renderStrip(ONE_FAMILY, [
    projectMissionActivity(working('stale')),
    projectMissionActivity({ currentWork: null, blockingReason: 'usage limit reached' }),
    projectMissionActivity({ currentWork: null, blockingReason: null, liveSession: null }),
  ]);

  assert.ok(frame.includes('1 stale'), `stale work must stay visible. Got: ${frame}`);
  assert.ok(frame.includes('1 blocked'), `blocked work must stay visible. Got: ${frame}`);
  assert.ok(frame.includes('1 idle'), `idle work must stay visible. Got: ${frame}`);
});

test('AgentStrip omits the work summary when no mission activity is supplied', async () => {
  const frame = await renderStrip(ONE_FAMILY);

  assert.ok(!frame.includes('work:'), `an absent projection must add no work claim. Got: ${frame}`);
});

// ---------- px status rendering ----------

/** Render `px status` output for one mission activity, returning its lines. */
function renderStatusLines(activity: MissionActivity | null): string[] {
  const lines: string[] = [];
  const result = {
    branch: 'mission/task-2389',
    worktree: '/tmp/task-2389',
    rebaseInfo: null,
    slug: 'task-2389',
    missionData: {
      backlogStatus: 'active',
      reviewHistory: [],
      activity,
    },
    prInfo: null,
    staleWorktrees: [],
    staleWorktreeRebase: {},
    agentMatrix: [],
    lastThreeCommits: [],
    uncommittedCount: 0,
  } as unknown as StatusResult;
  renderStatus(result, (line) => lines.push(plain(line)));
  return lines;
}

test('px status renders live authoritative work and live coordinator evidence as separate facts', () => {
  const lines = renderStatusLines(projectMissionActivity(working('live', {
    liveSession: { missionId: 'task-2389' as never, family: agentFamily('claude') },
  })));

  assert.ok(lines.includes('Mission work: (live): execute'), lines.join('\n'));
  assert.ok(lines.includes('Coordinator evidence: live px command (claude) — recovery evidence only'), lines.join('\n'));
});

test('px status reports a recovery-only live coordinator without claiming mission work', () => {
  const lines = renderStatusLines(projectMissionActivity({
    currentWork: null,
    blockingReason: null,
    liveSession: { missionId: 'task-2389' as never, family: null },
  }));

  assert.ok(lines.includes('Mission work: none recorded'), lines.join('\n'));
  assert.ok(lines.includes('Coordinator evidence: live px command — recovery evidence only'), lines.join('\n'));
  assert.ok(!lines.some((line) => /running/.test(line)), `no line may claim a running agent. Got: ${lines.join('\n')}`);
});

test('px status reports unknown coordinator evidence when liveness was not observed', () => {
  const lines = renderStatusLines(projectMissionActivity({ currentWork: null, blockingReason: null }));

  assert.ok(lines.includes('Coordinator evidence: px command liveness unknown'), lines.join('\n'));
});

test('px status reports stale authoritative work as stale rather than dropping it', () => {
  const lines = renderStatusLines(projectMissionActivity(working('stale', { liveSession: null })));

  assert.ok(lines.includes('Mission work: (stale): execute'), lines.join('\n'));
  assert.ok(lines.includes('Coordinator evidence: no live px command'), lines.join('\n'));
});

test('px status reports blocked work with its reason and idle work as none recorded', () => {
  const blocked = renderStatusLines(projectMissionActivity({
    currentWork: null,
    blockingReason: 'operation cannot continue autonomously',
    liveSession: null,
  }));
  const idle = renderStatusLines(projectMissionActivity({ currentWork: null, blockingReason: null, liveSession: null }));

  assert.ok(blocked.includes('Mission work: blocked: operation cannot continue autonomously'), blocked.join('\n'));
  assert.ok(idle.includes('Mission work: none recorded'), idle.join('\n'));
});

test('px status omits the activity lines when the projection supplied none', () => {
  const lines = renderStatusLines(null);

  assert.ok(!lines.some((line) => line.startsWith('Mission work:')), lines.join('\n'));
  assert.ok(!lines.some((line) => line.startsWith('Coordinator evidence:')), lines.join('\n'));
});

// ---------- output contract: no unrequested "working" label, active-only animation ----------

/** Build a mission card with the given operational-fact overrides. */
function cardWithOverrides(facts: Partial<MissionOperationalFacts>): MissionCard {
  return projectMissionCard(
    {
      id: 'task-2399' as never,
      repositoryId: 'parallix' as never,
      title: 'Change the working UI',
      labels: [] as never,
      status: 'active',
      rawStatus: 'active',
      closedAt: null,
      assignee: null,
      checkpoints: [],
      review: null,
      netEngineeringLines: null,
    } as never,
    {
      latestGate: 'passed',
      reviewApproval: null,
      blockingReason: null,
      flags: [],
      currentWork: null,
      liveSession: undefined,
      ...facts,
    } as never,
  );
}

/** Render one MissionCard, returning the raw (ANSI-inclusive) frame. */
async function renderCard(card: MissionCard): Promise<string> {
  const ink = await import('ink');
  const React = await import('react');
  const { MissionCard: Card } = await import('../src/interfaces/tui/mission-card.js');
  return ink.renderToString(React.createElement(Card, { card, width: 40 }), { columns: 200 });
}

test('describeMissionWork drops the unrequested working label and keeps only the trust grade and phase', () => {
  const work = projectMissionActivity(working('live')).work;

  const text = describeMissionWork(work);
  assert.ok(!/working/i.test(text), `the working label must not reappear. Got: ${text}`);
  assert.match(text, /^(?:\(live\)): execute$/, `the trust grade and phase remain. Got: ${text}`);
});

test('px status omits the working label from the active mission work line', () => {
  const lines = renderStatusLines(projectMissionActivity(working('live')));

  const workLine = lines.find((line) => line.startsWith('Mission work:'));
  assert.ok(workLine, `the work fact must still render. Got: ${lines.join('\n')}`);
  assert.ok(!/working/i.test(workLine as string), `no working label in the status work line. Got: ${workLine}`);
  assert.ok(!lines.some((line) => /working/i.test(line)), `no line may carry the working label. Got: ${lines.join('\n')}`);
});

test('an active mission card receives a terminal-compatible activity treatment and an idle card does not', async () => {
  const active = await renderCard(cardWithOverrides({
    currentWork: {
      operationId: 'op-1',
      phase: 'execute',
      summary: 'running checkpoint 2',
      agent: agentFamily('claude'),
      updatedAt: '2026-08-22T10:00:00Z',
      freshness: 'live',
    },
  }));
  const idle = await renderCard(cardWithOverrides({ currentWork: null, liveSession: null }));

  assert.ok(/\u001b\[5m/.test(active), `the active card must carry a blink activity treatment. Got: ${JSON.stringify(active)}`);
  assert.ok(!/\u001b\[5m/.test(idle), `the idle card must not carry the activity treatment. Got: ${JSON.stringify(idle)}`);
});

test('a selected active card still carries the activity treatment', async () => {
  const ink = await import('ink');
  const React = await import('react');
  const { MissionCard: Card } = await import('../src/interfaces/tui/mission-card.js');
  const selectedActive = await ink.renderToString(
    React.createElement(Card, { card: cardWithOverrides({
      currentWork: {
        operationId: 'op-1',
        phase: 'execute',
        summary: 'running checkpoint 2',
        agent: agentFamily('codex'),
        updatedAt: '2026-08-22T10:00:00Z',
        freshness: 'live',
      },
    }), width: 40, selected: true }),
    { columns: 200 },
  );
  // The focused (▶) marker is rendered separately; the blink must still wrap
  // the marker for the selected active card, not be withheld from it.
  assert.ok(/\u001b\[5m/.test(selectedActive), `the selected active card must carry the blink treatment. Got: ${JSON.stringify(selectedActive)}`);
  // The selection arrow is present so the focused card stays identifiable.
  assert.ok(selectedActive.includes('\u25b6'), `the selected card must render the focus arrow. Got: ${JSON.stringify(selectedActive)}`);
});
