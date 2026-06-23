const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { verifyHandoff, performHandoff } = require('../lib/commands/handoff');
const { mock } = test;

const git = require('../lib/core/git');
const missionUtils = require('../lib/core/mission-utils');
const backlog = require('../lib/tools/backlog');
const forgejo = require('../lib/tools/forgejo');
const gatekeeper = require('../lib/tools/gatekeeper');

const TEST_SLUG = 'task-handoff-test';
const WORKTREE = '/tmp/handoff-test-worktree';

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
  mock.method(backlog, 'transitionTask', () => true);
  mock.method(forgejo, 'readToken', () => 'token');
  mock.method(forgejo, 'createPr', () => ({ ok: true }));
  mock.method(gatekeeper, 'runGatekeeper', () => ({ ok: true }));
  
  const missionDir = path.join(WORKTREE, 'docs/missions/2026', TEST_SLUG);
  fs.mkdirSync(missionDir, { recursive: true });
  // visualBoard's Ways of Working use Forgejo review (the code default is off
  // for config-less distribution repos), so the worktree declares it.
  fs.writeFileSync(path.join(WORKTREE, 'workflow.config.json'), JSON.stringify({
    adapters: { review: { provider: 'forgejo', baseUrl: 'http://localhost:3300', remote: 'review', repo: 'magnus/visualboard' } },
  }));
  fs.writeFileSync(path.join(missionDir, 'MISSION.md'), 'mission');
  fs.writeFileSync(path.join(missionDir, 'CP-1.md'), '## Goal Check\n\n| a | b | c |\n|---|---|---|\n| 1 | 2 | 3 |');
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
  mock.method(gatekeeper, 'runGatekeeper', () => ({ ok: false, posted: true, missing: ['A'] }));
  const result = await performHandoff(TEST_SLUG, { worktree: WORKTREE, skipGate: true, rebaseFn: mockRebase });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.gatekeeperPushedBack, true);
  cleanup();
});

test('performHandoff handles gatekeeper block', async (t) => {
  setupMocks();
  mock.method(gatekeeper, 'runGatekeeper', () => ({ ok: false, posted: false, skipped: false, missing: ['A'] }));
  const result = await performHandoff(TEST_SLUG, { worktree: WORKTREE, skipGate: true, error: () => {}, rebaseFn: mockRebase });
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /Gatekeeper detected missing artifacts/);
  cleanup();
});

test('performHandoff fails when forgejoUser is missing', async (t) => {
  setupMocks();
  mock.method(backlog, 'getTaskImplementer', () => null);
  const originalEnv = process.env.FORGEJO_USER;
  delete process.env.FORGEJO_USER;
  const result = await performHandoff(TEST_SLUG, { worktree: WORKTREE, skipGate: true, error: () => {}, rebaseFn: mockRebase });
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
  const result = await performHandoff(TEST_SLUG, { worktree: WORKTREE, error: () => {}, rebaseFn: mockRebase });
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /Final verification gate failed/);
  cleanup();
});

test('performHandoff fails when PR creation fails', async (t) => {
  setupMocks();
  mock.method(forgejo, 'createPr', () => ({ ok: false, error: 'API Error' }));
  const result = await performHandoff(TEST_SLUG, { worktree: WORKTREE, skipGate: true, error: () => {}, rebaseFn: mockRebase });
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /Forgejo PR creation\/update failed/);
  cleanup();
});

test('performHandoff fails when Backlog transition fails (assignee)', async (t) => {
  setupMocks();
  mock.method(backlog, 'transitionTask', () => false);
  const result = await performHandoff(TEST_SLUG, { worktree: WORKTREE, skipGate: true, error: () => {}, rebaseFn: mockRebase });
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /Could not transition task task-handoff-test to review/);
  cleanup();
});

test('performHandoff fails when Backlog transition fails (status)', async (t) => {
  setupMocks();
  mock.method(backlog, 'transitionTask', () => false);
  const result = await performHandoff(TEST_SLUG, { worktree: WORKTREE, skipGate: true, error: () => {}, rebaseFn: mockRebase });
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /Could not transition task task-handoff-test to review/);
  cleanup();
});

test('performHandoff fails when git add fails', async (t) => {
  setupMocks();
  // transitionTask now handles git add/commit, so we mock it to fail
  mock.method(backlog, 'transitionTask', () => false);
  const result = await performHandoff(TEST_SLUG, { worktree: WORKTREE, skipGate: true, error: () => {}, rebaseFn: mockRebase });
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /Could not transition task task-handoff-test to review/);
  cleanup();
});

test('performHandoff fails when git push fails', async (t) => {
  setupMocks();
  mock.method(git, 'git', (args) => args.includes('push') ? { status: 1 } : { status: 0 });
  mock.method(forgejo, 'authenticatedReviewUrl', () => 'url');
  const result = await performHandoff(TEST_SLUG, { worktree: WORKTREE, skipGate: true, error: () => {}, rebaseFn: mockRebase });
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /Failed to push Backlog transition/);
  cleanup();
});
