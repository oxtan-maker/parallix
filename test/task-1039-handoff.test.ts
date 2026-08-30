
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mockModule, installModuleMocks } from './lib/module-mock.js';
import { stubMissionServices } from './helpers/stub-mission-services.js';
const verifyHandoffModule = mockModule<typeof import('../src/adapters/cli/commands/handoff.js')>('../src/adapters/cli/commands/handoff.js', import.meta.url);
const git = mockModule<typeof import('../src/adapters/git/git.js')>('../src/adapters/git/git.js', import.meta.url);
const missionUtils = mockModule<typeof import('../src/adapters/filesystem/mission-utils.js')>('../src/adapters/filesystem/mission-utils.js', import.meta.url);
const backlog = mockModule<typeof import('../src/adapters/backlog/backlog.js')>('../src/adapters/backlog/backlog.js', import.meta.url);
const forgejo = mockModule<typeof import('../src/adapters/forgejo/forgejo.js')>('../src/adapters/forgejo/forgejo.js', import.meta.url);
const gatekeeper = mockModule<typeof import('../src/adapters/verification/gatekeeper.js')>('../src/adapters/verification/gatekeeper.js', import.meta.url);
const verification = mockModule<typeof import('../src/adapters/verification/verification.js')>('../src/adapters/verification/verification.js', import.meta.url);
const agents = mockModule<typeof import('../src/adapters/agents/agents.js')>('../src/adapters/agents/agents.js', import.meta.url);
const netEngineering = mockModule<typeof import('../src/adapters/git/net-engineering-lines.js')>('../src/adapters/git/net-engineering-lines.js', import.meta.url);
await installModuleMocks();
const { mock } = test;
const { verifyHandoff, performHandoff } = verifyHandoffModule;

const TEST_SLUG = 'task-handoff-test';
const WORKTREE = path.join(os.tmpdir(), `handoff-test-worktree-${process.pid}`);

function setupMocks() {
  mock.method(missionUtils, 'findMissionDir', () => path.join(WORKTREE, 'docs/missions/2026', TEST_SLUG));
  mock.method(missionUtils, 'findMissionArea', () => 'docs');
  mock.method(missionUtils, 'findCheckpoints', () => [path.join(WORKTREE, 'docs/missions/2026', TEST_SLUG, 'CP-1.md')]);
  mock.method(git, 'getCurrentBranch', () => 'mission/' + TEST_SLUG);
  mock.method(git, 'getWorktreeStatus', () => []);
  mock.method(git, 'run', () => ({ status: 0 }));
  mock.method(git, 'git', () => ({ status: 0 }));
  mock.method(backlog, 'resolveTaskFile', () => ({ ok: true, taskFile: '/tmp/task.md' }));
  mock.method(backlog, 'getTaskImplementer', () => 'claude');
  // Keep agent selection and branch probing in-memory: the real paths spawn
  // the shimmed git CLI (several subprocesses per handoff run).
  mock.method(missionUtils, 'getPrimaryBranch', () => 'main');
  mock.method(agents, 'eligibleAgentsForStep', () => ['codex', 'claude', 'gemini', 'custom']);
  mock.method(agents, 'selectAgent', (_step, options = {}) => {
    // @ts-ignore -- module mock callback options are inferred as an empty object
    const excluded = options.exclude instanceof Set ? options.exclude : new Set();
    return ['codex', 'claude', 'gemini'].find((candidate) => !excluded.has(candidate)) ?? 'codex';
  });
  // NEL capture diffs the real repository when left to the real runner.
  mock.method(netEngineering, 'computeNELRecord', () => ({ nel: 0, bucket: { label: 'Small' } }));
  mock.method(verification, 'createVerificationProofIdentity', () => 'test-proof-identity');
  mock.method(backlog, 'transitionTask', () => true);
  mock.method(forgejo, 'readToken', () => 'token');
  mock.method(forgejo, 'createPr', () => ({ ok: true }));
  mock.method(forgejo, 'resolveTrackingBranchSha', () => ({ ok: true, sha: 'fake-sha' }));
  mock.method(gatekeeper, 'runGatekeeper', () => ({ ok: true }));

  const missionDir = path.join(WORKTREE, 'docs/missions/2026', TEST_SLUG);
  fs.mkdirSync(missionDir, { recursive: true });
  // visualBoard's Ways of Working use Forgejo review (the code default is off
  // for config-less distribution repos), so the worktree declares it.
  fs.writeFileSync(path.join(WORKTREE, 'workflow.config.json'), JSON.stringify({
    adapters: { review: { provider: 'forgejo', baseUrl: 'http://localhost:3300', remote: 'review', repo: 'magnus/visualboard' } },
  }));
  fs.writeFileSync(path.join(missionDir, 'MISSION.md'), 'mission');
  fs.writeFileSync(path.join(missionDir, 'CP-1.md'), '## Goal Check\n\n| Criterion | Evidence | Status |\n|---|---|---|\n| handoff coverage | docs/missions/2026/task-handoff-test/MISSION.md:1 | PASS |');
}

const mockRebase = async () => ({ ok: true, sharedFileConflicts: false });

function cleanup() {
  fs.rmSync(WORKTREE, { recursive: true, force: true });
  mock.reset();
}

test('verifyHandoff fails when not on mission branch', (t) => {
  setupMocks();
  mock.method(git, 'getCurrentBranch', () => 'main');
  const result = verifyHandoff(TEST_SLUG, { worktree: WORKTREE });
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /Not on mission branch/);
  cleanup();
});

test('performHandoff handles gatekeeper pushback', async (t) => {
  setupMocks();
  let gkCallCount = 0;
  const mockGK = () => {
    gkCallCount++;
    if (gkCallCount === 1) {
      return { ok: false, posted: true, missing: ['A'] };
    }
    return { ok: true, missing: [] };
  };
  // Mock the launch port so the kernel's verify re-runs the handoff
  const mockStartAgent = async () => ({ agent: 'custom', result: { status: 0 } });
  const unexpectedVerification = () => {
    throw new Error('skipGate must survive the remediation retry');
  };
  const result = await performHandoff(TEST_SLUG, {
    worktree: WORKTREE,
    skipGate: true,
    rebaseFn: mockRebase,
    startAgentFn: mockStartAgent,
    runGatekeeperFn: mockGK,
    runVerificationGateFn: unexpectedVerification,
    missionServicesFn: stubMissionServices(),
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.gatekeeperPushedBack, true);
  cleanup();
});

test('performHandoff handles gatekeeper block', async (t) => {
  setupMocks();
  mock.method(gatekeeper, 'runGatekeeper', () => ({ ok: false, posted: false, skipped: false, missing: ['A'] }));
  const result = await performHandoff(TEST_SLUG, { worktree: WORKTREE, skipGate: true, error: () => {}, rebaseFn: mockRebase, missionServicesFn: stubMissionServices() });
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /Gatekeeper detected missing artifacts/);
  cleanup();
});

test('performHandoff fails when forgejoUser is missing', async (t) => {
  setupMocks();
  mock.method(backlog, 'getTaskImplementer', () => null);
  const originalEnv = process.env.FORGEJO_USER;
  delete process.env.FORGEJO_USER;
  const result = await performHandoff(TEST_SLUG, { worktree: WORKTREE, skipGate: true, error: () => {}, rebaseFn: mockRebase, missionServicesFn: stubMissionServices() });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error, 'forgejoUser is required');
  process.env.FORGEJO_USER = originalEnv;
  cleanup();
});

test('performHandoff fails when final verification gate fails', async (t) => {
  setupMocks();
  // Configure a gate so it actually runs; the default is no validation.
  fs.writeFileSync(
    path.join(WORKTREE, 'workflow.config.json'),
    JSON.stringify({ adapters: { verification: { command: 'npm test' } } })
  );
  mock.method(git, 'run', () => ({ status: 1 }));
  const result = await performHandoff(TEST_SLUG, { worktree: WORKTREE, error: () => {}, rebaseFn: mockRebase, missionServicesFn: stubMissionServices() });
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /Final verification gate failed/);
  cleanup();
});

test('performHandoff fails when PR creation fails', async (t) => {
  setupMocks();
  mock.method(forgejo, 'createPr', () => ({ ok: false, error: 'API Error' }));
  const result = await performHandoff(TEST_SLUG, { worktree: WORKTREE, skipGate: true, error: () => {}, rebaseFn: mockRebase, missionServicesFn: stubMissionServices() });
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /Forgejo PR creation\/update failed/);
  cleanup();
});

test('performHandoff fails when Backlog transition fails (assignee)', async (t) => {
  setupMocks();
  mock.method(backlog, 'transitionTask', () => false);
  const result = await performHandoff(TEST_SLUG, { worktree: WORKTREE, skipGate: true, error: () => {}, rebaseFn: mockRebase, missionServicesFn: stubMissionServices() });
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /Could not transition task task-handoff-test to review/);
  cleanup();
});

test('performHandoff fails when Backlog transition fails (status)', async (t) => {
  setupMocks();
  mock.method(backlog, 'transitionTask', () => false);
  const result = await performHandoff(TEST_SLUG, { worktree: WORKTREE, skipGate: true, error: () => {}, rebaseFn: mockRebase, missionServicesFn: stubMissionServices() });
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /Could not transition task task-handoff-test to review/);
  cleanup();
});

test('performHandoff fails when git add fails', async (t) => {
  setupMocks();
  // transitionTask now handles git add/commit, so we mock it to fail
  mock.method(backlog, 'transitionTask', () => false);
  const result = await performHandoff(TEST_SLUG, { worktree: WORKTREE, skipGate: true, error: () => {}, rebaseFn: mockRebase, missionServicesFn: stubMissionServices() });
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /Could not transition task task-handoff-test to review/);
  cleanup();
});

test('performHandoff fails when git push fails', async (t) => {
  setupMocks();
  mock.method(git, 'git', (args) => args.includes('push') ? { status: 1, stderr: 'fatal: Unable to create .git/index.lock: No space left on device' } : { status: 0 });
  mock.method(forgejo, 'authenticatedReviewUrl', () => 'url');
  const result = await performHandoff(TEST_SLUG, { worktree: WORKTREE, skipGate: true, error: () => {}, rebaseFn: mockRebase, missionServicesFn: stubMissionServices() });
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /Failed to push Backlog transition/);
  assert.match(result.error, /Unable to create .git\/index\.lock: No space left on device/);
  cleanup();
});
