/**
 * TASK-2521.03 — the Mission projection behind `px status` and `px status --json`.
 *
 * `px status` is the single Mission reporting surface: there is no second
 * context command. These tests pin AC #1 (complete current Mission state is
 * readable), AC #11 (a structured form exists) and the three consumers that
 * must not fall back to a file: execute resume, review continuity and restart
 * recovery.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { renderStatus, statusJson, parseStatusCliRequest } from '../src/interfaces/cli/status.js';
import type { StatusResult, StatusMissionData } from '../src/application/ports/cli-workflows.js';

const BRIEF = {
  goal: 'Make the agent read/write workflow first-class through px',
  why: 'Agents otherwise fall back to filesystem archaeology.',
  scope: 'Typed read and write commands over existing authorities.',
  outOfScope: ['A generic patch endpoint', 'Direct SQL for agents'],
};

function missionData(overrides: Partial<StatusMissionData> = {}): StatusMissionData {
  return {
    backlogStatus: 'active',
    brief: BRIEF,
    declaredGates: ['./scripts/verify-local.sh all'],
    checkpoint: 'CP-1',
    checkpointDescription: 'Typed write surface',
    goalCheck: [{ criterion: 'Typed verbs exist', evidence: 'test/task-2521-03-mutation-parity.test.ts' }],
    nextAction: 'Record the next checkpoint.',
    version: 7,
    reviewHistory: [],
    ...overrides,
  };
}

function result(md: StatusMissionData | null): StatusResult {
  return {
    branch: 'mission/task-2521.03',
    worktree: '/tmp/parallix-task-2521.03',
    rebaseInfo: null,
    slug: 'task-2521.03',
    missionData: md,
    prInfo: null,
    staleWorktrees: [],
    staleWorktreeRebase: {},
    agentMatrix: [],
    agentOverride: undefined,
    lastThreeCommits: [],
    uncommittedCount: 0,
  } as StatusResult;
}

function render(md: StatusMissionData | null): string {
  const lines: string[] = [];
  renderStatus(result(md), (msg) => lines.push(msg));
  return lines.join('\n');
}

test('AC #1: px status reports the brief, the declared gates and the latest checkpoint', () => {
  const output = render(missionData());
  assert.match(output, /Goal: Make the agent read\/write workflow first-class through px/);
  assert.match(output, /Why: Agents otherwise fall back/);
  assert.match(output, /Scope: Typed read and write commands/);
  assert.match(output, /Out of scope: A generic patch endpoint; Direct SQL for agents/);
  assert.match(output, /Declared gates: \.\/scripts\/verify-local\.sh all/);
  assert.match(output, /Last checkpoint: CP-1/);
  assert.match(output, /Typed verbs exist: test\/task-2521-03-mutation-parity\.test\.ts/);
  assert.match(output, /Next action: Record the next checkpoint\./);
});

test('AC #10: px status reports the version an agent passes to --expected-version', () => {
  assert.match(render(missionData()), /Version: 7 \(pass to --expected-version when writing\)/);
  assert.equal(JSON.parse(statusJson(result(missionData()))).version, 7);
});

test('AC #11: px status --json exposes the recorded fields as structured data', () => {
  const parsed = JSON.parse(statusJson(result(missionData())));
  for (const key of ['slug', 'backlogStatus', 'version', 'brief', 'declaredGates', 'latestCheckpoint']) {
    assert.ok(Object.hasOwn(parsed, key), `--json output must expose ${key}`);
  }
  assert.deepEqual(parsed.declaredGates, ['./scripts/verify-local.sh all']);
  assert.equal(parsed.brief.goal, BRIEF.goal);
  assert.equal(parsed.latestCheckpoint.name, 'CP-1');
  assert.equal(parsed.latestCheckpoint.goalCheck[0].criterion, 'Typed verbs exist');
});

test('the JSON form carries no machine-local operator facts an agent could depend on', () => {
  const parsed = JSON.parse(statusJson(result(missionData())));
  for (const key of ['agentMatrix', 'staleWorktrees', 'lastThreeCommits', 'worktree', 'uncommittedCount']) {
    assert.ok(!Object.hasOwn(parsed, key), `--json must not expose the operator-local ${key}`);
  }
});

test('execute resume reads the next action and gates from the recorded state', () => {
  const parsed = JSON.parse(statusJson(result(missionData())));
  assert.equal(parsed.latestCheckpoint.nextAction, 'Record the next checkpoint.');
  assert.ok(parsed.declaredGates.length > 0, 'a resumed execute agent must see its declared gates');
});

test('review continuity reports round, phase, disposition and prior rounds', () => {
  const parsed = JSON.parse(statusJson(result(missionData({
    backlogStatus: 'review',
    reviewPhase: 'fixing',
    reviewRound: 2,
    reviewDisposition: 'CHANGES_MADE',
    reviewHistory: [{
      number: 1, reviewer: 'codex', implementer: 'claude', disposition: 'CHANGES_REQUESTED',
      comment: 'see findings', findingSummaries: ['F1 typed writes missing'], fixes: ['F1 fixed'], pushbacks: [],
    }],
  }))));
  assert.equal(parsed.review.round, 2);
  assert.equal(parsed.review.phase, 'fixing');
  assert.equal(parsed.review.disposition, 'CHANGES_MADE');
  assert.equal(parsed.review.history[0].findingSummaries[0], 'F1 typed writes missing');
});

test('restart recovery still reports lane and checkpoint when no brief is recorded', () => {
  const output = render(missionData({ brief: null, declaredGates: [] }));
  assert.match(output, /Brief: none recorded/);
  assert.match(output, /Declared gates: none/);
  assert.match(output, /Backlog status: active/);
  assert.match(output, /Last checkpoint: CP-1/);
  // Absence is reported as absence, never invented.
  assert.ok(!/Goal: /.test(output), 'no goal may be rendered when none is recorded');
});

test('an unrecorded mission reports nothing rather than falling back to files', () => {
  const parsed = JSON.parse(statusJson(result(null)));
  assert.equal(parsed.brief, null);
  assert.deepEqual(parsed.declaredGates, []);
  assert.equal(parsed.latestCheckpoint, null);
  assert.equal(parsed.version, null);
});

test('--json is parsed as a status flag and does not become a slug', () => {
  assert.deepEqual(parseStatusCliRequest(['task-2521.03', '--json']), { explicitSlug: 'task-2521.03', json: true });
  assert.deepEqual(parseStatusCliRequest(['--json']), { explicitSlug: undefined, json: true });
  assert.equal(parseStatusCliRequest(['task-2521.03']).json, false);
  assert.throws(() => parseStatusCliRequest(['--nope']), /Unknown status option/);
});

test('px status reports the repository title, never the intake placeholder', () => {
  // `title` is target-repository authority (MISSION_FIELD_AUTHORITY). The
  // aggregate's title is written at `px draft` intake while MISSION.md is still
  // the scaffold, so it holds the literal `<Title> (slug)` placeholder; reading
  // it from the store instead of the card published that placeholder to agents.
  const titled = missionData({ title: 'Mission 3 — Make the workflow first-class through px' });
  assert.match(render(titled), /Title: Mission 3 — Make the workflow first-class through px/);
  assert.doesNotMatch(render(titled), /<Title>/);
  assert.equal(JSON.parse(statusJson(result(titled))).title, 'Mission 3 — Make the workflow first-class through px');
});
