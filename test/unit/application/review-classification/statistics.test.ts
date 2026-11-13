import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewRounds } from '../../../../src/application/review-classification/statistics.js';
import { renderClassifierStatistics } from '../../../../src/application/presentation/classifier-statistics.js';
import { weeklyDecisionWindows } from '../../../../src/application/services/decision-window.js';
import { classificationAttempt } from '../../../fixtures/repeat-review.js';

test('px stats fallback-reasons table renders each distinguishable classifier failure cause (TASK-2704)', () => {
  const windows = weeklyDecisionWindows('2026-10-06', 'UTC');
  const row = (round: number, reason: string, unreached = false) => classificationAttempt({
    round,
    decisionId: `d${round}`,
    fingerprint: `f${round}`,
    observedAt: '2026-10-05T00:00:00Z',
    route: 'reviewer',
    reason,
    classificationMs: null,
    ...(unreached ? { provider: null, model: null, packetHash: null } : {}),
  });
  const attempts = [
    row(2, 'evidence-over-budget'),
    row(3, 'evidence-read-failed'),
    row(4, 'classifier-exception'),
    row(5, 'provider-key-missing', true),
    row(6, 'provider-unavailable', true),
    row(7, 'consecutive-classifier-returns', true),
  ];
  const report = renderClassifierStatistics(
    { decisions: [], attempts, coverage: 'complete' },
    [windows.current, windows.previous],
  );
  for (const reason of [
    'evidence-over-budget',
    'evidence-read-failed',
    'classifier-exception',
    'provider-key-missing',
    'provider-unavailable',
    'consecutive-classifier-returns',
  ]) {
    assert.match(report, new RegExp(`\\| ${reason}\\s+\\|\\s+1 \\(partial\\) \\|`), reason);
  }
});

test('classifier clear statistics separate omissions and historical unknowns (TASK-2751)', () => {
  const windows = weeklyDecisionWindows('2026-10-06', 'UTC');
  const attempts = [0, 2, undefined].map((omittedDiffCount, index) => classificationAttempt({
    round: index + 2,
    decisionId: `omission-${index}`,
    observedAt: '2026-10-05T00:00:00Z',
    route: 'clear',
    omittedDiffCount,
    omittedTokens: omittedDiffCount ? 500 : 0,
  }));
  attempts.push(classificationAttempt({
    round: 5,
    decisionId: 'context-only',
    observedAt: '2026-10-05T00:00:00Z',
    route: 'clear',
    omittedDiffCount: 0,
    omittedTokens: 500,
  }));
  const input = { decisions: [], attempts, coverage: 'complete' as const };
  const result = reviewRounds(input, windows.current);
  assert.equal(result.clearsWithOmissions, 2);
  assert.equal(result.clearsWithoutOmissions, 1);
  assert.equal(result.clearsOmissionsUnknown, 1);
  const rendered = renderClassifierStatistics(input, [windows.current, windows.previous]);
  assert.match(rendered, /With omissions\s+\|\s+2/);
  assert.match(rendered, /Without omissions\s+\|\s+1/);
  assert.match(rendered, /Historical unknown\s+\|\s+1/);
});

test('decided rounds ignore missing and undecided samples and use decision weeks (TASK-2758)', () => {
  const windows = weeklyDecisionWindows('2026-10-09', 'UTC');
  for (const round of [1, 2]) {
    const kind = round === 1 ? 'first review' : 're-review';
    const decisions = [
      { id: 'no-sample', round, decidedAt: '2026-10-08T12:00:00Z', source: 'reviewer' as const, outcome: 'clear' as const },
      { id: 'cross-week', round, decidedAt: '2026-10-08T13:00:00Z', source: 'classifier' as const, outcome: 'clear' as const },
      { id: 'before-telemetry', round, decidedAt: '2026-10-01T12:00:00Z', source: 'classifier' as const, outcome: 'implementer' as const },
    ];
    const attempts = [
      classificationAttempt({ round, decisionId: 'cross-week', observedAt: '2026-10-01T13:00:00Z' }),
      classificationAttempt({ round, mission: 'undecided', decisionId: 'undecided', observedAt: '2026-10-08T13:00:00Z' }),
    ];
    const input = { decisions, attempts, coverage: 'partial' as const };
    const current = reviewRounds(input, windows.current, kind);
    assert.equal(current.rounds, 2, 'decided round without a sample is counted; undecided sample is excluded');
    assert.equal(current.jevDecisions, 1, 'attribution uses the stored decider in its decision week');
    assert.equal(reviewRounds(input, windows.previous, kind).rounds, 1);
    assert.equal(
      reviewRounds({ ...input, attempts: [] }, windows.previous, kind).jevDecisions,
      1,
      'pre-telemetry share remains available',
    );
  }
});

test('deciders are exclusive and partial telemetry leaves decided share available (TASK-2758)', () => {
  const windows = weeklyDecisionWindows('2026-10-09', 'UTC');
  const at = '2026-10-08T12:00:00Z';
  const decisions = (['classifier', 'mechanical', 'reviewer'] as const).map(source => ({
    id: source,
    round: 2,
    source,
    decidedAt: at,
    outcome: 'clear' as const,
  }));
  const sample = classificationAttempt({ observedAt: at, route: 'clear', decisionId: 'classifier' });
  const input = {
    decisions: [...decisions, decisions[0]],
    attempts: [sample, sample],
    coverage: 'complete' as const,
  };
  const result = reviewRounds(input, windows.current, 're-review');
  assert.deepEqual(
    [result.rounds, result.jevDecisions, result.mechanical, result.reviewer, result.called],
    [3, 1, 1, 1, 1],
  );
  assert.equal(result.coverage, 'partial');
  const report = renderClassifierStatistics(input, [windows.current, windows.previous]);
  const current = report.split('\n').find(line => line.startsWith('| This week'))!;
  assert.match(current, /\|\s+3 \|\s+1 \|\s+1 \|\s+1 \|\s+33% \|/);
  assert.match(current, /1 \(partial\)/);
  assert.match(report, /Sample coverage starts: 2026-10-08T12:00:00Z/);
  assert.match(
    report.split('\n').find(line => line.startsWith('| Last week'))!,
    /\|\s+0 \|\s+0 \|\s+0 \|\s+0 \|\s+n\/a \|/,
  );
  assert.doesNotMatch(report, /Observed wrong|unobserved|Integration.repair|V5|preserves probability/);
  const complete = {
    decisions: [decisions[0]],
    attempts: [
      sample,
      classificationAttempt({ observedAt: '2026-09-01T00:00:00Z', mission: 'early', round: 1 }),
    ],
    coverage: 'complete' as const,
  };
  assert.equal(reviewRounds(complete, windows.current).coverage, 'complete');
});
