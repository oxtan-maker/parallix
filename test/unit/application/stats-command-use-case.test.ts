import assert from 'node:assert/strict';
import { test } from 'node:test';
import { StatsCommandUseCase } from '../../../src/application/stats-command-use-case.js';

function port(rows = [], overrides = {}) {
  return {
    loadMeasurements: async () => rows,
    loadMissionFlow: async () => null,
    ...overrides,
  };
}

test('StatsCommandUseCase sequences telemetry then lifecycle completion through the workflow port', async () => {
  const calls = [];
  const useCase = new StatsCommandUseCase(port([
    { repo: 'parallix', mission: 'task-1', date: '2026-06-23', },
    { repo: 'parallix', mission: 'task-2', date: '2026-06-10', },
  ], {
    loadMeasurements: async () => { calls.push('measurements'); return [{ repo: 'parallix', mission: 'task-1', date: '2026-06-23' }]; },
    loadMissionFlow: async () => { calls.push('mission-flow'); return [{ repo: 'parallix', mission: 'task-1', closedAt: '2026-06-23T12:00:00Z', labels: [] }]; },
  }));
  const result = await useCase.execute({ mode: 'weekly', today: '2026-06-23' });
  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.selection?.current.completedMissions?.map(row => row.mission), ['task-1']);
  assert.deepEqual(result.missionFlow?.map(row => row.mission), ['task-1']);
  assert.deepEqual(calls, ['measurements', 'mission-flow']);
});

test('StatsCommandUseCase weekly report returns all rows without inferring completion from telemetry', async () => {
  const result = await new StatsCommandUseCase(port([
    { repo: 'parallix', mission: 'task-1', date: '2026-06-23' },
    { repo: 'parallix', mission: 'task-2', date: '2026-06-10' },
  ])).execute({ mode: 'weekly', today: '2026-06-23' });
  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.selection?.current.completedMissions, []);
});

test('StatsCommandUseCase range report applies inclusive StatisticsService windowing', async () => {
  const useCase = new StatsCommandUseCase(port([
    { repo: 'parallix', mission: 'task-1', date: '2026-06-01', },
    { repo: 'parallix', mission: 'task-2', date: '2026-06-30', },
  ]));
  const result = await useCase.execute({ mode: 'range', from: '2026-06-01', to: '2026-06-30' });
  assert.deepEqual(result.selection?.current.windowedRows?.map((row) => row.mission), ['task-1', 'task-2']);
});

test('StatsCommandUseCase empty store returns an empty report result', async () => {
  const result = await new StatsCommandUseCase(port()).execute({ mode: 'weekly', today: '2026-06-23' });
  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.selection?.current.completedMissions, []);
});


// TASK-2637.04: recording is a separate application contract because stage
// consumers must remain synchronous while Mission/Review reads are async.
import { StatsRecordingUseCase } from '../../../src/application/stats-recording-use-case.js';
import type { StatisticsRecordingPort } from '../../../src/application/ports/statistics-recording.js';
import type { StatsRow } from '../../../src/application/services/statistics-row.js';
import type { Review } from '../../../src/domain/review.js';

function recordingPort(overrides: Partial<StatisticsRecordingPort> = {}): StatisticsRecordingPort {
  return {
    repositoryName: 'parallix',
    readClassification: () => ({ classification: 'ai_sdlc' }),
    readStoredClassification: async () => 'ai_sdlc',
    readReview: async () => null,
    readMeasurements: () => [],
    readFixRoundHistory: () => [],
    upsert: row => ({ changed: true, row, data: { headers: [], rows: [row] } }),
    readMissionFlow: async () => [],
    ...overrides,
  };
}

test('integration recording orders classification, authoritative Review, write and lifecycle read (TASK-2637.04)', async () => {
  const calls: string[] = [];
  const review = {
    rounds: [{ implementer: 'codex', decision: { kind: 'changes-requested' } }],
    reviewEvents: [{ eventType: 'reviewer_outcome', verdict: 'request-changes' }],
  } as unknown as Review;
  const useCase = new StatsRecordingUseCase(recordingPort({
    readStoredClassification: async () => { calls.push('classification'); return 'user_value'; },
    readReview: async () => { calls.push('review'); return review; },
    upsert: row => { calls.push('upsert'); return { changed: true, row, data: { headers: [], rows: [row] } }; },
    readMissionFlow: async () => {
      calls.push('lifecycle');
      return [{ repo: 'parallix', mission: 'task-1', closedAt: '2026-06-23T12:00:00Z', labels: ['user_value'], implementer: 'codex' }];
    },
  }));
  const result = await useCase.recordIntegration({ slug: 'task-1', date: '2026-06-23' });
  assert.deepEqual(calls, ['classification', 'review', 'upsert', 'lifecycle']);
  assert.equal(result.row.classification, 'user_value');
  assert.equal(result.row.implementer, 'codex');
  assert.equal(result.row.pr_fix_rounds, '1');
  assert.equal(result.selection?.current.flow?.total, 1);
  assert.equal(result.metadataSource.implementer, 'review-aggregate');
});

test('integration classification failure stops before Review and measurement effects (TASK-2637.04)', async () => {
  const calls: string[] = [];
  const useCase = new StatsRecordingUseCase(recordingPort({
    readStoredClassification: async () => { throw new Error('unclassified Mission'); },
    readReview: async () => { calls.push('review'); return null; },
    upsert: () => { calls.push('upsert'); throw new Error('unexpected write'); },
  }));
  await assert.rejects(useCase.recordIntegration({ slug: 'task-1', date: '2026-06-23' }), /unclassified Mission/);
  assert.deepEqual(calls, []);
});

test('integration history failure preserves the accepted measurement and returns a report error (TASK-2637.04)', async () => {
  let written: StatsRow | undefined;
  const useCase = new StatsRecordingUseCase(recordingPort({
    upsert: row => { written = row; return { changed: true, row, data: { headers: [], rows: [row] } }; },
    readMissionFlow: async () => { throw new Error('history unavailable'); },
  }));
  const result = await useCase.recordIntegration({ slug: 'task-1', date: '2026-06-23' });
  assert.equal(result.row, written);
  assert.equal(result.reportError, 'history unavailable');
  assert.equal(result.selection, undefined);
  assert.equal(result.row.pr_fix_rounds, undefined, 'absent Review does not fabricate zero');
});

test('stage accumulation sequences classification, read, merge and write without dropping telemetry (TASK-2637.04)', () => {
  const calls: string[] = [];
  const useCase = new StatsRecordingUseCase(recordingPort({
    readClassification: () => { calls.push('classification'); return { classification: 'ai_sdlc' }; },
    readMeasurements: () => { calls.push('read'); return [{
      repo: 'parallix', mission: 'task-1', stage: 'active', implementer: 'codex',
      provider: 'openai', model: 'gpt-old', input_tokens: '10', output_tokens: '5',
      cached_tokens: '2', thoughts_tokens: '1', context_tokens: '15', tool_calls: '1',
      openai_usage_before: '3', openai_usage_after: '50', openai_usage_delta: '4',
      duration_minutes: '2', cost_usd: '0.2',
    }]; },
    upsert: row => { calls.push('write'); return { changed: true, row, data: { headers: [], rows: [row] } }; },
  }));
  const result = useCase.accumulateStage({
    slug: 'task-1', stage: 'active', date: '2026-06-23', implementer: 'codex',
    telemetry: { provider: 'openai', model: 'gpt-new', inputTokens: 20, outputTokens: 7,
      cachedTokens: 3, thoughtsTokens: 2, totalTokens: 27, toolCalls: 2, usagePercent: 40, cost_usd: 0.3 },
    durationMinutes: 3,
  });
  assert.deepEqual(calls, ['classification', 'read', 'write']);
  assert.equal(result.row.input_tokens, '30');
  assert.equal(result.row.output_tokens, '12');
  assert.equal(result.row.cached_tokens, '5');
  assert.equal(result.row.thoughts_tokens, '3');
  assert.equal(result.row.context_tokens, '42');
  assert.equal(result.row.tool_calls, '3');
  assert.equal(result.row.duration_minutes, '5');
  assert.equal(result.row.cost_usd, '0.5');
  assert.equal(result.row.openai_usage_before, '0');
  assert.equal(result.row.openai_usage_after, '50');
  assert.equal(result.row.openai_usage_delta, '4');
  assert.equal(result.row.provider, 'openai');
  assert.equal(result.row.model, 'mixed');
  assert.equal(result.row.pr_fix_rounds, undefined);
  assert.ok(!(result instanceof Promise), 'stage telemetry API remains synchronous');
});

test('active and review recording carry known history forward and preserve implementer credit (TASK-2637.04)', () => {
  const calls: string[] = [];
  const useCase = new StatsRecordingUseCase(recordingPort({
    readFixRoundHistory: () => { calls.push('history'); return [null, 0, 2]; },
    readClassification: () => { calls.push('classification'); return { classification: 'ai_sdlc' }; },
    upsert: row => { calls.push('write'); return { changed: true, row, data: { headers: [], rows: [row] } }; },
  }));
  const active = useCase.recordActive({ slug: 'task-1', date: '2026-06-23', implementer: 'codex' });
  assert.equal(active.row.stage, 'active');
  assert.equal(active.row.pr_fix_rounds, '2');
  assert.deepEqual(calls, ['history', 'classification', 'write']);
  calls.length = 0;
  const review = useCase.recordReview({
    slug: 'task-1', date: '2026-06-23', implementer: 'codex', reviewer: 'claude', prFixRounds: '0',
  });
  assert.equal(review.row.stage, 'review');
  assert.equal(review.row.implementer, 'codex');
  assert.equal(review.row.reviewer_agent, 'claude');
  assert.equal(review.row.pr_fix_rounds, '0');
  assert.deepEqual(calls, ['classification', 'write'], 'provided known zero skips history');
});

test('fix-round history distinguishes unknown, measured zero and unavailable reads (TASK-2637.04)', () => {
  for (const [history, expected] of [[[], undefined], [[null, undefined], undefined], [[null, 0], '0']] as const) {
    const useCase = new StatsRecordingUseCase(recordingPort({ readFixRoundHistory: () => history }));
    assert.equal(useCase.defaultPrFixRounds('task-1'), expected);
  }
  const unavailable = new StatsRecordingUseCase(recordingPort({ readFixRoundHistory: () => { throw new Error('unreadable'); } }));
  assert.equal(unavailable.defaultPrFixRounds('task-1'), undefined);
});
