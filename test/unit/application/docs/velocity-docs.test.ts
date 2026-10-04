import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { assertVelocityOutcomesAreUnambiguous, assertVelocitySnapshot, renderVelocitySvg, weeklyComparableOutcomes } from '../../../../src/application/docs/velocity.js';

const outcome = (closedAt: string, labels = ['user_value']) => ({ closedAt, labels }) as any;

test('weeklyComparableOutcomes keeps zero weeks and excludes the current partial week', () => {
  assert.deepEqual(weeklyComparableOutcomes([outcome('2026-09-07T12:00:00Z'), outcome('2026-09-21T12:00:00Z')], '2026-09-26T12:00:00Z'), [
    { weekOf: '2026-09-07', completedCount: 1 }, { weekOf: '2026-09-14', completedCount: 0 },
  ]);
});

test('weeklyComparableOutcomes includes all delivered work as requested by operator (TASK-2640)', () => {
  assert.deepEqual(weeklyComparableOutcomes([outcome('2026-09-21T12:00:00Z', ['ai_sdlc']), outcome('2026-09-22T12:00:00Z'), outcome('2026-09-23T12:00:00Z', []), outcome('2026-09-28T12:00:00Z')], '2026-10-03T12:00:00Z'), [{ weekOf: '2026-09-21', completedCount: 3 }]);
});

test('velocity rendering is deterministic and rejects malformed snapshots', () => {
  const snapshot = JSON.parse(fs.readFileSync('docs/metrics/velocity/weekly.json', 'utf8'));
  assert.equal(renderVelocitySvg(snapshot), renderVelocitySvg(snapshot));
  assert.throws(() => assertVelocitySnapshot({ ...snapshot, metric: { classification: 'user_value' } }));
  assert.match(renderVelocitySvg(snapshot), /Manual proxy: 2 missions\/week/);
  assert.doesNotMatch(renderVelocitySvg(snapshot), /1\.96875/);
  assert.equal(snapshot.manualBaseline.unitsPerWeek, 1.96875);
  assert.throws(() => assertVelocitySnapshot({ ...snapshot, manualBaseline: { ...snapshot.manualBaseline, unitsPerWeek: 2 } }));
  assert.throws(() => assertVelocitySnapshot({ ...snapshot, parallix: { weeks: [{ weekOf: 'bad', completedCount: -1 }] } }));
});

test('velocity export rejects an explicit unknown completed-mission classification', () => {
  assert.throws(() => assertVelocityOutcomesAreUnambiguous([outcome('2026-09-21T12:00:00Z', ['unknown'])]), /unresolved classification/);
  assert.doesNotThrow(() => assertVelocityOutcomesAreUnambiguous([outcome('2026-09-21T12:00:00Z', ['user_value'])]));
});

test('README image contracts use raw GitHub assets that exist locally', () => {
  const readme = fs.readFileSync('README.md', 'utf8');
  for (const asset of ['first-value-demo.gif', 'velocity-throughput.svg']) {
    assert.match(readme, new RegExp(`https://raw\\.githubusercontent\\.com/oxtan-maker/parallix/main/docs/assets/${asset}`));
    assert.ok(fs.existsSync(`docs/assets/${asset}`));
  }
  assert.match(readme, /historical baseline of approximately 2 delivery units\/week/);
});
