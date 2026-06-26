const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { getPrStatus, getPrNumber, getPrAuthor, getLatestReviewDecision, syncMerged, createPr, forgejoAvailable, postReview, resolveForgejoUser, getComments, postComment, resolveForgejoHome, isForgejoPath, fetchReviewBranch } = require('../lib/tools/forgejo.js');
const git = require('../lib/core/git.js');
const backlog = require('../lib/tools/backlog.js');
const missionUtils = require('../lib/core/mission-utils.js');
const verification = require('../lib/core/verification');
const { mock } = test;

mock.method(verification, 'captureVerifiedTreeProof', (area, rootDir) => ({
  ok: true,
  proof: {
    rootDir: path.resolve(rootDir),
    area,
    command: 'mock-verification',
    commit: 'abc123',
    tree: 'tree123',
    verifiedAt: '2026-01-01T00:00:00.000Z'
  }
}));
mock.method(verification, 'assertVerifiedTreeProof', (proof, rootDir) => {
  const resolvedRoot = path.resolve(rootDir);
  if (!proof || proof.rootDir !== resolvedRoot) {
    return { ok: false, error: 'verification proof does not match the tree being published' };
  }
  return { ok: true, proof };
});

test('authenticatedReviewUrl uses the configured standalone review repo', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forgejo-config-url-'));
  try {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
      product: { name: 'Test Project' },
      adapters: {
        tasks: { provider: 'backlog-md', storage: 'backlog' },
        missions: { baseDir: 'docs/missions', branchPrefix: 'mission/', primaryBranch: 'main', worktreePattern: '../<repo>-<slug>' },
        verification: { command: 'npm test' },
        review: { provider: 'forgejo', baseUrl: 'http://localhost:3300', remote: 'review', repo: 'magnus/testproj' },
        agents: { commandEnvPrefix: 'AUTONOMOUS_REVIEW_' },
      },
    }, null, 2), 'utf8');

    const { authenticatedReviewUrl } = require('../lib/tools/forgejo.js');
    assert.equal(
      authenticatedReviewUrl('claude', 'token-123', root),
      'http://claude:token-123@localhost:3300/magnus/testproj.git'
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('createPr uses configured primaryBranch and configured Forgejo repo', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forgejo-config-pr-'));
  try {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
      product: { name: 'Test Project' },
      adapters: {
        tasks: { provider: 'backlog-md', storage: 'backlog' },
        missions: { baseDir: 'docs/missions', branchPrefix: 'mission/', primaryBranch: 'main', worktreePattern: '../<repo>-<slug>' },
        verification: { command: 'npm test' },
        review: { provider: 'forgejo', baseUrl: 'http://localhost:3300', remote: 'review', repo: 'magnus/testproj' },
        agents: { commandEnvPrefix: 'AUTONOMOUS_REVIEW_' },
      },
    }, null, 2), 'utf8');

    const gitCalls = [];
    mock.method(git, 'git', (args) => {
      gitCalls.push(args);
      if (args.includes('show-ref')) return { status: 0, stdout: '', stderr: '' };
      if (args.includes('push')) return { status: 0, stdout: '', stderr: '' };
      if (args.includes('rev-parse')) return { status: 0, stdout: 'abc123\n', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    });

    const apiCalls = [];
    const apiCall = mock.fn((method, apiPath, token, body, options = {}) => {
      apiCalls.push({ method, apiPath, token, body, options });
      if (method === 'GET' && apiPath.includes('/pulls?state=open')) return { ok: true, data: [] };
      if (method === 'GET' && apiPath.includes('/pulls?state=all')) return { ok: true, data: [] };
      if (method === 'POST' && apiPath === '/pulls') {
        return { ok: true, data: { html_url: 'http://localhost:3300/magnus/testproj/pulls/1', number: 1 } };
      }
      return { ok: false, data: null };
    });

    const result = createPr('mission/task-200', 'claude', 'token-123', { rootDir: root, apiCall, log: () => {}, forceWithLease: true });
    assert.equal(result.ok, true);
    assert.ok(gitCalls.some(args => args.includes('http://claude:token-123@localhost:3300/magnus/testproj.git')));
    assert.ok(apiCalls.some(call => call.method === 'POST' && call.body && call.body.base === 'main'));
    assert.ok(apiCalls.every(call => call.options.rootDir === root));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('createPr rejects a verification proof from a different checkout before syncing primary baseline', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forgejo-proof-mismatch-'));
  try {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
      product: { name: 'Test Project' },
      adapters: {
        tasks: { provider: 'backlog-md', storage: 'backlog' },
        missions: { baseDir: 'docs/missions', branchPrefix: 'mission/', primaryBranch: 'main', worktreePattern: '../<repo>-<slug>' },
        verification: { command: 'npm test' },
        review: { provider: 'forgejo', baseUrl: 'http://localhost:3300', remote: 'review', repo: 'magnus/testproj' },
        agents: { commandEnvPrefix: 'AUTONOMOUS_REVIEW_' },
      },
    }, null, 2), 'utf8');

    mock.method(git, 'git', (args) => {
      if (args.includes('show-ref')) return { status: 0, stdout: '', stderr: '' };
      if (args.includes('push')) throw new Error('push should not run when proof is stale');
      if (args.includes('rev-parse')) return { status: 0, stdout: 'abc123\n', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    });

    const apiCall = mock.fn((method, apiPath) => {
      if (method === 'GET' && apiPath.includes('/pulls?state=open')) return { ok: true, data: [] };
      if (method === 'GET' && apiPath.includes('/pulls?state=all')) return { ok: true, data: [] };
      return { ok: false, data: null };
    });

    const result = createPr('mission/task-200', 'claude', 'token-123', {
      rootDir: root,
      apiCall,
      log: () => {},
      captureVerifiedTreeProofFn: () => ({
        ok: true,
        proof: {
          rootDir: path.resolve('/tmp/different-checkout'),
          area: 'integrate',
          command: 'mock-verification',
          commit: 'stale-commit',
          tree: 'stale-tree',
          verifiedAt: '2026-01-01T00:00:00.000Z'
        }
      })
    });

    assert.equal(result.ok, false);
    assert.match(result.error, /verification proof/i);
    assert.match(result.error, /tree being published/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('standalone createPr refuses to publish when the configured verification gate fails', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forgejo-proof-failed-gate-'));
  try {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
      product: { name: 'Test Project' },
      adapters: {
        tasks: { provider: 'backlog-md', storage: 'backlog' },
        missions: { baseDir: 'docs/missions', branchPrefix: 'mission/', primaryBranch: 'main', worktreePattern: '../<repo>-<slug>' },
        verification: { command: 'npm test' },
        review: { provider: 'forgejo', baseUrl: 'http://localhost:3300', remote: 'review', repo: 'magnus/testproj' },
        agents: { commandEnvPrefix: 'AUTONOMOUS_REVIEW_' },
      },
    }, null, 2), 'utf8');

    const gitCalls = [];
    mock.method(git, 'git', (args) => {
      gitCalls.push(args);
      if (args.includes('push')) {
        throw new Error('push should not run when verification gate fails');
      }
      return { status: 0, stdout: '', stderr: '' };
    });

    const apiCall = mock.fn(() => {
      throw new Error('Forgejo API should not be called when verification gate fails');
    });

    const result = createPr('mission/task-200', 'claude', 'token-123', {
      rootDir: root,
      apiCall,
      log: () => {},
      captureVerifiedTreeProofFn: () => ({
        ok: false,
        error: 'verification gate failed for /tmp/fake-root with exit code 1'
      })
    });

    assert.equal(result.ok, false);
    assert.match(result.error, /verification gate failed/i);
    assert.equal(apiCall.mock.calls.length, 0);
    assert.equal(gitCalls.some(args => args.includes('push')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('createPr uses the implementer token for PR APIs and the repo-owner token for git sync when available', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forgejo-owner-api-'));
  const previousHome = process.env.FORGEJO_HOME;
  try {
    fs.mkdirSync(path.join(root, '.forgejo-local', 'tokens'), { recursive: true });
    fs.writeFileSync(path.join(root, '.forgejo-local', 'tokens', 'magnus'), 'owner-token\n', 'utf8');
    fs.writeFileSync(path.join(root, '.forgejo-local', 'tokens', 'claude'), 'reviewer-token\n', 'utf8');
    process.env.FORGEJO_HOME = path.join(root, '.forgejo-local');
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
      product: { name: 'Test Project' },
      adapters: {
        tasks: { provider: 'backlog-md', storage: 'backlog' },
        missions: { baseDir: 'docs/missions', branchPrefix: 'mission/', primaryBranch: 'main', worktreePattern: '../<repo>-<slug>' },
        verification: { command: 'npm test' },
        review: { provider: 'forgejo', baseUrl: 'http://localhost:3300', remote: 'review', repo: 'magnus/testproj' },
        agents: { commandEnvPrefix: 'AUTONOMOUS_REVIEW_' },
      },
    }, null, 2), 'utf8');

    const gitCalls = [];
    mock.method(git, 'git', (args) => {
      gitCalls.push(args);
      if (args.includes('show-ref')) return { status: 0, stdout: '', stderr: '' };
      if (args.includes('push')) return { status: 0, stdout: '', stderr: '' };
      if (args.includes('rev-parse')) return { status: 0, stdout: 'abc123\n', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    });

    const apiCalls = [];
    const apiCall = mock.fn((method, apiPath, token, body, options = {}) => {
      apiCalls.push({ method, apiPath, token, body, options });
      if (token === 'reviewer-token' && method === 'GET' && apiPath.includes('/pulls?state=open')) return { ok: true, data: [] };
      if (token === 'reviewer-token' && method === 'GET' && apiPath.includes('/pulls?state=all')) return { ok: true, data: [] };
      if (token === 'reviewer-token' && method === 'POST' && apiPath === '/pulls') {
        return { ok: true, data: { html_url: 'http://localhost:3300/magnus/testproj/pulls/9', number: 9 } };
      }
      return { ok: false, data: { message: 'The target could not be found.' }, statusCode: 404 };
    });

    const result = createPr('mission/task-200', 'claude', 'reviewer-token', { rootDir: root, apiCall, log: () => {}, forceWithLease: true });
    assert.equal(result.ok, true);
    assert.ok(apiCalls.some(call => call.token === 'reviewer-token' && call.method === 'GET' && call.apiPath.includes('/pulls?state=open')));
    assert.ok(apiCalls.some(call => call.token === 'reviewer-token' && call.method === 'POST' && call.apiPath === '/pulls'));
    assert.ok(gitCalls.some(args => args.includes('http://magnus:owner-token@localhost:3300/magnus/testproj.git')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    if (previousHome === undefined) delete process.env.FORGEJO_HOME;
    else process.env.FORGEJO_HOME = previousHome;
  }
});

test('createPr falls back to the repo-owner token for PR lookup when the implementer token cannot read PRs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forgejo-owner-lookup-'));
  const previousHome = process.env.FORGEJO_HOME;
  try {
    fs.mkdirSync(path.join(root, '.forgejo-local', 'tokens'), { recursive: true });
    fs.writeFileSync(path.join(root, '.forgejo-local', 'tokens', 'magnus'), 'owner-token\n', 'utf8');
    fs.writeFileSync(path.join(root, '.forgejo-local', 'tokens', 'claude'), 'reviewer-token\n', 'utf8');
    process.env.FORGEJO_HOME = path.join(root, '.forgejo-local');
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
      product: { name: 'Test Project' },
      adapters: {
        tasks: { provider: 'backlog-md', storage: 'backlog' },
        missions: { baseDir: 'docs/missions', branchPrefix: 'mission/', primaryBranch: 'main', worktreePattern: '../<repo>-<slug>' },
        verification: { command: 'npm test' },
        review: { provider: 'forgejo', baseUrl: 'http://localhost:3300', remote: 'review', repo: 'magnus/testproj' },
        agents: { commandEnvPrefix: 'AUTONOMOUS_REVIEW_' },
      },
    }, null, 2), 'utf8');

    mock.method(git, 'git', (args) => {
      if (args.includes('show-ref')) return { status: 0, stdout: '', stderr: '' };
      if (args.includes('push')) return { status: 0, stdout: '', stderr: '' };
      if (args.includes('rev-parse')) return { status: 0, stdout: 'abc123\n', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    });

    const apiCalls = [];
    const apiCall = mock.fn((method, apiPath, token, body, options = {}) => {
      apiCalls.push({ method, apiPath, token, body, options });
      if (token === 'reviewer-token') {
        return { ok: false, data: { message: 'permission denied' }, statusCode: 403 };
      }
      if (token === 'owner-token' && method === 'GET' && apiPath.includes('/pulls?state=open')) return { ok: true, data: [{ number: 9, head: { ref: 'mission/task-200' } }] };
      if (token === 'owner-token' && method === 'GET' && apiPath === '/pulls/9') return { ok: true, data: { html_url: 'http://localhost:3300/magnus/testproj/pulls/9', number: 9 } };
      return { ok: false, data: { message: 'unexpected' }, statusCode: 404 };
    });

    const result = createPr('mission/task-200', 'claude', 'reviewer-token', { rootDir: root, apiCall, log: () => {}, forceWithLease: true });
    assert.equal(result.ok, true);
    assert.equal(result.prNumber, 9);
    assert.ok(apiCalls.some(call => call.token === 'reviewer-token' && call.method === 'GET' && call.apiPath.includes('/pulls?state=open')));
    assert.ok(apiCalls.some(call => call.token === 'owner-token' && call.method === 'GET' && call.apiPath.includes('/pulls?state=open')));
    assert.ok(!apiCalls.some(call => call.token === 'reviewer-token' && call.method === 'POST' && call.apiPath === '/pulls'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    if (previousHome === undefined) delete process.env.FORGEJO_HOME;
    else process.env.FORGEJO_HOME = previousHome;
  }
});

test('createPr always calls syncPrimaryBaseline even when PR already exists', (t) => {
  const branch = 'mission/task-098';
  const user = 'gemini';
  const token = 'fake-token';
  const rootDir = '/tmp/fake-root';

  let syncCalled = false;
  // Mocking
  mock.method(git, 'git', (args) => {
    if (args.includes('branch') && args.includes('--list')) return { status: 0, stdout: 'main\n' };
    if (args.includes('push') && args.some(a => a.includes('main:main'))) {
      syncCalled = true;
    }
    return { status: 0, stdout: '' };
  });

  const apiCall = mock.fn((method, apiPath) => {
    if (method === 'GET' && apiPath.includes('/pulls?state=open')) {
      return {
        ok: true,
        data: [{ number: 32, head: { ref: branch }, html_url: 'http://pr/32' }]
      };
    }
    if (method === 'GET' && apiPath === '/pulls/32') {
      return { ok: true, data: { html_url: 'http://pr/32' } };
    }
    return { ok: false };
  });

  const result = createPr(branch, user, token, { rootDir, apiCall, log: () => {} });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.prNumber, 32);
  assert.strictEqual(syncCalled, true, 'syncPrimaryBaseline should be called');
});

test('createPr calls syncPrimaryBaseline when PR does not exist', (t) => {
  const branch = 'mission/task-099';
  const user = 'gemini';
  const token = 'fake-token';
  const rootDir = '/tmp/fake-root';

  let syncCalled = false;
  // Mocking
  mock.method(git, 'git', (args) => {
    if (args.includes('branch') && args.includes('--list')) return { status: 0, stdout: 'main\n' };
    if (args.includes('push') && args.some(a => a.includes('main:main'))) {
      syncCalled = true;
    }
    return { status: 0, stdout: '' };
  });

  const apiCall = mock.fn((method, apiPath) => {
    if (method === 'GET' && apiPath.includes('/pulls?state=open')) {
      return { ok: true, data: [] };
    }
    if (method === 'GET' && apiPath.includes('/pulls?state=all')) {
      return { ok: true, data: [] };
    }
    if (method === 'POST' && apiPath === '/pulls') {
      return { ok: true, data: { html_url: 'http://pr/33', number: 33 } };
    }
    return { ok: false };
  });

  const result = createPr(branch, user, token, { rootDir, apiCall, log: () => {} });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.prNumber, 33);
  assert.strictEqual(syncCalled, true);
});

test('createPr uses --force-with-lease flag when force: true is specified', (t) => {
  const branch = 'mission/task-100';
  const user = 'gemini';
  const token = 'fake-token';
  const rootDir = '/tmp/fake-root';

  let forceFlagUsed = false;
  // Mocking
  mock.method(git, 'git', (args) => {
    if (args.includes('branch') && args.includes('--list')) return { status: 0, stdout: 'main\n' };
    if (args.includes('push') && args.includes('--force-with-lease') && args.includes(branch)) {
      forceFlagUsed = true;
    }
    return { status: 0, stdout: '' };
  });

  const apiCall = mock.fn((method, apiPath) => {
    if (method === 'GET' && apiPath.includes('/pulls?state=open')) {
      return { ok: true, data: [{ number: 100, head: { ref: branch } }] };
    }
    if (method === 'GET' && apiPath === '/pulls/100') {
      return { ok: true, data: { html_url: 'http://pr/100' } };
    }
    return { ok: false };
  });

  const result = createPr(branch, user, token, { rootDir, apiCall, log: () => {}, force: true });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(forceFlagUsed, true, 'git push should include --force-with-lease flag');
});

test('createPr uses explicit force-with-lease sha when forceWithLease is true', (t) => {
  const branch = 'mission/task-100a';
  const user = 'gemini';
  const token = 'fake-token';
  const rootDir = '/tmp/fake-root';

  let pushArgs = [];
  mock.method(git, 'git', (args) => {
    if (args.includes('branch') && args.includes('--list')) return { status: 0, stdout: 'main\n' };
    if (args.includes('rev-parse') && args.includes(`refs/remotes/review/${branch}^{commit}`)) {
      return { status: 0, stdout: 'abc123\n', stderr: '' };
    }
    if (args.includes('push') && args.includes(branch)) {
      pushArgs = args;
    }
    return { status: 0, stdout: '', stderr: '' };
  });

  const apiCall = mock.fn((method, apiPath) => {
    if (method === 'GET' && apiPath.includes('/pulls?state=open')) return { ok: true, data: [] };
    if (method === 'GET' && apiPath.includes('/pulls?state=all')) return { ok: true, data: [] };
    if (method === 'POST' && apiPath === '/pulls') {
      return { ok: true, data: { html_url: 'http://pr/100a', number: 100 } };
    }
    return { ok: false };
  });

  const result = createPr(branch, user, token, { rootDir, apiCall, log: () => {}, forceWithLease: true });
  assert.strictEqual(result.ok, true);
  assert.ok(
    pushArgs.includes(`--force-with-lease=refs/heads/${branch}:abc123`),
    'git push should include an explicit force-with-lease sha'
  );
});

test('createPr falls back to origin tracking sha when review ref is unavailable', (t) => {
  const branch = 'mission/task-100b';
  const user = 'gemini';
  const token = 'fake-token';
  const rootDir = '/tmp/fake-root';

  let pushArgs = [];
  mock.method(git, 'git', (args) => {
    if (args.includes('branch') && args.includes('--list')) return { status: 0, stdout: 'main\n' };
    if (args.includes('rev-parse') && args.includes(`refs/remotes/review/${branch}^{commit}`)) {
      return { status: 128, stdout: '', stderr: 'unknown revision' };
    }
    if (args.includes('rev-parse') && args.includes(`refs/remotes/origin/${branch}^{commit}`)) {
      return { status: 0, stdout: 'originsha\n', stderr: '' };
    }
    if (args.includes('push') && args.includes(branch)) {
      pushArgs = args;
    }
    return { status: 0, stdout: '', stderr: '' };
  });

  const apiCall = mock.fn((method, apiPath) => {
    if (method === 'GET' && apiPath.includes('/pulls?state=open')) return { ok: true, data: [] };
    if (method === 'GET' && apiPath.includes('/pulls?state=all')) return { ok: true, data: [] };
    if (method === 'POST' && apiPath === '/pulls') {
      return { ok: true, data: { html_url: 'http://pr/100b', number: 100 } };
    }
    return { ok: false };
  });

  const result = createPr(branch, user, token, { rootDir, apiCall, log: () => {}, forceWithLease: true });
  assert.strictEqual(result.ok, true);
  assert.ok(
    pushArgs.includes(`--force-with-lease=refs/heads/${branch}:originsha`),
    'git push should use the origin tracking sha when review is unavailable'
  );
});

test('createPr uses a plain push when the branch is absent from the review remote', (t) => {
  const branch = 'mission/task-999';
  const user = 'claude';
  const token = 'fake-token';
  const rootDir = '/tmp/fake-root';

  let pushArgs = null;
  mock.method(git, 'git', (args) => {
    if (args.includes('branch') && args.includes('--list')) return { status: 0, stdout: 'main\n' };
    // First push: the mission branch does not exist on the review remote yet.
    if (args.includes('fetch') && args.some(a => typeof a === 'string' && a.includes(`+refs/heads/${branch}:`))) {
      return { status: 128, stdout: '', stderr: `fatal: could not find remote ref refs/heads/${branch}` };
    }
    // No tracking ref resolvable (neither review nor origin).
    if (args.includes('rev-parse') && args.some(a => typeof a === 'string' && a.includes(`refs/remotes/review/${branch}`))) {
      return { status: 128, stdout: '', stderr: 'unknown revision' };
    }
    if (args.includes('rev-parse') && args.some(a => typeof a === 'string' && a.includes(`refs/remotes/origin/${branch}`))) {
      return { status: 128, stdout: '', stderr: 'unknown revision' };
    }
    if (args.includes('push') && args.includes(branch)) {
      pushArgs = args;
      return { status: 0, stdout: '', stderr: '' };
    }
    return { status: 0, stdout: '', stderr: '' };
  });

  const apiCall = mock.fn((method, apiPath) => {
    if (method === 'GET' && apiPath.includes('/pulls?state=open')) return { ok: true, data: [] };
    if (method === 'GET' && apiPath.includes('/pulls?state=all')) return { ok: true, data: [] };
    if (method === 'POST' && apiPath === '/pulls') {
      return { ok: true, data: { html_url: 'http://pr/999', number: 999 } };
    }
    return { ok: false };
  });

  const result = createPr(branch, user, token, { rootDir, apiCall, log: () => {}, forceWithLease: true });
  assert.strictEqual(result.ok, true);
  assert.ok(pushArgs, 'a git push should be attempted');
  assert.ok(pushArgs.includes(branch), 'push should target the mission branch');
  assert.ok(
    !pushArgs.some(a => typeof a === 'string' && a.startsWith('--force-with-lease')),
    'first push of a new branch must not use --force-with-lease'
  );
});

test('createPr aborts without pushing when the tracking-ref fetch fails for a non-not-found reason', (t) => {
  const branch = 'mission/task-999';
  const user = 'claude';
  const token = 'fake-token';
  const rootDir = '/tmp/fake-root';

  let pushAttempted = false;
  mock.method(git, 'git', (args) => {
    if (args.includes('branch') && args.includes('--list')) return { status: 0, stdout: 'main\n' };
    // Mission-branch fetch fails for an auth reason, not a missing ref.
    if (args.includes('fetch') && args.some(a => typeof a === 'string' && a.includes(`+refs/heads/${branch}:`))) {
      return { status: 128, stdout: '', stderr: 'fatal: Authentication failed for review remote' };
    }
    if (args.includes('rev-parse') && args.some(a => typeof a === 'string' && a.includes(`refs/remotes/review/${branch}`))) {
      return { status: 128, stdout: '', stderr: 'unknown revision' };
    }
    if (args.includes('rev-parse') && args.some(a => typeof a === 'string' && a.includes(`refs/remotes/origin/${branch}`))) {
      return { status: 128, stdout: '', stderr: 'unknown revision' };
    }
    if (args.includes('push') && args.includes(branch)) {
      pushAttempted = true;
      return { status: 0, stdout: '', stderr: '' };
    }
    return { status: 0, stdout: '', stderr: '' };
  });

  const apiCall = mock.fn(() => ({ ok: false }));

  const result = createPr(branch, user, token, { rootDir, apiCall, log: () => {}, forceWithLease: true });
  assert.strictEqual(result.ok, false);
  assert.ok(result.error && /fetch tracking ref/.test(result.error), 'error should explain the failed tracking-ref fetch');
  assert.strictEqual(pushAttempted, false, 'a non-not-found fetch failure must abort before pushing');
});

test('getPrStatus returns PR details when PR exists', () => {
  const apiCall = mock.fn((method, apiPath) => {
    if (method === 'GET' && apiPath.includes('/pulls?state=all')) {
      return { ok: true, data: [{ number: 41, head: { ref: 'mission/task-081' } }] };
    }
    if (method === 'GET' && apiPath === '/pulls/41') {
      return {
        ok: true,
        data: {
          number: 41,
          title: 'Mission task-081',
          state: 'open',
          merged: false,
          html_url: 'http://localhost:3300/example'
        }
      };
    }
    return { ok: false };
  });

  const pr = getPrStatus('mission/task-081', '/tmp', { token: 'fake-token', apiCall });
  assert.equal(pr.exists, true);
  assert.equal(pr.number, 41);
  assert.equal(pr.state, 'open');
  assert.equal(pr.merged, false);
});

test('getComments returns null when the comment APIs fail', async () => {
  const logs = [];
  const apiCall = mock.fn((method, apiPath) => {
    if (method === 'GET' && apiPath.includes('/pulls?state=open')) {
      return { ok: true, data: [{ number: 121, head: { ref: 'mission/task-121' } }] };
    }
    if (method === 'GET' && apiPath === '/issues/121/comments') {
      return { ok: false, data: null };
    }
    if (method === 'GET' && apiPath === '/pulls/121/reviews') {
      return { ok: true, data: [] };
    }
    return { ok: false, data: null };
  });

  const comments = await getComments('mission/task-121', 'fake-token', {
    apiCall,
    log: message => logs.push(message)
  });

  assert.equal(comments, null);
  const failureLog = logs.find(message => message.includes('getComments API failure'));
  assert.strictEqual(failureLog, 'getComments API failure: issueCommentsRes.ok=false, reviewsRes.ok=true');
});

test('getComments failure path works with the production default logger', async () => {
  const apiCall = mock.fn((method, apiPath) => {
    if (method === 'GET' && apiPath.includes('/pulls?state=open')) {
      return { ok: true, data: [{ number: 121, head: { ref: 'mission/task-121' } }] };
    }
    if (method === 'GET' && apiPath === '/issues/121/comments') {
      return { ok: false, data: null };
    }
    if (method === 'GET' && apiPath === '/pulls/121/reviews') {
      return { ok: true, data: [] };
    }
    return { ok: false, data: null };
  });

  const comments = await getComments('mission/task-121', 'fake-token', { apiCall });

  assert.equal(comments, null);
});

test('getComments keeps using the fallback token after PR lookup succeeds', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'forgejo-comments-fallback-'));
  const previousUser = process.env.FORGEJO_USER;
  const previousHome = process.env.FORGEJO_HOME;
  process.env.FORGEJO_USER = 'codex';
  process.env.FORGEJO_HOME = tmpRoot;
  fs.mkdirSync(path.join(tmpRoot, 'tokens'), { recursive: true });
  fs.writeFileSync(path.join(tmpRoot, 'tokens', 'custom'), 'custom-token\n', 'utf8');

  const taskFile = path.join(process.cwd(), 'backlog', 'tasks', 'task-204 - comments fallback test.md');
  fs.mkdirSync(path.dirname(taskFile), { recursive: true });
  fs.writeFileSync(taskFile, `---
id: TASK-204
title: test
status: review
assignee: [custom]
---
`, 'utf8');

  try {
    const calls = [];
    const comments = await getComments('mission/task-204', 'codex-token', {
      apiCall(method, apiPath, token) {
        calls.push({ method, apiPath, token });
        if (method === 'GET' && apiPath.includes('/pulls?state=open')) {
          if (token === 'codex-token') return { ok: true, data: [], status: 0 };
          if (token === 'custom-token') {
            return { ok: true, data: [{ number: 204, head: { ref: 'mission/task-204' } }], status: 0 };
          }
        }
        if (method === 'GET' && apiPath === '/issues/204/comments') {
          if (token !== 'custom-token') return { ok: false, data: null, status: 401 };
          return {
            ok: true,
            data: [{ user: { login: 'custom' }, created_at: '2026-05-22T10:00:00Z', body: 'resolved' }],
            status: 0
          };
        }
        if (method === 'GET' && apiPath === '/pulls/204/reviews') {
          if (token !== 'custom-token') return { ok: false, data: null, status: 401 };
          return { ok: true, data: [], status: 0 };
        }
        return { ok: false, data: null, status: 404 };
      }
    });

    assert.equal(comments.length, 1);
    assert.equal(comments[0].user, 'custom');
    assert.ok(calls.some(call => call.apiPath === '/issues/204/comments' && call.token === 'custom-token'));
    assert.ok(calls.some(call => call.apiPath === '/pulls/204/reviews' && call.token === 'custom-token'));
  } finally {
    fs.rmSync(taskFile, { force: true });
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    if (previousUser === undefined) delete process.env.FORGEJO_USER;
    else process.env.FORGEJO_USER = previousUser;
    if (previousHome === undefined) delete process.env.FORGEJO_HOME;
    else process.env.FORGEJO_HOME = previousHome;
  }
});

test('resolveForgejoUser defaults to human when FORGEJO_USER is unset', () => {
  const previous = process.env.FORGEJO_USER;
  delete process.env.FORGEJO_USER;
  try {
    assert.equal(resolveForgejoUser(), 'human');
    assert.equal(resolveForgejoUser('codex'), 'codex');
  } finally {
    if (previous === undefined) delete process.env.FORGEJO_USER;
    else process.env.FORGEJO_USER = previous;
  }
});

test('getLatestReviewDecision keeps using the fallback token after PR lookup succeeds', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'forgejo-review-fallback-'));
  const previousUser = process.env.FORGEJO_USER;
  const previousHome = process.env.FORGEJO_HOME;
  process.env.FORGEJO_USER = 'codex';
  process.env.FORGEJO_HOME = tmpRoot;
  fs.mkdirSync(path.join(tmpRoot, 'tokens'), { recursive: true });
  fs.writeFileSync(path.join(tmpRoot, 'tokens', 'custom'), 'custom-token\n', 'utf8');

  const taskFile = path.join(process.cwd(), 'backlog', 'tasks', 'task-205 - review fallback test.md');
  fs.mkdirSync(path.dirname(taskFile), { recursive: true });
  fs.writeFileSync(taskFile, `---
id: TASK-205
title: test
status: review
assignee: [custom]
---
`, 'utf8');

  try {
    const calls = [];
    const decision = getLatestReviewDecision('mission/task-205', {
      token: 'codex-token',
      apiCall(method, apiPath, token) {
        calls.push({ method, apiPath, token });
        if (method === 'GET' && apiPath.includes('/pulls?state=open')) {
          if (token === 'codex-token') return { ok: true, data: [], status: 0 };
          if (token === 'custom-token') {
            return { ok: true, data: [{ number: 205, head: { ref: 'mission/task-205' } }], status: 0 };
          }
        }
        if (method === 'GET' && apiPath === '/pulls/205/reviews') {
          if (token !== 'custom-token') return { ok: false, data: null, status: 401 };
          return {
            ok: true,
            data: [{ state: 'APPROVED', submitted_at: '2026-05-22T10:00:00Z', user: { login: 'custom' } }],
            status: 0
          };
        }
        return { ok: false, data: null, status: 404 };
      }
    });

    assert.deepEqual(decision, {
      ok: true,
      prNumber: 205,
      reviewState: 'APPROVED',
      defaultUserApproved: false
    });
    assert.ok(calls.some(call => call.apiPath === '/pulls/205/reviews' && call.token === 'custom-token'));
  } finally {
    fs.rmSync(taskFile, { force: true });
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    if (previousUser === undefined) delete process.env.FORGEJO_USER;
    else process.env.FORGEJO_USER = previousUser;
    if (previousHome === undefined) delete process.env.FORGEJO_HOME;
    else process.env.FORGEJO_HOME = previousHome;
  }
});

test('getPrStatus and syncMerged share the same FORGEJO_USER fallback contract', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'forgejo-user-fallback-'));
  const previousUser = process.env.FORGEJO_USER;
  const previousHome = process.env.FORGEJO_HOME;
  delete process.env.FORGEJO_USER;
  process.env.FORGEJO_HOME = tmpRoot;
  fs.mkdirSync(path.join(tmpRoot, 'tokens'), { recursive: true });
  fs.writeFileSync(path.join(tmpRoot, 'tokens', 'human'), 'fallback-token\n', 'utf8');

  try {
    const statusCalls = [];
    const pr = getPrStatus('mission/task-081', '/tmp', {
      apiCall(method, apiPath, token) {
        statusCalls.push({ method, apiPath, token });
        if (method === 'GET' && apiPath.includes('/pulls?state=all')) {
          return { ok: true, data: [{ number: 41, head: { ref: 'mission/task-081' } }] };
        }
        if (method === 'GET' && apiPath === '/pulls/41') {
          return {
            ok: true,
            data: { number: 41, title: 'Mission task-081', state: 'open', merged: false, html_url: 'http://localhost:3300/example' }
          };
        }
        return { ok: false, data: null, status: 1 };
      }
    });
    assert.equal(pr.exists, true);
    assert.ok(statusCalls.every(call => call.token === 'fallback-token'));

    const mergeCalls = [];
    const merged = syncMerged('mission/task-081', 'abc123', {
      resolvePrNumber(branch, token) {
        mergeCalls.push({ type: 'resolve-pr', token });
        return 41;
      },
      apiCall(method, apiPath, token, body) {
        mergeCalls.push({ type: 'api', method, apiPath, token, body });
        if (method === 'POST' && apiPath === '/pulls/41/merge') {
          return { ok: true, data: { merged: true }, status: 0 };
        }
        return { ok: false, data: null, status: 1 };
      },
      verifyCommit() {
        return { status: 0 };
      },
      gitPush() {
        return { status: 0 };
      },
      gitFetch() {
        return { status: 0 };
      },
      gitDelete() {
        return { status: 0 };
      },
      log() {}
    });
    assert.equal(merged.ok, true);
    assert.ok(mergeCalls.every(call => call.token === 'fallback-token'));
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    if (previousUser === undefined) delete process.env.FORGEJO_USER;
    else process.env.FORGEJO_USER = previousUser;
    if (previousHome === undefined) delete process.env.FORGEJO_HOME;
    else process.env.FORGEJO_HOME = previousHome;
  }
});

test('getPrStatus reports missing PRs without throwing', () => {
  const apiCall = mock.fn(() => ({ ok: true, data: [] }));

  const pr = getPrStatus('mission/task-081', '/tmp', { token: 'fake-token', apiCall });
  assert.equal(pr.exists, false);
  assert.match(pr.raw, /no PR found/i);
});

test('getPrStatus surfaces sandbox guidance when PR detail API is unavailable', () => {
  const apiCall = mock.fn((method, apiPath) => {
    if (method === 'GET' && apiPath.includes('/pulls?state=all')) {
      return { ok: true, data: [{ number: 42, head: { ref: 'mission/task-104' } }] };
    }
    if (method === 'GET' && apiPath === '/pulls/42') {
      return { ok: false, data: null, status: 7 };
    }
    return { ok: false };
  });

  const pr = getPrStatus('mission/task-104', '/tmp', {
    token: 'fake-token',
    apiCall
  });

  assert.equal(pr.exists, false);
  assert.equal(pr.error, 'api-failed');
  assert.match(pr.raw, /Codex runtime cannot reach local Forgejo/i);
});

test('getPrStatus surfaces Forgejo authentication failures clearly', () => {
  const apiCall = mock.fn(() => ({
    ok: false,
    data: { message: 'user does not exist [uid: 0, name: ]' },
    status: 0,
    statusCode: 401,
  }));

  const pr = getPrStatus('mission/task-104', '/tmp', {
    token: 'fake-token',
    apiCall,
  });

  assert.equal(pr.exists, false);
  assert.equal(pr.error, 'api-failed');
  assert.match(pr.raw, /authentication failed \(401\)/i);
});

test('syncMerged pushes landed commit, marks PR merged, and deletes the remote branch', () => {
  const calls = [];
  const result = syncMerged('mission/task-097', 'abc123', {
    token: 'test-token',
    resolvePrNumber(branch, token) {
      calls.push({ type: 'resolve-pr', branch, token });
      return 97;
    },
    apiCall(method, apiPath, token, body) {
      calls.push({ type: 'api', method, apiPath, token, body });
      if (method === 'POST' && apiPath === '/pulls/97/merge') {
        return { ok: true, data: { merged: true }, status: 0 };
      }

      return { ok: false, data: null, status: 1 };
    },
    verifyCommit(commit, rootDir) {
      calls.push({ type: 'verify', commit, rootDir });
      return { status: 0 };
    },
    gitPush(sourceRef, destinationRef, rootDir) {
      calls.push({ type: 'push', sourceRef, destinationRef, rootDir });
      return { status: 0 };
    },
    gitFetch(branch, rootDir) {
      calls.push({ type: 'fetch', branch, rootDir });
      return { status: 0 };
    },
    gitDelete(branch, rootDir) {
      calls.push({ type: 'delete', branch, rootDir });
      return { status: 0 };
    },
    log(message) {
      calls.push({ type: 'log', message });
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.prNumber, 97);
  assert.equal(result.branchDeleted, true);
  assert.deepEqual(
    calls.filter(call => call.type === 'push').map(call => [call.sourceRef, call.destinationRef]),
    [
      ['abc123', 'refs/heads/main'],
      ['abc123', 'refs/heads/mission/task-097']
    ]
  );
  assert.deepEqual(
    calls.find(call => call.type === 'api' && call.method === 'POST').body,
    {
      Do: 'manually-merged',
      MergeCommitID: 'abc123',
      head_commit_id: 'abc123',
      delete_branch_after_merge: true
    }
  );
});

test('syncMerged continues when main push fails but review main already contains landed commit', () => {
  const calls = [];
  const result = syncMerged('mission/task-1062', 'abc123', {
    token: 'test-token',
    resolvePrNumber(branch, token) {
      calls.push({ type: 'resolve-pr', branch, token });
      return 1062;
    },
    apiCall(method, apiPath, token, body) {
      calls.push({ type: 'api', method, apiPath, token, body });
      if (method === 'POST' && apiPath === '/pulls/1062/merge') {
        return { ok: true, data: { merged: true }, status: 0 };
      }
      return { ok: false, data: null, status: 1 };
    },
    verifyCommit(commit, rootDir) {
      calls.push({ type: 'verify', commit, rootDir });
      return { status: 0 };
    },
    gitPush(sourceRef, destinationRef, rootDir, options) {
      calls.push({ type: 'push', sourceRef, destinationRef, rootDir, options });
      if (destinationRef === 'refs/heads/main') {
        return {
          status: 1,
          stderr: '! [rejected] abc123 -> main (non-fast-forward)'
        };
      }
      return { status: 0 };
    },
    gitFetch(branch, rootDir) {
      calls.push({ type: 'fetch', branch, rootDir });
      return { status: 0 };
    },
    gitContainsCommit(commit, remoteRef, rootDir) {
      calls.push({ type: 'contains', commit, remoteRef, rootDir });
      return { status: 0 };
    },
    gitDelete(branch, rootDir) {
      calls.push({ type: 'delete', branch, rootDir });
      return { status: 0 };
    },
    log(message) {
      calls.push({ type: 'log', message });
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.prNumber, 1062);
  assert.deepEqual(
    calls.filter(call => call.type === 'fetch').map(call => call.branch),
    ['main', 'mission/task-1062']
  );
  assert.deepEqual(
    calls.filter(call => call.type === 'contains').map(call => [call.commit, call.remoteRef]),
    [['abc123', 'refs/remotes/review/main']]
  );
  assert.deepEqual(
    calls.filter(call => call.type === 'push').map(call => [call.sourceRef, call.destinationRef, call.options]),
    [
      ['abc123', 'refs/heads/main', { user: undefined, token: 'test-token' }],
      ['abc123', 'refs/heads/mission/task-1062', { forceWithLease: true, user: undefined, token: 'test-token' }]
    ]
  );
  assert.equal(calls.some(call => call.type === 'api' && call.method === 'POST'), true, 'merge API runs after main containment is verified');
});

test('syncMerged recovers from stale-info branch push rejection by fetching and retrying', () => {
  const calls = [];
  let branchPushAttempts = 0;
  const result = syncMerged('mission/task-1062', 'abc123', {
    token: 'test-token',
    resolvePrNumber(branch, token) {
      calls.push({ type: 'resolve-pr', branch, token });
      return 1062;
    },
    apiCall(method, apiPath, token, body) {
      calls.push({ type: 'api', method, apiPath, token, body });
      if (method === 'POST' && apiPath === '/pulls/1062/merge') {
        return { ok: true, data: { merged: true }, status: 0 };
      }
      return { ok: false, data: null, status: 1 };
    },
    verifyCommit(commit, rootDir) {
      calls.push({ type: 'verify', commit, rootDir });
      return { status: 0 };
    },
    gitPush(sourceRef, destinationRef, rootDir, options) {
      calls.push({ type: 'push', sourceRef, destinationRef, rootDir, options });
      if (destinationRef === 'refs/heads/mission/task-1062') {
        branchPushAttempts++;
        if (branchPushAttempts > 1) {
          return { status: 0 };
        }
        return {
          status: 1,
          stderr: '! [rejected] abc123 -> mission/task-1062 (stale info)'
        };
      }
      return { status: 0 };
    },
    gitFetch(branch, rootDir) {
      calls.push({ type: 'fetch', branch, rootDir });
      return { status: 0 };
    },
    gitDelete(branch, rootDir) {
      calls.push({ type: 'delete', branch, rootDir });
      return { status: 0 };
    },
    log(message) {
      calls.push({ type: 'log', message });
    }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    calls.filter(call => call.type === 'push').map(call => [call.sourceRef, call.destinationRef, call.options]),
    [
      ['abc123', 'refs/heads/main', { user: undefined, token: 'test-token' }],
      ['abc123', 'refs/heads/mission/task-1062', { forceWithLease: true, user: undefined, token: 'test-token' }],
      ['abc123', 'refs/heads/mission/task-1062', { forceWithLease: true, user: undefined, token: 'test-token' }]
    ]
  );
  assert.deepEqual(
    calls.filter(call => call.type === 'fetch').map(call => [call.branch]),
    [
      ['mission/task-1062'],
      ['mission/task-1062']
    ]
  );
  assert.equal(calls.some(call => call.type === 'api' && call.method === 'POST'), true, 'merge API runs after stale-info retry succeeds');
});

test('syncMerged falls back to force push when stale-info persists after fetch retry', () => {
  const calls = [];
  const result = syncMerged('mission/task-1062', 'abc123', {
    token: 'test-token',
    resolvePrNumber() {
      return 1062;
    },
    apiCall(method, apiPath) {
      calls.push({ type: 'api', method, apiPath });
      if (method === 'POST' && apiPath === '/pulls/1062/merge') {
        return { ok: true, data: { merged: true }, status: 0 };
      }
      return { ok: false, data: null, status: 1 };
    },
    verifyCommit() {
      return { status: 0 };
    },
    gitPush(sourceRef, destinationRef, rootDir, options) {
      calls.push({ type: 'push', sourceRef, destinationRef, options });
      if (destinationRef === 'refs/heads/mission/task-1062' && options && options.forceWithLease) {
        return {
          status: 1,
          stderr: '! [rejected] abc123 -> mission/task-1062 (stale info)'
        };
      }
      return { status: 0 };
    },
    gitFetch(branch) {
      calls.push({ type: 'fetch', branch });
      return { status: 0 };
    },
    gitDelete() {
      return { status: 0 };
    },
    log() {}
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    calls.filter(call => call.type === 'push').map(call => [call.destinationRef, call.options]),
    [
      ['refs/heads/main', { user: undefined, token: 'test-token' }],
      ['refs/heads/mission/task-1062', { forceWithLease: true, user: undefined, token: 'test-token' }],
      ['refs/heads/mission/task-1062', { forceWithLease: true, user: undefined, token: 'test-token' }],
      ['refs/heads/mission/task-1062', { force: true, user: undefined, token: 'test-token' }]
    ]
  );
});

test('syncMerged does not treat unrelated stale output as stale-info branch rejection', () => {
  const calls = [];
  const result = syncMerged('mission/task-1062', 'abc123', {
    token: 'test-token',
    resolvePrNumber() {
      return 1062;
    },
    apiCall(method, apiPath) {
      calls.push({ type: 'api', method, apiPath });
      return { ok: false, data: null, status: 1 };
    },
    verifyCommit() {
      return { status: 0 };
    },
    gitPush(sourceRef, destinationRef, rootDir, options) {
      calls.push({ type: 'push', sourceRef, destinationRef, options });
      if (destinationRef === 'refs/heads/mission/task-1062') {
        return {
          status: 1,
          stderr: 'fatal: stale remote certificate cache'
        };
      }
      return { status: 0 };
    },
    gitFetch(branch) {
      calls.push({ type: 'fetch', branch });
      return { status: 0 };
    },
    gitDelete() {
      throw new Error('gitDelete should not be called when branch push fails');
    },
    log() {}
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'push-branch-failed');
  assert.deepEqual(
    calls.filter(call => call.type === 'push').map(call => [call.destinationRef, call.options]),
    [
      ['refs/heads/main', { user: undefined, token: 'test-token' }],
      ['refs/heads/mission/task-1062', { forceWithLease: true, user: undefined, token: 'test-token' }]
    ]
  );
  assert.equal(calls.some(call => call.type === 'api'), false, 'merge API must not run after unrelated branch push rejection');
});

test('syncMerged fails cleanly when the landed commit does not exist locally', () => {
  const result = syncMerged('mission/task-097', 'deadbeef', {
    token: 'test-token',
    resolvePrNumber() {
      return 97;
    },
    apiCall() {
      return { ok: false, data: null, status: 1 };
    },
    verifyCommit() {
      return { status: 1 };
    },
    gitPush() {
      throw new Error('gitPush should not be called when commit verification fails');
    },
    gitDelete() {
      throw new Error('gitDelete should not be called when commit verification fails');
    },
    log() {}
  });

  assert.deepEqual(result, { ok: false, error: 'missing-commit' });
});

test('getPrNumber follows pagination until it finds the matching branch', () => {
  const calls = [];
  const prNumber = getPrNumber('mission/task-097', 'test-token', {
    apiCall(method, apiPath, token) {
      calls.push({ method, apiPath, token });
      if (apiPath.includes('state=open')) {
        return { ok: true, data: [], status: 0 };
      }
      if (apiPath.includes('state=all') && apiPath.includes('page=1')) {
        return {
          ok: true,
          data: Array.from({ length: 50 }, (_, index) => ({
            number: index + 1,
            head: { ref: `mission/task-${index}`, label: `magnus:mission/task-${index}` }
          })),
          status: 0
        };
      }
      if (apiPath.includes('state=all') && apiPath.includes('page=2')) {
        return {
          ok: true,
          data: [
            {
              number: 97,
              head: { ref: 'mission/task-097', label: 'magnus:mission/task-097' }
            }
          ],
          status: 0
        };
      }
      return { ok: true, data: [], status: 0 };
    }
  });

  assert.equal(prNumber, 97);
});

test('getPrAuthor returns the PR author login from GET /pulls/{n}', () => {
  const author = getPrAuthor('mission/task-1255', 'test-token', {
    resolvePrNumber: () => 214,
    apiCall(method, apiPath) {
      assert.equal(method, 'GET');
      assert.equal(apiPath, '/pulls/214');
      return { ok: true, status: 0, statusCode: 200, data: { user: { login: 'custom' } } };
    }
  });
  assert.equal(author, 'custom');
});

test('getPrAuthor degrades to null when the PR cannot be resolved', () => {
  const author = getPrAuthor('mission/task-1255', 'test-token', {
    resolvePrNumber: () => null,
    apiCall() {
      throw new Error('apiCall should not be invoked when PR is unresolved');
    }
  });
  assert.equal(author, null);
});

test('getPrAuthor degrades to null when the PR detail API fails or lacks a user', () => {
  const failAuthor = getPrAuthor('mission/task-1255', 'test-token', {
    resolvePrNumber: () => 214,
    apiCall: () => ({ ok: false, status: 0, statusCode: 500, data: null })
  });
  assert.equal(failAuthor, null);

  const noUserAuthor = getPrAuthor('mission/task-1255', 'test-token', {
    resolvePrNumber: () => 214,
    apiCall: () => ({ ok: true, status: 0, statusCode: 200, data: {} })
  });
  assert.equal(noUserAuthor, null);
});

test('getLatestReviewDecision returns the latest formal review state for the branch PR', () => {
  const previousUser = process.env.FORGEJO_USER;
  process.env.FORGEJO_USER = 'human';
  try {
    const decision = getLatestReviewDecision('mission/task-097', {
      token: 'test-token',
      apiCall(method, apiPath, token) {
        if (apiPath.includes('/pulls?state=')) {
          return {
            ok: true,
            data: [
              {
                number: 97,
                head: { ref: 'mission/task-097', label: 'magnus:mission/task-097' }
              }
            ],
            status: 0
          };
        }
        if (apiPath === '/pulls/97/reviews') {
          return {
            ok: true,
            data: [
              { state: 'REQUEST_CHANGES', submitted_at: '2026-04-12T10:00:00Z', user: { login: 'codex' } },
              { state: 'APPROVED', submitted_at: '2026-04-12T11:00:00Z', user: { login: 'human' } }
            ],
            status: 0
          };
        }
        return { ok: false, data: null, status: 1 };
      }
    });

    assert.deepEqual(decision, {
      ok: true,
      prNumber: 97,
      reviewState: 'APPROVED',
      defaultUserApproved: true
    });
  } finally {
    process.env.FORGEJO_USER = previousUser;
  }
});

test('getLatestReviewDecision detects defaultUserApproved when default user approved but latest review is REQUEST_CHANGES', () => {
  const previousUser = process.env.FORGEJO_USER;
  process.env.FORGEJO_USER = 'human';
  try {
    const decision = getLatestReviewDecision('mission/task-097', {
      token: 'test-token',
      apiCall(method, apiPath, token) {
        if (apiPath.includes('/pulls?state=')) {
          return {
            ok: true,
            data: [
              {
                number: 97,
                head: { ref: 'mission/task-097', label: 'magnus:mission/task-097' }
              }
            ],
            status: 0
          };
        }
        if (apiPath === '/pulls/97/reviews') {
          return {
            ok: true,
            data: [
              { state: 'APPROVED', submitted_at: '2026-04-12T10:00:00Z', user: { login: 'human' } },
              { state: 'REQUEST_CHANGES', submitted_at: '2026-04-12T11:00:00Z', user: { login: 'codex' } }
            ],
            status: 0
          };
        }
        return { ok: false, data: null, status: 1 };
      }
    });

    assert.deepEqual(decision, {
      ok: true,
      prNumber: 97,
      reviewState: 'REQUEST_CHANGES',
      defaultUserApproved: true
    });
  } finally {
    process.env.FORGEJO_USER = previousUser;
  }
});

test('getLatestReviewDecision returns defaultUserApproved false when default user did not approve', () => {
  const previousUser = process.env.FORGEJO_USER;
  process.env.FORGEJO_USER = 'human';
  try {
    const decision = getLatestReviewDecision('mission/task-097', {
      token: 'test-token',
      apiCall(method, apiPath, token) {
        if (apiPath.includes('/pulls?state=')) {
          return {
            ok: true,
            data: [
              {
                number: 97,
                head: { ref: 'mission/task-097', label: 'magnus:mission/task-097' }
              }
            ],
            status: 0
          };
        }
        if (apiPath === '/pulls/97/reviews') {
          return {
            ok: true,
            data: [
              { state: 'APPROVED', submitted_at: '2026-04-12T10:00:00Z', user: { login: 'codex' } },
              { state: 'REQUEST_CHANGES', submitted_at: '2026-04-12T11:00:00Z', user: { login: 'gemini' } }
            ],
            status: 0
          };
        }
        return { ok: false, data: null, status: 1 };
      }
    });

    assert.deepEqual(decision, {
      ok: true,
      prNumber: 97,
      reviewState: 'REQUEST_CHANGES',
      defaultUserApproved: false
    });
  } finally {
    process.env.FORGEJO_USER = previousUser;
  }
});

test('syncMerged treats 409 Conflict as success if commits match (already merged)', () => {
  const calls = [];
  const result = syncMerged('mission/task-101', 'abc123', {
    token: 'test-token',
    resolvePrNumber(branch, token) {
      return 101;
    },
    apiCall(method, apiPath, token, body) {
      calls.push({ type: 'api', method, apiPath, token, body });
      if (method === 'POST' && apiPath === '/pulls/101/merge') {
        return { ok: false, data: { message: 'base and head are the same' }, status: 0, statusCode: 409 };
      }
      if (method === 'GET' && apiPath === '/pulls/101') {
        return { ok: true, data: { base: { sha: 'abc123' }, head: { sha: 'abc123' } }, status: 0 };
      }
      return { ok: false, data: null, status: 1 };
    },
    verifyCommit(commit, rootDir) {
      return { status: 0 };
    },
    gitFetch() {
      return { status: 0 };
    },
    gitPush(sourceRef, destinationRef, rootDir) {
      return { status: 0 };
    },
    gitDelete(branch, rootDir) {
      return { status: 0 };
    },
    log(message) {
      calls.push({ type: 'log', message });
    }
  });

  assert.equal(result.ok, true, 'Should be ok even with 409 if head/base match abc123');
  assert.equal(result.prNumber, 101);
  assert.ok(calls.some(c => c.type === 'log' && c.message.includes('confirmed head/base match')), 'Should log confirmation of head/base match');
});

test('syncMerged treats 405 Method Not Allowed as success if commits match (already merged)', () => {
  const calls = [];
  const result = syncMerged('mission/task-101', 'abc123', {
    token: 'test-token',
    resolvePrNumber(branch, token) {
      return 101;
    },
    apiCall(method, apiPath, token, body) {
      calls.push({ type: 'api', method, apiPath, token, body });
      if (method === 'POST' && apiPath === '/pulls/101/merge') {
        return { ok: false, data: { message: 'Method Not Allowed' }, status: 0, statusCode: 405 };
      }
      if (method === 'GET' && apiPath === '/pulls/101') {
        return { ok: true, data: { base: { sha: 'abc123' }, head: { sha: 'abc123' } }, status: 0 };
      }
      return { ok: false, data: null, status: 1 };
    },
    verifyCommit(commit, rootDir) {
      return { status: 0 };
    },
    gitFetch() {
      return { status: 0 };
    },
    gitPush(sourceRef, destinationRef, rootDir) {
      return { status: 0 };
    },
    gitDelete(branch, rootDir) {
      return { status: 0 };
    },
    log(message) {
      calls.push({ type: 'log', message });
    }
  });

  assert.equal(result.ok, true, 'Should be ok even with 405 if head/base match abc123');
  assert.equal(result.prNumber, 101);
  assert.ok(calls.some(c => c.type === 'log' && c.message.includes('Method Not Allowed')), 'Should log 405 verification');
});

test('syncMerged fails on 409 Conflict if commits do NOT match', () => {
  const result = syncMerged('mission/task-101', 'abc123', {
    token: 'test-token',
    resolvePrNumber(branch, token) {
      return 101;
    },
    apiCall(method, apiPath, token, body) {
      if (method === 'POST' && apiPath === '/pulls/101/merge') {
        return { ok: false, data: { message: 'Conflict' }, status: 0, statusCode: 409 };
      }
      if (method === 'GET' && apiPath === '/pulls/101') {
        return { ok: true, data: { base: { sha: 'some-other-sha' }, head: { sha: 'abc123' } }, status: 0 };
      }
      return { ok: false, data: null, status: 1 };
    },
    verifyCommit(commit, rootDir) {
      return { status: 0 };
    },
    gitFetch() {
      return { status: 0 };
    },
    gitPush(sourceRef, destinationRef, rootDir) {
      return { status: 0 };
    },
    gitDelete(branch, rootDir) {
      return { status: 0 };
    },
    log(message) {}
  });

  assert.equal(result.ok, false, 'Should NOT be ok if SHAs do not match');
  assert.equal(result.error, 'merge-conflict-sha-mismatch');
  assert.equal(result.baseSha, 'some-other-sha');
});

test('forgejoAvailable returns true when Forgejo is reachable', async () => {
  const req = new EventEmitter();
  req.destroy = mock.fn();
  req.end = mock.fn(() => {
    process.nextTick(() => req._onResponse({ statusCode: 200 }));
  });

  const result = await forgejoAvailable('http://localhost:3300', {
    request(url, options, onResponse) {
      assert.equal(String(url), 'http://localhost:3300/');
      assert.equal(options.method, 'GET');
      req._onResponse = onResponse;
      return req;
    }
  });

  assert.strictEqual(result, true, 'Forgejo should be reachable');
  assert.equal(req.end.mock.callCount(), 1);
  assert.equal(req.destroy.mock.callCount(), 1);
});

test('forgejoAvailable returns false when Forgejo is unreachable', async () => {
  const req = new EventEmitter();
  req.destroy = mock.fn();
  req.end = mock.fn(() => {
    process.nextTick(() => req.emit('error', new Error('ECONNREFUSED')));
  });

  const result = await forgejoAvailable('http://127.0.0.1:3301', {
    request(url, options, onResponse) {
      assert.equal(String(url), 'http://127.0.0.1:3301/');
      assert.equal(options.timeout, 5000);
      req._onResponse = onResponse;
      return req;
    }
  });

  assert.strictEqual(result, false, 'Forgejo should be unreachable');
  assert.equal(req.end.mock.callCount(), 1);
});

test('postReview includes commit_id', () => {
  const calls = [];
  const apiCall = mock.fn((method, apiPath, token, body) => {
    calls.push({ method, apiPath, body });
    if (method === 'GET' && apiPath === '/pulls/123') {
      return { ok: true, data: { head: { sha: 'head-sha-456' } } };
    }
    if (method === 'GET' && apiPath.includes('/pulls?state=')) {
      return { ok: true, data: [{ number: 123, head: { ref: 'mission/task-001' } }] };
    }
    return { ok: true };
  });

  postReview('mission/task-001', 'fake-token', 'approve', 'LGTM', { apiCall });
  
  const postCall = calls.find(c => c.method === 'POST');
  assert.ok(postCall, 'Should have made a POST call');
  assert.equal(postCall.body.commit_id, 'head-sha-456');
});

test('postComment resolves PR via default token fallback while posting as codex', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'forgejo-default-token-fallback-comment-'));
  const previousHome = process.env.FORGEJO_HOME;
  const previousUser = process.env.FORGEJO_USER;
  process.env.FORGEJO_HOME = tmpRoot;
  process.env.FORGEJO_USER = 'codex';
  fs.writeFileSync(path.join(tmpRoot, 'token'), 'default-token\n', 'utf8');

  try {
    const calls = [];
    const result = postComment('mission/task-111', 'codex-token', 'review comment', {
      apiCall(method, apiPath, token, body) {
        calls.push({ method, apiPath, token, body });
        if (method === 'GET' && apiPath.includes('/pulls?state=open')) {
          if (token === 'codex-token') return { ok: true, data: [], status: 0 };
          if (token === 'default-token') return { ok: true, data: [{ number: 39, head: { ref: 'mission/task-111' } }], status: 0 };
        }
        return { ok: true, data: { ok: true }, status: 0 };
      }
    });

    assert.equal(result.ok, true);
    assert.ok(calls.some(call => call.method === 'GET' && call.token === 'default-token'));
    assert.ok(calls.some(call => call.method === 'POST' && call.apiPath === '/issues/39/comments' && call.token === 'codex-token'));
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    if (previousUser === undefined) delete process.env.FORGEJO_USER;
    else process.env.FORGEJO_USER = previousUser;
    if (previousHome === undefined) delete process.env.FORGEJO_HOME;
    else process.env.FORGEJO_HOME = previousHome;
  }
});

test('postReview resolves PR via default token fallback while posting as codex', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'forgejo-default-token-fallback-review-'));
  const previousHome = process.env.FORGEJO_HOME;
  const previousUser = process.env.FORGEJO_USER;
  process.env.FORGEJO_HOME = tmpRoot;
  process.env.FORGEJO_USER = 'codex';
  fs.writeFileSync(path.join(tmpRoot, 'token'), 'default-token\n', 'utf8');

  try {
    const calls = [];
    const result = postReview('mission/task-111', 'codex-token', 'request-changes', 'needs fixes', {
      apiCall(method, apiPath, token, body) {
        calls.push({ method, apiPath, token, body });
        if (method === 'GET' && apiPath.includes('/pulls?state=open')) {
          if (token === 'codex-token') return { ok: true, data: [], status: 0 };
          if (token === 'default-token') return { ok: true, data: [{ number: 39, head: { ref: 'mission/task-111' } }], status: 0 };
        }
        if (method === 'GET' && apiPath === '/pulls/39') {
          return { ok: true, data: { head: { sha: 'review-head-sha' } }, status: 0 };
        }
        return { ok: true, data: { ok: true }, status: 0 };
      }
    });

    assert.equal(result.ok, true);
    assert.ok(calls.some(call => call.method === 'GET' && call.token === 'default-token'));
    const postCall = calls.find(call => call.method === 'POST' && call.apiPath === '/pulls/39/reviews');
    assert.ok(postCall);
    assert.equal(postCall.token, 'codex-token');
    assert.equal(postCall.body.commit_id, 'review-head-sha');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    if (previousUser === undefined) delete process.env.FORGEJO_USER;
    else process.env.FORGEJO_USER = previousUser;
    if (previousHome === undefined) delete process.env.FORGEJO_HOME;
    else process.env.FORGEJO_HOME = previousHome;
  }
});

test('FORGEJO_USER defaults to human', () => {
  const oldUser = process.env.FORGEJO_USER;
  const oldToken = process.env.FORGEJO_TOKEN;
  delete process.env.FORGEJO_USER;
  process.env.FORGEJO_TOKEN = 'fake-token';
  try {
    const apiCall = (method, apiPath, token, body) => {
      if (apiPath.includes('/pulls?state=')) {
        return { ok: true, data: [{ number: 1, head: { ref: 'mission/task-001' } }] };
      }
      return { ok: true, data: { number: 1, title: 'test', state: 'open', html_url: 'http://test' } };
    };
    const pr = getPrStatus('mission/task-001', '/tmp', { apiCall });
    assert.ok(pr.exists);
  } finally {
    if (oldUser === undefined) delete process.env.FORGEJO_USER; else process.env.FORGEJO_USER = oldUser;
    if (oldToken === undefined) delete process.env.FORGEJO_TOKEN; else process.env.FORGEJO_TOKEN = oldToken;
  }
});

test('getPrNumber fallback uses task implementer resolved from slug via findTaskFile', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'forgejo-slug-fallback-'));
  const previousHome = process.env.FORGEJO_HOME;
  const previousUser = process.env.FORGEJO_USER;
  delete process.env.FORGEJO_USER;
  process.env.FORGEJO_HOME = tmpRoot;

  // Token for codex user (the implementer)
  fs.mkdirSync(path.join(tmpRoot, 'tokens'), { recursive: true });
  fs.writeFileSync(path.join(tmpRoot, 'tokens', 'codex'), 'codex-token\n', 'utf8');

  // Create a test task file in the worktree's backlog/tasks/ so findTaskFile can locate it
  // Use task-999 to avoid conflicts with existing task files
  const worktreeTasksDir = path.join(process.cwd(), 'backlog', 'tasks');
  fs.mkdirSync(worktreeTasksDir, { recursive: true });
  const taskFile = path.join(worktreeTasksDir, 'task-999 - test task.md');
  fs.writeFileSync(taskFile, `---
id: TASK-999
title: test
status: active
assignee: [codex]
---
`);

  try {
    // Current user (magnus) has no matching PR — both open and all return empty
    // Implementer (codex) has the matching PR
    const calls = [];
    const prNumber = getPrNumber('mission/task-999', 'magnus-token', {
      apiCall(method, apiPath, token) {
        calls.push({ method, apiPath, token });
        if (apiPath.includes('state=open')) {
          return { ok: true, data: [] };
        }
        if (apiPath.includes('state=all')) {
          // magnus-token lookup finds nothing
          if (token === 'magnus-token') {
            return { ok: true, data: [] };
          }
          // codex-token lookup finds the PR
          return { ok: true, data: [{ number: 999, head: { ref: 'mission/task-999' } }] };
        }
        return { ok: true, data: [] };
      },
      slug: 'task-999'
    });

    assert.equal(prNumber, 999, 'Should find PR via codex fallback token');
    // Verify the fallback used the codex token, not magnus-token
    const fallbackCalls = calls.filter(c => c.token !== 'magnus-token');
    assert.ok(fallbackCalls.length > 0, 'Should have tried the implementer fallback token');
    assert.ok(fallbackCalls.some(c => c.token === 'codex-token'), 'Fallback should use codex token');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.rmSync(taskFile, { force: true });
    if (previousUser === undefined) delete process.env.FORGEJO_USER;
    else process.env.FORGEJO_USER = previousUser;
    if (previousHome === undefined) delete process.env.FORGEJO_HOME;
    else process.env.FORGEJO_HOME = previousHome;
  }
});

test('getPrNumber API failure returns structured error with _apiError and _notFound', () => {
  const result = getPrNumber('mission/task-100', 'fake-token', {
    apiCall(method, apiPath) {
      if (apiPath.includes('state=open') || apiPath.includes('state=all')) {
        return { ok: false, data: null, status: 7, error: 'connection refused' };
      }
      return { ok: false, data: null };
    },
    slug: 'task-100',
    reportNotFound: true
  });

  assert.ok(result && typeof result === 'object', 'Should return structured error object');
  assert.ok(result._apiError, 'Should include _apiError');
  assert.equal(result._apiError.status, 7);
  assert.equal(result._notFound, true);
});

test('getPrStatus surfaces sandbox hint when API returns status 7', () => {
  const apiCall = mock.fn((method, apiPath) => {
    if (apiPath.includes('/pulls?state=')) {
      return { ok: false, data: null, status: 7, error: 'connection refused' };
    }
    return { ok: false, data: null };
  });

  const pr = getPrStatus('mission/task-100', '/tmp', {
    token: 'fake-token',
    apiCall
  });

  assert.equal(pr.exists, false);
  assert.equal(pr.error, 'api-failed');
  assert.match(pr.raw, /Codex runtime cannot reach local Forgejo/i);
});

test('getPrNumber propagates API error from first token to fallback token lookup', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'forgejo-api-error-'));
  const previousHome = process.env.FORGEJO_HOME;
  const previousUser = process.env.FORGEJO_USER;
  delete process.env.FORGEJO_USER;
  process.env.FORGEJO_HOME = tmpRoot;

  // Token for codex user (the implementer)
  fs.mkdirSync(path.join(tmpRoot, 'tokens'), { recursive: true });
  fs.writeFileSync(path.join(tmpRoot, 'tokens', 'codex'), 'codex-token\n', 'utf8');

  // Create a test task file so findTaskFile can locate the implementer
  // Use a unique slug that won't conflict with existing tasks
  const worktreeTasksDir = path.join(process.cwd(), 'backlog', 'tasks');
  fs.mkdirSync(worktreeTasksDir, { recursive: true });
  const taskFile = path.join(worktreeTasksDir, 'task-1100 - api error test.md');
  fs.writeFileSync(taskFile, `---
id: TASK-1100
title: test
status: active
assignee: [codex]
---
`);

  try {
    const prNumber = getPrNumber('mission/task-1100', 'magnus-token', {
      apiCall(method, apiPath, token) {
        if (apiPath.includes('state=open')) {
          return { ok: false, data: null, status: 7, error: 'connection refused' };
        }
        if (apiPath.includes('state=all')) {
          if (token === 'magnus-token') {
            return { ok: false, data: null, status: 7, error: 'connection refused' };
          }
          return { ok: true, data: [{ number: 1100, head: { ref: 'mission/task-1100' } }] };
        }
        return { ok: false, data: null };
      },
      slug: 'task-1100',
      reportNotFound: true
    });

    // Should fall through to implementer fallback and find the PR there
    assert.equal(prNumber, 1100);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.rmSync(taskFile, { force: true });
    if (previousUser === undefined) delete process.env.FORGEJO_USER;
    else process.env.FORGEJO_USER = previousUser;
    if (previousHome === undefined) delete process.env.FORGEJO_HOME;
    else process.env.FORGEJO_HOME = previousHome;
  }
});

test('getLatestReviewDecision returns api-failed when getPrNumber returns _apiError', () => {
  const apiCall = mock.fn((method, apiPath) => {
    if (apiPath.includes('/pulls?state=')) {
      return { ok: false, data: null, status: 7, error: 'connection refused' };
    }
    return { ok: false, data: null };
  });

  const result = getLatestReviewDecision('mission/task-200', {
    forgejoUser: 'custom',
    token: 'fake-token',
    apiCall
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'api-failed');
  assert.equal(result.reviewState, null);
  assert.match(result.raw, /failed to resolve PR/);
  assert.match(result.raw, /Codex runtime cannot reach local Forgejo/i);
});

test('postComment returns api-failed when getPrNumber returns _apiError', () => {
  const apiCall = mock.fn((method, apiPath) => {
    if (apiPath.includes('/pulls?state=')) {
      return { ok: false, data: null, status: 7, error: 'connection refused' };
    }
    return { ok: false, data: null };
  });

  const result = postComment('mission/task-201', 'fake-token', 'review comment', { apiCall });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'api-failed');
  assert.match(result.raw, /failed to resolve PR/);
});

test('postReview returns api-failed when getPrNumber returns _apiError', () => {
  const apiCall = mock.fn((method, apiPath) => {
    if (apiPath.includes('/pulls?state=')) {
      return { ok: false, data: null, status: 7, error: 'connection refused' };
    }
    return { ok: false, data: null };
  });

  const result = postReview('mission/task-202', 'fake-token', 'approve', 'looks good', { apiCall });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'api-failed');
  assert.match(result.raw, /failed to resolve PR/);
});

test('getComments returns null when getPrNumber returns _apiError', async () => {
  const apiCall = mock.fn((method, apiPath) => {
    if (apiPath.includes('/pulls?state=')) {
      return { ok: false, data: null, status: 7, error: 'connection refused' };
    }
    return { ok: false, data: null };
  });

  const result = await getComments('mission/task-203', 'fake-token', { apiCall });

  assert.equal(result, null);
});

test('createPr retries push after stale-info rejection when forceWithLease is true', (t) => {
  const branch = 'mission/task-1089';
  const user = 'gemini';
  const token = 'fake-token';
  const rootDir = '/tmp/fake-root';

  let pushAttempts = 0;
  let fetchCalled = false;
  let revParseAttempts = 0;
  const leaseArgs = [];

  mock.method(git, 'git', (args) => {
    if (args.includes('branch') && args.includes('--list')) return { status: 0, stdout: 'main\n' };
    if (args.includes('fetch')) {
      fetchCalled = true;
      return { status: 0, stdout: '' };
    }
    if (args.includes('rev-parse') && args.includes(`refs/remotes/review/${branch}^{commit}`)) {
      revParseAttempts++;
      return { status: 0, stdout: `${revParseAttempts === 1 ? 'oldsha' : 'newsha'}\n`, stderr: '' };
    }
    if (args.includes('push') && args[args.length - 1] === branch) {
      pushAttempts++;
      leaseArgs.push(args.find(arg => arg.startsWith('--force-with-lease=')));
      if (pushAttempts === 1) {
        return { status: 1, stderr: `! [rejected] ${branch} (stale info)` };
      }
      return { status: 0, stdout: '' };
    }
    return { status: 0, stdout: '' };
  });

  const apiCall = mock.fn((method, apiPath) => {
    if (method === 'GET' && apiPath.includes('/pulls?state=open')) return { ok: true, data: [] };
    if (method === 'GET' && apiPath.includes('/pulls?state=all')) return { ok: true, data: [] };
    if (method === 'POST' && apiPath === '/pulls') {
      return { ok: true, data: { html_url: 'http://pr/1089', number: 1089 } };
    }
    return { ok: false };
  });

  const result = createPr(branch, user, token, { rootDir, apiCall, log: () => {}, forceWithLease: true });
  assert.strictEqual(result.ok, true, 'createPr should succeed after stale-info retry');
  assert.strictEqual(pushAttempts, 2, 'should attempt push twice');
  assert.strictEqual(fetchCalled, true, 'should fetch before retrying');
  assert.deepStrictEqual(
    leaseArgs,
    [
      `--force-with-lease=refs/heads/${branch}:oldsha`,
      `--force-with-lease=refs/heads/${branch}:newsha`
    ],
    'should rebuild the explicit lease after fetching'
  );
});

test('createPr does not retry push on non-stale push failure', (t) => {
  const branch = 'mission/task-1089b';
  const user = 'gemini';
  const token = 'fake-token';
  const rootDir = '/tmp/fake-root';

  let pushAttempts = 0;

  mock.method(git, 'git', (args) => {
    if (args.includes('branch') && args.includes('--list')) return { status: 0, stdout: 'main\n' };
    if (args.includes('rev-parse') && args.includes(`refs/remotes/review/${branch}^{commit}`)) {
      return { status: 0, stdout: 'abc123\n', stderr: '' };
    }
    if (args.includes('push') && args[args.length - 1] === branch) {
      pushAttempts++;
      return { status: 1, stderr: 'remote: Permission denied' };
    }
    return { status: 0, stdout: '' };
  });

  const apiCall = mock.fn(() => ({ ok: false }));

  const result = createPr(branch, user, token, { rootDir, apiCall, log: () => {}, forceWithLease: true });
  assert.strictEqual(result.ok, false, 'createPr should fail on non-stale push failure');
  assert.strictEqual(pushAttempts, 1, 'should attempt push only once for non-stale failure');
});

test('createPr fails cleanly on second consecutive stale rejection', (t) => {
  const branch = 'mission/task-1089c';
  const user = 'gemini';
  const token = 'fake-token';
  const rootDir = '/tmp/fake-root';

  let pushAttempts = 0;

  mock.method(git, 'git', (args) => {
    if (args.includes('branch') && args.includes('--list')) return { status: 0, stdout: 'main\n' };
    if (args.includes('fetch')) return { status: 0, stdout: '' };
    if (args.includes('rev-parse') && args.includes(`refs/remotes/review/${branch}^{commit}`)) {
      return { status: 0, stdout: 'abc123\n', stderr: '' };
    }
    if (args.includes('push') && args[args.length - 1] === branch) {
      pushAttempts++;
      return { status: 1, stderr: `! [rejected] ${branch} (stale info)` };
    }
    return { status: 0, stdout: '' };
  });

  const apiCall = mock.fn(() => ({ ok: false }));

  const result = createPr(branch, user, token, { rootDir, apiCall, log: () => {}, forceWithLease: true });
  assert.strictEqual(result.ok, false, 'createPr should fail cleanly after second consecutive stale rejection');
  assert.strictEqual(pushAttempts, 2, 'should attempt push exactly twice before giving up');
});

test('createPr fetches tracking ref before first push when local review ref is missing', (t) => {
  const branch = 'mission/task-1095-missing';
  const user = 'gemini';
  const token = 'fake-token';
  const rootDir = '/tmp/fake-root';

  let fetchCalls = 0;
  let pushArgs = [];

  mock.method(git, 'git', (args) => {
    if (args.includes('branch') && args.includes('--list')) return { status: 0, stdout: 'main\n' };
    if (args.includes('fetch')) {
      fetchCalls++;
      return { status: 0, stdout: '', stderr: '' };
    }
    if (args.includes('rev-parse') && args.includes(`refs/remotes/review/${branch}^{commit}`)) {
      if (fetchCalls === 0) return { status: 128, stdout: '', stderr: 'unknown revision' };
      return { status: 0, stdout: 'fetchedsha\n', stderr: '' };
    }
    if (args.includes('rev-parse') && args.includes(`refs/remotes/origin/${branch}^{commit}`)) {
      return { status: 128, stdout: '', stderr: 'unknown revision' };
    }
    if (args.includes('push') && args[args.length - 1] === branch) {
      pushArgs = args;
      return { status: 0, stdout: '', stderr: '' };
    }
    return { status: 0, stdout: '', stderr: '' };
  });

  const apiCall = mock.fn((method, apiPath) => {
    if (method === 'GET' && apiPath.includes('/pulls?state=open')) return { ok: true, data: [] };
    if (method === 'GET' && apiPath.includes('/pulls?state=all')) return { ok: true, data: [] };
    if (method === 'POST' && apiPath === '/pulls') {
      return { ok: true, data: { html_url: 'http://pr/1095', number: 1095 } };
    }
    return { ok: false };
  });

  const result = createPr(branch, user, token, { rootDir, apiCall, log: () => {}, forceWithLease: true });
  assert.strictEqual(result.ok, true, 'createPr should fetch tracking ref before first push');
  assert.strictEqual(fetchCalls, 1, 'should fetch exactly once before first push');
  assert.ok(
    pushArgs.includes(`--force-with-lease=refs/heads/${branch}:fetchedsha`),
    'push should use the fetched tracking sha'
  );
});

test('createPr fails cleanly when tracking ref remains missing after fetch', (t) => {
  const branch = 'mission/task-1095-unresolved';
  const user = 'gemini';
  const token = 'fake-token';
  const rootDir = '/tmp/fake-root';

  let fetchCalls = 0;
  let pushAttempts = 0;

  mock.method(git, 'git', (args) => {
    if (args.includes('branch') && args.includes('--list')) return { status: 0, stdout: 'main\n' };
    if (args.includes('fetch')) {
      fetchCalls++;
      return { status: 0, stdout: '', stderr: '' };
    }
    if (args.includes('rev-parse') && args.includes(`refs/remotes/review/${branch}^{commit}`)) {
      return { status: 128, stdout: '', stderr: 'unknown revision' };
    }
    if (args.includes('rev-parse') && args.includes(`refs/remotes/origin/${branch}^{commit}`)) {
      return { status: 128, stdout: '', stderr: 'unknown revision' };
    }
    if (args.includes('push') && args[args.length - 1] === branch) {
      pushAttempts++;
    }
    return { status: 0, stdout: '', stderr: '' };
  });

  const apiCall = mock.fn(() => ({ ok: false }));

  const result = createPr(branch, user, token, { rootDir, apiCall, log: () => {}, forceWithLease: true });
  assert.strictEqual(result.ok, false, 'createPr should fail when no tracking ref is available after fetch');
  assert.strictEqual(fetchCalls, 1, 'should fetch once before failing');
  assert.strictEqual(pushAttempts, 0, 'should not push without an explicit lease sha');
  assert.match(result.error, new RegExp(`could not resolve tracking ref for ${branch}`));
  assert.match(result.error, new RegExp(`refs/remotes/review/${branch}`));
  assert.match(result.error, new RegExp(`refs/remotes/origin/${branch}`));
});

test('createPr fails without retrying push when stale-info refresh fetch fails', (t) => {
  const branch = 'mission/task-1095-refresh-fails';
  const user = 'gemini';
  const token = 'fake-token';
  const rootDir = '/tmp/fake-root';

  let pushAttempts = 0;
  let fetchCalls = 0;

  mock.method(git, 'git', (args) => {
    if (args.includes('branch') && args.includes('--list')) return { status: 0, stdout: 'main\n' };
    if (args.includes('fetch')) {
      fetchCalls++;
      return { status: 1, stdout: '', stderr: 'remote unavailable' };
    }
    if (args.includes('rev-parse') && args.includes(`refs/remotes/review/${branch}^{commit}`)) {
      return { status: 0, stdout: 'abc123\n', stderr: '' };
    }
    if (args.includes('push') && args[args.length - 1] === branch) {
      pushAttempts++;
      return { status: 1, stderr: `! [rejected] ${branch} (stale info)` };
    }
    return { status: 0, stdout: '', stderr: '' };
  });

  const apiCall = mock.fn(() => ({ ok: false }));

  const result = createPr(branch, user, token, { rootDir, apiCall, log: () => {}, forceWithLease: true });
  assert.strictEqual(result.ok, false, 'createPr should fail when retry refresh cannot fetch');
  assert.strictEqual(pushAttempts, 1, 'should not attempt a second push after refresh fetch failure');
  assert.strictEqual(fetchCalls, 1, 'should attempt the retry refresh once');
  assert.match(result.error, new RegExp(`failed to refresh tracking ref for ${branch}`));
  assert.match(result.error, /remote unavailable/);
});

// ---------- Safety Hardening Regression Tests ----------

test('resolveForgejoHome returns safe fallback in test context when FORGEJO_HOME is unset', () => {
  const previousHome = process.env.FORGEJO_HOME;
  delete process.env.FORGEJO_HOME;
  // node --test already sets NODE_TEST_CONTEXT: true
  
  try {
    const resolved = resolveForgejoHome();
    assert.strictEqual(resolved, '/tmp/forgejo-test-home-missing', 'Should return safe test fallback');
  } finally {
    if (previousHome !== undefined) process.env.FORGEJO_HOME = previousHome;
  }
});

test('isForgejoPath matches forgejo home descendants after path normalization', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'forgejo-path-guard-'));
  const previousHome = process.env.FORGEJO_HOME;
  process.env.FORGEJO_HOME = tmpRoot;

  try {
    assert.equal(isForgejoPath(tmpRoot), true);
    assert.equal(isForgejoPath(path.join(tmpRoot, 'tokens', '..', 'tokens', 'codex')), true);
    assert.equal(isForgejoPath(path.join(os.tmpdir(), 'not-forgejo')), false);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    if (previousHome === undefined) delete process.env.FORGEJO_HOME;
    else process.env.FORGEJO_HOME = previousHome;
  }
});

// Regression: fetchReviewBranch must use '+' prefix so non-fast-forward tracking ref
// updates succeed after rebases. Fixed in task-1107, task-1130, and task-1134.
test('fetchReviewBranch uses force-update refspec to handle rebased branches', (t) => {
  let capturedArgs = null;
  mock.method(git, 'git', (args) => {
    capturedArgs = args;
    return { status: 0, stdout: '', stderr: '' };
  });

  fetchReviewBranch('mission/task-regression', '/tmp/fake-root');

  assert.ok(capturedArgs, 'git should have been called');
  const refspec = capturedArgs.find(a => a.includes('refs/heads/'));
  assert.ok(refspec, 'refspec argument should be present');
  assert.ok(
    refspec.startsWith('+'),
    `refspec must start with "+" for forced tracking ref update, got: ${refspec}`
  );
});

// Regression: git diagnostics are localized to the operator's locale. A
// non-English locale (e.g. Swedish "kunde inte hitta fjärr-referensen") made
// isMissingRemoteRef miss the "could not find remote ref" condition, so a
// routine first push of a new mission branch aborted. fetchReviewBranch must
// force a stable C locale so detection stays language-independent (task-1317).
test('fetchReviewBranch forces a C locale so git diagnostics are English', (t) => {
  let capturedOptions = null;
  mock.method(git, 'git', (_args, options) => {
    capturedOptions = options;
    return { status: 0, stdout: '', stderr: '' };
  });

  fetchReviewBranch('mission/task-1317', '/tmp/fake-root');

  assert.ok(capturedOptions, 'git should have been called with options');
  assert.ok(capturedOptions.env, 'fetch should pass an env override');
  assert.strictEqual(capturedOptions.env.LC_ALL, 'C', 'LC_ALL must be forced to C');
  assert.strictEqual(capturedOptions.env.LANG, 'C', 'LANG must be forced to C');
});

test('fetchReviewBranch uses authenticated review url when a token is available', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forgejo-fetch-auth-'));
  let capturedArgs = null;
  try {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
      product: { name: 'Test Project' },
      adapters: {
        tasks: { provider: 'backlog-md', storage: 'backlog' },
        missions: { baseDir: 'docs/missions', branchPrefix: 'mission/', worktreePattern: '../<repo>-<slug>' },
        verification: { command: 'npm test' },
        review: { provider: 'forgejo', baseUrl: 'http://localhost:3300', remote: 'review', repo: 'magnus/testproj' },
        agents: { commandEnvPrefix: 'AUTONOMOUS_REVIEW_' },
      },
    }, null, 2), 'utf8');

    mock.method(git, 'git', (args) => {
      capturedArgs = args;
      return { status: 0, stdout: '', stderr: '' };
    });

    fetchReviewBranch('main', root, { user: 'codex', token: 'token-123' });

    assert.ok(capturedArgs, 'git should have been called');
    assert.ok(
      capturedArgs.includes('http://codex:token-123@localhost:3300/magnus/testproj.git'),
      `expected authenticated fetch url, got: ${capturedArgs.join(' ')}`
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('createPr targets the recorded feature-branch base when MISSION.md has Base-Branch', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forgejo-config-pr-base-'));
  try {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
      product: { name: 'Test Project' },
      adapters: {
        tasks: { provider: 'backlog-md', storage: 'backlog' },
        missions: { baseDir: 'docs/missions', branchPrefix: 'mission/', primaryBranch: 'main', worktreePattern: '../<repo>-<slug>' },
        verification: { command: 'npm test' },
        review: { provider: 'forgejo', baseUrl: 'http://localhost:3300', remote: 'review', repo: 'magnus/testproj' },
        agents: { commandEnvPrefix: 'AUTONOMOUS_REVIEW_' },
      },
    }, null, 2), 'utf8');

    // Create a MISSION.md with a recorded feature-branch base
    const year = String(new Date().getFullYear());
    const missionDir = path.join(root, 'docs', 'missions', year, 'task-300');
    fs.mkdirSync(missionDir, { recursive: true });
    fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Mission: task-300\n\nBase-Branch: feat/x\n');

    const gitCalls = [];
    mock.method(git, 'git', (args) => {
      gitCalls.push(args);
      if (args.includes('show-ref')) return { status: 0, stdout: '', stderr: '' };
      if (args.includes('push')) return { status: 0, stdout: '', stderr: '' };
      if (args.includes('rev-parse')) return { status: 0, stdout: 'abc123\n', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    });

    const apiCalls = [];
    const apiCall = mock.fn((method, apiPath, token, body, options = {}) => {
      apiCalls.push({ method, apiPath, token, body, options });
      if (method === 'GET' && apiPath.includes('/pulls?state=open')) return { ok: true, data: [] };
      if (method === 'GET' && apiPath.includes('/pulls?state=all')) return { ok: true, data: [] };
      if (method === 'POST' && apiPath === '/pulls') {
        return { ok: true, data: { html_url: 'http://localhost:3300/magnus/testproj/pulls/2', number: 2 } };
      }
      return { ok: false, data: null };
    });

    const result = createPr('mission/task-300', 'mistral', 'token-456', { rootDir: root, apiCall, log: () => {} });
    assert.equal(result.ok, true);
    // The PR base should be the recorded feature-branch, not 'main'
    assert.ok(apiCalls.some(call => call.method === 'POST' && call.body && call.body.base === 'feat/x'), `Expected PR base 'feat/x', found: ${JSON.stringify(apiCalls.find(c => c.method === 'POST' && c.body)?.body)}`);
    // The feature base branch must be mirrored to the review remote so the PR
    // base resolves server-side; otherwise PR creation fails.
    assert.ok(
      gitCalls.some(args => args.includes('push') && args.includes('feat/x:feat/x')),
      `Expected feature base branch 'feat/x' to be pushed, got pushes: ${JSON.stringify(gitCalls.filter(a => a.includes('push')))}`
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ensureRemoteBaseBranch mirrors an existing local base branch with a force push', () => {
  const { ensureRemoteBaseBranch } = require('../lib/tools/forgejo.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forgejo-base-mirror-'));
  try {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
      product: { name: 'Test Project' },
      adapters: {
        tasks: { provider: 'backlog-md', storage: 'backlog' },
        missions: { baseDir: 'docs/missions', branchPrefix: 'mission/', primaryBranch: 'main' },
        verification: { command: 'npm test' },
        review: { provider: 'forgejo', baseUrl: 'http://localhost:3300', remote: 'review', repo: 'magnus/testproj' },
      },
    }, null, 2), 'utf8');

    const calls = [];
    // Fully injected runner — no real git process is spawned and nothing is pushed.
    const gitRunner = (args) => {
      calls.push(args);
      if (args.includes('show-ref')) return { status: 0, stdout: '', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    };

    const result = ensureRemoteBaseBranch('feat/x', 'mistral', 'token-456', root, { gitRunner });
    assert.equal(result.ok, true);
    assert.ok(calls.some(args => args.includes('push') && args.includes('--force') && args.includes('feat/x:feat/x')),
      `Expected a force push of 'feat/x', got: ${JSON.stringify(calls)}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ensureRemoteBaseBranch fails when the base branch is absent locally', () => {
  const { ensureRemoteBaseBranch } = require('../lib/tools/forgejo.js');
  const calls = [];
  const gitRunner = (args) => {
    calls.push(args);
    if (args.includes('show-ref')) return { status: 1, stdout: '', stderr: '' };
    return { status: 0, stdout: '', stderr: '' };
  };
  const result = ensureRemoteBaseBranch('feat/missing', 'mistral', 'token-456', process.cwd(), { gitRunner });
  assert.equal(result.ok, false);
  assert.match(result.error, /does not exist locally/);
  // It must never attempt a push when the local base branch is missing.
  assert.ok(!calls.some(args => args.includes('push')), 'Should not push when base branch is absent');
});
