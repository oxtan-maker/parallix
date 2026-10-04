import { reviewLoopReporter } from '../../../../src/adapters/review/review-loop-presentation.js';
// reviewer fallback contract.
// Reviewer routing policy lives in src/application/review-loop/reviewer-selection.ts;
// these cases drive it through a fake routing port (eligible families, launcher
// status, and the configured selector's nominee).
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { selectReviewer, type ReviewerSelectionRequest } from '../../../../src/application/review-loop/reviewer-selection.js';
import { runReviewLoop } from '../../../../src/application/review-loop/review-loop.js';
import type { ReviewerRoutingPort } from '../../../../src/application/ports/review-round.js';
import { agentFamily } from '../../../../src/domain/agents.js';
import { PreparedAgentSelection } from '../../../../src/application/services/agent-selection.js';
import { fakeReviewLoopPorts } from '../../../helpers/review-loop-ports.js';

function routing(eligible: string[], supported: (_agent: string) => boolean, nominate: (_excluded: ReadonlySet<string>) => string): ReviewerRoutingPort {
  return { eligibleFamilies: () => eligible, launcherStatus: agent => ({ supported: supported(agent), detail: agent }), nominate, runtimeMatrix: () => [] };
}

function select(request: Partial<ReviewerSelectionRequest> & { implementer: string }, port: ReviewerRoutingPort) {
  const logs: string[] = [];
  const errors: string[] = [];
  const selected = selectReviewer({ isContinue: false, persisted: null, maxAttempts: 5, dryRun: true, providerEnabled: false, slug: 'task-test-fallback', ...request }, port, reviewLoopReporter({ log: line => logs.push(line), error: line => errors.push(line) }));
  return { selected, logs, errors };
}

// Regression provenance: TASK-1079.
describe("review blocked fallback", { concurrency: false }, () => {
  // Original bug: a blocked auto-derived reviewer crashed the loop with
  // "Unsupported reviewer" even though other families were available. A blocked
  // nominee must be treated as needing a fallback, not as a hard failure.

  test('reviewer selection falls back when the auto-derived reviewer is blocked but a different-family agent is available', () => {
    const { selected, logs, errors } = select({ implementer: 'custom' }, routing(['claude', 'vibe', 'custom'], () => true, excluded => ['vibe', 'claude'].filter(a => !excluded.has(a))[0]));
    assert.ok(selected, `selection must not fail when a fallback is available; errors: ${errors.join(' | ')}`);
    assert.ok(logs.some(l => l.includes('Selected reviewer: vibe (auto-derived)')), `Expected selected-reviewer=vibe log; got: ${logs.join(' | ')}`);
  });

  test('reviewer selection iterates past a blocked deterministic fallback to a third unblocked agent (Mission SC #3 — "Mistral or Claude")', () => {
    const { selected, logs, errors } = select({ implementer: 'custom' }, routing(['claude', 'custom', 'codex', 'vibe'], agent => agent === 'claude' || agent === 'custom', excluded => {
      if (!excluded.has('codex')) { return 'codex'; }
      if (!excluded.has('vibe')) { return 'vibe'; }
      return 'claude';
    }));
    assert.ok(selected, `selection must walk past a blocked deterministic fallback; errors: ${errors.join(' | ')}`);
    assert.ok(logs.some(l => l.includes('Selected reviewer: claude (auto-derived-fallback)')), `Expected selected-reviewer=claude after multi-hop fallback; got: ${logs.join(' | ')}`);
  });

  test('reviewer selection still rejects with a clear error when the explicit reviewer is blocked and no fallback path exists', () => {
    const { selected, errors } = select({ implementer: 'custom', reviewer: 'codex', dryRun: false }, routing(['claude', 'gemini', 'custom', 'codex'], agent => agent !== 'codex', () => 'claude'));
    assert.equal(selected, null, 'an explicit blocked reviewer stops the loop');
    assert.ok(errors.some(e => e.includes('Unsupported reviewer: "codex"') && e.includes('launcher is not available')), `Expected launcher-unavailable error; got: ${errors.join(' | ')}`);
  });
});

// Regression provenance: TASK-1135.
describe("review fallback", { concurrency: false }, () => {
  // 1. A blocked auto-derived reviewer falls back through the selector.
  // 2. A launch that hits a usage limit adopts the launcher's fallback family.
  // 3. A blocked persisted reviewer falls back to the next eligible family.
  // 4. Reviewer fallback never mutates the Backlog assignee (SC 5).

  test('CP-1: blocked auto-derived reviewer falls back via selectAgent without mutating Backlog assignee', () => {
    const { selected, logs, errors } = select({ implementer: 'vibe' }, routing(['codex', 'claude', 'custom', 'vibe'], agent => agent !== 'codex', excluded => {
      if (!excluded.has('codex')) { return 'codex'; }
      if (!excluded.has('claude')) { return 'claude'; }
      return 'custom';
    }));
    assert.ok(selected, `selection must not fail when fallback is available; errors: ${errors.join(' | ')}`);
    assert.ok(logs.some(l => l.includes('Unsupported reviewer: "codex"')), `Expected blocked-reviewer warning; got: ${logs.join(' | ')}`);
    assert.ok(logs.some(l => l.includes('trying fallback "claude"')), `Expected fallback-to-claude log; got: ${logs.join(' | ')}`);
    assert.equal(selected?.reviewerSource, 'auto-derived-fallback');
  });

  test('CP-1: usage-limit on auto-derived reviewer triggers fallback with blocklist write', async () => {
    // The launcher hit a usage limit for the nominated reviewer, recorded the
    // block, and launched another family. The loop adopts that family for the
    // poll and every later round, and never touches the Backlog assignee.
    const blocklistWrites: string[] = [];
    const fake = fakeReviewLoopPorts({
      slug: 'task-test-cp1-fallback',
      routing: { eligibleFamilies: () => ['codex', 'claude', 'vibe', 'custom'], nominate: excluded => (!excluded.has('custom') ? 'custom' : 'vibe') },
      agents: {
        launch: async launch => {
          if (launch.agent === 'custom') { blocklistWrites.push('custom'); return { agent: 'vibe', result: { status: 0 } }; }
          return { agent: launch.agent, result: { status: 0 } };
        },
      },
      artifacts: { consumeReviewer: async () => ({ consumed: true, ok: true, reviewState: 'APPROVED' }) },
    });
    await runReviewLoop({ slug: 'task-test-cp1-fallback', implementer: 'claude', maxAttempts: 1, skipHandoff: true }, fake.ports);
    assert.deepEqual(fake.exits, [], `the loop must not exit on usage-limit; errors: ${fake.errors.join(' | ')}`);
    assert.ok(fake.logs.some(l => l.includes('Selected reviewer: custom')), `Expected selected-reviewer=custom; got: ${fake.logs.join(' | ')}`);
    assert.deepEqual(blocklistWrites, ['custom']);
    assert.ok(fake.logs.some(l => l.includes('reviewer fell back from custom to vibe')), fake.logs.join(' | '));
    assert.equal(fake.current()?.reviewer, 'vibe', 'the fallback family is persisted as the reviewer');
    assert.ok(!fake.mirrors.some(effect => effect.startsWith('assign:')), 'a reviewer fallback never mutates the Backlog assignee');
  });

  test('CP-1: persisted blocked reviewer falls back via selectAgent without mutating Backlog assignee', () => {
    const { selected, logs, errors } = select({
      implementer: 'custom',
      persisted: { reviewer: 'codex', round: 1, phase: 'reviewing' },
    }, routing(['codex', 'claude', 'vibe', 'custom'], agent => agent !== 'codex', excluded => (!excluded.has('vibe') ? 'vibe' : 'claude')));
    assert.ok(selected, `selection must not fail on a persisted blocked reviewer; errors: ${errors.join(' | ')}`);
    assert.ok(logs.some(l => l.includes('Unsupported reviewer: "codex"')), `Expected blocked-persisted-reviewer warning; got: ${logs.join(' | ')}`);
    assert.ok(logs.some(l => l.includes('trying fallback "vibe"')), `Expected fallback-to-vibe log; got: ${logs.join(' | ')}`);
    assert.equal(selected?.reviewerSource, 'persisted-fallback');
  });

  test('CP-1: explicit blocked reviewer fails fast without fallback (unchanged behavior)', () => {
    const { selected, errors } = select({ implementer: 'custom', reviewer: 'codex', dryRun: false }, routing(['claude', 'vibe', 'custom', 'codex'], agent => agent !== 'codex', () => 'claude'));
    assert.equal(selected, null, 'Expected the explicit blocked reviewer to stop selection');
    assert.ok(errors.some(e => e.includes('Unsupported reviewer: "codex"')), `Expected unsupported-reviewer error; got: ${errors.join(' | ')}`);
  });

  test('CP-1: a dry run validates an explicit reviewer by eligibility only', () => {
    const { selected } = select({ implementer: 'custom', reviewer: 'codex' }, routing(['claude', 'custom', 'codex'], () => false, () => 'claude'));
    assert.equal(selected?.reviewer, 'codex', 'a dry run launches nothing, so an eligible explicit reviewer is accepted');
    const blocked = select({ implementer: 'custom', reviewer: 'codex' }, routing(['claude', 'custom'], () => true, () => 'claude'));
    assert.equal(blocked.selected, null, 'an ineligible explicit reviewer is still rejected in a dry run');
    assert.ok(blocked.errors.some(e => e.includes('Unsupported reviewer: "codex" (blocked or unsupported)')), blocked.errors.join(' | '));
  });

  test('CP-1: multi-hop fallback scans remaining eligible agents when deterministic fallback is also blocked', () => {
    const { selected, logs, errors } = select({ implementer: 'custom' }, routing(['claude', 'custom', 'codex', 'vibe'], agent => agent === 'claude' || agent === 'custom', excluded => {
      if (!excluded.has('codex')) { return 'codex'; }
      if (!excluded.has('vibe')) { return 'vibe'; }
      return 'claude';
    }));
    assert.ok(selected, `selection must scan remaining eligible agents; errors: ${errors.join(' | ')}`);
    assert.ok(logs.some(l => l.includes('Selected reviewer: claude')), `Expected selected-reviewer=claude after multi-hop; got: ${logs.join(' | ')}`);
  });

  test('CP-1: no runnable reviewer exits with error and does not mutate Backlog assignee', async () => {
    const fake = fakeReviewLoopPorts({
      routing: {
        eligibleFamilies: () => ['codex', 'claude', 'vibe'],
        launcherStatus: () => ({ supported: false, detail: 'blocked' }),
        nominate: excluded => {
          const available = ['codex', 'claude'].filter(a => !excluded.has(a));
          if (available.length === 0) { throw new Error('No agents available'); }
          return available[0];
        },
      },
    });
    await runReviewLoop({ slug: 'task-test-cp1-fallback', implementer: 'vibe', dryRun: true }, fake.ports);
    assert.deepEqual(fake.exits, [1], `Expected exit(1) when no reviewer is runnable; errors: ${fake.errors.join(' | ')}`);
    assert.ok(fake.errors.some(e => e.includes('No runnable reviewer route')), `Expected no-runnable-reviewer error; got: ${fake.errors.join(' | ')}`);
    assert.deepEqual(fake.mirrors, [], 'no Backlog mutation before a reviewer exists');
  });

  test('CP-1: single-family fallback when no different-family reviewer is runnable (unchanged)', () => {
    const { selected, logs, errors } = select({ implementer: 'claude' }, routing(['codex', 'claude', 'vibe'], agent => agent === 'claude', excluded => {
      const available = ['codex', 'vibe'].filter(a => !excluded.has(a));
      if (available.length === 0) { throw new Error('No agents available'); }
      return available[0];
    }));
    assert.ok(selected, `selection must succeed with single-family fallback; errors: ${errors.join(' | ')}`);
    assert.ok(logs.some(l => l.includes('Selected reviewer: claude')), `Expected selected-reviewer=claude (single-family); got: ${logs.join(' | ')}`);
    assert.equal(selected?.reviewerSource, 'single-family-fallback');
  });
});

// Regression provenance: TASK-2351.
describe("review loop selection", { concurrency: false }, () => {
  test('review-loop prepared selection skips SQLite-blocked reviewer before any launch (TASK-2351)', async () => {
    const codex = agentFamily('codex');
    const claude = agentFamily('claude');
    let launchCalls = 0;
    const prepared = await PreparedAgentSelection.prepare({
      async load() {
        return {
          capturedAtMs: 1_000,
          defaultPolicy: { eligible: [codex, claude], strategy: 'random' },
          steps: { review: { eligible: [codex, claude], strategy: 'random' } },
          agents: [
            { family: codex, launcherAvailable: true, block: { kind: 'until', untilMs: 2_000, reason: 'SQLite limit' } },
            { family: claude, launcherAvailable: true, block: { kind: 'none' } },
          ],
        };
      },
    } as never);
    const reviewer = prepared.select('review', { excluded: new Set() });
    if (reviewer === 'codex') { launchCalls += 1; }
    assert.equal(reviewer, 'claude');
    assert.equal(launchCalls, 0, 'blocked codex receives zero launch calls');
  });
});
