

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { mockModule, installModuleMocks } from './lib/module-mock.js';
const startReviewLoopModule = mockModule<typeof import('../src/adapters/review/review-loop.js')>('../src/adapters/review/review-loop.js', import.meta.url);
const pushRoundModule = mockModule<typeof import('../src/adapters/review/review-commands.js')>('../src/adapters/review/review-commands.js', import.meta.url);
const performHandoffModule = mockModule<typeof import('../src/adapters/cli/commands/handoff.js')>('../src/adapters/cli/commands/handoff.js', import.meta.url);
const forgejo = mockModule<typeof import('../src/adapters/forgejo/forgejo.js')>('../src/adapters/forgejo/forgejo.js', import.meta.url);
const gatekeeper = mockModule<typeof import('../src/adapters/verification/gatekeeper.js')>('../src/adapters/verification/gatekeeper.js', import.meta.url);
const backlog = mockModule<typeof import('../src/adapters/backlog/backlog.js')>('../src/adapters/backlog/backlog.js', import.meta.url);
const missionUtils = mockModule<typeof import('../src/adapters/filesystem/mission-utils.js')>('../src/adapters/filesystem/mission-utils.js', import.meta.url);
const git = mockModule<typeof import('../src/adapters/git/git.js')>('../src/adapters/git/git.js', import.meta.url);
// `handoff.ts` reads the filesystem through `import * as fs from 'node:fs'`.
// That namespace is immutable, so patching the `fs` default export no longer
// reaches it — the doubles below must be installed through the module seam.
const nodeFs = mockModule<typeof import('node:fs')>('node:fs', import.meta.url);
await installModuleMocks();
const { startReviewLoop } = startReviewLoopModule;
const { pushRound } = pushRoundModule;
const { performHandoff } = performHandoffModule;
const { mock } = test;

// Isolate stats writes to a temp PARALLIX_HOME so this test never pollutes
// the real operator stats.csv at the real PARALLIX_HOME.
let _prevParallixHome;
let _tmpHome;
test.beforeEach(() => {
  _tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'task-1104-home-'));
  _prevParallixHome = process.env.PARALLIX_HOME;
  process.env.PARALLIX_HOME = _tmpHome;
});
test.afterEach(() => {
  if (_prevParallixHome === undefined) delete process.env.PARALLIX_HOME;
  else process.env.PARALLIX_HOME = _prevParallixHome;
  fs.rmSync(_tmpHome, { recursive: true, force: true });
});

const TEST_SLUG = 'task-1104-test';

test('startReviewLoop follows the transition contract: review before reviewer, active before implementer', async () => {
  const events = [];
  const logs = [];

  const baseOpts = {
    isForgejoReviewEnabledFn: () => true,
    eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'custom'],
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
    implementer: 'claude',
    reviewer: 'codex',
    worktree: '/tmp/test',
    gitFn: () => ({ status: 0, stdout: 'main\n', stderr: '' }),
    dryRun: false,
    log: (m) => logs.push(m),
    error: (m) => console.error(m),
    exit: (code) => { if (code !== 0) throw new Error(`Exit ${code}`); },
    workflowLauncherStatusFn: () => ({ supported: true }),
    forgejoAvailableFn: async () => true,
    getPrStatusFn: () => ({ exists: true, state: 'open', number: 41 }),
    maybeUpdateGraphifyBeforeReviewFn: () => {},
    enforceTaskAssigneeFn: () => true,
    resolveForgejoUserFn: () => 'gemini',
    readTokenFn: () => 'token',
    readReviewStateFn: () => null,
    writeReviewStateFn: () => {},
    rebaseBeforeReviewRoundFn: async () => ({ ok: true, sharedFileConflicts: false }),
    performHandoffFn: async () => {},
    // Track transition calls
    transitionTaskFn: (slug, status, options) => {
      events.push({ type: 'transition', status, implementer: options.implementer });
      return true;
    },
    transitionVirtualFn: (transition, slug, status, options) => transition(slug, status, options),

    // Track agent launches
    startAgentFn: async (step, options) => {
      events.push({ type: 'launch', step, agent: options.agent });
      return { agent: options.agent };
    },

    // Mock polling results to ensure we go through one full round
    pollForReviewFn: async () => 'REQUEST_CHANGES',
    // A terminal disposition proves the complete reviewer -> implementer order
    // in one round without exercising the five-round retry policy.
    pollForDispositionFn: async () => 'PUSHBACK_ALL',

    applyAgentFallbackFn: (args) => args.original,
    buildCompactReviewPromptFn: () => 'review prompt',
    buildCompactActOnReviewPromptFn: () => 'act-on-review prompt',
    consumeReviewerArtifactsFn: async () => ({ consumed: false }),
    consumeImplementerArtifactsFn: async () => ({ consumed: false }),
    recordStageStatsSafeFn: () => {},
    runPreReviewGateFn: async () => ({ ok: true, area: 'all', command: 'mock gate', exitCode: 0, stdout: '', stderr: '' }),
  };

// @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
  await startReviewLoop(TEST_SLUG, baseOpts);

  // Expected sequence:
  // 1. transition to 'review' (before reviewer launch)
  // 2. launch 'review' (reviewer)
  // 3. transition to 'active' (before act-on-review launch)
  // 4. launch 'act-on-review' (implementer)

  const relevantEvents = events.filter(e => e.type === 'transition' || e.type === 'launch');

  // Current implementation (which we want to fix) might have an 'active' transition at the very start.
  // We want to ensure that 'review' happens before the reviewer launch.

  const reviewerLaunchIdx = relevantEvents.findIndex(e => e.type === 'launch' && e.step === 'review');
  const implementerLaunchIdx = relevantEvents.findIndex(e => e.type === 'launch' && e.step === 'act-on-review');

  assert.ok(reviewerLaunchIdx !== -1, 'Reviewer should be launched');
  assert.ok(implementerLaunchIdx !== -1, 'Implementer should be launched');

  // Check 'review' transition before reviewer launch
  const reviewTransitionIdx = relevantEvents.findIndex(e => e.type === 'transition' && e.status === 'review');
  assert.ok(reviewTransitionIdx !== -1, "Transition to 'review' should occur");
  assert.ok(reviewTransitionIdx < reviewerLaunchIdx, "Transition to 'review' must occur BEFORE reviewer launch");

  // Check 'active' transition before implementer launch
  const activeTransitionIdx = relevantEvents.findIndex(e => e.type === 'transition' && e.status === 'active' && e.implementer === 'claude');
  assert.ok(activeTransitionIdx !== -1, "Transition to 'active' should occur");
  assert.ok(activeTransitionIdx > reviewerLaunchIdx, "Transition to 'active' must occur AFTER reviewer launch");
  assert.ok(activeTransitionIdx < implementerLaunchIdx, "Transition to 'active' must occur BEFORE implementer launch");

  // Ensure no 'active' transition before 'review' transition (the bug we are fixing)
  const firstActiveTransitionIdx = relevantEvents.findIndex(e => e.type === 'transition' && e.status === 'active');
  assert.ok(firstActiveTransitionIdx > reviewTransitionIdx, "Initial transition should not be 'active'");
});

test('pushRound follows the transition contract: review before createPr', async () => {
  const events = [];
  const logs = [];

  const opts = {
    resolveWorktreeFn: () => '/tmp/worktree',
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
    getTaskImplementerFn: () => 'gemini',
    readTokenFn: () => 'token',
    log: msg => logs.push(msg),
    transitionTaskFn: (slug, status, options) => {
      events.push({ type: 'transition', status });
      return true;
    },
    createPrFn: (branch, user, token, options) => {
      events.push({ type: 'createPr' });
      return { ok: true };
    }
  };

// @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
  await pushRound(TEST_SLUG, opts);

  const relevantEvents = events.filter(e => e.type === 'transition' || e.type === 'createPr');

  const reviewTransitionIdx = relevantEvents.findIndex(e => e.type === 'transition' && e.status === 'review');
  const createPrIdx = relevantEvents.findIndex(e => e.type === 'createPr');

  assert.ok(reviewTransitionIdx !== -1, "Transition to 'review' should occur");
  assert.ok(createPrIdx !== -1, "createPr should occur");
  assert.ok(reviewTransitionIdx < createPrIdx, "Transition to 'review' must occur BEFORE createPr");
});

import { stubMissionServices } from './helpers/stub-mission-services.js';

test('performHandoff follows the sequence: createPr -> gatekeeper -> transitionTask -> push', async () => {
  const events = [];
  const slug = 'task-1104-handoff-test';

  // Mocking all external dependencies for performHandoff
  const mocks = [
    mock.method(git, 'getCurrentBranch', () => `mission/${slug}`),
    mock.method(git, 'getWorktreeStatus', () => []),
    mock.method(git, 'git', (args) => {
      if (args && args.includes('push')) {
        events.push({ type: 'push' });
      }
      return { status: 0 };
    }),
    mock.method(git, 'run', () => ({ status: 0 })),
    mock.method(missionUtils, 'findMissionDir', () => '/tmp/mission'),
    mock.method(missionUtils, 'findMissionArea', () => 'workflow'),
    mock.method(missionUtils, 'findCheckpoints', () => ['/tmp/mission/CP-1.md']),
    mock.method(backlog, 'resolveTaskFile', () => ({ ok: true, taskFile: '/tmp/task.md' })),
    mock.method(backlog, 'getTaskImplementer', () => 'gemini'),
    mock.method(backlog, 'transitionTask', () => {
      events.push({ type: 'transition', status: 'review' });
      return true;
    }),
    mock.method(forgejo, 'readToken', () => 'token'),
    mock.method(forgejo, 'createPr', () => {
      events.push({ type: 'createPr' });
      return { ok: true };
    }),
    mock.method(forgejo, 'authenticatedReviewUrl', () => 'http://forgejo/push'),
    mock.method(forgejo, 'resolveTrackingBranchSha', () => ({ ok: true, sha: 'expected-pr-tip' })),
    mock.method(gatekeeper, 'runGatekeeper', () => {
      events.push({ type: 'gatekeeper' });
      return { ok: true };
    }),
    mock.method(nodeFs, 'readFileSync', () => '## Goal Check\n| Goal | Evidence | Status |\n| :--- | :--- | :--- |\n| test | test/task-1104-call-order.test.js:1 | PASS |\n'),
    mock.method(nodeFs, 'existsSync', () => true),
    mock.method(git, 'getCurrentBranch', () => `mission/${slug}`)
  ];

  try {
    const mockRebase = async () => ({ ok: true, sharedFileConflicts: false });
    await performHandoff(slug, {
      skipGate: true,
      isForgejoReviewEnabledFn: () => true,
      rebaseFn: mockRebase,
      missionServicesFn: stubMissionServices(),
      // The blanket readFileSync mock above supplies checkpoint content. Keep
      // agent selection independent of filesystem-backed configuration.
      eligibleAgentsForStepFn: () => ['codex', 'claude'],
      selectAgentFn: () => 'claude',
    });

    const relevantEvents = events.filter(e => e.type === 'createPr' || e.type === 'gatekeeper' || e.type === 'transition' || e.type === 'push');

    const createPrIdx = relevantEvents.findIndex(e => e.type === 'createPr');
    const gatekeeperIdx = relevantEvents.findIndex(e => e.type === 'gatekeeper');
    const transitionIdx = relevantEvents.findIndex(e => e.type === 'transition');
    const pushIdx = relevantEvents.findIndex(e => e.type === 'push');

    assert.ok(createPrIdx !== -1, "createPr should occur");
    assert.ok(gatekeeperIdx !== -1, "gatekeeper should occur");
    assert.ok(transitionIdx !== -1, "transition should occur");
    assert.ok(pushIdx !== -1, "push should occur");

    assert.ok(createPrIdx < gatekeeperIdx, "createPr must occur before gatekeeper");
    assert.ok(gatekeeperIdx < transitionIdx, "gatekeeper must occur before transitionTask");
    assert.ok(transitionIdx < pushIdx, "transitionTask must occur before final push");
  } finally {
    mock.restoreAll();
  }
});

test('startReviewLoop does not transition to review if rebase fails', async () => {
  const events = [];
  const logs = [];

  const baseOpts = {
    isForgejoReviewEnabledFn: () => true,
    eligibleAgentsForStepFn: () => ['codex'],
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
    implementer: 'claude',
    reviewer: 'codex',
    dryRun: false,
    log: (m) => logs.push(m),
    error: (m) => {},
    exit: (code) => { if (code !== 0) events.push({ type: 'exit', code }); },
    workflowLauncherStatusFn: () => ({ supported: true }),
    forgejoAvailableFn: async () => true,
    getPrStatusFn: () => ({ exists: true, state: 'open', number: 41 }),
    maybeUpdateGraphifyBeforeReviewFn: () => {},
    enforceTaskAssigneeFn: () => true,
    resolveForgejoUserFn: () => 'gemini',
    readTokenFn: () => 'token',
    readReviewStateFn: () => null,
    writeReviewStateFn: () => {},

    // FAILING REBASE
    rebaseBeforeReviewRoundFn: async () => ({ ok: false, sharedFileConflicts: false }),

    transitionTaskFn: (slug, status, options) => {
      events.push({ type: 'transition', status });
      return true;
    },

    startAgentFn: async (step, options) => {
      events.push({ type: 'launch', step });
      return { agent: options.agent };
    },


  };

// @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
  await startReviewLoop(TEST_SLUG, baseOpts);

  const reviewTransitions = events.filter(e => e.type === 'transition' && e.status === 'review');
  assert.equal(reviewTransitions.length, 0, "Should NOT transition to 'review' if rebase fails");

  const exitEvent = events.find(e => e.type === 'exit');
  assert.ok(exitEvent, "Should exit if rebase fails");
});

// Restore stats mocks to prevent stray writes to stats.csv.
mock.restoreAll();
