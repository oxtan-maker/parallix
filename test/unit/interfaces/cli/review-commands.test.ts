import type { StartReviewRound } from '../../../../src/application/ports/review-round.js';
import type { ReviewLoopObservers } from '../../../../src/adapters/review/review-workflow-adapter.js';
import { ReviewState } from '../../../../src/adapters/review/review-state.js';
type ObservedLoop = StartReviewRound & ReviewLoopObservers;

import { reviewOperation, reviewOperationPhase, reviewPushIdentity } from '../../../../src/domain/review-command-policy.js';

import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { ReviewCommandUseCase } from '../../../../src/application/review-command-use-case.js';
import { createReviewCommand } from '../../../../src/interfaces/cli/review.js';
import { mkdtemp as registeredMkdtemp } from '../../../helpers/temp-dir.js';
import { bindReviewPersistence } from '../../../../src/composition/review-persistence.js';
import { fixtureMission, inMemoryTransitionStore } from '../../../fixtures/mission-builders.js';
import { fakeReviewLoopPorts } from '../../../helpers/review-loop-ports.js';

/** Bound loop mechanisms whose held controller fence declines the run. */
const declinedLoop = () => fakeReviewLoopPorts({ lock: { tryAcquire: () => false, release: () => {} } }).ports;
const reviewCliFlags = await import('../../../../src/adapters/review/review-cli-flags.js');
const reviewWorkflowAdapter = await import('../../../../src/adapters/review/review-workflow-adapter.js');
test.afterEach(() => mock.restoreAll());
const { flagValue, readTextFlag, unknownReviewFlags } = reviewCliFlags;
const { ReviewWorkflowAdapter, createReviewWorkflowAdapter } = reviewWorkflowAdapter;
const review = (args: string[], options: NonNullable<Parameters<typeof createReviewWorkflowAdapter>[0]> = {}) =>
  createReviewCommand(new ReviewCommandUseCase(createReviewWorkflowAdapter(options)))(args, options);

test('createReviewWorkflowAdapter returns a ReviewWorkflowAdapter', () => {
  assert.ok(createReviewWorkflowAdapter() instanceof ReviewWorkflowAdapter);
});

// ============================================================================
// flagValue tests
// ============================================================================

test('flagValue returns null when flag not found', () => {
  const result = flagValue(['--other', 'value'], '--target');
  assert.equal(result, null);
});

test('flagValue returns value after flag', () => {
  const result = flagValue(['--flag', 'my-value'], '--flag');
  assert.equal(result, 'my-value');
});

test('flagValue returns null when value starts with --', () => {
  const result = flagValue(['--flag', '--other'], '--flag');
  assert.equal(result, null);
});

test('flagValue returns null when no value after flag', () => {
  const result = flagValue(['--flag'], '--flag');
  assert.equal(result, null);
});

test('flagValue finds flag in middle of array', () => {
  const result = flagValue(['a', 'b', '--flag', 'value', 'c'], '--flag');
  assert.equal(result, 'value');
});

// ============================================================================
// readTextFlag tests
// ============================================================================

test('readTextFlag reads from file when fileFlag is provided', () => {
  const tmpDir = registeredMkdtemp('test-readTextFlag-');
  const filePath = path.join(tmpDir, 'test-file.txt');
  fs.writeFileSync(filePath, 'file content\n', 'utf8');

  try {
    const result = readTextFlag(
      ['--message-file', filePath],
      '--message',
      '--message-file',
      'message',
      { readFileSync: fs.readFileSync, exit: () => {}, error: () => {} }
    );
    assert.equal(result, 'file content');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('readTextFlag reads from inline flag when fileFlag not found', () => {
  const result = readTextFlag(
    ['--message', 'inline content'],
    '--message',
    '--message-file',
    'message',
    { readFileSync: fs.readFileSync, exit: () => {}, error: () => {} }
  );
  assert.equal(result, 'inline content');
});

test('readTextFlag returns null when neither flag is present', () => {
  const result = readTextFlag(
    ['--other', 'value'],
    '--message',
    '--message-file',
    'message',
    { readFileSync: fs.readFileSync, exit: () => {}, error: () => {} }
  );
  assert.equal(result, null);
});

test('readTextFlag handles file read error gracefully', () => {
  let exited = false;
  const result = readTextFlag(
    ['--message-file', '/nonexistent/file.txt'],
    '--message',
    '--message-file',
    'message',
    {
      readFileSync: () => { throw new Error('ENOENT'); },
      exit: (code) => { exited = true; },
      error: () => {}
    }
  );
  assert.equal(result, null);
  assert.equal(exited, true);
});

test('bare review binds the handoff loop without implicitly approving (TASK-2810)', async () => {
  const fake = fakeReviewLoopPorts({ handoff: { handoff: async () => ({ ok: false, reason: 'criteria incomplete' }) } });
  let calls = 0;
  await review(['task-1259-regression'], {
    inferSlugFn: s => s ?? null, readReviewStateFn: async () => null,
    log: () => {}, error: () => {}, exit: () => {}, resolveWorktreeFn: () => null,
    reviewLoopMechanisms: () => { calls++; return fake.ports; },
  });
  assert.equal(calls, 1);
  assert.deepEqual(fake.exits, [1]);
  assert.deepEqual(fake.launches, []);
  assert.ok(!fake.mirrors.includes('approved'));
});

// ============================================================================
// Unknown-flag guard (--max-attempt typo silently ignored the override)
// ============================================================================

test('flagValue supports --flag=value form', () => {
  assert.equal(flagValue(['--max-attempts=7'], '--max-attempts'), '7');
  assert.equal(flagValue(['a', '--focus=tests', 'b'], '--focus'), 'tests');
  assert.equal(flagValue(['--max-attempts='], '--max-attempts'), null);
});

test('unknownReviewFlags flags typos but not values of value-taking flags', () => {
  assert.deepEqual(
    unknownReviewFlags(['--implementer', 'claude', '--reviewer', 'codex', '--max-attempt', '7']),
    ['--max-attempt']
  );
  assert.deepEqual(unknownReviewFlags(['--comment', '--not-a-flag but a message body']), []);
  assert.deepEqual(unknownReviewFlags(['task-1', '--max-attempts=7']), []);
});

test('review rejects an unknown flag with a suggestion instead of ignoring it', async () => {
  const errors: string[] = [];
  let exitCode: { value: number | null } = { value: null };
  let startReviewLoopCalled = 0;

  await review(['task-2322', '--max-attempt', '7'], {
    inferSlugFn: (s) => s || 'task-2322',
    log: () => {},
    error: (m) => errors.push(m),
    exit: (c) => { exitCode.value = c; },
    reviewLoopMechanisms: () => { startReviewLoopCalled += 1; return declinedLoop(); }
  });

  assert.equal(startReviewLoopCalled, 0, 'the loop must not start when a flag is misspelled');
  assert.equal(exitCode.value, 1);
  assert.ok(
    errors.some(e => e.includes('--max-attempt') && e.includes('--max-attempts')),
    `expected a suggestion for --max-attempts; got: ${errors.join(' | ')}`
  );
});

test('review passes an explicit --max-attempts through to the review loop', async () => {
  let received: { value: ObservedLoop | null } = { value: null };
  const exits: number[] = [];
  const exit = (code: number) => { exits.push(code); };

  await review(['task-2322', '--max-attempts', '7'], {
    continueReviewClearsInterventionFn: async () => false,
    readReviewStateFn: async slug => new ReviewState(slug, { round: 1, startedAt: '2026-01-01T00:00:00Z' }),
    inferSlugFn: (s) => s || 'task-2322',
    log: () => {},
    error: () => {},
    exit,
    reviewLoopMechanisms: (request, observers) => { received.value = { ...request, ...observers }; return declinedLoop(); }
  });

  assert.equal(received.value && received.value.maxAttempts, 7);
  assert.notEqual(received.value && received.value.exit, process.exit, 'nested review loops must not retain process.exit from the parent command');
  // The use case observes the injected exit (TASK-2620) and still forwards to it.
  assert.ok(received.value?.exit);
  received.value.exit(3);
  assert.equal(exits.at(-1), 3);
});

test('a manual review continuation renews the five-round budget at the current round', async () => {
  let received: { value: ObservedLoop | null } = { value: null };

  await review(['task-2436'], {
    continueReviewClearsInterventionFn: async () => false,
    inferSlugFn: (s) => s || 'task-2436',
    log: () => {}, error: () => {}, exit: () => {},
    readReviewStateFn: async slug => new ReviewState(slug, { round: 5, startedAt: '2026-01-01T00:00:00Z' }),
    reviewLoopMechanisms: (request, observers) => { received.value = { ...request, ...observers }; return declinedLoop(); },
  });

  assert.equal(received.value && received.value.maxAttempts, 9);
});

test('review automation retains its five-round limit', async () => {
  let received: { value: ObservedLoop | null } = { value: null };

  await review(['task-2436'], {
    inferSlugFn: (s) => s || 'task-2436',
    log: () => {}, error: () => {}, exit: () => {},
    readReviewStateFn: async () => null,
    reviewLoopMechanisms: (request, observers) => { received.value = { ...request, ...observers }; return declinedLoop(); },
  });

  assert.equal(received.value && received.value.maxAttempts, 5);
});

// An unknown identity may not begin a review; known missions reach handoff
// readiness even when their first Review has not been created yet.
test('bare review rejects an unknown mission without the DB-native Review aggregate', async () => {
  let startReviewLoopCalled = 0;
  const errors: string[] = [];
  const exits: number[] = [];

  await review(['task-2490'], {
    inferSlugFn: (s) => s || 'task-2490',
    log: () => {},
    error: message => errors.push(message),
    exit: code => { exits.push(code); },
    requireReviewAggregate: true,
    readReviewStateFn: async () => null,
    reviewLoopMechanisms: () => { startReviewLoopCalled += 1; return declinedLoop(); },
  });

  assert.equal(startReviewLoopCalled, 0, 'inferred entry must not reintroduce retired file-backed state for an unknown Mission');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /unknown|no valid Review aggregate/i);
  assert.deepEqual(exits, [1]);
});

// An unknown Mission stops before loop dispatch even when no Review exists.
test('bare review rejects an unknown mission before loop dispatch', async () => {
  const errors: string[] = [];
  let startReviewLoopCalled = 0;

  await review(['task-2490'], {
    inferSlugFn: (s) => s || 'task-2490',
    log: () => {},
    error: (m) => errors.push(m),
    exit: () => {},
    requireReviewAggregate: true,
    readReviewStateFn: async () => null,
    reviewLoopMechanisms: () => { startReviewLoopCalled += 1; return declinedLoop(); },
  });

  assert.equal(startReviewLoopCalled, 0, 'inferred entry must not reach the review loop for an unknown Mission');
  assert.ok(
    errors.some(e => /no valid Review aggregate/.test(e)),
    `expected the missing-Review diagnostic; got: ${errors.join(' | ')}`
  );
});

test('review forwards current-work agent publication into the review loop', async () => {
  let received: { value: ObservedLoop | null } = { value: null };

  await review(['task-2322'], {
    continueReviewClearsInterventionFn: async () => false,
    readReviewStateFn: async slug => new ReviewState(slug, { round: 1, startedAt: '2026-01-01T00:00:00Z' }),
    inferSlugFn: (s) => s || 'task-2322',
    log: () => {},
    error: () => {},
    exit: () => {},
    reviewLoopMechanisms: (request, observers) => { received.value = { ...request, ...observers }; return declinedLoop(); },
  });

  assert.equal(typeof received.value?.onAgentLaunched, 'function');
});

test('review rejects a non-numeric --max-attempts', async () => {
  const errors: string[] = [];
  let exitCode: { value: number | null } = { value: null };
  let startReviewLoopCalled = 0;

  await review(['task-2322', '--max-attempts', 'lots'], {
    continueReviewClearsInterventionFn: async () => false,
    readReviewStateFn: async slug => new ReviewState(slug, { round: 1, startedAt: '2026-01-01T00:00:00Z' }),
    inferSlugFn: (s) => s || 'task-2322',
    log: () => {},
    error: (m) => errors.push(m),
    exit: (c) => { exitCode.value = c; },
    reviewLoopMechanisms: () => { startReviewLoopCalled += 1; return declinedLoop(); }
  });

  assert.equal(startReviewLoopCalled, 0);
  assert.equal(exitCode.value, 1);
  assert.ok(
    errors.some(e => /--max-attempts requires a positive integer/.test(e)),
    `expected a positive-integer error; got: ${errors.join(' | ')}`
  );
});

test('review operation precedence and push identity are pure policies (TASK-2668.07)', () => {
  assert.equal(reviewOperation(['--status=true']), 'status');
  assert.equal(reviewOperation(['--comment-file=x']), 'comment');
  assert.equal(reviewOperation(['task-x', '--unknown']), 'enter');
  assert.equal(reviewOperationPhase('enter'), 'review');
  assert.equal(reviewOperationPhase('status'), undefined);
  assert.deepEqual(reviewPushIdentity(null, null, false), { identity: 'autonomous', defaulted: true });
  assert.deepEqual(reviewPushIdentity(null, null, true), { identity: null, defaulted: false });
  assert.equal(reviewPushIdentity('autonomous', 'codex', true).identity, null);
  assert.equal(reviewPushIdentity('claude', 'codex', true).identity, 'claude');
  assert.equal(reviewPushIdentity(null, 'codex', true).identity, 'codex');
});

test('composed review entry rejects an unknown mission without Review once and stops all downstream work (TASK-2696)', async () => {
  const slug = 'task-2696-repro';
  const store = inMemoryTransitionStore(fixtureMission('another-mission'));
  mock.method(store, 'load', async () => ({ kind: 'missing' as const }));
  const persistence = bindReviewPersistence(store, null);
  const errors: string[] = [];
  const exits: number[] = [];
  const effects: string[] = [];
  mock.method(store, 'save', async () => { effects.push('persist'); });
  const fake = fakeReviewLoopPorts({
    provider: { ensureReachable: async () => { effects.push('provider'); return true; } },
    routing: { nominate: () => { effects.push('reviewer'); return 'claude'; } },
    agents: { launch: async () => { effects.push('launch'); return {}; } },
    stateport: { persist: async () => { effects.push('round persistence'); } },
  });
  await review([slug], {
    inferSlugFn: () => slug,
    resolveWorktreeFn: () => null,
    log: () => {}, error: message => errors.push(message), exit: code => { exits.push(code); },
    requireReviewAggregate: true, missionStore: store,
    readReviewStateFn: persistence.readReviewState,
    continueReviewClearsInterventionFn: async () => { effects.push('clear intervention'); return false; },
    reviewLoopMechanisms: () => { effects.push('mechanisms'); return fake.ports; },
  });
  assert.deepEqual(effects, []);
  assert.deepEqual(exits, [1]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /unknown|no valid Review aggregate/i);
  assert.ok(errors[0].includes('known Mission'));
});

for (const prerequisite of ['intervention', 'blocker']) {
  test(`continuation stops after a ${prerequisite} prerequisite failure when exit returns (TASK-2696)`, async () => {
    const errors: string[] = [];
    const exits: number[] = [];
    const effects: "dispatch"[] = [];
    const store = inMemoryTransitionStore(fixtureMission('task-2696-failure'));
    mock.method(store, 'load', async () => { throw new Error('isolated store read failure'); });
    await review(['task-2696-failure'], {
      inferSlugFn: () => 'task-2696-failure', resolveWorktreeFn: () => null,
      log: () => {}, error: message => errors.push(message), exit: code => { exits.push(code); },
      operatorResume: { acknowledge: async () => {} },
      missionStore: store, readReviewStateFn: async slug => new ReviewState(slug, { round: 2, startedAt: '2026-01-01T00:00:00Z' }),
      ...(prerequisite === 'blocker' ? { continueReviewClearsInterventionFn: async () => false } : {}),
      reviewLoopMechanisms: () => { effects.push('dispatch'); return declinedLoop(); },
    });
    assert.deepEqual(exits, [1]);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /isolated store read failure/);
    assert.deepEqual(effects, []);
  });
}

test('resume without a persisted Review returns after one rejection without writes (TASK-2696)', async () => {
  const errors: string[] = [];
  const exits: number[] = [];
  const store = inMemoryTransitionStore(fixtureMission('task-2696-resume'));
  mock.method(store, 'save', async () => { return assert.fail('resume must not persist a missing review'); });
  await review(['task-2696-resume', '--resume', '--actor', 'operator'], {
    inferSlugFn: () => 'task-2696-resume', resolveWorktreeFn: () => null,
    missionStore: store, log: () => {}, error: message => errors.push(message),
    exit: code => { exits.push(code); },
    reviewLoopMechanisms: () => { return assert.fail('resume must not dispatch the loop'); },
  });
  assert.deepEqual(exits, [1]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Unknown flag.*--resume/);
});

test('continuation preserves unexpected helper errors (TASK-2696)', async () => {
  const failure = new Error('unexpected prerequisite failure');
  await assert.rejects(async () => review(['task-2696-failure'], {
    inferSlugFn: () => 'task-2696-failure', resolveWorktreeFn: () => null,
    readReviewStateFn: async slug => new ReviewState(slug, { round: 2, startedAt: '2026-01-01T00:00:00Z' }),
    operatorResume: { acknowledge: async () => {} },
    continueReviewClearsInterventionFn: async () => { throw failure; },
    log: () => {}, error: () => {}, exit: () => {},
    reviewLoopMechanisms: () => { return assert.fail('unexpected errors must stop dispatch'); },
  }), (error) => error === failure);
});


test('composition grants review acknowledgment only to a direct operator invocation (TASK-2759)', async () => {
  const { bindReviewOperatorResume, withinCliInvocation } = await import('../../../../src/composition/review-operator-resume.js');
  const store = inMemoryTransitionStore(fixtureMission('task-2759'));
  assert.equal(bindReviewOperatorResume(store, false, {}), undefined, 'automatic and borrowed registries have no authority');
  assert.equal(bindReviewOperatorResume(store, true, { nestedWork: {} }), undefined);
  assert.equal(bindReviewOperatorResume(store, true, { integrationOwnsReview: true }), undefined);
  await withinCliInvocation(true, async direct => {
    assert.ok(bindReviewOperatorResume(store, direct, {}));
    await withinCliInvocation(true, async nested => {
      assert.equal(bindReviewOperatorResume(store, nested, {}), undefined, 'reentrant public CLI has no authority');
    });
  });
  withinCliInvocation(false, direct => assert.equal(direct, false, 'forwarded supervisor invocation'));
});

for (const providerEnabled of [true, false]) {
  test(`explicit status preserves provider PR inspection when enabled=${providerEnabled} (TASK-2810)`, async () => {
    const logs: string[] = [];
    let providerReads = 0;
    await review(['task-status', '--status'], {
      inferSlugFn: () => 'task-status',
      resolveWorktreeFn: () => '/fixture',
      readReviewStateFn: async () => null,
      isReviewProviderEnabledFn: () => providerEnabled,
      getPrStatusFn: (branch, root) => {
        assert.equal(branch, 'mission/task-status');
        assert.equal(root, '/fixture');
        providerReads++;
        return { exists: false, raw: 'no PR found' };
      },
      log: message => logs.push(message),
      reviewLoopMechanisms: () => { throw new Error('status must not enter review'); },
    });
    assert.equal(providerReads, providerEnabled ? 1 : 0);
    assert.equal(logs.includes('no PR found'), providerEnabled);
    assert.ok(logs.some(message => message.includes('No persisted review state')));
  });
}
