

import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { mockModule, installModuleMocks } from './lib/module-mock.js';
const stats = mockModule<typeof import('../src/adapters/cli/commands/stats.js')>('../src/adapters/cli/commands/stats.js', import.meta.url);
const __mm1 = mockModule<typeof import('../src/application/presentation/cli-format.js')>('../src/application/presentation/cli-format.js', import.meta.url);
await installModuleMocks();
test.afterEach(() => mock.restoreAll());
'use strict';

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
// @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
  ].map(stats.normalizeStatsRow);

  const report = stats.renderMissionPhaseReport(rows, 'task-1354');

  // BUG REPRODUCTION: Currently the phase report filters to closed==='yes'
  // rows only. Since active rows have no closed field, the report will say
  // "No telemetry rows recorded" even though active rows exist.
  // After the fix, the execute phase should show the active row.
  const plain = __mm1.stripAnsi(report);

  // The active row for task-1354 should be visible
  assert.ok(plain.includes('task-1354') || plain.includes('execute'),
    'phase report should show mission data for active-stage mission');
  assert.ok(!plain.includes('No telemetry rows recorded'),
    'active-stage mission should NOT show "no telemetry" message');
});

test('task-2213: weekly agent performance table excludes active-stage agents', () => {
  const rows = [
    // Closed mission (should appear in agent performance)
    {
      date: '2026-06-20',
      mission: 'task-closed',
      classification: 'ai_sdlc',
      implementer: 'codex',
      model: 'gpt-5',
      pr_fix_rounds: '2',
      closed: 'yes',
    },
    // Active-stage missions (must NOT appear in agent performance)
    {
      date: '2026-06-21',
      mission: 'task-active-qwen',
      classification: 'ai_sdlc',
      implementer: 'cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit',
      model: 'cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit',
      pr_fix_rounds: '0',
      stage: 'active',
      // No closed field — in-progress mission
    },
    {
      date: '2026-06-21',
      mission: 'task-active-claude',
      classification: 'user_value',
      implementer: 'claude-opus-4-8',
      model: 'claude-opus-4-8',
      pr_fix_rounds: '0',
      stage: 'active',
      // No closed field — in-progress mission
    },
  ];

  const report = stats.renderWeeklyStatsReport(rows, { today: '2026-06-24' });
  const plain = __mm1.stripAnsi(report);
  const performance = plain.slice(
    plain.indexOf('Agent performance this week'),
    plain.indexOf('Agent spend by stage this week'),
  );

  // Mission count: only 1 closed mission
  assert.match(plain, /# missions\s+[^\d]*1\s/,
    'weekly report should count only closed missions');

  // Agent performance: only closed missions appear
  assert.ok(performance.includes('gpt-5'),
    'closed mission model gpt-5 should appear in weekly report');
  assert.ok(!performance.includes('cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit'),
    'active-stage agent must NOT appear in agent performance table');
  assert.ok(!performance.includes('claude-opus-4-8'),
    'active-stage agent must NOT appear in agent performance table');
});

test('task-2213: range agent performance table excludes active-stage agents', () => {
  const rows = [
    {
      date: '2026-06-15',
      mission: 'task-active1',
      classification: 'ai_sdlc',
      implementer: 'vibe',
      model: 'vibe',
      pr_fix_rounds: '0',
      stage: 'active',
      // No closed field — in-progress mission
    },
    {
      date: '2026-06-16',
      mission: 'task-active2',
      classification: 'ai_sdlc',
      implementer: 'claude-sonnet-4-6',
      model: 'claude-sonnet-4-6',
      pr_fix_rounds: '0',
      stage: 'active',
      // No closed field — in-progress mission
    },
    {
      date: '2026-06-17',
      mission: 'task-active3',
      classification: 'user_value',
      implementer: 'claude-sonnet-5',
      model: 'claude-sonnet-5',
      pr_fix_rounds: '0',
      stage: 'active',
      // No closed field — in-progress mission
    },
  ];

  const report = stats.renderRangeStatsReport(rows, { from: '2026-06-15', to: '2026-06-17' });
  const plain = __mm1.stripAnsi(report);

  // Mission count: 0 (no closed missions)
  assert.match(plain, /# missions\s+[^\d]*0\s/,
    'range report should count 0 closed missions');

  // Active-stage agents must NOT appear in agent performance
  assert.ok(!plain.includes('vibe'),
    'active-stage agent must NOT appear in agent performance table');
  assert.ok(!plain.includes('claude-sonnet-4-6'),
    'active-stage agent must NOT appear in agent performance table');
  assert.ok(!plain.includes('claude-sonnet-5'),
    'active-stage agent must NOT appear in agent performance table');
});

test('task-2213: completed missions keep per-model rows with per-model averages', () => {
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
  const plain = __mm1.stripAnsi(report);

  assert.match(plain, /qwen3\.5\s+2\s+1\.50/,
    'the qwen3.5 model row must average only its own completed missions');
  assert.match(plain, /gpt-5\s+1\s+1\.00/,
    'the gpt-5 model row must average only its own completed mission');
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
      // Not closed yet — must NOT appear in agent performance
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
    // Active mission with same model — must NOT appear in agent performance
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
  const plain = __mm1.stripAnsi(report);

  // Mission count: only the closed row counts, so 1 mission
  assert.match(plain, /# missions\s+[^\d]*1\s/,
    'mission count should be 1 (only closed rows count)');

  // Agent performance: gpt-5 shows 1 mission (only the closed row)
  // Active rows must NOT inflate agent performance counts
  assert.match(plain, /gpt-5\s+1\s+2\.00/);
});

test('task-2213: a blank-model rollup row buckets under the mission\'s model row', () => {
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
  const plain = __mm1.stripAnsi(report);

  assert.match(plain, /cyankiwi\/Qwen3\.6-35B-A3B-AWQ-4bit\s+1\s+1\.00/,
    'mission must keep its model-row label while averaging the fix rounds recorded on its rollup row');
});
