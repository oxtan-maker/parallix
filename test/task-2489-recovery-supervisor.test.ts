// task-2489: the fleet-level recovery supervisor (ADR 0059).
//
// What the supervisor reacts to is the board's own "needs your attention" queue
// — the same list the web board shows a human. These tests drive it with a
// scripted queue: no filesystem, no Forgejo, no agent launch. What is pinned
// here is that it presses the action the board advertises, never presses
// integrate, recovers only what the board's own action could not clear, and
// counts its attempts per failure.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  attentionDetail,
  failureFingerprint,
  HUMAN_ONLY_ACTIONS,
  observationFromAttention,
  RECOVERY_BUDGET,
  recoveryInstruction,
  superviseFleet,
  type AttentionObservation,
  type MissionSupervision,
  type Poll,
  type RecoveryRequest,
  type SupervisorPort,
} from '../src/application/recovery-supervisor.js';
import { createLeadCommand, leadInvocation } from '../src/interfaces/cli/lead.js';
import { claimRecoveryLock } from '../src/adapters/filesystem/recovery-claim.js';
import { pollingPause } from '../src/adapters/process/polling-pause.js';
import { AGENT_WORK_STAGE_BY_ACTIVITY } from '../src/domain/usage.js';
import type { AttentionItem, AttentionReason } from '../src/application/projections/board.js';
import type { BoardLane, CommandAvailability, MissionCard } from '../src/application/projections/mission-board.js';
import { agentFamily } from '../src/domain/agents.js';
import { missionId, missionLabels } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';

const MISSION = 'task-2489-stuck';

const GATE_FAILED: AttentionReason = { kind: 'gate-failed', detail: 'Gate failed' };

/** A cancellable pause, shaped like the production polling timer. */
function pause(milliseconds: number): Poll {
  let timer: NodeJS.Timeout | undefined;
  const elapsed = new Promise<void>((resolve) => { timer = setTimeout(resolve, milliseconds); });
  return { elapsed, cancel: () => { if (timer) { clearTimeout(timer); } } };
}

function item(overrides: Partial<AttentionObservation> = {}): AttentionObservation {
  return {
    missionId: MISSION,
    lane: 'active',
    reason: GATE_FAILED,
    action: { kind: 'active:execute', display: `px active ${overrides.missionId ?? MISSION}` },
    working: false,
    workingDetail: null,
    progress: 'active|failed|-|-|-|-|sha0',
    ...overrides,
  };
}

interface Recorder {
  readonly port: SupervisorPort;
  readonly ran: Array<[string, string]>;
  readonly recoveries: RecoveryRequest[];
  readonly released: string[];
  readonly waits: number[];
  /** Attention-queue reads: one per pass. */
  readonly reads: () => number;
}

/**
 * A board driven by a script of attention queues, one entry per pass. The last
 * entry repeats, so a test says exactly what the board reports at each pass.
 */
function board(passes: Array<readonly AttentionObservation[]>, options: {
  readonly claimable?: boolean;
  readonly actionFails?: string;
  readonly launchFails?: string;
} = {}): Recorder {
  const ran: Array<[string, string]> = [];
  const recoveries: RecoveryRequest[] = [];
  const released: string[] = [];
  const waits: number[] = [];
  let pass = -1;
  const current = (): readonly AttentionObservation[] => passes[Math.min(Math.max(pass, 0), passes.length - 1)];
  const port: SupervisorPort = {
    attention: async () => {
      pass += 1;
      return current();
    },
    missionExists: async (mission) => passes.some((entries) => entries.some((entry) => entry.missionId === mission)),
    liveness: async (mission) => {
      const entry = current().find((candidate) => candidate.missionId === mission);
      return { working: entry?.working ?? false, detail: entry?.workingDetail ?? null };
    },
    runAction: async (mission, action) => {
      ran.push([mission, action.kind]);
      if (options.actionFails) { throw new Error(options.actionFails); }
    },
    claimRecovery: async (mission) => {
      if (options.claimable === false) { return null; }
      return async () => { released.push(mission); };
    },
    launchRecovery: async (request) => {
      recoveries.push(request);
      if (options.launchFails) { throw new Error(options.launchFails); }
      return 'claude ran in /tmp/worktree';
    },
    // Recorded, and yielded to the macrotask queue: a pause that resolves
    // synchronously would starve the timers the tests themselves rely on.
    wait: (milliseconds) => {
      waits.push(milliseconds);
      return pause(1);
    },
  };
  return { port, ran, recoveries, released, waits, reads: () => pass + 1 };
}

function resultFor(results: readonly MissionSupervision[], mission = MISSION): MissionSupervision {
  const found = results.find((result) => result.missionId === mission);
  assert.ok(found, `${mission} was supervised`);
  return found;
}

test('the work list is the board attention queue, in the board order', async () => {
  const fleet = board([
    [
      item({ missionId: 'task-a', action: { kind: 'active:execute', display: 'px active task-a' } }),
      item({ missionId: 'task-b', reason: { kind: 'review-lane', detail: 'Awaiting review decision' }, action: { kind: 'review:submit', display: 'px review task-b' } }),
    ],
    [],
  ]);

  const results = await superviseFleet(fleet.port);

  assert.deepEqual(fleet.ran, [['task-a', 'active:execute'], ['task-b', 'review:submit']], 'the board decides the order and the command');
  assert.deepEqual(results.map((result) => result.outcome), ['cleared', 'cleared']);
});

test('a mission the board stops asking about is cleared — the queue is the proof', async () => {
  const fleet = board([[item()], []]);

  const results = await superviseFleet(fleet.port);

  assert.equal(resultFor(results).outcome, 'cleared');
  assert.deepEqual(fleet.recoveries, [], 'the board action cleared the item, so no agent was started');
});

test('a mission hidden by live work is watched, not cleared', async () => {
  const stuck = item();
  let reads = 0;
  let livenessReads = 0;
  const port: SupervisorPort = {
    attention: async () => (++reads === 1 ? [stuck] : []),
    missionExists: async () => true,
    liveness: async () => ({
      working: ++livenessReads === 2,
      detail: livenessReads === 2 ? 'execute — running (live, now)' : null,
    }),
    runAction: async () => {},
    claimRecovery: async () => async () => {},
    launchRecovery: async () => 'not reached',
    wait: () => pause(0),
  };

  const results = await superviseFleet(port, { budget: 0, pollMs: 1 });

  assert.equal(reads, 3, 'the live mission is re-read instead of being treated as cleared');
  assert.equal(resultFor(results).outcome, 'cleared');
});

test('the supervisor never integrates: an integration item is left for the human', async () => {
  const fleet = board([[item({
    lane: 'integration',
    reason: { kind: 'integrate-lane', detail: 'Awaiting integration' },
    action: { kind: 'integrate:merge', display: `px integrate ${MISSION}` },
  })]]);

  const results = await superviseFleet(fleet.port);

  assert.equal(resultFor(results).outcome, 'human');
  assert.deepEqual(fleet.ran, [], 'no command is run for an item the human owns');
  assert.deepEqual(fleet.recoveries, [], 'and no agent is sent to do it instead');
  assert.match(resultFor(results).summary, /never integrates/);
  assert.ok(HUMAN_ONLY_ACTIONS.has('integrate:merge'));
});

test('the supervisor leaves refined missions for operator activation', async () => {
  const refined = item({
    lane: 'refined',
    action: { kind: 'active:execute', display: `px active ${MISSION}` },
  });
  const fleet = board([[refined]]);

  const results = await superviseFleet(fleet.port);

  assert.deepEqual(results, []);
  assert.deepEqual(fleet.ran, [], 'lead never starts a refined mission');
  assert.deepEqual(fleet.recoveries, []);
});

test('a mission with a working agent is never on the queue, so it is never touched', async () => {
  // `attentionReason` returns `none` while an agent is working, so the queue the
  // supervisor reads simply does not contain it.
  const card = makeCard({ currentWork: {
    operationId: 'op-live', phase: 'execute', summary: 'writing CP-2',
    agent: agentFamily('claude'), updatedAt: '2026-09-12T09:00:00.000Z', freshness: 'unverified',
  } });

  const fleet = board([[]]);
  const results = await superviseFleet(fleet.port);

  assert.deepEqual(results, [], 'an empty attention queue is an empty run');
  assert.equal(observationFromAttention(makeItem(card), null).working, true, 'unverified current work still counts as working');
});

test('the board action is pressed once per state, then recovery takes over', async () => {
  const stuck = item();
  const fleet = board([[stuck]]);

  const results = await superviseFleet(fleet.port, { budget: 1 });

  assert.deepEqual(fleet.ran, [[MISSION, 'active:execute']], 'the same action against the same facts runs once');
  assert.equal(fleet.recoveries.length, 1, 'the item survived the board action, so an agent was sent');
  assert.equal(resultFor(results).outcome, 'escalated');
});

test('the recovery worker gets the board reason, the action that failed, and the constraints', async () => {
  const fleet = board([[item({ reason: { kind: 'blocking', detail: 'worktree is dirty' } })]]);

  await superviseFleet(fleet.port, { budget: 1 });

  const [request] = fleet.recoveries;
  assert.equal(request.missionId, MISSION);
  assert.match(request.diagnostic, /blocking: worktree is dirty/);
  assert.match(request.attemptedOperation, /px active/);
  assert.match(request.instruction, /worktree is dirty/);
  assert.match(request.instruction, /evidence, not a diagnosis/, 'the board reason is evidence, never an asserted root cause');
  assert.match(request.instruction, /px integrate/, 'the integration boundary is stated to the worker');
  assert.match(request.instruction, /weaken, skip or remove a gate/);
  assert.match(request.instruction, /outside this mission's scope/);
  assert.match(request.instruction, /Do the recovery now/);
  assert.match(request.instruction, /Do not stop after diagnosing/);
  assert.match(request.instruction, /Run the appropriate supported Parallix command/);
  assert.match(request.instruction, /Report completion only after the original/);
});

test('an attention reason a classifier would call human-only still gets a recovery attempt', async () => {
  // ADR 0048 would classify this HumanOnly and refuse to bounce. The supervisor
  // answers a different question — the board still wants attention — so it tries.
  const fleet = board([[item({ reason: { kind: 'blocking', detail: 'HUMAN ONLY: unknown harness failure' } })]]);

  const results = await superviseFleet(fleet.port, { budget: 1 });

  assert.equal(fleet.recoveries.length, 1);
  assert.equal(resultFor(results).outcome, 'escalated');
});

test('the budget is spent per failure, like every other retry budget in the repo', async () => {
  const fleet = board([[item({ reason: { kind: 'blocking', detail: 'rebase conflict left unresolved at line 41' } })]]);

  const results = await superviseFleet(fleet.port);

  assert.equal(RECOVERY_BUDGET, 2);
  assert.equal(fleet.recoveries.length, RECOVERY_BUDGET, 'one failure gets the budget and no more');
  assert.equal(resultFor(results).outcome, 'escalated');
  assert.match(resultFor(results).summary, /survived px active .* and 2 recovery attempt\(s\)/);
  assert.ok(resultFor(results).steps.some((step) => step.includes('rebase conflict left unresolved')));
});

test('a different attention reason reopens an escalated mission with its own attempts', async () => {
  const first = item({ reason: { kind: 'gate-failed', detail: 'Gate failed' } });
  const second = item({ reason: { kind: 'blocking', detail: 'worktree is dirty' }, progress: 'active|failed|-|-|-|-|sha1' });
  const fleet = board([[first], [first], [first], [second], [second], [second]]);

  const results = await superviseFleet(fleet.port, { budget: 1 });

  assert.equal(fleet.recoveries.length, 2, 'the second, different failure was not refused as budget-spent');
  assert.deepEqual(
    fleet.recoveries.map((request) => request.diagnostic),
    ['gate-failed: Gate failed', 'blocking: worktree is dirty'],
  );
  assert.equal(fleet.ran.length, 2, 'the newly observed failure gets its own advertised action before recovery');
  assert.ok(resultFor(results).steps.some((step) => step.includes('different failure')));
  assert.equal(resultFor(results).outcome, 'escalated');
});

test('the same reason with a moved line number or count is still the same failure', () => {
  const at = (line: number) => item({ reason: { kind: 'blocking', detail: `gate failed at foo.ts:${line} after 3 retries` } });

  assert.equal(failureFingerprint(at(41)), failureFingerprint(at(87)));
  assert.notEqual(failureFingerprint(at(41)), failureFingerprint(item()));
  assert.equal(attentionDetail({ kind: 'none' }), 'the board reports nothing');
});

test('a recovery agent that exits successfully is not itself evidence', async () => {
  const stuck = item();
  // The item is still on the queue after the first agent claimed success; it is
  // gone after the second, and only that clears the mission.
  const fleet = board([[stuck], [stuck], [stuck], []]);

  const results = await superviseFleet(fleet.port, { pollMs: 1 });

  assert.equal(fleet.recoveries.length, 2, 'the first agent changed nothing the board can see, so a second ran');
  assert.equal(resultFor(results).outcome, 'cleared');
  assert.ok(resultFor(results).steps.some((step) => step.includes('recovery agent 2/2')));
});

test('recovery is claimed, released, and skipped when another run holds the claim', async () => {
  const held = board([[item()]], { claimable: false });

  const blocked = await superviseFleet(held.port, { budget: 1, once: true });

  assert.deepEqual(held.recoveries, [], 'a mission claimed by another supervisor run is not recovered twice');
  assert.equal(resultFor(blocked).outcome, 'open');

  const free = board([[item()]], { launchFails: 'agent could not start' });
  const failed = await superviseFleet(free.port, { budget: 1 });

  assert.deepEqual(free.released, [MISSION], 'the claim is released even when the launch throws');
  assert.equal(resultFor(failed).outcome, 'escalated');
  assert.ok(resultFor(failed).steps.some((step) => step.includes('agent could not start')));
});

test('work that starts between reading the queue and launching cancels the recovery', async () => {
  const stuck = item();
  // Pass 1 presses the board action. Pass 2 reaches recovery, but by the time
  // the claim is held an agent is running again.
  const fleet = board([
    [stuck],
    [{ ...stuck, working: true, workingDetail: 'execute — resumed (live, now)' }],
    [],
  ]);

  const results = await superviseFleet(fleet.port, { budget: 1, pollMs: 1 });

  assert.deepEqual(fleet.recoveries, [], 'liveness is rechecked inside the claim');
  assert.deepEqual(fleet.released, [MISSION], 'the claim is released without launching');
  assert.equal(resultFor(results).outcome, 'cleared');
});

test('a transient board-action failure is retried before recovery', async () => {
  const stuck = item({ reason: { kind: 'review-lane', detail: 'Awaiting review decision' }, action: { kind: 'review:submit', display: `px review ${MISSION}` } });
  const fleet = board([[stuck], [stuck], []]);
  let attempts = 0;
  const port: SupervisorPort = {
    ...fleet.port,
    runAction: async (mission, action) => {
      attempts += 1;
      if (attempts === 1) { throw new Error('px review exited 1'); }
      await fleet.port.runAction(mission, action);
    },
    wait: () => pause(0),
  };

  const results = await superviseFleet(port, { budget: 1, pollMs: 1 });

  assert.ok(resultFor(results).steps.some((step) => step.includes('px review exited 1')));
  assert.equal(attempts, 2, 'the failed press was not recorded as spent');
  assert.deepEqual(fleet.recoveries, [], 'a transient command failure does not spend recovery budget');
  assert.equal(resultFor(results).outcome, 'cleared');
});

test('a persistently failing board action reaches recovery and escalation', async () => {
  const fleet = board([[item()]], { actionFails: 'Forgejo unavailable' });

  const results = await superviseFleet(fleet.port, { budget: 1, pollMs: 1 });

  assert.equal(fleet.ran.length, 2, 'the action has a bounded retry before recovery');
  assert.equal(fleet.recoveries.length, 1, 'recovery still diagnoses a persistently failing command');
  assert.equal(resultFor(results).outcome, 'escalated');
});

test('a transient board read waits and does not orphan an in-flight step', async () => {
  const stuck = item();
  let reads = 0;
  let waits = 0;
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const port: SupervisorPort = {
    missionExists: async () => true,
    attention: async () => {
      reads += 1;
      if (reads === 1) { return [stuck]; }
      if (reads === 2) { throw new Error('board temporarily unavailable'); }
      return [];
    },
    liveness: async () => ({ working: stuck.working, detail: stuck.workingDetail }),
    runAction: async () => { await pending; },
    claimRecovery: async () => async () => {},
    launchRecovery: async () => 'not reached',
    wait: () => {
      waits += 1;
      if (waits === 2) { release?.(); }
      return pause(0);
    },
  };

  const results = await superviseFleet(port, { pollMs: 1 });

  assert.ok(reads >= 3, 'a failed read is retried');
  assert.equal(resultFor(results).outcome, 'cleared', 'the running step is awaited before reporting');
  assert.ok(resultFor(results).steps.some((step) => step.includes('board read failed')));
});

test('an unreadable board is reported and fails instead of looking empty', async () => {
  const failures: string[] = [];
  const fleet = board([[]]);
  const port: SupervisorPort = { ...fleet.port, attention: async () => { throw new Error('database busy'); } };

  await assert.rejects(
    superviseFleet(port, { once: true, onBoardReadFailure: (error) => failures.push(error.message) }),
    /Could not read the board/,
  );
  assert.match(failures.join('\n'), /database busy/);
});

test('one escalated mission never stops the rest of the queue', async () => {
  const stuck = item({ missionId: 'task-stuck', action: { kind: 'active:execute', display: 'px active task-stuck' } });
  const moving = item({ missionId: 'task-moving', action: { kind: 'active:execute', display: 'px active task-moving' } });
  const fleet = board([[stuck, moving], [stuck, moving], [stuck]], { launchFails: 'agent could not start' });

  const results = await superviseFleet(fleet.port, { budget: 1, pollMs: 1 });

  assert.equal(resultFor(results, 'task-stuck').outcome, 'escalated');
  assert.equal(resultFor(results, 'task-moving').outcome, 'cleared');
});

test('an item that appears mid-run is picked up on the next pass', async () => {
  const late = item({ missionId: 'task-late', action: { kind: 'active:execute', display: 'px active task-late' } });
  const fleet = board([[item()], [late], []]);

  const results = await superviseFleet(fleet.port);

  assert.ok(results.some((result) => result.missionId === 'task-late'), 'the queue is re-read every pass');
});

// ── The board-to-observation mapping ────────────────────────────────────────

function makeCard(overrides: Partial<MissionCard> = {}): MissionCard {
  const commands: CommandAvailability[] = [{ command: 'active', enabled: true, reason: null }];
  return {
    id: missionId('task-2489-card'), repositoryId: repositoryId('task-2489'), title: 'card',
    labels: missionLabels(['ai_sdlc']), lane: 'active' as BoardLane, status: 'active', rawStatus: 'active',
    closed: false, agent: agentFamily('claude'), checkpoint: 'CP-2.md', checkpointDescription: null,
    nextActionText: null, gate: 'failed', pullRequest: null, reviewApproved: false, reviewRound: null,
    reviewPhase: null, reviewDisposition: null, reviewHistory: [], currentWork: null,
    blockingReason: null, flags: [], commands,
    ...overrides,
  } as MissionCard;
}

function makeItem(card: MissionCard): AttentionItem {
  return {
    missionId: card.id,
    rank: 1,
    reason: GATE_FAILED,
    card,
    action: { kind: 'active:execute', display: `px active ${card.id}` },
    dependsOnSources: [],
  };
}

test('the observation carries the board reason and action unchanged', () => {
  const observed = observationFromAttention(makeItem(makeCard()), 'sha1');

  assert.deepEqual(observed.reason, GATE_FAILED, 'the board owns the reason; the supervisor does not re-derive it');
  assert.equal(observed.action.kind, 'active:execute');
  assert.equal(observed.working, false);
  assert.match(observed.progress, /sha1/);
});

test('the branch head is part of progress, so a commit-only repair counts as movement', () => {
  assert.notEqual(
    observationFromAttention(makeItem(makeCard()), 'sha1').progress,
    observationFromAttention(makeItem(makeCard()), 'sha2').progress,
  );
});

test('the recovery instruction stands alone without the supervisor', () => {
  const instruction = recoveryInstruction({
    missionId: MISSION, lane: 'active', diagnostic: 'gate-failed: Gate failed', attemptedOperation: `px active ${MISSION}`,
  });

  assert.match(instruction, /gate-failed: Gate failed/);
  assert.match(instruction, new RegExp(`px active ${MISSION}`));
  assert.match(instruction, /restore the mission to a state where the normal Parallix workflow can continue/);
});

// ── The command surface ─────────────────────────────────────────────────────

test('px lead works the whole attention queue with no arguments', async () => {
  const fleet = board([
    [
      item({ missionId: 'task-a', action: { kind: 'active:execute', display: 'px active task-a' } }),
      item({ missionId: 'task-b', action: { kind: 'active:execute', display: 'px active task-b' } }),
    ],
    [],
  ]);
  const lines: string[] = [];

  const code = await createLeadCommand(fleet.port, (line) => lines.push(line))(['--once']);

  assert.equal(code, 0);
  assert.deepEqual(fleet.ran.map(([mission]) => mission), ['task-a', 'task-b']);
  assert.match(lines.join('\n'), /pass 1: 2 mission\(s\) on the attention queue/);
});

test('px lead narrows to the missions named, and reports an empty queue', async () => {
  const fleet = board([
    [
      item({ missionId: 'task-a', action: { kind: 'active:execute', display: 'px active task-a' } }),
      item({ missionId: 'task-b', action: { kind: 'active:execute', display: 'px active task-b' } }),
    ],
    [],
  ]);

  await createLeadCommand(fleet.port, () => {})(['task-a', '--once']);
  assert.deepEqual(fleet.ran, [['task-a', 'active:execute']], 'task-b was not touched');

  const empty = board([[]]);
  const lines: string[] = [];
  assert.equal(await createLeadCommand(empty.port, (line) => lines.push(line))(['--once']), 0);
  assert.match(lines.join('\n'), /asks for attention on nothing/);
});

test('px lead --dry-run prints the queue and acts on none of it', async () => {
  const fleet = board([[item()]]);
  const lines: string[] = [];

  const code = await createLeadCommand(fleet.port, (line) => lines.push(line))(['--dry-run']);

  assert.equal(code, 0);
  assert.match(lines.join('\n'), /gate-failed: Gate failed.*board offers px active/s);
  assert.deepEqual(fleet.ran, []);
  assert.deepEqual(fleet.recoveries, []);
});

test('px lead --dry-run omits refined missions awaiting operator activation', async () => {
  const fleet = board([[item({ lane: 'refined' })]]);
  const lines: string[] = [];

  const code = await createLeadCommand(fleet.port, (line) => lines.push(line))(['--dry-run']);

  assert.equal(code, 0);
  assert.match(lines.join('\n'), /asks for attention on nothing/);
  assert.deepEqual(fleet.ran, []);
});

test('px lead keeps watching an unchanged integration handoff without duplicate output', async () => {
  const waiting = item({
    lane: 'integration',
    reason: { kind: 'integrate-lane', detail: 'Awaiting integration' },
    action: { kind: 'integrate:merge', display: `px integrate ${MISSION}` },
  });
  const fleet = board([[waiting]]);
  const lines: string[] = [];
  let reads = 0;
  const port: SupervisorPort = {
    ...fleet.port,
    attention: async () => {
      reads += 1;
      if (reads > 2) { throw new Error('test stop'); }
      return [waiting];
    },
    wait: () => pause(0),
  };

  await assert.rejects(createLeadCommand(port, (line) => lines.push(line))(['--poll', '0.001']), /Could not read the board/);
  assert.equal(reads, 4, 'the integration handoff is polled again instead of ending the lead run');
  assert.equal(lines.filter((line) => line.includes('waiting for you')).length, 1);
});

test('px lead --once reports a single pass without treating pending recovery as an escalation', async () => {
  const fleet = board([[item()]]);
  const lines: string[] = [];

  const code = await createLeadCommand(fleet.port, (line) => lines.push(line))(['--budget', '1', '--once']);

  assert.equal(code, 0);
  assert.equal(fleet.recoveries.length, 0, '--once performs only the advertised board action');
  assert.doesNotMatch(lines.join('\n'), /escalated/);
  assert.match(lines.join('\n'), /pass 1/);
});

test('px lead presses commands that do work, never a status print or integrate', () => {
  assert.deepEqual(leadInvocation('active:execute', 'task-a'), { command: 'active', args: ['task-a'] });
  assert.deepEqual(leadInvocation('review:submit', 'task-a'), { command: 'review', args: ['task-a', '--continue'] });
  assert.equal(leadInvocation('integrate:merge', 'task-a'), null);
});

test('px lead rejects an unusable budget, an unusable poll, and unknown options', async () => {
  const fleet = board([[item()]]);
  await assert.rejects(createLeadCommand(fleet.port, () => {})(['--budget', '-1']), /non-negative whole number/);
  await assert.rejects(createLeadCommand(fleet.port, () => {})(['--poll', '0']), /number of seconds/);
  await assert.rejects(createLeadCommand(fleet.port, () => {})(['--daemon']), /Unknown lead option/);
});

test('px lead rejects an unknown mission instead of treating it as an empty board', async () => {
  const fleet = board([[item({ missionId: 'task-real' })]]);

  await assert.rejects(createLeadCommand(fleet.port, () => {})(['task-typo']), /Unknown mission: task-typo/);
});

// ── The cross-run recovery claim ────────────────────────────────────────────

test('only one supervisor run holds a mission claim, and a released claim is available again', async () => {
  const mission = `task-2489-claim-${process.pid}`;

  const held = claimRecoveryLock(mission);
  assert.ok(held, 'the first run takes the claim');
  assert.equal(claimRecoveryLock(mission), null, 'a second run is refused while the first holds it');
  await held();

  const again = claimRecoveryLock(mission);
  assert.ok(again, 'a released claim is available');
  await again();
});

test('a live agent is never dispatched onto, even when the board ranks its failed gate first', async () => {
  // The queue ranks a failed gate above liveness, so a mission with a running
  // agent does appear on it. Dispatching a command there would collide with the
  // agent mid-flight.
  const live = item({ working: true, workingDetail: 'execute — gate re-running (live, now)' });
  const fleet = board([[live], []]);

  const results = await superviseFleet(fleet.port, { once: true });

  assert.deepEqual(fleet.ran, [], 'no command is dispatched onto a working mission');
  assert.deepEqual(fleet.recoveries, [], 'and no recovery agent either');
  assert.equal(resultFor(results).outcome, 'open');
});

test('a mission whose agent is still running does not stop the rest of the fleet', async () => {
  const slow = item({ missionId: 'task-slow', action: { kind: 'active:execute', display: 'px active task-slow' } });
  const quick = item({ missionId: 'task-quick', action: { kind: 'active:execute', display: 'px active task-quick' } });
  let releaseSlow: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => { releaseSlow = resolve; });
  const fleet = board([[slow, quick], [slow, quick], [slow]]);
  const port: SupervisorPort = {
    ...fleet.port,
    runAction: async (mission, action) => {
      if (mission === 'task-slow') { await pending; }
      return fleet.port.runAction(mission, action);
    },
  };

  const run = superviseFleet(port, { budget: 0, pollMs: 1 });
  // The slow mission's command has not returned, and the quick one is already
  // supervised through to escalation.
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(fleet.ran.some(([mission]) => mission === 'task-quick'), 'the fleet moved on while one agent was still running');
  releaseSlow?.();
  const results = await run;

  assert.equal(resultFor(results, 'task-quick').outcome, 'escalated');
  assert.equal(fleet.ran.filter(([mission]) => mission === 'task-slow').length, 1, 'and the slow mission got exactly one step at a time');
});

test('a claim is never visible without its owner, and only a readable dead owner is taken over', async () => {
  const mission = `task-2489-race-${process.pid}`;
  const dir = path.join(os.tmpdir(), 'parallix-recovery-claims', mission);

  const held = claimRecoveryLock(mission);
  assert.ok(held, 'the claim is taken');
  assert.equal(fs.readFileSync(path.join(dir, 'owner'), 'utf8').split('\n')[0], String(process.pid),
    'the owner is published before the claim directory exists, so no racing run can read an ownerless claim');
  assert.equal(claimRecoveryLock(mission), null, 'a live claim is refused');
  await held();

  // A claim with no readable owner is not a corpse to be stolen.
  fs.mkdirSync(dir, { recursive: true });
  assert.equal(claimRecoveryLock(mission), null, 'an unreadable claim is left alone');

  // A claim whose recorded owner is gone is taken over.
  fs.writeFileSync(path.join(dir, 'owner'), '2147483646\ndead-token', 'utf8');
  const takenOver = claimRecoveryLock(mission);
  assert.ok(takenOver, 'a dead owner is taken over');
  assert.equal(fs.readFileSync(path.join(dir, 'owner'), 'utf8').split('\n')[0], String(process.pid));
  await takenOver();
  assert.equal(fs.existsSync(dir), false, 'releasing removes the claim');
});

test('a mission that clears and comes back is supervised again, keeping the attempts it spent', async () => {
  const stuck = item();
  // A second mission keeps the run alive while the first clears and comes back.
  const other = item({ missionId: 'task-other', action: { kind: 'active:execute', display: 'px active task-other' } });
  const fleet = board([[stuck, other], [other], [stuck, other], [other], []]);

  const results = await superviseFleet(fleet.port, { budget: 1, pollMs: 1 });

  assert.ok(resultFor(results).steps.some((step) => step.includes('back on the attention queue')));
  assert.equal(fleet.ran.filter(([mission]) => mission === MISSION).length, 1, 'the board action was already spent on this state');
  assert.equal(
    fleet.recoveries.filter((request) => request.missionId === MISSION).length,
    1,
    'the returning item is worked again, with the attempts it had left',
  );
  assert.equal(resultFor(results).outcome, 'cleared');
});

test('a recovery launch is attributed, so mission usage does not under-report it', () => {
  // A recovery agent spends tokens like any other launch. The domain forbids a
  // known token-using activity from disappearing into `default`.
  assert.equal(AGENT_WORK_STAGE_BY_ACTIVITY.recovery, 'execute');

  // And the launch site records them: the wiring reads the launcher result and
  // hands it to the same stats recorder every other stage launch uses.
  const composition = fs.readFileSync('src/composition/create-cli.ts', 'utf8');
  const launchRecovery = composition.slice(composition.indexOf('launchRecovery:'));
  assert.match(launchRecovery.slice(0, launchRecovery.indexOf('\n      },')), /recordStageStatsSafe\('active', \{\s*\n\s*stage: 'recovery'/,
    'the recovery launch records its telemetry');
  assert.doesNotMatch(launchRecovery.slice(0, launchRecovery.indexOf('\n      },')), /unknown agent/,
    'a launch without a reported family is not written as a fictitious implementer');
  assert.match(launchRecovery, /Starting fresh recovery agent/,
    'the operator can see that the general recovery prompt was launched');
  assert.match(launchRecovery, /const worktree = missionWorktree \?\? expectedWorktree/,
    'a broken mission mapping still launches from its conventional workspace');
  assert.match(launchRecovery, /repair its git worktree state while preserving unrelated changes/,
    'the recovery agent is told to preserve work found in the broken workspace');
  assert.match(launchRecovery, /Recovery prompt for .*\$\{prompt\}/,
    'the complete recovery prompt is visible while lead stabilizes');
  assert.match(launchRecovery, /agents\.startAgent\('execute', \{[\s\S]*?worktree,/,
    'recovery uses the common mutating-agent confinement path');
  assert.match(launchRecovery, /services\.mission\?\.store\.load\(missionId\(request\.missionId\)\)[\s\S]*?agent: assignedAgent/,
    'recovery starts with the mission authority\'s assigned implementer family');
  assert.doesNotMatch(launchRecovery, /pinnedAgent:\s*true/,
    'the normal unavailable and usage-limit family fallback remains available');
  assert.doesNotMatch(launchRecovery, /allowUnsandboxedMutation/,
    'lead recovery cannot bypass bubblewrap or the native-sandbox fallback policy');
  assert.match(launchRecovery, /Recovery agent .* finished .* rechecking the board/,
    'the operator can distinguish a completed launch from another normal action retry');
  assert.match(launchRecovery, /Recovery agent .* failed:/,
    'a consumed recovery attempt cannot fail invisibly');
});

test('lead starts long forward workflows without blocking fleet supervision', () => {
  const composition = fs.readFileSync('src/composition/create-cli.ts', 'utf8');
  const runAction = composition.slice(composition.indexOf('runAction: async'));
  assert.match(
    runAction,
    /createProductionApplicationServices\(missionWorktree\)[\s\S]*?startForward\(mission, action, \(\) => active\(invocation\.args, \{[\s\S]*?controller,/,
    'lead active recovery must use a controller rooted in the mission worktree',
  );
  assert.match(
    composition,
    /const forward: Promise<unknown> = Promise\.resolve\(\)\.then\(work\)[\s\S]*?currentWork\.ended\(publication\)/,
    'the forward workflow runs in the background and clears its liveness marker when it ends',
  );
  assert.match(
    runAction,
    /startForward\(mission, action, \(\) => run\(\s*\[invocation\.command, \.\.\.invocation\.args\],\s*\{ baseCwd: missionWorktree,/,
    'review work is also started without awaiting its autonomous loop, targeted at the mission worktree',
  );
  assert.match(
    composition,
    /createLeadCommand\(buildLeadPort\(services, forwards\)\)\(args\); \} finally \{ await Promise\.allSettled\(forwards\); \}/,
    'lead settles the forwards it started only after its fleet loop returns, before its graph closes',
  );
});

// ── Regressions from review round 7 ─────────────────────────────────────────

test('a pending agent does not stop the queue from being read for new missions', async () => {
  // `task-slow`'s recovery agent only finishes once `task-appeared` — which
  // becomes stuck while it runs — has been supervised. A loop that waits only
  // on its in-flight step never reads the queue again and deadlocks here.
  const slow = item({ missionId: 'task-slow', action: { kind: 'active:execute', display: 'px active task-slow' } });
  const appeared = item({ missionId: 'task-appeared', action: { kind: 'active:execute', display: 'px active task-appeared' } });
  let release: (() => void) | undefined;
  const agentRunning = new Promise<void>((resolve) => { release = resolve; });
  let launchStarted = false;
  let slowDone = false;
  let appearedHandled = false;
  let reads = 0;
  const waits: number[] = [];
  const queue = (): AttentionObservation[] => [
    ...(slowDone ? [] : [slow]),
    ...(launchStarted && !appearedHandled ? [appeared] : []),
  ];
  const ran: string[] = [];
  const port: SupervisorPort = {
    attention: async () => { reads += 1; return queue(); },
    missionExists: async () => true,
    liveness: async (mission) => {
      const entry = queue().find((candidate) => candidate.missionId === mission);
      return { working: entry?.working ?? false, detail: entry?.workingDetail ?? null };
    },
    runAction: async (mission) => {
      ran.push(mission);
      if (mission === 'task-appeared') { appearedHandled = true; release?.(); }
    },
    claimRecovery: async () => async () => {},
    launchRecovery: async () => {
      launchStarted = true;
      await agentRunning;
      slowDone = true;
      return 'claude ran in /tmp/worktree';
    },
    wait: (milliseconds) => { waits.push(milliseconds); return pause(1); },
  };

  const results = await superviseFleet(port, { budget: 1, pollMs: 5 });

  assert.ok(ran.includes('task-appeared'), 'the mission that became stuck while an agent ran was supervised');
  assert.ok(reads > 2, `the queue was read again while the agent was pending; read ${reads} time(s)`);
  assert.ok(waits.length > 0, 'the polling interval is raced against the pending step');
  assert.equal(resultFor(results, 'task-slow').outcome, 'cleared');
});

test('a live or claimed mission is polled, not spun on', async () => {
  // Keep the mission live until eight polling intervals have elapsed. Advancing
  // only from wait avoids a clock boundary between attention and liveness.
  // A loop that treats `watching` as a wake-up still reads the queue too often.
  const live = item({ working: true, workingDetail: 'execute — running (live, now)' });
  let elapsedPolls = 0;
  let reads = 0;
  const waits: number[] = [];
  const ran: string[] = [];
  const current = (): AttentionObservation[] => (elapsedPolls < 8 ? [live] : []);
  const port: SupervisorPort = {
    attention: async () => { reads += 1; return current(); },
    missionExists: async () => true,
    liveness: async () => ({ working: current()[0]?.working ?? false, detail: current()[0]?.workingDetail ?? null }),
    runAction: async (mission) => { ran.push(mission); },
    claimRecovery: async () => async () => {},
    launchRecovery: async () => 'claude ran in /tmp/worktree',
    wait: (milliseconds) => {
      waits.push(milliseconds);
      const poll = pause(milliseconds);
      return { elapsed: poll.elapsed.then(() => { elapsedPolls += 1; }), cancel: poll.cancel };
    },
  };

  await superviseFleet(port, { pollMs: 5 });

  assert.deepEqual(ran, [], 'a live mission is never dispatched onto');
  assert.ok(reads <= 12, `the queue is read once per polling interval, not spun on; read ${reads} time(s)`);
  assert.ok(waits.length >= 1, 'and every pass that moved nothing waited out the interval');
  assert.deepEqual([...new Set(waits)], [5], 'for the configured interval');
});

test('two runs that saw the same dead owner cannot both take the claim', async () => {
  const mission = `task-2489-interleave-${process.pid}`;
  const dir = path.join(os.tmpdir(), 'parallix-recovery-claims', mission);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'owner'), '2147483646\ndead-token', 'utf8');

  // B reads the dead owner, and A completes its whole takeover inside that
  // window. B must then find A's live claim and give up rather than delete it.
  let winner: (() => Promise<void>) | null = null;
  const loser = claimRecoveryLock(mission, {
    onDeadOwnerObserved: () => { winner = claimRecoveryLock(mission); },
  });

  assert.ok(winner, 'the run that got there first holds the claim');
  assert.equal(loser, null, 'the run holding a stale observation does not steal it back');
  assert.equal(fs.readFileSync(path.join(dir, 'owner'), 'utf8').split('\n')[0], String(process.pid),
    'and the live claim was not deleted underneath its owner');
  await winner!();
  assert.equal(fs.existsSync(dir), false);
});

test('a release removes only the claim the caller published', async () => {
  const mission = `task-2489-release-${process.pid}`;
  const dir = path.join(os.tmpdir(), 'parallix-recovery-claims', mission);

  const taken = claimRecoveryLock(mission);
  assert.ok(taken, 'the claim is taken');
  // A successor took it over while this run was still holding its release.
  fs.writeFileSync(path.join(dir, 'owner'), `${process.pid}\nsomeone-elses-token`, 'utf8');
  await taken();

  assert.equal(fs.existsSync(dir), true, 'the successor\'s claim survives the predecessor\'s release');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── Regressions from review round 8 ─────────────────────────────────────────

test('the polling pause keeps the process alive, and the loop cancels the one it drops', async () => {
  // An unreferenced timer lets Node exit while the supervisor is waiting on
  // another process's agent or claim, ending supervision after one queue read.
  const handles: Array<{ unrefs: number; cleared: number }> = [];
  const timers = {
    set: (fn: () => void, ms: number) => {
      const handle = { unrefs: 0, cleared: 0, unref() { handle.unrefs += 1; return handle; } };
      handles.push(handle);
      setTimeout(fn, ms);
      return handle as unknown as NodeJS.Timeout;
    },
    clear: (handle: NodeJS.Timeout) => { (handle as unknown as { cleared: number }).cleared += 1; },
  };

  const poll = pollingPause(1, timers);
  await poll.elapsed;
  assert.equal(handles[0].unrefs, 0, 'the pause the supervisor waits on is never unreferenced');
  poll.cancel();
  assert.equal(handles[0].cleared, 1, 'and cancelling it clears the timer');

  // The loop cancels the pause that lost the race, so a referenced timer never
  // outlives the pass that created it.
  const cancelled: number[] = [];
  const stuck = item();
  const fleet = board([[stuck], []]);
  const port: SupervisorPort = {
    ...fleet.port,
    wait: (milliseconds) => {
      const inner = pause(1);
      return { elapsed: inner.elapsed, cancel: () => { cancelled.push(milliseconds); inner.cancel(); } };
    },
  };

  await superviseFleet(port, { budget: 1, pollMs: 3 });

  assert.ok(cancelled.length > 0, 'every pause the loop created was cancelled');
  assert.deepEqual([...new Set(cancelled)], [3]);
});

test('a contender that recovers the abandoned takeover lock first is not displaced', async () => {
  const mission = `task-2489-abandoned-${process.pid}`;
  const dir = path.join(os.tmpdir(), 'parallix-recovery-claims', mission);
  const lock = `${dir}.takeover`;
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(lock, { recursive: true, force: true });
  // A dead claim, plus the takeover lock a run died holding.
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'owner'), '2147483646\ndead-claim', 'utf8');
  fs.mkdirSync(lock, { recursive: true });
  fs.writeFileSync(path.join(lock, 'owner'), '2147483645\ndead-lock', 'utf8');
  const long = new Date(Date.now() - 10 * 60_000);
  fs.utimesSync(lock, long, long);

  // Both contenders see the same abandoned lock. The other one recovers it
  // while this one still holds its stale view; deleting it from here would put
  // two runs inside the takeover the lock exists to serialize.
  const loser = claimRecoveryLock(mission, {
    onAbandonedTakeoverLock: () => {
      fs.rmSync(lock, { recursive: true, force: true });
      fs.mkdirSync(lock, { recursive: true });
      fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\nwinners-lock`, 'utf8');
      // The winner's lock is no younger than the corpse it replaced: age is not
      // evidence of death, so only ownership may decide this.
      fs.utimesSync(lock, long, long);
    },
  });

  assert.equal(loser, null, 'the contender holding a stale view of the lock does not enter behind it');
  assert.equal(fs.readFileSync(path.join(lock, 'owner'), 'utf8').split('\n')[1], 'winners-lock',
    "and it does not delete the winner's lock");
  assert.equal(fs.readFileSync(path.join(dir, 'owner'), 'utf8').split('\n')[1], 'dead-claim',
    'the claim is left for the run that holds the lock');

  fs.rmSync(lock, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('an abandoned takeover lock whose holder is alive is left alone', async () => {
  const mission = `task-2489-livelock-${process.pid}`;
  const dir = path.join(os.tmpdir(), 'parallix-recovery-claims', mission);
  const lock = `${dir}.takeover`;
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'owner'), '2147483646\ndead-claim', 'utf8');
  // Age is not evidence of death: this lock is old and its holder is running.
  fs.mkdirSync(lock, { recursive: true });
  fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\nlive-lock`, 'utf8');
  const old = new Date(Date.now() - 10 * 60_000);
  fs.utimesSync(lock, old, old);

  assert.equal(claimRecoveryLock(mission), null, 'a live takeover holder is never displaced');
  assert.equal(fs.readFileSync(path.join(lock, 'owner'), 'utf8').split('\n')[1], 'live-lock');

  fs.rmSync(lock, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('liveness is read per mission, not by rebuilding the queue', async () => {
  // Liveness is asked before every dispatch and every launch. Answering it from
  // the queue made a pass cost one board projection per question.
  let queueReads = 0;
  let livenessReads = 0;
  const stuck = item();
  const port: SupervisorPort = {
    attention: async () => { queueReads += 1; return queueReads <= 3 ? [stuck] : []; },
    missionExists: async () => true,
    liveness: async () => { livenessReads += 1; return { working: false, detail: null }; },
    runAction: async () => {},
    claimRecovery: async () => async () => {},
    launchRecovery: async () => 'claude ran in /tmp/worktree',
    wait: () => pause(1),
  };

  const results = await superviseFleet(port, { budget: 1, pollMs: 1 });

  assert.equal(queueReads, 4, 'one queue read per pass, and never one to answer a liveness question');
  assert.equal(livenessReads, 2, 'liveness is asked before the dispatch and before the launch, without touching the queue');
  assert.equal(resultFor(results).outcome, 'escalated');
});

test('an unreadable current-work authority stops the step instead of dispatching', async () => {
  // Silently answering "not working" would let a command land on a mission
  // whose liveness could not be read at all.
  const stuck = item();
  const fleet = board([[stuck], [stuck], []]);
  const port: SupervisorPort = {
    ...fleet.port,
    liveness: async () => { throw new Error('the operator database is unavailable'); },
  };

  const results = await superviseFleet(port, { budget: 1, pollMs: 1 });

  assert.deepEqual(fleet.ran, [], 'nothing is dispatched while liveness is unknown');
  assert.deepEqual(fleet.recoveries, [], 'and no recovery agent is started either');
  assert.ok(resultFor(results).steps.some((step) => step.includes('the operator database is unavailable')));
});
