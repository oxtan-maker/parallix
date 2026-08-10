import assert from 'node:assert/strict';
import { test } from 'node:test';
import { StatsCommandUseCase } from '../src/application/stats-command-use-case.js';

function port(rows = [], overrides = {}) {
  return {
    loadMeasurements: () => rows,
    resolveClassification: () => ({ classification: 'ai_sdlc' }),
    deriveImplementerAndFixRounds: () => ({ implementer: 'codex', prFixRounds: '0' }),
    resolveRepositoryName: () => 'parallix',
    ...overrides,
  };
}

test('StatsCommandUseCase weekly report returns all rows and completed window summary', () => {
  const useCase = new StatsCommandUseCase(port([
    { repo: 'parallix', mission: 'task-1', date: '2026-06-23', closed: 'yes' },
    { repo: 'parallix', mission: 'task-2', date: '2026-06-10', closed: 'yes' },
  ]));
  const result = useCase.execute({ mode: 'weekly', today: '2026-06-23' });
  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.completedMissions?.map((row) => row.mission), ['task-1']);
});

test('StatsCommandUseCase range report applies inclusive StatisticsService windowing', () => {
  const useCase = new StatsCommandUseCase(port([
    { repo: 'parallix', mission: 'task-1', date: '2026-06-01', closed: 'yes' },
    { repo: 'parallix', mission: 'task-2', date: '2026-06-30', closed: 'yes' },
  ]));
  const result = useCase.execute({ mode: 'range', from: '2026-06-01', to: '2026-06-30' });
  assert.deepEqual(result.windowedRows?.map((row) => row.mission), ['task-1', 'task-2']);
});

test('StatsCommandUseCase backfill path invokes only the mocked port', () => {
  let backfilled = 0;
  const useCase = new StatsCommandUseCase(port([], { backfill: () => { backfilled += 1; } }));
  const result = useCase.execute({ mode: 'weekly', backfill: true });
  assert.equal(backfilled, 1);
  assert.equal(result.backfilled, true);
});

test('StatsCommandUseCase empty store returns an empty report result', () => {
  const result = new StatsCommandUseCase(port()).execute({ mode: 'weekly', today: '2026-06-23' });
  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.completedMissions, []);
});

test('StatsCommandUseCase Forgejo-unavailable lookup returns a graceful warning', () => {
  const useCase = new StatsCommandUseCase(port([], {
    lookupForgejo: () => { throw new Error('Forgejo unavailable'); },
  }));
  const result = useCase.execute({ mode: 'mission', mission: 'task-1', lookupForgejo: true });
  assert.equal(result.forgejoWarning, 'Forgejo unavailable');
});
