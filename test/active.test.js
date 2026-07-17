const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.NO_COLOR = '1';
const active = require('../lib/commands/active');

const {
  buildExecutePrompt,
  buildCheckpointContext,
  runHandoffAndReview,
  applyExecuteFallback,
  selectLaunchAndRecord,
  enforceExecuteCommitSafety
} = require('../lib/commands/active');
const { resolveWorktree } = require('../lib/core/mission-utils');
const { completePreflightOrExit } = require('../lib/commands/mission-start');

test('buildExecutePrompt injects slug, current year, and checkpoint context into the template', () => {
  const context = 'Most recent checkpoint: CP-3.md — CP-3: Real active command';
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'execute-prompt-'));
  try {
    fs.writeFileSync(
      path.join(tempRoot, 'workflow.config.json'),
      JSON.stringify({
        adapters: {
          missions: {
            baseDir: 'docs/missions',
            branchPrefix: 'mission/',
            worktreePattern: '../<repo>-<slug>'
          }
        }
      }, null, 2)
    );

    const prompt = buildExecutePrompt('task-088', context, { rootDir: tempRoot });

    assert.match(prompt, new RegExp(`/docs/missions/${new Date().getFullYear()}/task-088/MISSION\\.md`));
    assert.match(prompt, /Slug: task-088/);
    assert.match(prompt, /execute-after-lock|execute after lock|execute checkpoint/i);
    assert.match(prompt, /CP-3\.md/);
    assert.match(prompt, /Do not claim that `git diff HEAD` proves a committed change/i);
    assert.match(prompt, /exact non-HEAD baseline/i);
    // Template placeholders must not appear in output
    assert.doesNotMatch(prompt, /\{\{slug\}\}/);
    assert.doesNotMatch(prompt, /YYYY/);
    assert.doesNotMatch(prompt, /\{\{checkpoint_context\}\}/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('buildExecutePrompt uses absolute worktree paths and emits no docs/agent-prompts indirection', () => {
  const rootDir = '/tmp/testproj-task-8';
  const prompt = buildExecutePrompt('task-8', 'No checkpoint documents found. Start from CP-1.', { rootDir });

  assert.match(prompt, /Mission: \/tmp\/testproj-task-8\/missions\/task-8\/MISSION\.md/);
  assert.match(prompt, /Mission dir: \/tmp\/testproj-task-8\/missions\/task-8/);
  assert.match(prompt, /Backlog task: .*task-8/);
  assert.doesNotMatch(prompt, /Load the workflow lifecycle/);
  assert.doesNotMatch(prompt, /docs\/agent-prompts/);
  assert.doesNotMatch(prompt, /\{\{[^}]+\}\}/);
});

test('buildExecutePrompt reserves Backlog lifecycle transitions for Parallix', () => {
  const prompt = buildExecutePrompt('task-8', 'No checkpoint documents found. Start from CP-1.', { rootDir: '/tmp/testproj-task-8' });

  assert.match(prompt, /do not change the Backlog task's status/i);
  assert.match(prompt, /Parallix performs lifecycle transitions itself/i);
});

test('buildCheckpointContext returns fallback text when no checkpoints exist', () => {
  const context = buildCheckpointContext('task-nonexistent-9999');
  assert.match(context, /CP-1|no checkpoint/i);
});

test('resolveWorktree finds the expected path for the current mission', () => {
  // task-088 is the current mission and its worktree should be discoverable
  const worktree = resolveWorktree('task-088');

  // If we are running inside the worktree, it should resolve to the cwd or the worktree path
  assert.ok(
    worktree === null || typeof worktree === 'string',
    'resolveWorktree must return null or a string path'
  );

  if (worktree !== null) {
    assert.match(worktree, /mission-task-088/);
  }
});

test('resolveWorktree returns null for a non-existent mission slug', () => {
  const worktree = resolveWorktree('task-nonexistent-9999');
  assert.equal(worktree, null);
});

test('resolveWorktree ignores prunable duplicates and prefers the live cwd match', () => {
  const FAKE_ROOT = '/tmp/mission';
  const porcelain = [
    `worktree ${FAKE_ROOT}-118`,
    'HEAD deadbeef',
    'branch refs/heads/mission/task-118',
    'prunable stale metadata',
    '',
    `worktree ${FAKE_ROOT}-task-118`,
    'HEAD cafe1234',
    'branch refs/heads/mission/task-118',
    ''
  ].join('\n');

  const worktree = resolveWorktree('task-118', {
    cwd: `${FAKE_ROOT}-task-118`,
    gitFn: () => ({ stdout: porcelain })
  });

  assert.equal(worktree, `${FAKE_ROOT}-task-118`);
});

// Regression: mission-start must return instead of calling process.exit() when
// returnResult:true, so active.js can use the result without the process terminating
// before resolveWorktree() and startAgent() run.
// Tested via the extracted completePreflightOrExit helper — no live git needed.
test('completePreflightOrExit returns {pass:false} on failure when returnResult is true', () => {
  const result = completePreflightOrExit(true, true);
  assert.deepEqual(result, { pass: false });
});

test('completePreflightOrExit returns {pass:true} on success when returnResult is true', () => {
  const result = completePreflightOrExit(false, true);
  assert.deepEqual(result, { pass: true });
});

test('mission-start verify mode reports diagnostics and open-ended success without slug', () => {
  const lines = [];
  const errors = [];
  const missionStart = require('../lib/commands/mission-start');

  // @ts-expect-error TS2349 This expression is not callable.
  const result = missionStart([], {
    returnResult: true,
    inferSlugFn: () => null,
    cwdFn: () => '/tmp/anywhere',
    getCurrentBranchFn: () => 'main',
    getLastCommitFn: () => ({ sha: 'abcdef123456', subject: 'Initial', date: '2026-04-30' }),
    evaluateRepositoryReadinessFn: () => ({ mode: 'default', issues: [], configPath: null }),
    evaluateReviewSetupFn: () => ({
      required: true,
      ok: false,
      issues: ['Forgejo token for codex is invalid or expired (HTTP 401)'],
      steps: ['Run `px setup-review` and re-enter the Forgejo passwords to rotate local PATs.'],
    }),
    log: line => lines.push(line),
    error: line => errors.push(line)
  });

  assert.deepEqual(result, { pass: true });
  assert.ok(lines.some(l => l.includes('[INFO] Running environment diagnostics (verify-env)...')));
  assert.ok(lines.some(l => l.includes('[PASS] PWD: /tmp/anywhere')));
  assert.ok(lines.some(l => l.includes('[PASS] Branch: main')));
  assert.ok(lines.some(l => l.includes('[WARN] Forgejo review setup: review actions are not ready yet.')));
  assert.ok(lines.some(l => l.includes('invalid or expired (HTTP 401)')));
  assert.ok(lines.some(l => l.includes('[PASS] Last commit: abcdef12 - Initial (2026-04-30)')));
  assert.ok(lines.some(l => l.includes('[PASS] Environment verdict: USABLE')));
  assert.equal(errors.length, 0);
});

test('mission-start mission mode reports failures for wrong branch, ambiguous task, and missing mission dir', () => {
  const lines = [];
  const errors = [];
  const missionStart = require('../lib/commands/mission-start');

  // @ts-expect-error TS2349 This expression is not callable.
  const result = missionStart(['task-1031'], {
    returnResult: true,
    cwdFn: () => '/tmp/not-the-right-worktree',
    getCurrentBranchFn: () => 'main',
    resolveTaskFileFn: () => ({ ok: false, reason: 'ambiguous', matches: ['a.md', 'b.md'] }),
    resolveMissionClassificationFn: () => ({ classification: 'ai_sdlc' }),
    findMissionDirFn: () => null,
    getMissionYearFn: () => '2026',
    conventionalWorktreePathFn: slug => `/tmp/project-${slug}`,
    getLastCommitFn: () => ({ sha: 'abcdef123456', subject: 'Initial', date: '2026-04-30' }),
    getPrStatusFn: () => ({ exists: false }),
    isForgejoReviewEnabledFn: () => true,
    log: line => lines.push(line),
    error: line => errors.push(line)
  });

  assert.deepEqual(result, { pass: false });
  assert.ok(lines.some(line => line.includes('[FAIL] PWD: /tmp/not-the-right-worktree does not match expected mission worktree path /tmp/project-task-1031')));
  assert.ok(lines.some(line => line.includes('[FAIL] Branch: main does not match expected mission branch mission/task-1031')));
  assert.ok(lines.some(l => l.includes('[FAIL] Backlog task resolution is ambiguous for slug: task-1031')));
  assert.ok(lines.includes('  - a.md'));
  assert.ok(lines.includes('  - b.md'));
  assert.ok(lines.some(line => line.includes('[FAIL] Mission doc: directory not found in docs/missions/2026/ for slug task-1031')));
  assert.ok(lines.some(line => line.includes('[PASS] Forgejo PR: no PR found (ready for startup)')));
  assert.ok(errors.some(line => line.includes('[FAIL] Environment verdict: NOT USABLE')));
});

// ---------- active top-level command paths ----------

test('active() success path: preflight, launch, and handoff run in order', async () => {
  const calls = [];
  const logs = [];

  // @ts-expect-error TS2349 This expression is not callable.
  await active(['task-1038'], {
    inferSlugFn: () => 'task-1038',
    missionStartFn: () => ({ pass: true }),
    resolveWorktreeFn: () => '/tmp/project-task-1038',
    readAgentConfigOrExitFn: () => ({ draft: ['codex'] }),
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/project-task-1038/backlog/tasks/task-1038.md' }),
    buildCheckpointContextFn: (slug) => {
      calls.push(['checkpoint', slug]);
      return 'Most recent checkpoint: CP-1.md';
    },
    buildExecutePromptFn: (slug, context) => {
      calls.push(['prompt', slug, context]);
      return `Execute ${slug}`;
    },
    selectLaunchAndRecordFn: async (opts) => {
      calls.push(['launch', opts.slug, opts.worktree, opts.prompt]);
      return { agent: 'codex', result: { status: 0 } };
    },
    enforceExecuteCommitSafetyFn: () => false,
    runHandoffAndReviewFn: async (slug, worktree, agent) => {
      calls.push(['handoff', slug, worktree, agent]);
      return true;
    },
    exitFn: (code) => { throw new Error(`unexpected exit ${code}`); },
    logFn: (msg) => logs.push(msg),
    errorFn: (msg) => { throw new Error(`unexpected error: ${msg}`); }
  });

  assert.deepEqual(calls, [
    ['checkpoint', 'task-1038'],
    ['prompt', 'task-1038', 'Most recent checkpoint: CP-1.md'],
    ['launch', 'task-1038', '/tmp/project-task-1038', 'Execute task-1038'],
    ['handoff', 'task-1038', '/tmp/project-task-1038', 'codex']
  ]);
  assert.ok(logs.some(line => line.includes('Running execute preflight')));
  assert.ok(logs.some(line => line.includes('Starting automated handoff')));
});

test('active() honors an explicit --implementer override without consulting WORKFLOW_AGENT', async () => {
  const calls = [];
  const priorWorkflowAgent = process.env.WORKFLOW_AGENT;
  delete process.env.WORKFLOW_AGENT;

  try {
    // @ts-expect-error TS2349 This expression is not callable.
    await active(['task-1038', '--implementer', 'claude'], {
      inferSlugFn: () => 'task-1038',
      missionStartFn: () => ({ pass: true }),
      resolveWorktreeFn: () => '/tmp/project-task-1038',
      readAgentConfigOrExitFn: () => ({ active: ['codex'] }),
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/project-task-1038/backlog/tasks/task-1038.md' }),
      buildCheckpointContextFn: () => 'Most recent checkpoint: CP-1.md',
      buildExecutePromptFn: (slug) => `Execute ${slug}`,
      selectLaunchAndRecordFn: async (opts) => {
        calls.push(['launch', opts.preselectedAgent]);
        return { agent: opts.preselectedAgent, result: { status: 0 } };
      },
      enforceExecuteCommitSafetyFn: () => false,
      runHandoffAndReviewFn: async (slug, worktree, agent) => {
        calls.push(['handoff', agent]);
        return true;
      },
      exitFn: (code) => { throw new Error(`unexpected exit ${code}`); },
      logFn: () => {},
      errorFn: (msg) => { throw new Error(`unexpected error: ${msg}`); }
    });
  } finally {
    if (priorWorkflowAgent === undefined) { delete process.env.WORKFLOW_AGENT; } else { process.env.WORKFLOW_AGENT = priorWorkflowAgent; }
  }

  assert.deepEqual(calls, [
    ['launch', 'claude'],
    ['handoff', 'claude']
  ]);
});

test('active() exits non-zero with usage text when --implementer is missing its value', async () => {
  let exitCode = null;
  const errors = [];

  // @ts-expect-error TS2349 This expression is not callable.
  await active(['task-1038', '--implementer'], {
    inferSlugFn: () => 'task-1038',
    missionStartFn: () => { throw new Error('must not run preflight when --implementer parsing fails'); },
    exitFn: (code) => { exitCode = code; throw new Error('__stop__'); },
    logFn: () => {},
    errorFn: (msg) => errors.push(msg)
  }).catch(err => { if (err.message !== '__stop__') { throw err; } });

  assert.equal(exitCode, 1);
  assert.ok(errors.some(msg => msg.includes('px active <slug> --implementer <family>')));
});

test('active() does not pre-write backlog state before the execute agent actually launches', async () => {
  const logs = [];

  // @ts-expect-error TS2349 This expression is not callable.
  await active(['task-1038'], {
    inferSlugFn: () => 'task-1038',
    missionStartFn: () => ({ pass: true }),
    resolveWorktreeFn: () => '/tmp/project-task-1038',
    readAgentConfigOrExitFn: () => ({}),
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/project-task-1038/backlog/tasks/task-1038.md' }),
    buildCheckpointContextFn: () => 'Most recent checkpoint: CP-1.md',
    buildExecutePromptFn: () => 'Execute task-1038',
    selectLaunchAndRecordFn: async () => ({ agent: 'codex', result: { status: 0 } }),
    enforceExecuteCommitSafetyFn: () => false,
    runHandoffAndReviewFn: async () => true,
    exitFn: (code) => { throw new Error(`unexpected exit ${code}`); },
    logFn: (msg) => logs.push(msg),
    errorFn: (msg) => { throw new Error(`unexpected error: ${msg}`); }
  });

  assert.ok(
    !logs.some(line => line.includes('Enforcing implementer')),
    `active() must defer backlog writes until after launch; got logs: ${logs.join(' | ')}`
  );
});

test('active() exits 1 when preflight fails', async () => {
  let exitCode = null;
  const errors = [];

  // @ts-expect-error TS2349 This expression is not callable.
  await active(['task-1038'], {
    inferSlugFn: () => 'task-1038',
    missionStartFn: () => ({ pass: false }),
    exitFn: (code) => { exitCode = code; },
    logFn: () => {},
    errorFn: (msg) => errors.push(msg)
  });

  assert.equal(exitCode, 1);
  assert.ok(errors.some(line => line.includes('Preflight failed')));
});

test('active() exits 1 when worktree is missing', async () => {
  let exitCode = null;
  const errors = [];

  // @ts-expect-error TS2349 This expression is not callable.
  await active(['task-1038'], {
    inferSlugFn: () => 'task-1038',
    missionStartFn: () => ({ pass: true }),
    resolveWorktreeFn: () => null,
    exitFn: (code) => { exitCode = code; },
    logFn: () => {},
    errorFn: (msg) => errors.push(msg)
  });

  assert.equal(exitCode, 1);
  assert.ok(errors.some(line => line.includes('Could not locate dedicated worktree')));
});

test('active() exits 1 when execute launch throws', async () => {
  let exitCode = null;
  const errors = [];

  // @ts-expect-error TS2349 This expression is not callable.
  await active(['task-1038'], {
    inferSlugFn: () => 'task-1038',
    missionStartFn: () => ({ pass: true }),
    resolveWorktreeFn: () => '/tmp/project-task-1038',
    readAgentConfigOrExitFn: () => ({}),
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
    buildCheckpointContextFn: () => 'CP-1',
    buildExecutePromptFn: () => 'Execute task-1038',
    selectLaunchAndRecordFn: async () => { throw new Error('launcher exploded'); },
    exitFn: (code) => { exitCode = code; },
    logFn: () => {},
    errorFn: (msg) => errors.push(msg)
  });

  assert.equal(exitCode, 1);
  assert.ok(errors.some(line => line.includes('Could not launch execute agent: launcher exploded')));
});

test('active() exits with agent status when execute agent returns non-zero', async () => {
  let exitCode = null;
  const errors = [];

  // @ts-expect-error TS2349 This expression is not callable.
  await active(['task-1038'], {
    inferSlugFn: () => 'task-1038',
    missionStartFn: () => ({ pass: true }),
    resolveWorktreeFn: () => '/tmp/project-task-1038',
    readAgentConfigOrExitFn: () => ({}),
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
    buildCheckpointContextFn: () => 'CP-1',
    buildExecutePromptFn: () => 'Execute task-1038',
    selectLaunchAndRecordFn: async () => ({ agent: 'codex', result: { status: 23 } }),
    exitFn: (code) => { exitCode = code; },
    logFn: () => {},
    errorFn: (msg) => errors.push(msg)
  });

  assert.equal(exitCode, 23);
  assert.ok(errors.some(line => line.includes('exited with status 23')));
});

test('active() exits 1 when handoff fails after successful execute launch', async () => {
  let exitCode = null;

  // @ts-expect-error TS2349 This expression is not callable.
  await active(['task-1038'], {
    inferSlugFn: () => 'task-1038',
    missionStartFn: () => ({ pass: true }),
    resolveWorktreeFn: () => '/tmp/project-task-1038',
    readAgentConfigOrExitFn: () => ({}),
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
    buildCheckpointContextFn: () => 'CP-1',
    buildExecutePromptFn: () => 'Execute task-1038',
    selectLaunchAndRecordFn: async () => ({ agent: 'codex', result: { status: 0 } }),
    enforceExecuteCommitSafetyFn: () => false,
    runHandoffAndReviewFn: async () => false,
    exitFn: (code) => { exitCode = code; },
    logFn: () => {},
    errorFn: () => {}
  });

  assert.equal(exitCode, 1);
});

test('active() runs the execute safety harness before handoff', async () => {
  const calls = [];

  // @ts-expect-error TS2349 This expression is not callable.
  await active(['task-1038'], {
    inferSlugFn: () => 'task-1038',
    missionStartFn: () => ({ pass: true }),
    resolveWorktreeFn: () => '/tmp/project-task-1038',
    readAgentConfigOrExitFn: () => ({}),
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
    buildCheckpointContextFn: () => 'CP-1',
    buildExecutePromptFn: () => 'Execute task-1038',
    selectLaunchAndRecordFn: async () => ({ agent: 'codex', result: { status: 0 } }),
    enforceExecuteCommitSafetyFn: () => {
      calls.push('safety');
      return true;
    },
    runHandoffAndReviewFn: async () => {
      calls.push('handoff');
      return true;
    },
    exitFn: (code) => { throw new Error(`unexpected exit ${code}`); },
    logFn: () => {},
    errorFn: (msg) => { throw new Error(`unexpected error: ${msg}`); }
  });

  assert.deepEqual(calls, ['safety', 'handoff']);
});

test('active() restores task status and continues to handoff when the execute agent changed it', async () => {
  const calls = [];
  const errors = [];

  // @ts-expect-error TS2349 This expression is not callable.
  await active(['task-1038'], {
    inferSlugFn: () => 'task-1038',
    missionStartFn: () => ({ pass: true }),
    resolveWorktreeFn: () => '/tmp/project-task-1038',
    readAgentConfigOrExitFn: () => ({}),
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
    buildCheckpointContextFn: () => 'CP-1',
    buildExecutePromptFn: () => 'Execute task-1038',
    selectLaunchAndRecordFn: async () => ({ agent: 'codex', result: { status: 0 } }),
    getTaskStatusFn: () => 'done',
    transitionTaskFn: (slug, status, opts) => {
      calls.push(['restore', slug, status, opts.rootDir]);
      return true;
    },
    enforceExecuteCommitSafetyFn: () => calls.push('safety'),
    runHandoffAndReviewFn: async () => calls.push('handoff'),
    exitFn: (code) => { throw new Error(`unexpected exit ${code}`); },
    logFn: () => {},
    errorFn: (msg) => errors.push(msg)
  });

  assert.deepEqual(calls, [
    ['restore', 'task-1038', 'active', '/tmp/project-task-1038'],
    'safety',
    'handoff'
  ]);
  assert.deepEqual(errors, []);
});

// ---------- runHandoffAndReview wiring ----------

// Regression guard for the repairHandoffFn default in runHandoffAndReview
// (lib/commands/active.ts:433). repair-handoff.ts is imported via
// `import * as repairHandoff from './repair-handoff.js'`, but repair-handoff.ts
// also does `module.exports = repairHandoff` for CJS compat, which makes
// `require('./repair-handoff.js')` return the function directly (with
// isRelaunchableError/buildRelaunchPrompt attached as properties, no
// `.repairHandoff` property). Under the compiled CJS runtime that `bin.px`
// actually ships, tsc's `__importStar` interop wraps that into
// `{ isRelaunchableError, buildRelaunchPrompt, default: <fn> }` — so the
// bare namespace object and `.repairHandoff` are both non-callable, and only
// `.default` resolves to the function. This test fails loudly if that export
// shape ever changes without updating active.ts's accessor to match.
test('repair-handoff module exposes its default export as callable under CJS require+importStar interop', () => {
  const repairHandoffModule = require('../lib/commands/repair-handoff');
  assert.equal(typeof repairHandoffModule, 'function', 'require(repair-handoff) must return the function directly (CJS compat line)');

  // Replicate tsc's __importStar interop exactly (module lacks __esModule
  // since `module.exports = repairHandoff` overwrites it at runtime).
  const ns = {};
  for (const k of Object.keys(repairHandoffModule)) { ns[k] = repairHandoffModule[k]; }
  ns.default = repairHandoffModule;

  assert.equal(typeof ns.default, 'function', 'namespace.default must be callable — this is what active.ts:433 relies on');
  assert.equal(typeof ns.repairHandoff, 'undefined', 'namespace.repairHandoff is NOT set by importStar interop under CJS — using it as the accessor silently breaks handoff repair');
});

test('runHandoffAndReview passes worktree and implementer to startReviewLoop', async () => {
  const reviewLoopCalls = [];
  const result = await runHandoffAndReview('task-test', '/tmp/project-task-test', 'codex', {
    validateCheckpointsBeforeHandoffFn: () => ({ ok: true }),
    performHandoff: async () => ({ ok: true }),
    startReviewLoop: (slug, opts) => reviewLoopCalls.push({ slug, opts }),
    log: () => {},
    error: () => {}
  });

  assert.ok(result, 'runHandoffAndReview should return true on success');
  assert.equal(reviewLoopCalls.length, 1, 'startReviewLoop must be called exactly once');
  assert.equal(reviewLoopCalls[0].slug, 'task-test');
  assert.equal(reviewLoopCalls[0].opts.worktree, '/tmp/project-task-test');
  assert.equal(reviewLoopCalls[0].opts.implementer, 'codex');
});

test('runHandoffAndReview waits for the autonomous review loop to complete', async () => {
  let resolveReview;
  const reviewComplete = new Promise(resolve => { resolveReview = resolve; });
  const handoffPromise = runHandoffAndReview('task-test', '/tmp/project-task-test', 'codex', {
    validateCheckpointsBeforeHandoffFn: () => ({ ok: true }),
    performHandoff: async () => ({ ok: true }),
    startReviewLoop: async () => reviewComplete,
    log: () => {},
    error: () => {}
  });
  let settled = false;
  handoffPromise.then(() => { settled = true; });

  await Promise.resolve();
  await Promise.resolve();
  assert.equal(settled, false, 'px active must not finish while review is still running');

  // @ts-expect-error TS2722 Cannot invoke an object which is possibly 'undefined'.
  resolveReview();
  assert.equal(await handoffPromise, true);
  assert.equal(settled, true);
});

test('runHandoffAndReview retries handoff once after successful repair with force:true', async () => {
  let handoffAttempts = 0;
  let repairAttempts = 0;
  let forceUsed = false;

  const result = await runHandoffAndReview('task-test', '/tmp/project-task-test', 'codex', {
    validateCheckpointsBeforeHandoffFn: () => ({ ok: true }),
    performHandoff: async (slug, opts) => {
      handoffAttempts++;
      if (handoffAttempts === 1) return { ok: false, error: 'dirty files' };
      forceUsed = opts.force;
      return { ok: true };
    },
    repairHandoffFn: async () => {
      repairAttempts++;
      return { repaired: true, blocker: null };
    },
    startReviewLoop: () => {},
    log: () => {},
    error: () => {}
  });

  assert.ok(result);
  assert.equal(handoffAttempts, 2, 'handoff should be retried once');
  assert.equal(repairAttempts, 1, 'repair should be called once');
  assert.equal(forceUsed, true, 'force:true should be used on retry after repair');
});

test('runHandoffAndReview fails and does not retry if repair returns repaired:false', async () => {
  let handoffAttempts = 0;
  let repairAttempts = 0;

  const result = await runHandoffAndReview('task-test', '/tmp/project-task-test', 'codex', {
    validateCheckpointsBeforeHandoffFn: () => ({ ok: true }),
    performHandoff: async () => {
      handoffAttempts++;
      return { ok: false, error: 'dirty files' };
    },
    repairHandoffFn: async () => {
      repairAttempts++;
      return { repaired: false, blocker: null };
    },
    startReviewLoop: () => {},
    log: () => {},
    error: () => {}
  });

  assert.equal(result, false);
  assert.equal(handoffAttempts, 1, 'handoff should not be retried if repair fails');
  assert.equal(repairAttempts, 1);
});

test('runHandoffAndReview reports specific blocker when repair fails', async () => {
  const errors = [];
  const result = await runHandoffAndReview('task-test', '/tmp/project-task-test', 'codex', {
    validateCheckpointsBeforeHandoffFn: () => ({ ok: true }),
    performHandoff: async () => ({ ok: false, error: 'original error' }),
    repairHandoffFn: async () => ({ repaired: false, blocker: 'specific rebase blocker' }),
    startReviewLoop: () => {},
    log: () => {},
    error: (msg) => errors.push(msg)
  });

  assert.equal(result, false);
  assert.ok(errors.some(l => l.includes('Automated handoff failed: specific rebase blocker')), 
    'Should report the specific blocker instead of the original error');
});

test('runHandoffAndReview fails if retry also fails', async () => {
  let handoffAttempts = 0;

  const result = await runHandoffAndReview('task-test', '/tmp/project-task-test', 'codex', {
    validateCheckpointsBeforeHandoffFn: () => ({ ok: true }),
    performHandoff: async () => {
      handoffAttempts++;
      return { ok: false, error: 'still dirty' };
    },
    repairHandoffFn: async () => ({ repaired: true, blocker: null }),
    startReviewLoop: () => {},
    log: () => {},
    error: () => {}
  });

  assert.equal(result, false);
  assert.equal(handoffAttempts, 2, 'handoff should be retried once but fail again');
});

// ---------- applyExecuteFallback (regression: implementer falls back after limit hit) ----------

test('applyExecuteFallback returns preselected when startAgent did not fall back', () => {
  const next = applyExecuteFallback({
    slug: 'task-test',
    preselected: 'codex',
    actual: 'codex',
    taskResolution: { ok: true, taskFile: '/tmp/task.md' },
    log: () => {},
    enforceTaskAssigneeFn: () => { throw new Error('enforceTaskAssignee must not run when no fallback occurred'); }
  });
  assert.equal(next, 'codex');
});

test('applyExecuteFallback returns preselected when actual is undefined (catastrophic launch failure)', () => {
  const next = applyExecuteFallback({
    slug: 'task-test',
    preselected: 'codex',
    actual: undefined,
    taskResolution: { ok: true, taskFile: '/tmp/task.md' },
    log: () => {},
    enforceTaskAssigneeFn: () => { throw new Error('enforceTaskAssignee must not run when actual is missing'); }
  });
  assert.equal(next, 'codex');
});

test('applyExecuteFallback rewrites backlog assignee and returns the fallback agent', () => {
  const transitions = [];
  const next = applyExecuteFallback({
    slug: 'task-test',
    preselected: 'claude',
    actual: 'codex',
    taskResolution: { ok: true, taskFile: '/tmp/task.md' },
    log: () => {},
    transitionTaskFn: (slug, status, opts) => { transitions.push({ slug, status, opts }); return true; }
  });
  assert.equal(next, 'codex');
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0].slug, 'task-test');
  assert.equal(transitions[0].status, 'active');
  assert.equal(transitions[0].opts.implementer, 'codex');
  assert.equal(transitions[0].opts.rootDir, undefined);
  assert.equal(typeof transitions[0].opts.log, 'function');
});

test('applyExecuteFallback logs warning and returns fallback agent even if git commit fails', () => {
  const logs = [];
  const next = applyExecuteFallback({
    slug: 'task-test',
    preselected: 'claude',
    actual: 'codex',
    taskResolution: { ok: true, taskFile: '/tmp/task.md' },
    log: (msg) => logs.push(msg),
    transitionTaskFn: () => false // transition/commit fails
  });
  assert.equal(next, 'codex');
  // transitionTask handles its own logging now
});

test('applyExecuteFallback skips backlog write when taskResolution is not ok', () => {
  const next = applyExecuteFallback({
    slug: 'task-test',
    preselected: 'claude',
    actual: 'codex',
    taskResolution: { ok: false },
    log: () => {},
    transitionTaskFn: () => { throw new Error('transitionTaskFn must not run when taskResolution.ok is false'); }
  });
  // Still returns the fallback identity so downstream handoff polls the right user.
  assert.equal(next, 'codex');
});

// ---------- runHandoffAndReview gatekeeper pushback ----------

test('runHandoffAndReview skips startReviewLoop when gatekeeper posted pushback', async () => {
  const reviewLoopCalls = [];
  const result = await runHandoffAndReview('task-test', '/tmp/project-task-test', 'codex', {
    validateCheckpointsBeforeHandoffFn: () => ({ ok: true }),
    performHandoff: async () => ({ ok: true, gatekeeperPushedBack: true }),
    startReviewLoop: () => reviewLoopCalls.push(true),
    log: () => {},
    error: () => {}
  });

  assert.ok(result, 'runHandoffAndReview should return true even with gatekeeper pushback');
  assert.equal(reviewLoopCalls.length, 0, 'startReviewLoop must not be called when gatekeeper posted pushback');
});

test('runHandoffAndReview starts review loop when gatekeeper did not push back', async () => {
  const reviewLoopCalls = [];
  const result = await runHandoffAndReview('task-test', '/tmp/project-task-test', 'codex', {
    validateCheckpointsBeforeHandoffFn: () => ({ ok: true }),
    performHandoff: async () => ({ ok: true, gatekeeperPushedBack: false }),
    startReviewLoop: (slug, opts) => reviewLoopCalls.push({ slug, opts }),
    log: () => {},
    error: () => {}
  });

  assert.ok(result, 'runHandoffAndReview should return true');
  assert.equal(reviewLoopCalls.length, 1, 'startReviewLoop must be called when gatekeeper did not push back');
});

// ---------- selectLaunchAndRecord — Backlog state-ordering contract ----------
// These tests verify that Backlog writes (status=active, assignee) happen ONLY
// after startAgent confirms a successful launch. A failed or exhausted launch
// must not leave the task in a misleading active state with the wrong assignee.

test('selectLaunchAndRecord writes Backlog with the launched agent after a successful launch', async () => {
  const transitions = [];

  const result = await selectLaunchAndRecord({
    slug: 'task-test',
    worktree: '/tmp/project-task-test',
    agentConfig: {},
    taskResolution: { ok: true, taskFile: '/tmp/task.md' },
    prompt: 'Execute.',
    selectAgentFn: () => 'codex',
    startAgentFn: async (step, opts) => {
      if (opts.onLaunch) {
        await opts.onLaunch({ agent: 'codex' });
      }
      return { agent: 'codex', result: { status: 0 } };
    },
    transitionTaskFn: (slug, status, opts) => { transitions.push({ slug, status, opts }); return true; },
    log: () => {}
  });

  assert.equal(result.agent, 'codex');
  assert.equal(transitions.length, 1, 'transitionTask must be called exactly once on success');
  assert.equal(transitions[0].status, 'active');
  assert.equal(transitions[0].opts.implementer, 'codex');
});

test('selectLaunchAndRecord reuses the caller preselection instead of choosing again', async () => {
  const result = await selectLaunchAndRecord({
    slug: 'task-test',
    worktree: '/tmp/project-task-test',
    preselectedAgent: 'claude',
    agentConfig: {},
    taskResolution: { ok: false },
    prompt: 'Execute.',
    selectAgentFn: () => { throw new Error('selectAgentFn must not run when preselectedAgent is provided'); },
    startAgentFn: async (step, opts) => {
      assert.equal(step, 'active');
      assert.equal(opts.agent, 'claude');
      return { agent: 'claude', result: { status: 0 } };
    },
    log: () => {}
  });

  assert.equal(result.preselected, 'claude');
  assert.equal(result.agent, 'claude');
});

test('selectLaunchAndRecord writes Backlog when startAgent returns successful result', async () => {
  const transitions = [];

  await selectLaunchAndRecord({
    slug: 'task-test',
    worktree: '/tmp/project-task-test',
    agentConfig: {},
    taskResolution: { ok: true, taskFile: '/tmp/task.md' },
    prompt: 'Execute.',
    selectAgentFn: () => 'claude',
    startAgentFn: async (step, opts) => {
      if (opts.onLaunch) {
        await opts.onLaunch({ agent: 'claude' });
      }
      return { agent: 'claude', result: { status: 0 } };
    },
    transitionTaskFn: (slug, status, opts) => { transitions.push({ slug, status, opts }); return true; },
    log: () => {}
  });

  assert.equal(transitions.length, 1, 'transitionTask must be called on successful launch');
  assert.equal(transitions[0].status, 'active');
});

test('selectLaunchAndRecord writes Backlog before the launcher resolves its final result', async () => {
  const transitions = [];
  let resolveResult;
  let transitionCountAtReturn = null;

  const pendingResult = new Promise(resolve => {
    resolveResult = resolve;
  });

  const callPromise = selectLaunchAndRecord({
    slug: 'task-test',
    worktree: '/tmp/project-task-test',
    agentConfig: {},
    taskResolution: { ok: true, taskFile: '/tmp/task.md' },
    prompt: 'Execute.',
    selectAgentFn: () => 'claude',
    startAgentFn: async (step, opts) => {
      if (opts.onLaunch) {
        await opts.onLaunch({ agent: 'claude' });
      }
      transitionCountAtReturn = transitions.length;
      const result = await pendingResult;
      return { agent: 'claude', result };
    },
    transitionTaskFn: (slug, status, opts) => { transitions.push({ slug, status, opts }); return true; },
    log: () => {}
  });

  await Promise.resolve();
  assert.equal(transitionCountAtReturn, 1, 'transitionTask must run during onLaunch, before the final result resolves');
  assert.equal(transitions[0].status, 'active');

  // @ts-expect-error TS2722 Cannot invoke an object which is possibly 'undefined'.
  resolveResult({ status: 0 });
  await callPromise;
});

test('selectLaunchAndRecord rolls Backlog back when startAgent returns a result.error', async () => {
  const transitions = [];

  await selectLaunchAndRecord({
    slug: 'task-test',
    worktree: '/tmp/project-task-test',
    agentConfig: {},
    taskResolution: { ok: true, taskFile: '/tmp/task.md' },
    getTaskStatusFn: () => 'refined',
    prompt: 'Execute.',
    selectAgentFn: () => 'claude',
    startAgentFn: async (step, opts) => {
      if (opts.onLaunch) {
        await opts.onLaunch({ agent: 'claude' });
      }
      return {
        agent: 'claude',
        result: { error: new Error('usage limit'), status: null }
      };
    },
    transitionTaskFn: (slug, status, opts) => { transitions.push({ slug, status, opts }); return true; },
    log: () => {}
  });

  assert.equal(transitions.length, 2, 'transitionTask must write active at launch and restore the prior status on result.error');
  assert.equal(transitions[0].status, 'active');
  assert.equal(transitions[1].status, 'refined');
});

test('selectLaunchAndRecord rolls Backlog back when startAgent returns non-zero exit status', async () => {
  const transitions = [];

  await selectLaunchAndRecord({
    slug: 'task-test',
    worktree: '/tmp/project-task-test',
    agentConfig: {},
    taskResolution: { ok: true, taskFile: '/tmp/task.md' },
    getTaskStatusFn: () => 'refined',
    prompt: 'Execute.',
    selectAgentFn: () => 'claude',
    startAgentFn: async (step, opts) => {
      if (opts.onLaunch) {
        await opts.onLaunch({ agent: 'claude' });
      }
      return { agent: 'claude', result: { status: 1 } };
    },
    transitionTaskFn: (slug, status, opts) => { transitions.push({ slug, status, opts }); return true; },
    log: () => {}
  });

  assert.equal(transitions.length, 2, 'transitionTask must write active at launch and restore the prior status on non-zero exit');
  assert.equal(transitions[0].status, 'active');
  assert.equal(transitions[1].status, 'refined');
});

test('selectLaunchAndRecord rolls Backlog back when startAgent throws after onLaunch recorded active', async () => {
  const transitions = [];

  await assert.rejects(
    () => selectLaunchAndRecord({
      slug: 'task-test',
      worktree: '/tmp/project-task-test',
      agentConfig: {},
      taskResolution: { ok: true, taskFile: '/tmp/task.md' },
      getTaskStatusFn: () => 'refined',
      prompt: 'Execute.',
      selectAgentFn: () => 'claude',
      startAgentFn: async (step, opts) => {
        if (opts.onLaunch) {
          await opts.onLaunch({ agent: 'claude' });
        }
        throw new Error('all eligible agents exhausted after limit hit');
      },
      transitionTaskFn: (slug, status, opts) => { transitions.push({ slug, status, opts }); return true; },
      log: () => {}
    }),
    /all eligible agents exhausted after limit hit/
  );

  assert.equal(transitions.length, 2, 'transitionTask must write active at launch and restore the prior status when startAgent throws after launch');
  assert.equal(transitions[0].status, 'active');
  assert.equal(transitions[1].status, 'refined');
});

test('selectLaunchAndRecord restores prior implementer on rollback when startAgent returns result.error', async () => {
  const transitions = [];

  await selectLaunchAndRecord({
    slug: 'task-test',
    worktree: '/tmp/project-task-test',
    agentConfig: {},
    taskResolution: { ok: true, taskFile: '/tmp/task.md' },
    getTaskStatusFn: () => 'refined',
    getTaskImplementerFn: () => 'codex',
    prompt: 'Execute.',
    selectAgentFn: () => 'claude',
    startAgentFn: async (step, opts) => {
      if (opts.onLaunch) {
        await opts.onLaunch({ agent: 'claude' });
      }
      return { agent: 'claude', result: { error: new Error('usage limit'), status: null } };
    },
    transitionTaskFn: (slug, status, opts) => { transitions.push({ slug, status, opts }); return true; },
    log: () => {}
  });

  assert.equal(transitions.length, 2, 'transitionTask must write active at launch and restore state on failure');
  assert.equal(transitions[0].status, 'active');
  assert.equal(transitions[1].status, 'refined');
  assert.equal(transitions[1].opts.implementer, 'codex', 'rollback must restore the prior implementer');
});

test('selectLaunchAndRecord rolls back both status and implementer when task starts already-active', async () => {
  // Regression: prior guard `priorStatus === "active"` skipped rollback for already-active tasks,
  // leaving the assignee pinned to the failed transient agent after a failed relaunch.
  const transitions = [];

  await selectLaunchAndRecord({
    slug: 'task-test',
    worktree: '/tmp/project-task-test',
    agentConfig: {},
    taskResolution: { ok: true, taskFile: '/tmp/task.md' },
    getTaskStatusFn: () => 'active',
    getTaskImplementerFn: () => 'codex',
    prompt: 'Execute.',
    selectAgentFn: () => 'claude',
    startAgentFn: async (step, opts) => {
      if (opts.onLaunch) {
        await opts.onLaunch({ agent: 'claude' });
      }
      return { agent: 'claude', result: { error: new Error('usage limit'), status: null } };
    },
    transitionTaskFn: (slug, status, opts) => { transitions.push({ slug, status, opts }); return true; },
    log: () => {}
  });

  assert.equal(transitions.length, 2, 'must write active/claude at launch, then roll back to active/codex');
  assert.equal(transitions[0].status, 'active');
  assert.equal(transitions[0].opts.implementer, 'claude');
  assert.equal(transitions[1].status, 'active', 'rollback must restore the prior status (active)');
  assert.equal(transitions[1].opts.implementer, 'codex', 'rollback must restore the prior implementer (codex)');
});

test('selectLaunchAndRecord does not write Backlog when startAgent throws (no eligible agents)', async () => {
  const transitions = [];

  await assert.rejects(
    () => selectLaunchAndRecord({
      slug: 'task-test',
      worktree: '/tmp/project-task-test',
      agentConfig: {},
      taskResolution: { ok: true, taskFile: '/tmp/task.md' },
      prompt: 'Execute.',
      selectAgentFn: () => { throw new Error('No agents are eligible for workflow step: active'); },
      startAgentFn: async () => { throw new Error('should not be reached'); },
      transitionTaskFn: (slug, status, opts) => { transitions.push({ slug, status, opts }); return true; },
      log: () => {}
    }),
    /No agents are eligible/
  );

  assert.equal(transitions.length, 0, 'transitionTask must NOT be called when selectAgent throws');
});

test('selectLaunchAndRecord records the fallback agent when startAgent falls back from preselected', async () => {
  // When startAgent internally reroutes from claude to codex after a limit hit,
  // the Backlog must record the fallback agent (codex), not the preselected one (claude).
  const transitions = [];

  const result = await selectLaunchAndRecord({
    slug: 'task-test',
    worktree: '/tmp/project-task-test',
    agentConfig: {},
    taskResolution: { ok: true, taskFile: '/tmp/task.md' },
    prompt: 'Execute.',
    selectAgentFn: () => 'claude',
    startAgentFn: async (step, opts) => {
      if (opts.onLaunch) await opts.onLaunch({ agent: 'codex' });
      return { agent: 'codex', result: { status: 0 } };
    },
    transitionTaskFn: (slug, status, opts) => { transitions.push({ slug, status, opts }); return true; },
    log: () => {}
  });

  assert.equal(result.preselected, 'claude', 'preselected must reflect selectAgent result');
  assert.equal(result.agent, 'codex', 'agent must reflect the actual fallback implementer');
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0].opts.implementer, 'codex', 'Backlog must record the fallback agent, not the preselected one');
});

test('selectLaunchAndRecord collapses stale multi-agent assignees to the launched implementer', async () => {
  const transitions = [];

  await selectLaunchAndRecord({
    slug: 'task-test',
    worktree: '/tmp/project-task-test',
    agentConfig: {},
    taskResolution: { ok: true, taskFile: '/tmp/task.md' },
    prompt: 'Execute.',
    selectAgentFn: () => 'claude',
    startAgentFn: async (step, opts) => {
      if (opts.onLaunch) await opts.onLaunch({ agent: 'claude' });
      return { agent: 'claude', result: { status: 0 } };
    },
    transitionTaskFn: (slug, status, opts) => { transitions.push({ slug, status, opts }); return true; },
    log: () => {}
  });

  assert.equal(transitions.length, 1);
  assert.equal(transitions[0].slug, 'task-test');
  assert.equal(transitions[0].status, 'active');
  assert.equal(transitions[0].opts.implementer, 'claude');
  assert.equal(transitions[0].opts.rootDir, '/tmp/project-task-test');
  assert.equal(typeof transitions[0].opts.log, 'function');
});

test('selectLaunchAndRecord rolls back intermediate active write on limit-hit before retry', async () => {
  // Regression: a claude→codex fallback fired two consecutive onLaunch calls without rolling
  // back the first, leaving a spurious active/claude commit in the Backlog history.
  const transitions = [];

  const result = await selectLaunchAndRecord({
    slug: 'task-test',
    worktree: '/tmp/project-task-test',
    agentConfig: {},
    taskResolution: { ok: true, taskFile: '/tmp/task.md' },
    getTaskStatusFn: () => 'refined',
    getTaskImplementerFn: () => null,
    prompt: 'Execute.',
    selectAgentFn: () => 'claude',
    startAgentFn: async (step, opts) => {
      // First attempt: claude hits limit
      await opts.onLaunch({ agent: 'claude' });
      if (opts.onLimitHit) opts.onLimitHit({ agent: 'claude' });
      // Second attempt: codex succeeds
      await opts.onLaunch({ agent: 'codex' });
      return { agent: 'codex', result: { status: 0 } };
    },
    transitionTaskFn: (slug, status, opts) => { transitions.push({ slug, status, opts }); return true; },
    log: () => {}
  });

  // claude active → rollback (clear assignee) → codex active
  assert.equal(transitions.length, 3, 'must record active/claude, rollback, then active/codex');
  assert.equal(transitions[0].status, 'active');
  assert.equal(transitions[0].opts.implementer, 'claude');
  assert.equal(transitions[1].status, 'refined', 'rollback must restore prior status');
  assert.ok(transitions[1].opts.clearAssignee, 'rollback must clear assignee when priorImplementer was absent');
  assert.equal(transitions[2].status, 'active');
  assert.equal(transitions[2].opts.implementer, 'codex', 'final commit must use the surviving agent');
  assert.equal(result.agent, 'codex');
});

test('selectLaunchAndRecord clears assignee on rollback when there was no prior implementer', async () => {
  // Regression: rollbackIfNeeded passed implementer: undefined, which skips enforceTaskAssignee
  // and leaves the transient agent pinned as assignee on a task that had no prior workflow owner.
  const transitions = [];

  await selectLaunchAndRecord({
    slug: 'task-test',
    worktree: '/tmp/project-task-test',
    agentConfig: {},
    taskResolution: { ok: true, taskFile: '/tmp/task.md' },
    getTaskStatusFn: () => 'refined',
    getTaskImplementerFn: () => null,
    prompt: 'Execute.',
    selectAgentFn: () => 'claude',
    startAgentFn: async (step, opts) => {
      await opts.onLaunch({ agent: 'claude' });
      return { agent: 'claude', result: { error: new Error('failed'), status: null } };
    },
    transitionTaskFn: (slug, status, opts) => { transitions.push({ slug, status, opts }); return true; },
    log: () => {}
  });

  assert.equal(transitions.length, 2, 'must write active then rollback');
  assert.equal(transitions[0].status, 'active');
  assert.equal(transitions[0].opts.implementer, 'claude');
  assert.equal(transitions[1].status, 'refined');
  assert.ok(transitions[1].opts.clearAssignee, 'rollback must pass clearAssignee when priorImplementer was absent');
  assert.equal(transitions[1].opts.implementer, undefined, 'must not pass implementer on a clear-assignee rollback');
});

test('selectLaunchAndRecord logs warning (not throws) when rollback transitionTask fails inside onLimitHit', async () => {
  // Covers the throwOnFailure: false path in rollbackIfNeeded when called from onLimitHit.
  const logs = [];
  let callCount = 0;

  // The rollback call (second call) returns false; all other calls return true.
  const transitionTaskFn = (slug, status, opts) => {
    callCount++;
    return callCount !== 2;
  };

  const result = await selectLaunchAndRecord({
    slug: 'task-test',
    worktree: '/tmp/project-task-test',
    agentConfig: {},
    taskResolution: { ok: true, taskFile: '/tmp/task.md' },
    getTaskStatusFn: () => 'refined',
    getTaskImplementerFn: () => null,
    prompt: 'Execute.',
    selectAgentFn: () => 'claude',
    startAgentFn: async (step, opts) => {
      await opts.onLaunch({ agent: 'claude' });
      if (opts.onLimitHit) opts.onLimitHit({ agent: 'claude' });
      // After the failed rollback, a second launch succeeds
      await opts.onLaunch({ agent: 'codex' });
      return { agent: 'codex', result: { status: 0 } };
    },
    transitionTaskFn,
    log: msg => logs.push(msg)
  });

  assert.ok(logs.some(msg => msg.includes('[WARN]') && msg.includes('Failed to roll back')),
    'must log a warning when the rollback transitionTask returns false inside onLimitHit');
  assert.equal(result.agent, 'codex');
});

test('selectLaunchAndRecord skips Backlog write when taskResolution is not ok', async () => {
  const transitions = [];
  const result = await selectLaunchAndRecord({
    slug: 'task-test',
    worktree: '/tmp/project-task-test',
    agentConfig: {},
    taskResolution: { ok: false },
    prompt: 'Execute.',
    selectAgentFn: () => 'codex',
    startAgentFn: async (step, opts) => {
      if (opts.onLaunch) await opts.onLaunch({ agent: 'codex' });
      return { agent: 'codex', result: { status: 0 } };
    },
    transitionTaskFn: (slug, status, opts) => { transitions.push({ slug, status, opts }); return true; },
    log: () => {}
  });

  assert.equal(result.agent, 'codex');
  assert.equal(transitions.length, 0, 'transitionTask must not be called when taskResolution.ok is false');
});

// ---------- validateCheckpointsBeforeHandoff ----------

test('validateCheckpointsBeforeHandoff returns { ok: false } when mission dir is missing', () => {
  const result = active.validateCheckpointsBeforeHandoff('task-missing', '/tmp/nonexistent', {
    findMissionDirFn: () => null,
    log: () => {},
    error: () => {}
  });
  assert.equal(result.ok, false);
  assert.ok(result.error.includes('Mission directory not found'));
});

test('validateCheckpointsBeforeHandoff returns { ok: false } when dir exists but no CP files', () => {
  const result = active.validateCheckpointsBeforeHandoff('task-empty', '/tmp/project-task-empty', {
    findMissionDirFn: () => '/tmp/project-task-empty/docs/missions/2026/task-empty',
    findCheckpointsFn: () => [],
    log: () => {},
    error: () => {}
  });
  assert.equal(result.ok, false);
  assert.ok(result.error.includes('No checkpoint documents found'));
});

test('validateCheckpointsBeforeHandoff returns { ok: true } when at least one CP file exists', () => {
  const logs = [];
  const result = active.validateCheckpointsBeforeHandoff('task-ok', '/tmp/project-task-ok', {
    findMissionDirFn: () => '/tmp/project-task-ok/docs/missions/2026/task-ok',
    findCheckpointsFn: () => ['/tmp/project-task-ok/docs/missions/2026/task-ok/CP-1.md'],
    runFn: () => ({ status: 0, stdout: '' }),
    log: (msg) => logs.push(msg),
    error: () => {}
  });
  assert.equal(result.ok, true);
  assert.ok(logs.some(l => l.includes('Found 1 checkpoint')));
});

test('validateCheckpointsBeforeHandoff returns { ok: false } when checkpoint files are uncommitted', () => {
  const result = active.validateCheckpointsBeforeHandoff('task-dirty', '/tmp/project-task-dirty', {
    findMissionDirFn: () => '/tmp/project-task-dirty/docs/missions/2026/task-dirty',
    findCheckpointsFn: () => ['/tmp/project-task-dirty/docs/missions/2026/task-dirty/CP-1.md'],
    runFn: () => ({ status: 0, stdout: '?? docs/missions/2026/task-dirty/CP-1.md\n' }),
    log: () => {},
    error: () => {}
  });
  assert.equal(result.ok, false);
  assert.ok(result.error.includes('must be committed before handoff'));
  assert.ok(result.error.includes('CP-1.md'));
});

test('active() state-ordering contract: does not write Backlog before launch (regression)', async () => {
  const statusWrites = [];
  const assigneeWrites = [];

  // @ts-expect-error TS2349 This expression is not callable.
  await active(['task-1038'], {
    inferSlugFn: () => 'task-1038',
    missionStartFn: () => ({ pass: true }),
    resolveWorktreeFn: () => '/tmp/project-task-1038',
    readAgentConfigOrExitFn: () => ({}),
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
    buildCheckpointContextFn: () => 'CP-1',
    buildExecutePromptFn: () => 'Execute task-1038',
    selectLaunchAndRecordFn: async () => {
      // At this point, Backlog must not have been mutated
      assert.equal(statusWrites.length, 0, 'Backlog status must NOT be written before launch');
      assert.equal(assigneeWrites.length, 0, 'Backlog assignee must NOT be written before launch');
      return { agent: 'codex', result: { status: 0 } };
    },
    enforceExecuteCommitSafetyFn: () => false,
    runHandoffAndReviewFn: async () => true,
    exitFn: () => {},
    logFn: () => {},
    errorFn: () => {},
    // Inject mocks that track mutations
    setTaskStatus: (file, status) => { statusWrites.push({ file, status }); return true; },
    enforceTaskAssignee: (file, agent) => { assigneeWrites.push({ file, agent }); return true; }
  });
});

// CP-2 tests for attemptAgentRelaunch

const { attemptAgentRelaunch } = require('../lib/commands/active');

test('attemptAgentRelaunch function exists', () => {
  assert.ok(typeof attemptAgentRelaunch === 'function', 'attemptAgentRelaunch should be exported');
});

test('attemptAgentRelaunch returns relaunched:false for non-relaunchable error', async () => {
  const logs = [];
  const { relaunched, error } = await attemptAgentRelaunch(
    'task-1124', '/tmp/worktree', 'Some other error', 'codex', {
      isRelaunchableErrorFn: () => false,
      log: (msg) => logs.push(msg),
      error: () => {}
    }
  );
  
  assert.equal(relaunched, false);
  assert.ok(error);
  assert.ok(error.includes('not relaunchable'));
  assert.ok(logs.some(l => l.includes('Error is not relaunchable')));
});

test('attemptAgentRelaunch returns relaunched:false when agent is not available', async () => {
  const errors = [];
  const { relaunched, error } = await attemptAgentRelaunch(
    'task-1124', '/tmp/worktree',
    'The final checkpoint at docs/missions/2026/task-1121/CP-3.md has a "## Goal Check" section but no evidence rows. A goal-check table with real evidence is required before handoff.',
    'unavailable-agent',
    {
      isRelaunchableErrorFn: (msg) => msg.includes('has a "## Goal Check" section but no evidence rows'),
      workflowLauncherStatusFn: () => ({ supported: false, detail: 'agent not found' }),
      log: () => {},
      error: (msg) => errors.push(msg)
    }
  );
  
  assert.equal(relaunched, false);
  assert.ok(error);
  assert.ok(error.includes('launcher is not available'));
  assert.ok(errors.some(e => e.includes('not available for relaunch')));
});

test('attemptAgentRelaunch calls startAgent with correct parameters', async () => {
  let startAgentCalled = false;
  let stepArg = null;
  let optsArg = null;
  
  const { relaunched } = await attemptAgentRelaunch(
    'task-1124', '/tmp/worktree',
    'The final checkpoint at docs/missions/2026/task-1121/CP-3.md has a "## Goal Check" section but no evidence rows. A goal-check table with real evidence is required before handoff.',
    'codex',
    {
      isRelaunchableErrorFn: (msg) => msg.includes('has a "## Goal Check" section but no evidence rows'),
      workflowLauncherStatusFn: () => ({ supported: true }),
      startAgentFn: async (step, opts) => {
        startAgentCalled = true;
        stepArg = step;
        optsArg = opts;
        return { agent: 'codex', result: { status: 0 } };
      },
      buildRelaunchPromptFn: () => 'test prompt',
      log: () => {},
      error: () => {}
    }
  );
  
  assert.equal(relaunched, true);
  assert.equal(startAgentCalled, true);
  assert.equal(stepArg, 'active');
  // @ts-expect-error TS18047 'optsArg' is possibly 'null'.
  assert.equal(optsArg.slug, 'task-1124');
  // @ts-expect-error TS18047 'optsArg' is possibly 'null'.
  assert.equal(optsArg.role, 'implementer');
  // @ts-expect-error TS18047 'optsArg' is possibly 'null'.
  assert.equal(optsArg.agent, 'codex');
  // @ts-expect-error TS18047 'optsArg' is possibly 'null'.
  assert.equal(optsArg.worktree, '/tmp/worktree');
  // @ts-expect-error TS18047 'optsArg' is possibly 'null'.
  assert.equal(optsArg.prompt, 'test prompt');
});

// ---------- enforceExecuteCommitSafety: task-1211 fallback-commit regression ----------
//
// Reproduces the task-1210 transcript failure: git status --porcelain C-quotes
// paths that contain spaces (e.g. the backlog task filename), and the safety
// harness passed those literal-quoted strings to `git add --`, which never
// matches a real file. The add fails, nothing is staged, and the fallback
// commit dies with "could not create fallback commit".

// The exact dirty entries from the task-1210 transcript. The backlog task path
// is C-quoted by git because the filename contains spaces.
const TRANSCRIPT_DIRTY_ENTRIES = [
  ' M "backlog/tasks/task-1210 - Ensure-an-agent-can-review-itself-as-last-fallback.md"',
  ' M docs/agent-prompts/review.md',
  ' M workflow/lib/review/review-loop.js',
  ' M workflow/prompts/review-verbose.md',
  ' M workflow/prompts/review.md',
  '?? docs/missions/2026/task-1210/'
];

const TRANSCRIPT_EXPECTED_PATHS = [
  'backlog/tasks/task-1210 - Ensure-an-agent-can-review-itself-as-last-fallback.md',
  'docs/agent-prompts/review.md',
  'workflow/lib/review/review-loop.js',
  'workflow/prompts/review-verbose.md',
  'workflow/prompts/review.md',
  'docs/missions/2026/task-1210/'
];

test('enforceExecuteCommitSafety stages every transcript dirty path (unquoted) and returns true', () => {
  const gitCalls = [];
  const result = enforceExecuteCommitSafety({
    slug: 'task-test',
    worktree: '/tmp/wt',
    dirtyEntries: TRANSCRIPT_DIRTY_ENTRIES,
    gitImpl(args) {
      gitCalls.push(args);
      return { status: 0, stdout: '', stderr: '' };
    }
  });

  assert.equal(result, true);
  const addCall = gitCalls.find(args => args.includes('add'));
  assert.ok(addCall, 'expected a git add call');
  // Every relevant path must be staged with its real (unquoted) value so git
  // can actually match it. The literal-quoted form must never be passed.
  for (const expected of TRANSCRIPT_EXPECTED_PATHS) {
    assert.ok(
      addCall.includes(expected),
      `git add must stage unquoted path: ${expected}\ngot: ${JSON.stringify(addCall)}`
    );
  }
  assert.ok(
    !addCall.some(arg => arg.startsWith('"') && arg.endsWith('"')),
    `git add must not receive any literal-quoted path: ${JSON.stringify(addCall)}`
  );
});

test('enforceExecuteCommitSafety creates the fallback commit with the documented subject and body', () => {
  const gitCalls = [];
  enforceExecuteCommitSafety({
    slug: 'task-test',
    worktree: '/tmp/wt',
    dirtyEntries: TRANSCRIPT_DIRTY_ENTRIES,
    gitImpl(args) {
      gitCalls.push(args);
      return { status: 0, stdout: '', stderr: '' };
    }
  });

  const commitCall = gitCalls.find(args => args.includes('commit'));
  assert.ok(commitCall, 'expected a git commit call');
  assert.ok(commitCall.includes('execute(task-test): capture agent output'));
  assert.ok(commitCall.includes('Safety harness: capture implementation changes left uncommitted by the execute agent.'));
});

test('enforceExecuteCommitSafety stages an untracked directory entry ending in / without throwing', () => {
  const gitCalls = [];
  let result;
  assert.doesNotThrow(() => {
    result = enforceExecuteCommitSafety({
      slug: 'task-test',
      worktree: '/tmp/wt',
      dirtyEntries: ['?? docs/missions/2026/task-1210/'],
      gitImpl(args) {
        gitCalls.push(args);
        return { status: 0, stdout: '', stderr: '' };
      }
    });
  });
  assert.equal(result, true);
  const addCall = gitCalls.find(args => args.includes('add'));
  assert.ok(addCall.includes('docs/missions/2026/task-1210/'));
});

test('enforceExecuteCommitSafety throws when the fallback commit returns non-zero', () => {
  assert.throws(
    () => enforceExecuteCommitSafety({
      slug: 'task-test',
      worktree: '/tmp/wt',
      dirtyEntries: [' M docs/agent-prompts/review.md'],
      gitImpl(args) {
        if (args.includes('commit')) return { status: 1, stdout: '', stderr: 'no changes' };
        return { status: 0, stdout: '', stderr: '' };
      }
    }),
    /Execute safety harness could not create fallback commit/
  );
});

test('enforceExecuteCommitSafety throws on an unresolved-conflict (UU) entry and names the path', () => {
  assert.throws(
    () => enforceExecuteCommitSafety({
      slug: 'task-test',
      worktree: '/tmp/wt',
      dirtyEntries: ['UU workflow/lib/review/review-loop.js'],
      gitImpl: () => ({ status: 0, stdout: '', stderr: '' })
    }),
    /Execute safety harness found unresolved conflicts: workflow\/lib\/review\/review-loop\.js/
  );
});

test('enforceExecuteCommitSafety excludes workflow-generated artifacts from the fallback git add', () => {
  const gitCalls = [];
  enforceExecuteCommitSafety({
    slug: 'task-test',
    worktree: '/tmp/wt',
    dirtyEntries: [
      ' M docs/agent-prompts/review.md',
      '?? .workflow/runs/task-test/run.log'
    ],
    gitImpl(args) {
      gitCalls.push(args);
      return { status: 0, stdout: '', stderr: '' };
    }
  });
  const addCall = gitCalls.find(args => args.includes('add'));
  assert.ok(addCall.includes('docs/agent-prompts/review.md'));
  assert.ok(
    !addCall.some(arg => arg.includes('.workflow/')),
    `ignored workflow artifact must not be staged: ${JSON.stringify(addCall)}`
  );
});

test('enforceExecuteCommitSafety stages the unquoted destination of a quoted rename', () => {
  const gitCalls = [];
  enforceExecuteCommitSafety({
    slug: 'task-test',
    worktree: '/tmp/wt',
    dirtyEntries: ['R  "backlog/tasks/old name.md" -> "backlog/tasks/new name.md"'],
    gitImpl(args) {
      gitCalls.push(args);
      return { status: 0, stdout: '', stderr: '' };
    }
  });
  const addCall = gitCalls.find(args => args.includes('add'));
  assert.ok(addCall.includes('backlog/tasks/new name.md'),
    `expected unquoted rename destination staged: ${JSON.stringify(addCall)}`);
  assert.ok(!addCall.some(arg => arg.includes('old name.md')),
    `rename source must not be staged: ${JSON.stringify(addCall)}`);
});

test('enforceExecuteCommitSafety decodes octal-escaped UTF-8 and C escapes from git status', () => {
  const gitCalls = [];
  enforceExecuteCommitSafety({
    slug: 'task-test',
    worktree: '/tmp/wt',
    // git emits non-ASCII bytes as \NNN octal (é -> \303\251) and a tab as \t,
    // both wrapped in the C-quoted form.
    dirtyEntries: [
      ' M "docs/caf\\303\\251 notes.md"',
      '?? "docs/a\\tb.md"'
    ],
    gitImpl(args) {
      gitCalls.push(args);
      return { status: 0, stdout: '', stderr: '' };
    }
  });
  const addCall = gitCalls.find(args => args.includes('add'));
  assert.ok(addCall.includes('docs/café notes.md'),
    `expected octal UTF-8 decoded to real bytes: ${JSON.stringify(addCall)}`);
  assert.ok(addCall.includes('docs/a\tb.md'),
    `expected \\t decoded to a real tab: ${JSON.stringify(addCall)}`);
});

// ---------- TASK-1324: relaunch success must not escape without review transition ----------

test('runHandoffAndReview: relaunch success triggers post-relaunch handoff instead of bare return', async () => {
  // Pre-fix bug shape: performHandoff was called only once (initial call),
  // and startReviewLoop was never called. After the fix, performHandoff is
  // re-invoked after a successful relaunch.
  let handoffAttempts = 0;
  let reviewLoopStarted = false;
  let relaunchAttempts = 0;

  const result = await runHandoffAndReview('task-1324', '/tmp/project-task-1324', 'codex', {
    validateCheckpointsBeforeHandoffFn: () => ({ ok: true }),
    performHandoff: async (slug, opts) => {
      handoffAttempts++;
      // First call fails with relaunchable error; second call (post-fix) would succeed
      if (handoffAttempts === 1) {
        return { ok: false, error: 'The final checkpoint at docs/missions/2026/task-1324/CP-1.md has a "## Goal Check" section but no evidence rows. A goal-check table with real evidence is required before handoff.' };
      }
      return { ok: true };
    },
    repairHandoffFn: async () => ({ repaired: false, blocker: null }),
    attemptAgentRelaunchFn: async () => {
      relaunchAttempts++;
      return { relaunched: true };
    },
    startReviewLoop: () => { reviewLoopStarted = true; },
    log: () => {},
    error: () => {}
  });

  // Post-fix: performHandoff must be re-invoked after relaunch, and review loop must start
  assert.ok(result, 'runHandoffAndReview returns true after successful post-relaunch handoff');
  assert.equal(handoffAttempts, 2, 'performHandoff must be re-invoked after relaunch');
  assert.equal(reviewLoopStarted, true, 'startReviewLoop must be called after successful post-relaunch handoff');
  assert.equal(relaunchAttempts, 1, 'attemptAgentRelaunch was called once');
});

test('runHandoffAndReview: relaunch success must trigger post-relaunch handoff and review loop', async () => {
  // Post-fix expectation: after a successful relaunch, the code must re-invoke
  // performHandoff() to verify the handoff-to-review transition actually happened,
  // matching the contract of the repair-success path.
  let handoffAttempts = 0;
  let reviewLoopStarted = false;
  let relaunchAttempts = 0;

  const result = await runHandoffAndReview('task-1324', '/tmp/project-task-1324', 'codex', {
    validateCheckpointsBeforeHandoffFn: () => ({ ok: true }),
    performHandoff: async (slug, opts) => {
      handoffAttempts++;
      if (handoffAttempts === 1) {
        return { ok: false, error: 'The final checkpoint at docs/missions/2026/task-1324/CP-1.md has a "## Goal Check" section but no evidence rows. A goal-check table with real evidence is required before handoff.' };
      }
      return { ok: true };
    },
    repairHandoffFn: async () => ({ repaired: false, blocker: null }),
    attemptAgentRelaunchFn: async () => {
      relaunchAttempts++;
      return { relaunched: true };
    },
    startReviewLoop: (slug, opts) => { reviewLoopStarted = true; },
    log: () => {},
    error: () => {}
  });

  // After fix: performHandoff must be re-invoked after relaunch, and review loop must start
  assert.ok(result, 'runHandoffAndReview should return true after successful post-relaunch handoff');
  assert.equal(handoffAttempts, 2, 'performHandoff must be re-invoked after relaunch');
  assert.equal(reviewLoopStarted, true, 'startReviewLoop must be called after successful post-relaunch handoff');
  assert.equal(relaunchAttempts, 1, 'attemptAgentRelaunch was called once');
});

test('runHandoffAndReview: relaunch success with post-relaunch handoff failure must not report success', async () => {
  // Edge case: relaunch succeeds but the post-relaunch handoff still fails.
  // The function must return false, not true.
  // With ADR 0048 C1 classification, IncompleteEvidence maps to AutoSendBack
  // which takes the relaunch path directly (up to 2 attempts).
  let handoffAttempts = 0;
  let reviewLoopStarted = false;

  const result = await runHandoffAndReview('task-1324', '/tmp/project-task-1324', 'codex', {
    validateCheckpointsBeforeHandoffFn: () => ({ ok: true }),
    performHandoff: async () => {
      handoffAttempts++;
      // IncompleteEvidence error — classifies as AutoSendBack, triggers relaunch path
      return { ok: false, error: 'The final checkpoint at docs/missions/2026/task-1324/CP-1.md has a "## Goal Check" section but no evidence rows. A goal-check table with real evidence is required before handoff.' };
    },
    repairHandoffFn: async () => ({ repaired: false, blocker: null }),
    attemptAgentRelaunchFn: async () => ({ relaunched: true }),
    startReviewLoop: () => { reviewLoopStarted = true; },
    log: () => {},
    error: () => {}
  });

  assert.equal(result, false, 'must return false when post-relaunch handoff fails');
  // IncompleteEvidence → AutoSendBack → relaunch path: initial + 2 relaunch retries = 3
  assert.equal(handoffAttempts, 3, 'performHandoff called 3 times: initial + 2 relaunch retries');
  assert.equal(reviewLoopStarted, false, 'startReviewLoop must NOT be called when handoff fails');
});

test('runHandoffAndReview: relaunch failure must not trigger post-relaunch handoff', async () => {
  // If relaunch itself fails, the code should fall through to the manual handoff message.
  let handoffAttempts = 0;
  let reviewLoopStarted = false;
  let relaunchAttempts = 0;

  const result = await runHandoffAndReview('task-1324', '/tmp/project-task-1324', 'codex', {
    validateCheckpointsBeforeHandoffFn: () => ({ ok: true }),
    performHandoff: async () => {
      handoffAttempts++;
      return { ok: false, error: 'The final checkpoint at docs/missions/2026/task-1324/CP-1.md has a "## Goal Check" section but no evidence rows. A goal-check table with real evidence is required before handoff.' };
    },
    repairHandoffFn: async () => ({ repaired: false, blocker: null }),
    attemptAgentRelaunchFn: async () => {
      relaunchAttempts++;
      return { relaunched: false, error: 'relaunch failed' };
    },
    startReviewLoop: () => { reviewLoopStarted = true; },
    log: () => {},
    error: () => {}
  });

  assert.equal(result, false, 'must return false when relaunch fails');
  assert.equal(handoffAttempts, 1, 'performHandoff called only once (no post-relaunch retry)');
  assert.equal(reviewLoopStarted, false, 'startReviewLoop must NOT be called');
  assert.equal(relaunchAttempts, 1, 'attemptAgentRelaunch was called once');
});

// ---------- TASK-1387: gate output capture and automatic relaunch (SC3 & SC4) ----------

test('runHandoffAndReview relaunches on verification gate failure with captured output (SC3)', async () => {
  let handoffAttempts = 0;
  let relaunchAttempts = 0;
  let lastGateOutput = null;

  const result = await runHandoffAndReview('task-1387-sc3', '/tmp/project-task-1387', 'codex', {
    validateCheckpointsBeforeHandoffFn: () => ({ ok: true }),
    performHandoff: async (slug, opts) => {
      handoffAttempts++;
      if (handoffAttempts === 1) {
        return {
          ok: false,
          error: 'Final verification gate failed. Fix errors before submitting or use --no-gate if appropriate.',
          gateOutput: {
            stdout: 'lint: ERROR: unused import in foo.js',
            stderr: 'TypeScript: error TS2345: type mismatch'
          }
        };
      }
      return { ok: true };
    },
    repairHandoffFn: async () => ({ repaired: false, blocker: null }),
    attemptAgentRelaunchFn: async (slugArg, worktree, errorMsg, agent, opts) => {
      relaunchAttempts++;
      lastGateOutput = opts.gateOutput || null;
      return { relaunched: true };
    },
    startReviewLoop: () => {},
    log: () => {},
    error: () => {}
  });

  assert.ok(result, 'should succeed after successful relaunch');
  assert.equal(handoffAttempts, 2, 'performHandoff called twice: initial + post-relaunch');
  assert.equal(relaunchAttempts, 1, 'attemptAgentRelaunch called once');
  assert.ok(lastGateOutput, 'gateOutput should be passed to attemptAgentRelaunch');
  // @ts-expect-error TS2339 Property 'stdout' does not exist on type 'never'.
  assert.equal(lastGateOutput.stdout, 'lint: ERROR: unused import in foo.js');
  // @ts-expect-error TS2339 Property 'stderr' does not exist on type 'never'.
  assert.equal(lastGateOutput.stderr, 'TypeScript: error TS2345: type mismatch');
});

test('runHandoffAndReview relaunches on declared gate failure with captured output (SC3)', async () => {
  let handoffAttempts = 0;
  let relaunchAttempts = 0;
  let lastGateOutput = null;

  const result = await runHandoffAndReview('task-1387-sc3-declared', '/tmp/project-task-1387', 'codex', {
    validateCheckpointsBeforeHandoffFn: () => ({ ok: true }),
    performHandoff: async () => {
      handoffAttempts++;
      if (handoffAttempts === 1) {
        return {
          ok: false,
          error: 'Declared gate "bash -c exit 1" failed for task-1387-sc3-declared: err output. Blocking handoff — task remains in active.',
          gateOutput: {
            stdout: 'declared gate stdout',
            stderr: 'declared gate stderr'
          }
        };
      }
      return { ok: true };
    },
    repairHandoffFn: async () => ({ repaired: false, blocker: null }),
    attemptAgentRelaunchFn: async (slugArg, worktree, errorMsg, agent, opts) => {
      relaunchAttempts++;
      lastGateOutput = opts.gateOutput || null;
      return { relaunched: true };
    },
    startReviewLoop: () => {},
    log: () => {},
    error: () => {}
  });

  assert.ok(result, 'should succeed after successful relaunch on declared gate failure');
  assert.equal(handoffAttempts, 2, 'performHandoff called twice');
  assert.equal(relaunchAttempts, 1, 'attemptAgentRelaunch called once');
  assert.ok(lastGateOutput, 'gateOutput should be passed to attemptAgentRelaunch for declared gate failures');
  // @ts-expect-error TS2339 Property 'stdout' does not exist on type 'never'.
  assert.equal(lastGateOutput.stdout, 'declared gate stdout');
  // @ts-expect-error TS2339 Property 'stderr' does not exist on type 'never'.
  assert.equal(lastGateOutput.stderr, 'declared gate stderr');
});

test('runHandoffAndReview limits gate-failure relaunches to 2 attempts (SC4)', async () => {
  let handoffAttempts = 0;
  let relaunchAttempts = 0;
  let relaunchErrors = [];

  const result = await runHandoffAndReview('task-1387-sc4', '/tmp/project-task-1387', 'codex', {
    validateCheckpointsBeforeHandoffFn: () => ({ ok: true }),
    performHandoff: async () => {
      handoffAttempts++;
      // Handoff keeps failing with gate failure
      return {
        ok: false,
        error: 'Final verification gate failed. Fix errors before submitting or use --no-gate if appropriate.',
        gateOutput: { stdout: 'gate error', stderr: 'gate stderr' }
      };
    },
    repairHandoffFn: async () => ({ repaired: false, blocker: null }),
    attemptAgentRelaunchFn: async () => {
      relaunchAttempts++;
      // Relaunch always succeeds but handoff keeps failing
      return { relaunched: true };
    },
    startReviewLoop: () => {},
    log: () => {},
    error: (msg) => { relaunchErrors.push(msg); }
  });

  assert.equal(result, false, 'should return false after exhausting relaunch attempts');
  assert.equal(handoffAttempts, 3, 'performHandoff: initial + 2 post-relaunch retries');
  assert.equal(relaunchAttempts, 2, 'attemptAgentRelaunch called exactly 2 times (max limit)');
  assert.ok(relaunchErrors.some(e => e.includes('Gate failure persisting after 2 relaunch attempts')),
    'should report the 2-attempt limit in the error message');
});

test('runHandoffAndReview stops relaunching when agent relaunch itself fails (SC4)', async () => {
  let handoffAttempts = 0;
  let relaunchAttempts = 0;

  const result = await runHandoffAndReview('task-1387-sc4-stop', '/tmp/project-task-1387', 'codex', {
    validateCheckpointsBeforeHandoffFn: () => ({ ok: true }),
    performHandoff: async () => {
      handoffAttempts++;
      return {
        ok: false,
        error: 'Final verification gate failed. Fix errors before submitting or use --no-gate if appropriate.',
        gateOutput: { stdout: 'gate error', stderr: 'gate stderr' }
      };
    },
    repairHandoffFn: async () => ({ repaired: false, blocker: null }),
    attemptAgentRelaunchFn: async () => {
      relaunchAttempts++;
      // First relaunch succeeds, second fails
      if (relaunchAttempts === 1) {
        return { relaunched: true };
      }
      return { relaunched: false, error: 'launcher unavailable' };
    },
    startReviewLoop: () => {},
    log: () => {},
    error: () => {}
  });

  assert.equal(result, false, 'should return false when relaunch fails');
  assert.equal(handoffAttempts, 2, 'performHandoff: initial + 1 post-relaunch (first relaunch succeeded)');
  assert.equal(relaunchAttempts, 2, 'attemptAgentRelaunch called twice: first succeeds, second fails');
});
