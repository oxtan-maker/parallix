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
const test = require('node:test');
const { mock } = test;
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

const { startReviewLoop } = require('../lib/review/review');
const { findMissionDir, missionDirForSlug, missionPathForSlug } = require('../lib/core/mission-utils');

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
test('findMissionDir reads a mission contract from a non-standard --mission path', () => {
  withTempGitRepo((root) => {
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

function standaloneOpts(root, overrides = {}) {
  const taskFile = path.join(root, 'task.md');
  fs.writeFileSync(taskFile, '# task');

  // Forgejo surfaces — must remain untouched in standalone mode (SC2).
  const getPrStatusFn = mock.fn(() => ({ exists: false }));
  const forgejoAvailableFn = mock.fn(async () => false);
  const readTokenFn = mock.fn(() => 'should-not-be-read');
  const pollForReviewFn = mock.fn(async () => 'TIMEOUT');
  const pollForDispositionFn = mock.fn(async () => 'TIMEOUT');
  const getLatestReviewForPrFn = mock.fn(async () => null);

  const logs = [];
  const errors = [];
  const exitCodes = [];

  const opts = {
    slug: 'task-1272',
    implementer: 'claude',
    reviewer: 'codex',
    worktree: root,
    dryRun: false,
    // Standalone: provider unset.
    isForgejoReviewEnabledFn: () => false,
    // Forgejo surfaces (asserted untouched).
    getPrStatusFn,
    forgejoAvailableFn,
    readTokenFn,
    pollForReviewFn,
    pollForDispositionFn,
    getLatestReviewForPrFn,
    // Loop plumbing.
    maybeUpdateGraphifyBeforeReviewFn: () => {},
    resolveTaskFileFn: () => ({ ok: true, taskFile }),
    getTaskStatusFn: () => 'review',
    transitionTaskFn: () => {},
    transitionVirtualFn: () => {},
    toVirtualFn: (s) => s,
    workflowLauncherStatusFn: () => ({ supported: true }),
    eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'custom'],
    enforceTaskAssigneeFn: () => true,
    applyAgentFallbackFn: (a) => a.original,
    readReviewStateFn: () => null,
    writeReviewStateFn: () => {},
    startAgentFn: async () => ({ agent: null }),
    rebaseBeforeReviewRoundFn: async () => ({ ok: true, sharedFileConflicts: false }),
    buildCompactReviewPromptFn: () => 'review prompt',
    buildCompactActOnReviewPromptFn: () => 'act-on-review prompt',
    log: (m) => logs.push(m),
    error: (m) => errors.push(m),
    exit: (c) => exitCodes.push(c),
    ...overrides
  };
  return { opts, logs, errors, exitCodes, mocks: { getPrStatusFn, forgejoAvailableFn, readTokenFn, pollForReviewFn, pollForDispositionFn, getLatestReviewForPrFn } };
}

function assertNoForgejoApiCalls(mocks) {
  assert.equal(mocks.getPrStatusFn.mock.callCount(), 0, 'no PR status check in standalone mode');
  assert.equal(mocks.forgejoAvailableFn.mock.callCount(), 0, 'no Forgejo availability probe in standalone mode');
  assert.equal(mocks.readTokenFn.mock.callCount(), 0, 'no Forgejo token read in standalone mode');
  assert.equal(mocks.pollForReviewFn.mock.callCount(), 0, 'no Forgejo review poll in standalone mode');
  assert.equal(mocks.pollForDispositionFn.mock.callCount(), 0, 'no Forgejo disposition poll in standalone mode');
  assert.equal(mocks.getLatestReviewForPrFn.mock.callCount(), 0, 'no Forgejo review fetch in standalone mode');
}

// SC7 integration: startReviewLoop must thread a --mission override into the
// launched reviewer/implementer prompts (not just findMissionDir in isolation).
test('startReviewLoop threads --mission override into the launched reviewer prompt', async () => {
  await withTempGitRepo(async (root) => {
    // Mission contract at a non-standard location (outside docs/missions/).
    const customDir = path.join(root, 'review-pack');
    fs.mkdirSync(customDir, { recursive: true });
    const customMission = path.join(customDir, 'MISSION.md');
    fs.writeFileSync(customMission, '# Mission: custom standalone contract\n');

    let capturedPrompt = null;
    const { opts } = standaloneOpts(root, {
      missionPath: customMission,
      // Use the REAL prompt builder (undefined => destructuring default) so the
      // captured prompt reflects actual {{missionPath}} substitution.
      buildCompactReviewPromptFn: undefined,
      // Force the reviewer prompt callback to execute so we can capture it,
      // then approve immediately so the loop terminates after one launch.
      startAgentFn: async (step, agentOpts) => {
        if (step === 'review' && typeof agentOpts.prompt === 'function') {
          capturedPrompt = agentOpts.prompt('codex');
        }
        return { agent: 'codex' };
      },
      consumeReviewerArtifactsFn: async () => ({ consumed: true, ok: true, reviewState: 'APPROVED' })
    });

    await startReviewLoop('task-1272', opts);

    assert.ok(capturedPrompt, 'reviewer prompt should have been built');
    assert.ok(
      capturedPrompt.includes(customMission),
      `launched reviewer prompt must reference the --mission override path; got missionPath context absent`
    );
    // Must NOT fall back to the slug-derived standard location.
    assert.ok(
      !capturedPrompt.includes(missionPathForSlug(root, 'task-1272')),
      'override prompt must not also reference the slug-derived standard mission path'
    );
  });
});

// Negative control: absent --mission, the prompt uses the slug-derived path.
test('startReviewLoop uses the slug-derived mission path when --mission is absent', async () => {
  await withTempGitRepo(async (root) => {
    let capturedPrompt = null;
    const { opts } = standaloneOpts(root, {
      // no missionPath; use the REAL prompt builder for true substitution.
      buildCompactReviewPromptFn: undefined,
      startAgentFn: async (step, agentOpts) => {
        if (step === 'review' && typeof agentOpts.prompt === 'function') {
          capturedPrompt = agentOpts.prompt('codex');
        }
        return { agent: 'codex' };
      },
      consumeReviewerArtifactsFn: async () => ({ consumed: true, ok: true, reviewState: 'APPROVED' })
    });

    await startReviewLoop('task-1272', opts);

    assert.ok(capturedPrompt, 'reviewer prompt should have been built');
    assert.ok(
      capturedPrompt.includes(missionPathForSlug(root, 'task-1272')),
      'absent --mission must resolve the slug-derived standard mission path'
    );
  });
});

// SC1 + SC2: first reviewer round reaching APPROVED via artifacts, no Forgejo calls.
test('standalone review loop completes a first round to APPROVED with no Forgejo calls', async () => {
  await withTempGitRepo(async (root) => {
    const { opts, logs, errors, exitCodes, mocks } = standaloneOpts(root, {
      consumeReviewerArtifactsFn: async () => ({ consumed: true, ok: true, reviewState: 'APPROVED' })
    });

    await startReviewLoop('task-1272', opts);

    assert.deepEqual(exitCodes, [], `loop must not exit(1); errors=${errors.join(' | ')}`);
    assert.ok(logs.some(l => /reviewer approved/.test(l)), 'should stop on reviewer approval');
    assert.ok(
      logs.some(l => /Forgejo validation skipped/.test(l)),
      'should log that Forgejo validation was skipped'
    );
    assertNoForgejoApiCalls(mocks);
  });
});

// SC1 + SC4: full reviewer -> implementer -> reviewer cycle survives standalone.
test('standalone loop survives REQUEST_CHANGES -> CHANGES_MADE -> APPROVED across rounds', async () => {
  await withTempGitRepo(async (root) => {
    const reviewOutcomes = ['REQUEST_CHANGES', 'APPROVED'];
    let reviewIdx = 0;
    const { opts, errors, exitCodes, mocks } = standaloneOpts(root, {
      consumeReviewerArtifactsFn: async () => ({
        consumed: true, ok: true, reviewState: reviewOutcomes[reviewIdx++]
      }),
      consumeImplementerArtifactsFn: async () => ({
        consumed: true, ok: true, disposition: 'CHANGES_MADE'
      })
    });

    await startReviewLoop('task-1272', opts);

    assert.deepEqual(exitCodes, [], `multi-round loop must not exit(1); errors=${errors.join(' | ')}`);
    assert.equal(reviewIdx, 2, 'reviewer artifacts consumed across two rounds');
    assertNoForgejoApiCalls(mocks);
  });
});
