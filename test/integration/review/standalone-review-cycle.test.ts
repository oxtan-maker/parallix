
/**
 * task-1272 CP-4: full review cycle survives in a standalone (Forgejo-disabled)
 * git repo with no PR and a mission file at a non-standard location.
 *
 * Covers Success Criteria 1, 2, and 7 from MISSION.md:
 *  - SC1: first reviewer round (launch -> artifact write -> consumption -> state
 *         transition) completes without an unhandled exception or exit(1).
 *  - SC2: the loop makes NO Forgejo API calls when review.provider is unset
 *         (getPrStatusFn / forgejoAvailableFn / readTokenFn / poll fns untouched).
 *  - SC7: findMissionDir reads the contract from a caller-supplied --mission path
 *         (outside docs/missions/) and preserves slug-derived behaviour when absent.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import childProcess from 'child_process';
import { mockModule, installModuleMocks } from '../../lib/module-mock.js';
import { runReviewLoop } from '../../../src/application/review-loop/review-loop.js';
import { fakeReviewLoopPorts } from '../../helpers/review-loop-ports.js';
const agentsModule = mockModule<typeof import('../../../src/adapters/agents/agents.js')>('../../../src/adapters/agents/agents.js', import.meta.url);
const reviewAdapterModule = mockModule<typeof import('../../../src/adapters/review/review-adapter.js')>('../../../src/adapters/review/review-adapter.js', import.meta.url);
const findMissionDirModule = mockModule<typeof import('../../../src/adapters/filesystem/mission-utils.js')>('../../../src/adapters/filesystem/mission-utils.js', import.meta.url);
const reviewLoopModule = mockModule<typeof import('../../../src/adapters/review/review-loop.js')>('../../../src/adapters/review/review-loop.js', import.meta.url);
await installModuleMocks();
test.afterEach(() => mock.restoreAll());
const { createReviewLoopPorts } = reviewLoopModule;
const { findMissionDir, missionDirForSlug, missionPathForSlug } = findMissionDirModule;

const { mock } = test;

async function withTempGitRepo(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-test-1272-cycle-'));
  try {
    childProcess.spawnSync('git', ['init', '-b', 'master'], { cwd: root });
    childProcess.spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
    childProcess.spawnSync('git', ['config', 'user.name', 'Test User'], { cwd: root });
    fs.writeFileSync(path.join(root, 'README.md'), '# repo');
    childProcess.spawnSync('git', ['add', '.'], { cwd: root });
    childProcess.spawnSync('git', ['commit', '-m', 'initial'], { cwd: root });
    const result = fn(root);
    if (result && typeof result.then === 'function') {
      await result;
    }
    return result;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// SC7: --mission path resolution.
test('findMissionDir reads a mission contract from a non-standard --mission path', async () => {
  await withTempGitRepo((root) => {
    const slug = 'task-1272';
    // Mission deliberately placed OUTSIDE docs/missions/.
    const customDir = path.join(root, 'elsewhere', 'review-pack');
    fs.mkdirSync(customDir, { recursive: true });
    const customMission = path.join(customDir, 'MISSION.md');
    fs.writeFileSync(customMission, '# Mission: custom location\n');

    // File path -> returns its containing directory.
    assert.equal(
      findMissionDir(slug, root, { missionPath: customMission }),
      customDir,
      'file --mission path should resolve to its dirname'
    );
    // Directory path -> returned as-is.
    assert.equal(
      findMissionDir(slug, root, { missionPath: customDir }),
      customDir,
      'directory --mission path should resolve to itself'
    );
    // Absent --mission -> slug-derived behaviour unchanged.
    const stdDir = missionDirForSlug(root, slug);
    fs.mkdirSync(stdDir, { recursive: true });
    fs.writeFileSync(path.join(stdDir, 'MISSION.md'), '# Mission: standard\n');
    assert.equal(
      findMissionDir(slug, root, {}),
      stdDir,
      'absent --mission must fall back to the slug-derived standard location'
    );
  });
});

/**
 * A standalone review loop: the real review-loop mechanisms bound to a git repo
 * with no review provider configured, with the reviewer/implementer outputs,
 * the Backlog mirror and the pre-review checks faked.
 */
function standalone(root, options: { missionPath?: string; reviewer?: () => Promise<unknown>; implementer?: () => Promise<unknown> } = {}) {
  // Forgejo surfaces — must remain untouched in standalone mode (SC2).
  const forgejo = {
    getPrStatus: mock.method(reviewAdapterModule, 'getPrStatus', () => ({ exists: false })),
    providerAvailable: mock.method(reviewAdapterModule, 'providerAvailable', async () => false),
    readToken: mock.method(reviewAdapterModule, 'readToken', () => 'should-not-be-read'),
    getLatestReviewForPr: mock.method(reviewAdapterModule, 'getLatestReviewForPr', async () => null),
  };
  const bound = createReviewLoopPorts('task-1272', { worktree: root, missionPath: options.missionPath }, { log: () => {}, error: () => {} });
  let head = 0;
  const fake = fakeReviewLoopPorts({
    slug: 'task-1272',
    worktree: root,
    handoff: { handoff: async () => ({ ok: true }) },
    routing: { eligibleFamilies: () => ['codex', 'claude', 'gemini', 'custom'] },
    artifacts: {
      ...(options.reviewer ? { consumeReviewer: options.reviewer as never } : {}),
      ...(options.implementer ? { consumeImplementer: options.implementer as never } : {}),
    },
    // The implementer commits a revised tree between rounds.
    preReview: { head: () => `head-${++head}` },
  });
  const ports = { ...fake.ports, provider: bound.provider, agents: bound.agents };
  return { fake, ports, forgejo };
}

function assertNoForgejoApiCalls(ports, forgejo) {
  assert.equal(ports.provider, null, 'standalone mode binds no review provider');
  for (const [name, fn] of Object.entries(forgejo)) {
    assert.equal((fn as any).mock.callCount(), 0, `no Forgejo ${name} call in standalone mode`);
  }
}

/** Capture the rendered reviewer prompt from the real agent port. */
function capturePrompt() {
  const captured: { prompt: string | null } = { prompt: null };
  mock.method(agentsModule, 'startAgent', async (step, agentOpts) => {
    if (step === 'review' && typeof agentOpts.prompt === 'function') { captured.prompt = agentOpts.prompt('codex'); }
    return { agent: agentOpts.agent };
  });
  return captured;
}

// SC7 integration: the review loop must thread a --mission override into the
// launched reviewer/implementer prompts (not just findMissionDir in isolation).
test('review loop threads --mission override into the launched reviewer prompt', async () => {
  await withTempGitRepo(async (root) => {
    // Mission contract at a non-standard location (outside docs/missions/).
    const customDir = path.join(root, 'review-pack');
    fs.mkdirSync(customDir, { recursive: true });
    const customMission = path.join(customDir, 'MISSION.md');
    // TASK-2521.03: the prompt no longer echoes the mission path, so the
    // override is observed through what the harness reads from it — the
    // declared-gate list in the completed-controls block.
    fs.writeFileSync(customMission, '# Mission: custom standalone contract\n\n## Gates\n- `npm run override-gate`\n');

    const captured = capturePrompt();
    const { ports } = standalone(root, { missionPath: customMission, reviewer: async () => ({ consumed: true, ok: true, reviewState: 'APPROVED' }) });
    await runReviewLoop({ slug: 'task-1272', implementer: 'claude', reviewer: 'codex' }, ports);
    const capturedPrompt = captured.prompt;

    assert.ok(capturedPrompt, 'reviewer prompt should have been built');
    assert.ok(
      capturedPrompt.includes('npm run override-gate'),
      'the --mission override must decide which mission the harness reads gates from'
    );
    // The path itself is harness plumbing and is never handed to the reviewer.
    assert.ok(
      !capturedPrompt.includes(customMission) && !capturedPrompt.includes(missionPathForSlug(root, 'task-1272')),
      'no mission document path may appear in the reviewer prompt'
    );
  });
});

// Negative control: absent --mission, the harness resolves the slug-derived path.
test('review loop uses the slug-derived mission path when --mission is absent', async () => {
  await withTempGitRepo(async (root) => {
    const derived = missionPathForSlug(root, 'task-1272');
    fs.mkdirSync(path.dirname(derived), { recursive: true });
    fs.writeFileSync(derived, '# Mission: derived\n\n## Gates\n- `npm run derived-gate`\n');
    const captured = capturePrompt();
    const { ports } = standalone(root, { reviewer: async () => ({ consumed: true, ok: true, reviewState: 'APPROVED' }) });
    await runReviewLoop({ slug: 'task-1272', implementer: 'claude', reviewer: 'codex' }, ports);
    const capturedPrompt = captured.prompt;

    assert.ok(capturedPrompt, 'reviewer prompt should have been built');
    assert.ok(
      capturedPrompt.includes('npm run derived-gate'),
      'absent --mission must resolve the slug-derived standard mission path'
    );
    assert.ok(!capturedPrompt.includes(derived), 'the resolved path stays out of the prompt');
  });
});

// SC1 + SC2: first reviewer round reaching APPROVED via artifacts, no Forgejo calls.
test('standalone review loop completes a first round to APPROVED with no Forgejo calls', async () => {
  await withTempGitRepo(async (root) => {
    capturePrompt();
    const { fake, ports, forgejo } = standalone(root, { reviewer: async () => ({ consumed: true, ok: true, reviewState: 'APPROVED' }) });
    // SC4: the disabled-provider "Forgejo validation skipped" line is demoted
    // to verbose by default; reveal it here to prove no Forgejo calls.
    await runReviewLoop({ slug: 'task-1272', implementer: 'claude', reviewer: 'codex', verbose: true }, ports);
    const { logs, errors, exits: exitCodes } = fake;
    const mocks = forgejo;

    assert.deepEqual(exitCodes, [], `loop must not exit(1); errors=${errors.join(' | ')}`);
    assert.ok(logs.some(l => /reviewer approved/.test(l)), 'should stop on reviewer approval');
    assert.ok(
      logs.some(l => /Forgejo validation skipped/.test(l)),
      'should log that Forgejo validation was skipped'
    );
    assertNoForgejoApiCalls(ports, mocks);
  });
});

// SC1 + SC4: full reviewer -> implementer -> reviewer cycle survives standalone.
test('standalone loop survives REQUEST_CHANGES -> CHANGES_MADE -> APPROVED across rounds', async () => {
  await withTempGitRepo(async (root) => {
    const reviewOutcomes = ['REQUEST_CHANGES', 'APPROVED'];
    let reviewIdx = 0;
    mock.method(agentsModule, 'startAgent', async (_step, agentOpts) => ({ agent: agentOpts.agent }));
    const { fake, ports, forgejo } = standalone(root, {
      reviewer: async () => ({ consumed: true, ok: true, reviewState: reviewOutcomes[reviewIdx++] }),
      implementer: async () => ({ consumed: true, ok: true, disposition: 'CHANGES_MADE' }),
    });
    await runReviewLoop({ slug: 'task-1272', implementer: 'claude', reviewer: 'codex' }, ports);
    const { errors, exits: exitCodes } = fake;

    assert.deepEqual(exitCodes, [], `multi-round loop must not exit(1); errors=${errors.join(' | ')}`);
    assert.equal(reviewIdx, 2, 'reviewer artifacts consumed across two rounds');
    assertNoForgejoApiCalls(ports, forgejo);
  });
});
