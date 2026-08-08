const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const stats = require('../.test-runtime/adapters/cli/commands/stats.js');

function createRepoFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2337-fixture-'));
  fs.mkdirSync(path.join(root, 'backlog', 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs', 'missions', '2026', 'task-2337'), { recursive: true });
  // Create a minimal mission file so classification resolves
  fs.writeFileSync(
    path.join(root, 'backlog', 'tasks', 'task-2337.md'),
    `---\nid: TASK-2337\nassignee: [custom]\nlabels: [user_value]\n---\n## Description\ntest mission\n`,
    'utf8'
  );
  return root;
}

// Reproduction test for task-2337: custom model name lost in stats display.
// The bug: custom agents display "custom" instead of their actual model name
// (e.g. qwen3.6-27b-q8) in the "Agent performance" table because the model
// column in the measurement database is not populated with the actual model name.

test('task-2337: telemetryToStatsFields uses model option when telemetry.model is null/empty', () => {
  // When telemetry has no model, the model option should be used (not agentFamily)
  const result = stats.telemetryToStatsFields(
    { provider: 'openai', inputTokens: 100, outputTokens: 50, cachedTokens: 0, totalTokens: 150, toolCalls: 3, usagePercent: 10 },
    { agentFamily: 'custom', model: 'qwen3.6-27b-q8' }
  );
  assert.equal(result.model, 'qwen3.6-27b-q8', 'model should be the configured model, not agentFamily');
  assert.equal(result.provider, 'openai');

  // When both telemetry.model and model option are absent, falls back to agentFamily
  const noModel = stats.telemetryToStatsFields(
    { provider: 'openai', inputTokens: 100, outputTokens: 50, cachedTokens: 0, totalTokens: 150, toolCalls: 3, usagePercent: 10 },
    { agentFamily: 'custom' }
  );
  assert.equal(noModel.model, 'custom', 'should fall back to agentFamily when no model is provided');
});

test('task-2337: telemetryToStatsFields prefers telemetry.model over model option', () => {
  // When telemetry has a model, it takes precedence
  const result = stats.telemetryToStatsFields(
    { provider: 'openai', model: 'gpt-5.4-mini', inputTokens: 100, outputTokens: 50, cachedTokens: 0, totalTokens: 150, toolCalls: 3, usagePercent: 10 },
    { agentFamily: 'codex', model: 'gpt-5.4-mini' }
  );
  assert.equal(result.model, 'gpt-5.4-mini');
});

test('task-2337: recordStageStats records model for custom agent', () => {
  const root = createRepoFixture();
  try {
    const { row } = stats.recordStageStats({
      slug: 'task-2337',
      stage: 'active',
      rootDir: root,
      implementer: 'custom',
      model: 'qwen3.6-27b-q8',
      telemetry: { inputTokens: 100, outputTokens: 50, cachedTokens: 0, totalTokens: 150, toolCalls: 3, usagePercent: 10 },
      durationMinutes: 5,
    });
    assert.equal(row.model, 'qwen3.6-27b-q8', 'recorded row should have the actual model name, not "custom"');
    assert.equal(row.implementer, 'custom');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('task-2337: weekly stats report renders model name for custom agent rows', () => {
  const rows = [
    { date: '2026-08-01', repo: 'r', mission: 'task-custom-1', classification: 'user_value', implementer: 'custom', model: 'qwen3.6-27b-q8', stage: 'active', pr_fix_rounds: '0', duration_minutes: '10', closed: 'yes' },
    { date: '2026-08-02', repo: 'r', mission: 'task-custom-2', classification: 'user_value', implementer: 'custom', model: 'qwen3.6-27b-q8', stage: 'active', pr_fix_rounds: '0', duration_minutes: '8', closed: 'yes' },
    { date: '2026-08-03', repo: 'r', mission: 'task-custom-3', classification: 'user_value', implementer: 'custom', model: 'cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit', stage: 'active', pr_fix_rounds: '0', duration_minutes: '12', closed: 'yes' },
  ];
  const report = stats.renderWeeklyStatsReport(rows, { today: '2026-08-04' });
  const plain = require('../.test-runtime/application/presentation/cli-format.js').stripAnsi(report);

  // Agent performance table should show the actual model names
  assert.match(plain, /Agent performance this week[\s\S]*qwen3\.6-27b-q8/, 'should render qwen3.6-27b-q8 in agent performance table');
  assert.match(plain, /Agent performance this week[\s\S]*cyankiwi\/Qwen3\.6-35B/, 'should render cyankiwi model in agent performance table');
  // Should NOT show 'custom' as the display key when model is populated
  assert.doesNotMatch(plain, /Agent performance this week[\s\S]*custom\s+\d+/, 'should not show "custom" as display key when model is populated');
});

test('task-2337: accumulateStageStats preserves model for custom agent', () => {
  const root = createRepoFixture();
  try {
    // First recording
    stats.accumulateStageStats({
      slug: 'task-2337',
      stage: 'active',
      rootDir: root,
      implementer: 'custom',
      model: 'qwen3.6-27b-q8',
      telemetry: { inputTokens: 100, outputTokens: 50, cachedTokens: 0, totalTokens: 150, toolCalls: 3, usagePercent: 10 },
      durationMinutes: 5,
    });

    // Second recording (should accumulate)
    stats.accumulateStageStats({
      slug: 'task-2337',
      stage: 'active',
      rootDir: root,
      implementer: 'custom',
      model: 'qwen3.6-27b-q8',
      telemetry: { inputTokens: 200, outputTokens: 100, cachedTokens: 0, totalTokens: 300, toolCalls: 5, usagePercent: 20 },
      durationMinutes: 8,
    });

    const data = stats.loadMeasurementRows({ rootDir: root });
    assert.equal(data.rows.length, 1, 'should have exactly one accumulated row');
    assert.equal(data.rows[0].model, 'qwen3.6-27b-q8', 'accumulated row should preserve model name');
    assert.equal(data.rows[0].implementer, 'custom');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
