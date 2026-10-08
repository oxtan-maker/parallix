// review loop presentation contract.
// Related scenarios share imports; each contract keeps its own hooks and mutable fixtures.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { runReviewLoop } from '../../../../src/application/review-loop/review-loop.js';
import { renderReviewLoopEvent, renderReviewVerdict } from '../../../../src/adapters/review/review-loop-presentation.js';
import { reviewIndependence } from '../../../../src/adapters/review/review-loop-presentation.js';
import type { ReviewLoopEvent } from '../../../../src/application/ports/review-loop-output.js';
import type { ReviewerArtifactFacts } from '../../../../src/application/ports/review-round.js';
import { fakeReviewLoopPorts } from '../../../helpers/review-loop-ports.js';

/** Provider=none start with no runnable reviewer launcher and an unassigned task. */
function providerNone(consumeReviewer: () => Promise<ReviewerArtifactFacts>, runGate?: () => Promise<{ ok: true }>) {
  return fakeReviewLoopPorts({
    slug: 'task-999',
    routing: {
      eligibleFamilies: () => ['codex'],
      launcherStatus: () => ({ supported: false, detail: 'not installed' }),
      nominate: () => { throw new Error('No agents available'); },
    },
    // SC1: a provider-disabled --start performs the handoff transition.
    handoff: { handoff: async () => ({ ok: true }) },
    agents: { launch: async launch => { throw new Error(`unexpected ${launch.role} launch`); } },
    artifacts: { consumeReviewer, consumeImplementer: async () => ({ consumed: true, ok: true, disposition: 'CHANGES_MADE' }) },
    ...(runGate ? { preReview: { runGate } } : {}),
    output: { exit: (code: number) => { throw new Error(`exit(${code})`); } },
  });
}

// Regression provenance: TASK-1209.
describe("review loop", { concurrency: false }, () => {
  test('review loop skips reviewer and implementer launches for autonomous fallback in provider=none mode', async () => {
    const fake = providerNone(async () => ({ consumed: true, ok: true, reviewState: 'REQUEST_CHANGES' }));
    await runReviewLoop({ slug: 'task-999', maxAttempts: 1 }, fake.ports);
    const { logs, errors } = fake;

    assert.deepEqual(fake.launches, [], 'autonomous fallback should not launch any agents');
    assert.equal(errors.length, 0, `expected no errors, got: ${errors.join(' | ')}`);
    assert.ok(logs.some(msg => msg.includes('skipping reviewer launch')), 'should log reviewer launch bypass');
    assert.ok(logs.some(msg => msg.includes('skipping implementer launch')), 'should log implementer launch bypass');
    assert.equal(logs.filter(msg => msg.includes('Selected reviewer:')).length, 1, 'reviewer selection is announced once');
    assert.ok(logs.some(msg => msg.includes('REVIEW — task-999')), 'operator header identifies the mission');
    assert.ok(logs.some(msg => msg.includes('Independence: same-family fallback / self-review')), 'operator header states the fallback relationship');
    assert.equal(logs.some(msg => /Poll interval|Poll timeout|Max attempts|Persisted reviewer artifacts/.test(msg)), false, 'default output hides review plumbing');
  });
});

// Regression provenance: TASK-2477.
describe("review presentation", { concurrency: false }, () => {
  /**
   * Focused review-presentation tests for TASK-2477. These drive the review
   * loop through fake mechanism ports so the exact default/verbose emissions
   * are asserted without launching real agents.
   */
  const happyPath = (outcome = 'APPROVED') => providerNone(async () => ({ consumed: true, ok: true, reviewState: outcome, reviewFindings: [] }));

  test('single pre-review gate pass emission on the happy path', async () => {
    const lines: string[] = [];
    // TASK-2477/F4: the gate mechanism emits the real announcement, so the test
    // asserts how many times the gate-pass line is emitted. A duplicate
    // emission in the loop would push this count to 2 and fail.
    const fake = providerNone(async () => ({ consumed: true, ok: true, reviewState: 'APPROVED' }), async () => {
      lines.push('[PASS] Pre-review gate passed for area "docs".');
      return { ok: true };
    });
    await runReviewLoop({ slug: 'task-999', maxAttempts: 1 }, fake.ports);
    const logs = [...lines, ...fake.logs];
    assert.equal(logs.filter((m) => m.includes('Pre-review gate passed for area')).length, 1, `pre-review gate success announced exactly once on the happy path`);
    assert.equal(fake.errors.length, 0, `no errors on happy path: ${fake.errors.join(' | ')}`);
  });

  test('verdict prominence: APPROVED emitted before the review-stopped transition line', async () => {
    const fake = happyPath();
    await runReviewLoop({ slug: 'task-999', maxAttempts: 1 }, fake.ports);
    const approvedIdx = fake.logs.findIndex((m) => /APPROVED/.test(m) && m.includes('===='));
    const stopIdx = fake.logs.findIndex((m) => m.includes('Autonomous review stopped: reviewer approved'));
    assert.ok(approvedIdx !== -1, 'prominent APPROVED verdict is presented');
    assert.ok(stopIdx !== -1, 'review-stopped transition line present');
    assert.ok(approvedIdx < stopIdx, `verdict (${approvedIdx}) precedes the stop/transition line (${stopIdx})`);
  });

  test('non-APPROVED persisted state emits no APPROVED presentation', async () => {
    // REQUEST_CHANGES routes into the fixing branch; no approval is presented.
    const fake = happyPath('REQUEST_CHANGES');
    await runReviewLoop({ slug: 'task-999', maxAttempts: 1 }, fake.ports);
    assert.ok(!fake.logs.some((m) => /APPROVED/.test(m) && m.includes('====')), 'no APPROVED verdict for a non-approval state');
  });

  test('verbose review start exposes poll/provider lines that default hides', async () => {
    const verbose = happyPath();
    await runReviewLoop({ slug: 'task-999', maxAttempts: 1, verbose: true }, verbose.ports);
    const quiet = happyPath();
    await runReviewLoop({ slug: 'task-999', maxAttempts: 1 }, quiet.ports);
    assert.ok(verbose.logs.some((m) => m.includes('Forgejo validation skipped')), 'verbose on: provider-skipped line present');
    // TASK-2477/F4: Max attempts is part of the demoted review-start header too.
    assert.ok(quiet.logs.some((m) => /Poll interval|Poll timeout|Max attempts/.test(m)) === false, 'default off: poll/timeout/max-attempts lines absent');
    assert.ok(verbose.logs.some((m) => /Poll interval|Poll timeout/.test(m)), 'verbose on: poll lines present');
    assert.ok(verbose.logs.some((m) => /Max attempts/.test(m)), 'verbose on: max-attempts line present');
  });

  test('incomplete reviewer-artifact infrastructure failure survives at default verbosity', async () => {
    const fake = providerNone(async () => ({ consumed: true, ok: false, diagnostic: 'persist failed (outcome): sqlite busy' }));
    await runReviewLoop({ slug: 'task-999', maxAttempts: 1 }, fake.ports);
    assert.ok(fake.errors.some((m) => m.includes('Reviewer artifact infrastructure failure')), 'infra failure message surfaces at default verbosity');
    assert.deepEqual(fake.stops, ['REVIEWER_ARTIFACT_INFRA_FAILURE'], 'an infrastructure failure escalates to a human instead of relaunching');
  });
});

// Regression provenance: TASK-2351.
describe('review independence and verdict output', () => {
  test('classifier fallbacks say whether the classifier abstained, failed or was not used (TASK-2675)', () => {
    const lines: string[] = [];
    const output = { log: (line: string) => { lines.push(line); }, error: (line: string) => { lines.push(line); } };
    for (const reason of ['abstention', 'classifier-publication-failed', 'opted-out']) {
      renderReviewLoopEvent({ kind: 'reviewer-classification', reason }, output as never);
    }
    assert.match(lines[0], /Reviewer classifier abstained, continuing with general reviewer/);
    assert.match(lines[1], /Reviewer classifier failed \(classifier-publication-failed\), continuing with general reviewer/);
    assert.match(lines[2], /Reviewer classifier not used \(opted-out\), continuing with general reviewer/);
  });

  test('review presentation classifies different-family and same-family fallback from agent-family identity', () => {
    assert.equal(reviewIndependence('claude', 'custom'), 'different-family review');
    assert.equal(reviewIndependence('claude', 'claude'), 'same-family fallback / self-review');
    assert.doesNotMatch(reviewIndependence('claude', 'claude'), /different-family/);
  });

  test('review verdict presentation is authoritative and renders blocking findings before follow-up work', () => {
    const logs: string[] = [];
    // Structured findings carry the id so the verdict names the finding
    // (TASK-2478/criterion 5): the operator must tell WHICH finding blocks.
    renderReviewVerdict('REQUEST_CHANGES', [{ id: 'F1', summary: 'missing validation' }, { id: 'F2', summary: 'unhandled retry' }], (line) => logs.push(line));
    assert.match(logs[0], /CHANGES REQUESTED/);
    assert.match(logs[1], /Blocking finding: F1 — missing validation/);
    assert.match(logs[2], /Blocking finding: F2 — unhandled retry/);

    renderReviewVerdict('COMMENT', [], (line) => logs.push(line));
    assert.equal(logs.length, 3, 'non-authoritative states cannot produce an approval or changes verdict');
  });
});

test('renderReviewVerdict renders an APPROVED verdict as a PASS banner', () => {
  const logs: string[] = [];
  renderReviewVerdict('APPROVED', [], (line) => logs.push(line));
  assert.equal(logs.length, 1);
  assert.match(logs[0], /APPROVED/);
  assert.match(logs[0], /\[PASS\]/);
});

test('renderReviewVerdict surfaces a non-binary verdict only when verbose', () => {
  const quiet: string[] = [];
  renderReviewVerdict('COMMENT', [], (line) => quiet.push(line));
  assert.equal(quiet.length, 0, 'non-binary verdict is silent without verbose');

  const verbose: string[] = [];
  renderReviewVerdict('COMMENT', [], (line) => verbose.push(line), true);
  assert.equal(verbose.length, 1);
  assert.match(verbose[0], /Reviewer outcome = COMMENT/);
});


test('application review succeeds through structured observations without terminal output (TASK-2647)', async () => {
  const fake = providerNone(async () => ({ consumed: true, ok: true, reviewState: 'APPROVED', reviewFindings: [] }));
  const events: ReviewLoopEvent[] = [];
  fake.ports.output.emit = event => { events.push(event); };
  fake.ports.output.log = () => assert.fail('application must not render terminal output');
  fake.ports.output.error = () => assert.fail('application must not render terminal errors');
  await runReviewLoop({ slug: 'task-999', maxAttempts: 1 }, fake.ports);
  const verdict = events.findIndex(event => event.kind === 'review-verdict' && event.disposition === 'APPROVED');
  const stopped = events.findIndex(event => event.kind === 'reviewer-approved');
  assert.ok(verdict >= 0 && stopped > verdict, 'authoritative verdict precedes completion');
  assert.ok(events.some(event => event.kind === 'review-started' && event.slug === 'task-999'));
  assert.deepEqual(fake.mirrors, ['review', 'approved']);
});
