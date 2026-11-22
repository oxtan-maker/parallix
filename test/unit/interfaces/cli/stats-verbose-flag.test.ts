import test from 'node:test';
import assert from 'node:assert/strict';
import { createStatsCommand, parseStatsArgs } from '../../../../src/interfaces/cli/stats.js';
import { selectStatsReport } from '../../../../src/application/services/statistics-report-selection.js';

test('--verbose is a flag, not a mission or a value (TASK-2867.07)', () => {
  assert.equal(parseStatsArgs([]).verbose, false);
  assert.equal(parseStatsArgs(['--verbose']).verbose, true);
  const withMission = parseStatsArgs(['--verbose', 'task-12']);
  assert.deepEqual([withMission.verbose, withMission.mission], [true, 'task-12']);
});

test('px stats passes --verbose to the report and the verification section (TASK-2867.07)', async () => {
  const selection = selectStatsReport([], [], { mode: 'weekly', today: '2026-06-23', timeZone: 'UTC' });
  const seen: boolean[] = [];
  const command = createStatsCommand({ execute: async () => ({ mode: 'weekly' as const, rows: [], missionFlow: [], selection }) }, {
    renderWeekly: (_rows, options) => { seen.push(options.verbose); return 'weekly'; },
    renderRange: () => { throw new Error('unexpected range route'); },
    renderMission: () => { throw new Error('unexpected mission route'); },
    writeReport: () => { throw new Error('unexpected file write'); },
    cohorts: async () => { throw new Error('unexpected cohort route'); },
  });
  const io = { log: () => undefined, error: (message: string) => { throw new Error(message); }, exit: () => { throw new Error('unexpected exit'); } };
  await command([], io);
  await command(['--verbose'], io);
  assert.deepEqual(seen, [false, true]);
});
