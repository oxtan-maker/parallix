import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('task-2347.08: CLI delegates identity, completion, and window rules to statistics service', () => {
  const source = fs.readFileSync(path.join(root, 'src/adapters/cli/commands/stats.ts'), 'utf8');
  assert.match(source, /statisticsMissionKey\(row\)/);
  assert.match(source, /statisticsRowInWindow\(row, window\)/);
  assert.match(source, /summarizeCompletedMissionWindow\(rows, window, completedMissionKeys\)/);
  assert.doesNotMatch(source, /return `\$\{String\(row\.repo/);
});

test('task-2347.08: board metrics accept named input without positional overload casts', () => {
  const source = fs.readFileSync(path.join(root, 'src/application/projections/board.ts'), 'utf8');
  assert.match(source, /export interface BoardMetricsInput/);
  assert.match(source, /buildBoardMetrics\(input: BoardMetricsInput\)/);
  assert.doesNotMatch(source, /as MetricSeries|as LaneMetricSeries|\.\.\.extensions/);
});

test('task-2347.08: cumulative flow evaluates ordered transitions once', () => {
  const source = fs.readFileSync(path.join(root, 'src/application/projections/metrics.ts'), 'utf8');
  const body = source.slice(source.indexOf('export function cumulativeFlowSeries'), source.indexOf('export function cumulativeFlowByStateSeries'));
  assert.match(body, /let index = 0/);
  assert.match(body, /while \(index < ordered\.length/);
  assert.doesNotMatch(body, /instants\.map\([\s\S]*for \(const transition of ordered\)/);
});
