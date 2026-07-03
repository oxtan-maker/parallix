'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const stats = require('../lib/commands/stats');

// Reproduction test for task-1409: active-stage stats rows are invisible in
// stats reports because the per-mission phase report and the agent performance
// tables filter to `closed === 'yes'` rows, which excludes in-progress active
// stage rows whose `closed` field is empty/undefined.
//
// The backlog task provides a concrete week snapshot with active-stage model
// counts:
//   claude-opus-4-8  5
//   claude-sonnet-4-6  1
//   claude-sonnet-5    6
//   cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit  32
//   mistral            1
// These rows have stage='active' and no closed column. They should be visible
// in the per-mission phase report and in the agent performance table.

test('task-1409: active-stage rows are visible in per-mission phase report', () => {
  // Simulate active-stage rows as they would appear in stats.csv after
  // recordActiveStats. These rows have NO closed column (or closed='').
  const rows = [
    {
      date: '2026-07-01',
      mission: 'task-1354',
      classification: 'ai_sdlc',
      implementer: 'cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit',
      model: 'cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit',
      implementer_agent: 'cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit',
      provider: 'local',
      stage: 'active',
      input_tokens: '50000',
      output_tokens: '10000',
      cached_tokens: '30000',
      tool_calls: '200',
      duration_minutes: '45',
      cost_usd: '0',
      // No closed field — this is how active-stage rows are stored.
    },
    {
      date: '2026-07-01',
      mission: 'task-1355',
      classification: 'user_value',
      implementer: 'claude-opus-4-8',
      model: 'claude-opus-4-8',
      implementer_agent: 'claude-opus-4-8',
      provider: 'anthropic',
      stage: 'active',
      input_tokens: '30000',
      output_tokens: '8000',
      cached_tokens: '20000',
      tool_calls: '150',
      duration_minutes: '30',
      cost_usd: '2.50',
    },
  ].map(stats.normalizeStatsRow);

  const report = stats.renderMissionPhaseReport(rows, 'task-1354');

  // BUG REPRODUCTION: Currently the phase report filters to closed==='yes'
  // rows only. Since active rows have no closed field, the report will say
  // "No telemetry rows recorded" even though active rows exist.
  // After the fix, the execute phase should show the active row.
  const plain = require('../lib/core/fmt').stripAnsi(report);
  
  // The active row for task-1354 should be visible
  assert.ok(plain.includes('task-1354') || plain.includes('execute'),
    'phase report should show mission data for active-stage mission');
  assert.ok(!plain.includes('No telemetry rows recorded'),
    'active-stage mission should NOT show "no telemetry" message');
});

test('task-1409: weekly agent performance table includes active-stage agents', () => {
  const rows = [
    // Closed mission (existing behavior — should still work)
    {
      date: '2026-06-20',
      mission: 'task-closed',
      classification: 'ai_sdlc',
      implementer: 'codex',
      model: 'gpt-5',
      pr_fix_rounds: '2',
      closed: 'yes',
    },
    // Active-stage mission (not counted as closed)
    {
      date: '2026-06-21',
      mission: 'task-active-qwen',
      classification: 'ai_sdlc',
      implementer: 'cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit',
      model: 'cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit',
      pr_fix_rounds: '0',
      stage: 'active',
      // No closed field
    },
    {
      date: '2026-06-21',
      mission: 'task-active-claude',
      classification: 'user_value',
      implementer: 'claude-opus-4-8',
      model: 'claude-opus-4-8',
      pr_fix_rounds: '0',
      stage: 'active',
    },
  ];

  const report = stats.renderWeeklyStatsReport(rows, { today: '2026-06-24' });
  const plain = require('../lib/core/fmt').stripAnsi(report);

  // Mission count should still be 1 (only closed missions count)
  assert.match(plain, /# missions\s+[^\d]*1\s/,
    'weekly report should count only closed missions');

  // Active-stage agents should appear in the agent performance table
  // After the fix, cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit and claude-opus-4-8
  // should be visible in the agent table.
  assert.ok(plain.includes('cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit') || plain.includes('Qwen'),
    'active-stage agent cyankiwi/Qwen3.6 should appear in weekly report');
  assert.ok(plain.includes('claude-opus-4-8'),
    'active-stage agent claude-opus-4-8 should appear in weekly report');
});

test('task-1409: range agent performance table includes active-stage agents', () => {
  const rows = [
    {
      date: '2026-06-15',
      mission: 'task-active1',
      classification: 'ai_sdlc',
      implementer: 'mistral',
      model: 'mistral',
      pr_fix_rounds: '0',
      stage: 'active',
    },
    {
      date: '2026-06-16',
      mission: 'task-active2',
      classification: 'ai_sdlc',
      implementer: 'claude-sonnet-4-6',
      model: 'claude-sonnet-4-6',
      pr_fix_rounds: '0',
      stage: 'active',
    },
    {
      date: '2026-06-17',
      mission: 'task-active3',
      classification: 'user_value',
      implementer: 'claude-sonnet-5',
      model: 'claude-sonnet-5',
      pr_fix_rounds: '0',
      stage: 'active',
    },
  ];

  const report = stats.renderRangeStatsReport(rows, { from: '2026-06-15', to: '2026-06-17' });
  const plain = require('../lib/core/fmt').stripAnsi(report);

  // Mission count should be 0 (no closed missions)
  assert.match(plain, /# missions\s+[^\d]*0\s/,
    'range report should count 0 closed missions');

  // Active-stage agents should still appear in agent performance
  assert.ok(plain.includes('mistral'),
    'active-stage agent mistral should appear in range report');
  assert.ok(plain.includes('claude-sonnet-4-6'),
    'active-stage agent claude-sonnet-4-6 should appear in range report');
  assert.ok(plain.includes('claude-sonnet-5'),
    'active-stage agent claude-sonnet-5 should appear in range report');
});

test('task-1409: existing model-based grouping is preserved for closed missions', () => {
  // Verify that the fix does not break existing model-based grouping
  const rows = [
    {
      date: '2026-06-20',
      mission: 'task-1001',
      classification: 'ai_sdlc',
      implementer: 'custom',
      model: 'qwen3.5',
      pr_fix_rounds: '1',
      closed: 'yes',
    },
    {
      date: '2026-06-21',
      mission: 'task-1002',
      classification: 'ai_sdlc',
      implementer: 'custom',
      model: 'qwen3.5',
      pr_fix_rounds: '2',
      closed: 'yes',
    },
    {
      date: '2026-06-22',
      mission: 'task-1003',
      classification: 'user_value',
      implementer: 'codex',
      model: 'gpt-5',
      pr_fix_rounds: '1',
      closed: 'yes',
    },
  ];

  const report = stats.renderWeeklyStatsReport(rows, { today: '2026-06-24' });
  const plain = require('../lib/core/fmt').stripAnsi(report);

  // Model-based grouping should still work: qwen3.5 gets 2 missions, gpt-5 gets 1
  assert.match(plain, /qwen3\.5\s+2\s+1\.50/,
    'model-based grouping should still group qwen3.5 rows together');
  assert.match(plain, /gpt-5\s+1\s+1\.00/,
    'model-based grouping should still show gpt-5 as separate group');
});

test('task-1409: active and closed rows coexist without double-counting', () => {
  // Same mission with both active and closed rows should not double-count
  const rows = [
    {
      date: '2026-06-18',
      mission: 'task-multi',
      classification: 'ai_sdlc',
      implementer: 'codex',
      model: 'gpt-5',
      pr_fix_rounds: '0',
      stage: 'active',
      // Not closed yet
    },
    {
      date: '2026-06-20',
      mission: 'task-multi',
      classification: 'ai_sdlc',
      implementer: 'codex',
      model: 'gpt-5',
      pr_fix_rounds: '2',
      closed: 'yes',
    },
    // Active mission with same model
    {
      date: '2026-06-21',
      mission: 'task-active-other',
      classification: 'user_value',
      implementer: 'codex',
      model: 'gpt-5',
      pr_fix_rounds: '0',
      stage: 'active',
    },
  ];

  const report = stats.renderWeeklyStatsReport(rows, { today: '2026-06-24' });
  const plain = require('../lib/core/fmt').stripAnsi(report);

  // Mission count: only the closed row counts, so 1 mission
  assert.match(plain, /# missions\s+[^\d]*1\s/,
    'mission count should be 1 (only closed rows count)');

  // Agent performance: codex/gpt-5 should show 2 missions (1 closed + 1 active)
  // The closed and active rows are different missions (task-multi vs task-active-other)
  assert.match(plain, /gpt-5\s+2\s+/);
});

test('task-1409: a blank-model rollup row must not override the real model row', () => {
  // A mission can have real per-stage telemetry rows with a model, plus a
  // 'default' stage rollup row that carries the final pr_fix_rounds but no
  // model. Deduplicating by "highest fix rounds wins" alone lets the blank
  // rollup row win, which drops the mission's model identity and buckets it
  // under the generic implementer name instead (e.g. 'custom').
  const rows = [
    {
      date: '2026-06-20',
      mission: 'task-rollup',
      classification: 'ai_sdlc',
      implementer: 'custom',
      model: 'cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit',
      pr_fix_rounds: '0',
      stage: 'active',
      closed: 'yes',
    },
    {
      date: '2026-06-21',
      mission: 'task-rollup',
      classification: 'ai_sdlc',
      implementer: 'custom',
      model: '',
      pr_fix_rounds: '1',
      stage: 'default',
      closed: 'yes',
    },
  ];

  const report = stats.renderWeeklyStatsReport(rows, { today: '2026-06-24' });
  const plain = require('../lib/core/fmt').stripAnsi(report);

  assert.ok(plain.includes('cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit'),
    'mission should be bucketed under its real model, not the blank-model rollup row');
  assert.ok(!/^custom\s/m.test(plain),
    'mission must not fall back to the generic implementer name when a real model row exists');
});
