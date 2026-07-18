const test = require('node:test');
const assert = require('node:assert/strict');

const stats = require('../dist/lib/commands/stats');

const WINDOW = {
  start: new Date('2026-07-05T00:00:00Z'),
  end: new Date('2026-07-11T23:59:59Z'),
};

function row(overrides = {}) {
  return {
    date: '2026-07-08',
    repo: 'parallix',
    classification: 'ai_sdlc',
    implementer: 'custom',
    model: 'qwen3.5',
    mission: 'task-default',
    pr_fix_rounds: '0',
    closed: 'yes',
    ...overrides,
  };
}

test('task-2213: agent performance counts and fix-round averages use only each model row\'s completed missions', () => {
  // @ts-expect-error TS2339 Property '_internals' does not exist on type 'typeof import("/home/magnus/code/p
  const summary = stats._internals.summarizeAgentWindow([
    row({ mission: 'task-qwen-fixes', pr_fix_rounds: '4' }),
    row({ mission: 'task-qwen-zero', pr_fix_rounds: '0' }),
    row({ mission: 'task-codex', implementer: 'codex', model: 'gpt-5.4', pr_fix_rounds: '1' }),
    // This in-window mission used to inflate the qwen3.5 row to 3 / 4.33.
    row({ mission: 'task-qwen-active', pr_fix_rounds: '9', closed: '' }),
    // This completed mission is outside the selected week.
    row({ mission: 'task-qwen-old', date: '2026-07-04', pr_fix_rounds: '8' }),
  ], WINDOW);

  assert.deepEqual(summary, [
    { implementer: 'gpt-5.4', missions: 1, averageFixRounds: '1.00' },
    { implementer: 'qwen3.5', missions: 2, averageFixRounds: '2.00' },
  ]);
});

test('task-2213: models sharing an implementer family keep separate rows and averages', () => {
  // @ts-expect-error TS2339 Property '_internals' does not exist on type 'typeof import("/home/magnus/code/p
  const summary = stats._internals.summarizeAgentWindow([
    row({ mission: 'task-sonnet-a', implementer: 'claude', model: 'claude-sonnet-5', pr_fix_rounds: '3' }),
    row({ mission: 'task-sonnet-b', implementer: 'claude', model: 'claude-sonnet-5', pr_fix_rounds: '1' }),
    row({ mission: 'task-opus', implementer: 'claude', model: 'claude-opus-4', pr_fix_rounds: '0' }),
  ], WINDOW);

  assert.deepEqual(summary, [
    { implementer: 'claude-opus-4', missions: 1, averageFixRounds: '0.00' },
    { implementer: 'claude-sonnet-5', missions: 2, averageFixRounds: '2.00' },
  ]);
});

test('task-2213: completed rows with missing attribution or review-round metadata are explicit, not silent skew', () => {
  // @ts-expect-error TS2339 Property '_internals' does not exist on type 'typeof import("/home/magnus/code/p
  const summary = stats._internals.summarizeAgentWindow([
    // No model and no implementer: must surface as a visible `unknown` row.
    row({ mission: 'task-no-attribution', model: '', implementer: '', pr_fix_rounds: '' }),
    // Missing review-round value: counts as zero rounds, not NaN, and cannot
    // leak into another row's average.
    row({ mission: 'task-no-rounds', pr_fix_rounds: undefined }),
  ], WINDOW);

  assert.deepEqual(summary, [
    { implementer: 'qwen3.5', missions: 1, averageFixRounds: '0.00' },
    { implementer: 'unknown', missions: 1, averageFixRounds: '0.00' },
  ]);
});

test('task-2213: completion on the blank-model rollup row keeps the mission in its model row with the rollup fix rounds', () => {
  // Real CSV shape: the model is recorded on non-closed stage rows, while
  // completion and the final pr_fix_rounds live on a blank-model rollup row.
  // @ts-expect-error TS2339 Property '_internals' does not exist on type 'typeof import("/home/magnus/code/p
  const summary = stats._internals.summarizeAgentWindow([
    row({ mission: 'task-rollup', implementer: 'claude', model: 'claude-fable-5', stage: 'active', pr_fix_rounds: '0', closed: '' }),
    row({ mission: 'task-rollup', implementer: 'claude', model: '', stage: 'default', pr_fix_rounds: '3', closed: 'yes' }),
    // Same implementer, different model, never completed: no row at all.
    row({ mission: 'task-unfinished', implementer: 'claude', model: 'claude-sonnet-5', stage: 'active', pr_fix_rounds: '5', closed: '' }),
  ], WINDOW);

  assert.deepEqual(summary, [
    { implementer: 'claude-fable-5', missions: 1, averageFixRounds: '3.00' },
  ]);
});

test('task-2213: weekly report retains live active-stage spend while excluding that mission from agent performance', () => {
  const report = require('../dist/lib/core/fmt').stripAnsi(stats.renderWeeklyStatsReport([
    row({ mission: 'task-complete', pr_fix_rounds: '2', duration_minutes: '5', stage: 'default' }),
    row({ mission: 'task-active', pr_fix_rounds: '9', duration_minutes: '15', stage: 'active', closed: '' }),
  ], { today: '2026-07-11' }));

  const performance = report.slice(
    report.indexOf('Agent performance this week'),
    report.indexOf('Agent spend by stage this week'),
  );
  const spend = report.slice(report.indexOf('Agent spend by stage this week'));

  assert.match(performance, /qwen3\.5\s+1\s+2\.00/);
  assert.match(spend, /qwen3\.5\s+0m \(0%\)\s+15m \(75%\)/);
});

test('task-2213: completing implementer fallback is used when its model telemetry is absent', () => {
  // A reviewer model is not ownership evidence. When the completing
  // implementer has no model telemetry in the window, use its recorded family
  // from the closed rollup instead of crediting the reviewer.
  // @ts-expect-error TS2339 Property '_internals' does not exist on type 'typeof import("/home/magnus/code/p
  const summary = stats._internals.summarizeAgentWindow([
    // Implementer was codex; its gpt model row is outside the window.
    // Only the blank-model rollup and a reviewer-model row survive.
    row({ mission: 'task-reviewer-only', implementer: 'codex', model: '', stage: 'default', pr_fix_rounds: '2', closed: 'yes' }),
    row({ mission: 'task-reviewer-only', implementer: 'codex', model: 'claude-sonnet-5', stage: 'review', pr_fix_rounds: '0', closed: '' }),
  ], WINDOW);

  // The closed rollup's implementer wins; fix rounds come from that rollup.
  assert.deepEqual(summary, [
    { implementer: 'codex', missions: 1, averageFixRounds: '2.00' },
  ]);
});

test('task-2213: completing implementer model beats reviewer model in attribution', () => {
  // When both the completing implementer's model row and a reviewer's model
  // row are in the window, only the completing implementer's telemetry may
  // determine the model label.
  // @ts-expect-error TS2339 Property '_internals' does not exist on type 'typeof import("/home/magnus/code/p
  const summary = stats._internals.summarizeAgentWindow([
    // Model telemetry from the completing implementer.
    row({ mission: 'task-impl-vs-reviewer', implementer: 'claude', model: 'claude-sonnet-5', stage: 'active', pr_fix_rounds: '0', closed: '' }),
    // Reviewer / different-family model
    row({ mission: 'task-impl-vs-reviewer', implementer: 'claude', model: 'gpt-5.4', stage: 'review', pr_fix_rounds: '0', closed: '' }),
    // Blank-model rollup with fix rounds
    row({ mission: 'task-impl-vs-reviewer', implementer: 'claude', model: '', stage: 'default', pr_fix_rounds: '3', closed: 'yes' }),
  ], WINDOW);

  // Must attribute to claude-sonnet-5, NOT the reviewer's gpt-5.4.
  assert.deepEqual(summary, [
    { implementer: 'claude-sonnet-5', missions: 1, averageFixRounds: '3.00' },
  ]);
});

test('task-2213: completing implementer model beats reviewer model even when reviewer date is later', () => {
  // A later reviewer date does not change the completing implementer's
  // ownership: impl=claude active on July 7, reviewer on July 8, and closed
  // rollup on July 9.
  // @ts-expect-error TS2339 Property '_internals' does not exist on type 'typeof import("/home/magnus/code/p
  const summary = stats._internals.summarizeAgentWindow([
    // Completing implementer's model (earlier date)
    row({ mission: 'task-date-priority', date: '2026-07-07', implementer: 'claude', model: 'claude-sonnet-5', stage: 'active', pr_fix_rounds: '0', closed: '' }),
    // Reviewer / different-family model (later date)
    row({ mission: 'task-date-priority', date: '2026-07-08', implementer: 'claude', model: 'gpt-5.4', stage: 'review', pr_fix_rounds: '0', closed: '' }),
    // Blank-model rollup with fix rounds (latest date)
    row({ mission: 'task-date-priority', date: '2026-07-09', implementer: 'claude', model: '', stage: 'default', pr_fix_rounds: '3', closed: 'yes' }),
  ], WINDOW);

  // Must attribute to claude-sonnet-5, NOT the reviewer's gpt-5.4.
  assert.deepEqual(summary, [
    { implementer: 'claude-sonnet-5', missions: 1, averageFixRounds: '3.00' },
  ]);
});

test('task-2213: the completing implementer owns the model row, not a later reviewer model', () => {
  // The closed rollup is the authoritative record of who completed the
  // mission. A reviewer may run later using a model that the old `custom`
  // family heuristic also accepted (mistral), but that telemetry must never
  // reassign credit away from the completing implementer.
  // @ts-expect-error TS2339 Property '_internals' does not exist on type 'typeof import("/home/magnus/code/p
  const summary = stats._internals.summarizeAgentWindow([
    row({ mission: 'task-final-owner', date: '2026-07-07', implementer: 'custom', model: 'qwen3.6-27b-q8', stage: 'follow-up', pr_fix_rounds: '0', closed: '' }),
    row({ mission: 'task-final-owner', date: '2026-07-08', implementer: 'custom', reviewer_agent: 'vibe', model: 'mistral', stage: 'review', pr_fix_rounds: '0', closed: '' }),
    row({ mission: 'task-final-owner', date: '2026-07-09', implementer: 'custom', model: '', stage: 'default', pr_fix_rounds: '3', closed: 'yes' }),
  ], WINDOW);

  assert.deepEqual(summary, [
    { implementer: 'qwen3.6-27b-q8', missions: 1, averageFixRounds: '3.00' },
  ]);
});

test('task-2213: a closed reviewer row does not replace the final implementer after a handoff', () => {
  // Completion is mission-wide: a reviewer row may carry `closed: yes`, while
  // the last actual implementation was a follow-up by a different agent.
  // @ts-expect-error TS2339 Property '_internals' does not exist on type 'typeof import("/home/magnus/code/p
  const summary = stats._internals.summarizeAgentWindow([
    row({ mission: 'task-handoff-owner', date: '2026-07-07', implementer: 'claude', model: 'claude-sonnet-5', stage: 'follow-up', closed: '' }),
    row({ mission: 'task-handoff-owner', date: '2026-07-08', implementer: 'custom', model: 'qwen3.6-27b-q8', stage: 'follow-up', closed: '' }),
    row({ mission: 'task-handoff-owner', date: '2026-07-09', implementer: 'custom', reviewer_agent: 'vibe', model: 'mistral', stage: 'review', pr_fix_rounds: '3', closed: 'yes' }),
  ], WINDOW);

  assert.deepEqual(summary, [
    { implementer: 'qwen3.6-27b-q8', missions: 1, averageFixRounds: '3.00' },
  ]);
});
