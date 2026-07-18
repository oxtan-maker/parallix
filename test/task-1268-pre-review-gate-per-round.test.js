const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startReviewLoop } = require('../dist/lib/review/review');

const TEST_SLUG = `task-1268-gate-per-round-${process.pid}`;
let previousHome;
let temporaryHome;

test.beforeEach(() => {
  temporaryHome = fs.mkdtempSync(path.join(os.tmpdir(), 'task-1268-gate-home-'));
  previousHome = process.env.PARALLIX_HOME;
  process.env.PARALLIX_HOME = temporaryHome;
});

test.afterEach(() => {
  if (previousHome === undefined) delete process.env.PARALLIX_HOME;
  else process.env.PARALLIX_HOME = previousHome;
  fs.rmSync(temporaryHome, { recursive: true, force: true });
});

test('startReviewLoop runs the pre-review gate before every reviewer round', async () => {
  const events = [];
  const gateCalls = [];
  const reviewOutcomes = ['REQUEST_CHANGES', 'APPROVED'];
  const dispositions = ['CHANGES_MADE'];

  await startReviewLoop(TEST_SLUG, {
    eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'custom'],
    // @ts-expect-error TS2322 Type '{ ok: true; taskFile: string; }' is not assignable to type '{ ok: boolean;
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
    implementer: 'claude', reviewer: 'codex', dryRun: false,
    // @ts-expect-error TS2739 Type '{ supported: true; }' is missing the following properties from type 'Launc
    workflowLauncherStatusFn: () => ({ supported: true }),
    isForgejoReviewEnabledFn: () => true,
    forgejoAvailableFn: async () => true,
    getPrStatusFn: () => ({ exists: true, state: 'open', number: 41 }),
    maybeUpdateGraphifyBeforeReviewFn: () => {},
    enforceTaskAssigneeFn: () => true,
    resolveForgejoUserFn: () => 'gemini', readTokenFn: () => 'token',
    // @ts-expect-error TS2322 Type '() => void' is not assignable to type '(slug: string, state: Record<string
    readReviewStateFn: () => null, writeReviewStateFn: () => {},
    rebaseBeforeReviewRoundFn: async () => ({ ok: true, sharedFileConflicts: false }),
    runPreReviewGateFn: async () => {
      gateCalls.push(gateCalls.length + 1);
      return { ok: true, area: 'lib', command: 'true', exitCode: 0, stdout: '', stderr: '' };
    },
    // @ts-expect-error TS2322 Type '(step: string, options: StartAgentOptions) => Promise<{ agent: any; }>' is
    startAgentFn: async (step, options) => {
      events.push(`${step}:${options.role}`);
      return { agent: null };
    },
    pollForReviewFn: async () => reviewOutcomes.shift(),
    pollForDispositionFn: async () => dispositions.shift(),
    applyAgentFallbackFn: ({ original }) => original,
    buildCompactReviewPromptFn: () => 'review prompt',
    buildCompactActOnReviewPromptFn: () => 'act-on-review prompt',
    // @ts-expect-error TS2322 Type '() => void' is not assignable to type '(_code: number) => never'.
    log: () => {}, error: () => {}, exit: () => {},
    consumeReviewerArtifactsFn: async () => ({ consumed: false }),
    consumeImplementerArtifactsFn: async () => ({ consumed: false }),
  });

  const reviewerLaunches = events.filter((event) => event === 'review:reviewer').length;
  assert.ok(reviewerLaunches >= 2, 'the simulated review loop must attempt multiple rounds');
  assert.equal(gateCalls.length, reviewerLaunches, 'each reviewer round must have exactly one pre-review gate');
});

test('startReviewLoop stops after a gate-failure bounce without launching a reviewer', async () => {
  const events = [];
  let gateCalls = 0;

  await startReviewLoop(TEST_SLUG, {
    eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'custom'],
    // @ts-expect-error TS2322 Type '{ ok: true; taskFile: string; }' is not assignable to type '{ ok: boolean;
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
    implementer: 'claude', reviewer: 'codex', dryRun: false,
    // @ts-expect-error TS2739 Type '{ supported: true; }' is missing the following properties from type 'Launc
    workflowLauncherStatusFn: () => ({ supported: true }),
    isForgejoReviewEnabledFn: () => true,
    forgejoAvailableFn: async () => true,
    getPrStatusFn: () => ({ exists: true, state: 'open', number: 41 }),
    maybeUpdateGraphifyBeforeReviewFn: () => {},
    enforceTaskAssigneeFn: () => true,
    resolveForgejoUserFn: () => 'gemini', readTokenFn: () => 'token',
    // @ts-expect-error TS2322 Type '() => void' is not assignable to type '(slug: string, state: Record<string
    readReviewStateFn: () => null, writeReviewStateFn: () => {},
    rebaseBeforeReviewRoundFn: async () => ({ ok: true, sharedFileConflicts: false }),
    runPreReviewGateFn: async () => {
      gateCalls += 1;
      return { ok: false, area: 'lib', command: 'false', exitCode: 1, stdout: '', stderr: '' };
    },
    handleGateFailureAutoBounceFn: async () => ({ bounced: true, stranded: false }),
    // @ts-expect-error TS2322 Type '(step: string, options: StartAgentOptions) => Promise<{ agent: any; }>' is
    startAgentFn: async (step, options) => {
      events.push(`${step}:${options.role}`);
      return { agent: null };
    },
    applyAgentFallbackFn: ({ original }) => original,
    buildCompactReviewPromptFn: () => 'review prompt',
    buildCompactActOnReviewPromptFn: () => 'act-on-review prompt',
    // @ts-expect-error TS2322 Type '() => void' is not assignable to type '(_code: number) => never'.
    log: () => {}, error: () => {}, exit: () => {},
    consumeReviewerArtifactsFn: async () => ({ consumed: false }),
    consumeImplementerArtifactsFn: async () => ({ consumed: false }),
  });

  assert.equal(gateCalls, 1);
  assert.equal(events.filter((event) => event === 'review:reviewer').length, 0);
});
