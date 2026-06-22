const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const readline = require('readline');
const childProcess = require('child_process');
const { mock } = require('node:test');

const {
  bootstrapReviewSurface,
  buildWorkflowConfig,
  collectSetupAnswers,
  collectWizardAnswers,
  createToken,
  defaultProductName,
  defaultRepoSlug,
  ensureRepo,
  ensureReviewRemote,
  evaluateReviewSetup,
  parseRepoSlug,
  parseYesNo,
  readConfiguredReviewRemote,
  runVerifyEnv,
  setupReview,
  setupWizard,
  writeWorkflowConfig,
} = require('../lib/tools/setup-review');

async function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-setup-review-'));
  try {
    await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function loadSetupReviewWithSpawn(spawnImpl) {
  const modulePath = require.resolve('../lib/tools/setup-review');
  const mocked = mock.method(childProcess, 'spawnSync', spawnImpl);
  delete require.cache[modulePath];
  try {
    return require('../lib/tools/setup-review');
  } finally {
    mocked.mock.restore();
    delete require.cache[modulePath];
  }
}

function writeConfig(root, review = {}) {
  fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
    product: { name: 'Standalone' },
    adapters: {
      tasks: { provider: 'backlog-md', storage: 'backlog' },
      missions: { baseDir: 'docs/missions', branchPrefix: 'mission/', primaryBranch: 'main', worktreePattern: '../<repo>-<slug>' },
      verification: { command: 'npm test', defaultArea: 'docs' },
      review: {
        provider: 'forgejo',
        baseUrl: 'http://localhost:3300',
        remote: 'review',
        repo: 'test-org/test-repo',
        ...review,
      },
      agents: { commandEnvPrefix: 'AUTONOMOUS_REVIEW_' },
    },
  }, null, 2));
}

test('parseRepoSlug accepts owner/repo strings', () => {
  assert.deepEqual(parseRepoSlug('acme/branchops'), { owner: 'acme', repo: 'branchops' });
  assert.equal(parseRepoSlug('broken'), null);
});

test('parseYesNo and default helpers provide setup wizard defaults', () => {
  assert.equal(parseYesNo('', true), true);
  assert.equal(parseYesNo('n', true), false);
  assert.equal(parseYesNo('yes', false), true);
  assert.equal(defaultProductName('/tmp/my-project'), 'my-project');
  assert.equal(defaultRepoSlug('/tmp/my-project', 'magnus'), 'magnus/my-project');
});

test('evaluateReviewSetup reports missing tokens and review remote', () => {
  return withTempDir(root => {
    writeConfig(root);
    const result = evaluateReviewSetup(root, {
      users: ['codex', 'claude'],
      tokenPathFn: user => path.join(root, '.forgejo-local', 'tokens', user),
      getRemoteUrlFn: () => null,
      remoteUrlFn: () => 'http://localhost:3300/test-org/test-repo.git',
    });

    assert.equal(result.required, true);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some(issue => issue.includes('codex')));
    assert.ok(result.issues.some(issue => issue.includes('git remote "review" is missing')));
    assert.ok(result.steps.some(step => step.includes('px setup')));
  });
});

test('evaluateReviewSetup reports not-required without configured review settings and passes when setup is complete', async () => {
  await withTempDir(async root => {
    let result = evaluateReviewSetup(root, {
      users: ['codex'],
      tokenPathFn: user => path.join(root, '.forgejo-local', 'tokens', user),
      getRemoteUrlFn: () => null,
      remoteUrlFn: () => null,
    });
    assert.equal(result.required, false);
    assert.equal(result.ok, true);

    writeConfig(root);
    fs.mkdirSync(path.join(root, '.forgejo-local', 'tokens'), { recursive: true });
    fs.writeFileSync(path.join(root, '.forgejo-local', 'tokens', 'codex'), 'token\n');
    result = evaluateReviewSetup(root, {
      users: ['codex'],
      tokenPathFn: user => path.join(root, '.forgejo-local', 'tokens', user),
      getRemoteUrlFn: () => 'http://localhost:3300/test-org/test-repo.git',
      remoteUrlFn: () => 'http://localhost:3300/test-org/test-repo.git',
      requestFn: () => ({ ok: true, statusCode: 200, data: { id: 1 } }),
    });
    assert.deepEqual(result, { required: true, ok: true, issues: [], steps: [] });
  });
});

test('evaluateReviewSetup reports invalid Forgejo tokens', async () => {
  await withTempDir(async root => {
    writeConfig(root);
    fs.mkdirSync(path.join(root, '.forgejo-local', 'tokens'), { recursive: true });
    fs.writeFileSync(path.join(root, '.forgejo-local', 'tokens', 'codex'), 'token\n');

    const result = evaluateReviewSetup(root, {
      users: ['codex'],
      tokenPathFn: user => path.join(root, '.forgejo-local', 'tokens', user),
      getRemoteUrlFn: () => 'http://localhost:3300/test-org/test-repo.git',
      remoteUrlFn: () => 'http://localhost:3300/test-org/test-repo.git',
      requestFn: () => ({ ok: false, statusCode: 401, data: { message: 'denied' } }),
    });

    assert.equal(result.required, true);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some(issue => issue.includes('invalid or expired')));
    assert.ok(result.steps.some(step => step.includes('setup-review')));
  });
});

test('bootstrapReviewSurface writes token files and configures the review remote', async () => {
  await withTempDir(async root => {
    writeConfig(root);
    const forgejoHome = path.join(root, '.forgejo-local');
    spawnSync('git', ['init', '-b', 'main'], { cwd: root, encoding: 'utf8' });

    const requests = [];
    const requestFn = (method, url, requestOptions = {}) => {
      requests.push({ method, url, requestOptions });
      if (method === 'POST' && url.endsWith('/api/v1/users/magnus/tokens')) {
        return { ok: true, statusCode: 201, data: { sha1: 'owner-token' } };
      }
      if (method === 'GET' && url.endsWith('/api/v1/repos/test-org/test-repo')) {
        return { ok: false, statusCode: 404, data: {} };
      }
      if (method === 'POST' && url.endsWith('/api/v1/orgs/test-org/repos')) {
        return { ok: true, statusCode: 201, data: { full_name: 'test-org/test-repo' } };
      }
      if (method === 'PUT' && url.endsWith('/api/v1/repos/test-org/test-repo/collaborators/codex')) {
        return { ok: true, statusCode: 204, data: {} };
      }
      if (method === 'POST' && url.endsWith('/api/v1/users/codex/tokens')) {
        return { ok: true, statusCode: 201, data: { sha1: 'codex-token' } };
      }
      return { ok: false, statusCode: 500, data: { error: 'unexpected request' } };
    };

    const result = await bootstrapReviewSurface(root, {
      baseUrl: 'http://localhost:3300/',
      repo: 'test-org/test-repo',
      ownerLogin: 'magnus',
      ownerPassword: 'secret',
      agentPasswords: [{ user: 'codex', password: 'agent-secret' }],
    }, {
      requestFn,
      forgejoHome,
      log: () => {},
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(fs.readFileSync(path.join(forgejoHome, 'tokens', 'magnus'), 'utf8').trim(), 'owner-token');
    assert.equal(fs.readFileSync(path.join(forgejoHome, 'tokens', 'codex'), 'utf8').trim(), 'codex-token');
    const ownerTokenRequest = requests.find(entry => entry.method === 'POST' && entry.url.endsWith('/api/v1/users/magnus/tokens'));
    assert.deepEqual(ownerTokenRequest.requestOptions.body.scopes, ['write:user', 'write:repository', 'write:issue', 'write:organization']);
    assert.ok(requests.some(entry => entry.method === 'PUT' && entry.url.endsWith('/api/v1/repos/test-org/test-repo/collaborators/codex')));

    const remoteUrl = spawnSync('git', ['-C', root, 'remote', 'get-url', 'review'], { encoding: 'utf8' });
    assert.equal(remoteUrl.status, 0, remoteUrl.stderr);
    assert.equal(remoteUrl.stdout.trim(), 'http://localhost:3300/test-org/test-repo.git');
    assert.ok(requests.some(entry => entry.url.endsWith('/api/v1/orgs/test-org/repos')));
  });
});

test('createToken reports API failures and missing token payloads', () => {
  let seenBody = null;
  let result = createToken('http://localhost:3300/', 'codex', 'pw', 'workflow-codex', (_method, _url, requestOptions = {}) => {
    seenBody = requestOptions.body;
    return {
      ok: false,
      statusCode: 401,
      data: { message: 'denied' },
    };
  });
  assert.deepEqual(seenBody.scopes, ['write:user', 'write:repository', 'write:issue', 'write:organization']);
  assert.equal(result.ok, false);
  assert.match(result.error, /HTTP 401/);

  result = createToken('http://localhost:3300/', 'magnus', 'pw', 'workflow-magnus', () => ({
    ok: true,
    statusCode: 201,
    data: { sha1: 'owner-token' },
  }), ['write:user', 'write:repository']);
  assert.equal(result.ok, true);

  result = createToken('http://localhost:3300/', 'codex', 'pw', 'workflow-codex', () => ({
    ok: true,
    statusCode: 201,
    data: {},
  }));
  assert.equal(result.ok, false);
  assert.match(result.error, /did not return a token/);
});

test('ensureRepo handles invalid slugs, existing repos, user repos, and creation failures', () => {
  let result = ensureRepo('http://localhost:3300', 'broken', 'magnus', 'token', () => ({ ok: true }));
  assert.equal(result.ok, false);
  assert.match(result.error, /invalid review repo slug/);

  result = ensureRepo('http://localhost:3300', 'magnus/demo', 'magnus', 'token', (method, url) => {
    if (method === 'GET' && url.endsWith('/api/v1/repos/magnus/demo')) {
      return { ok: true, statusCode: 200, data: {} };
    }
    return { ok: false, statusCode: 500, data: {} };
  });
  assert.deepEqual(result, { ok: true, created: false });

  const seen = [];
  result = ensureRepo('http://localhost:3300', 'magnus/demo', 'magnus', 'token', (method, url, requestOptions = {}) => {
    seen.push({ method, url, requestOptions });
    if (method === 'GET') {
      return { ok: false, statusCode: 404, data: {} };
    }
    return { ok: true, statusCode: 201, data: {} };
  });
  assert.equal(result.ok, true);
  assert.ok(seen.some(entry => entry.url.endsWith('/api/v1/user/repos')));

  result = ensureRepo('http://localhost:3300', 'test-org/demo', 'magnus', 'token', (method, url) => {
    if (method === 'GET') {
      return { ok: false, statusCode: 500, data: { message: 'boom' } };
    }
    return { ok: false, statusCode: 500, data: {} };
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /failed to check review repo/);

  result = ensureRepo('http://localhost:3300', 'test-org/demo', 'magnus', 'token', (method, url) => {
    if (method === 'GET') {
      return { ok: false, statusCode: 404, data: {} };
    }
    return { ok: false, statusCode: 403, data: { message: 'nope' } };
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /failed to create review repo/);
});

test('collectSetupAnswers uses defaults and skips blank agent passwords', async () => {
  await withTempDir(async root => {
    writeConfig(root);
    const prompts = [];
    const answers = ['', 'owner-password', '', 'agent-password', ''];
    const result = await collectSetupAnswers(root, {
      users: ['codex', 'claude'],
      log: () => {},
      promptFn: async (prompt, promptOptions = {}) => {
        prompts.push({ prompt, promptOptions });
        return answers.shift();
      },
    });

    assert.equal(result.baseUrl, 'http://localhost:3300');
    assert.equal(result.repo, 'test-org/test-repo');
    assert.equal(result.ownerLogin, 'test-org');
    assert.equal(result.ownerPassword, 'owner-password');
    assert.deepEqual(result.agentPasswords, [{ user: 'codex', password: 'agent-password' }]);
    assert.ok(prompts.some(entry => entry.prompt.includes('Password for codex')));
    assert.ok(prompts.some(entry => entry.promptOptions.hidden === false));
  });
});

test('collectWizardAnswers uses default layout answers and bootstrap defaults', async () => {
  await withTempDir(async root => {
    const prompts = [];
    const logs = [];
    const answers = ['', '', '', '', '', '', '', 'owner-password', '', 'agent-password', ''];
    const result = await collectWizardAnswers(root, {
      users: ['codex', 'claude'],
      log: message => logs.push(message),
      loadWorkflowConfigFn: () => ({ found: false, config: null }),
      detectPrimaryBranchDefaultFn: () => 'main',
      promptFn: async (prompt, promptOptions = {}) => {
        prompts.push({ prompt, promptOptions });
        return answers.shift() ?? '';
      },
    });

    assert.equal(result.productName, path.basename(root));
    assert.equal(result.tasksProvider, 'backlog-md');
    assert.equal(result.verificationCommand, 'npm test');
    assert.equal(result.primaryBranch, 'main');
    assert.equal(result.reviewRepo, `human/${path.basename(root)}`);
    assert.equal(result.bootstrapReview, true);
    assert.deepEqual(result.agentPasswords, [{ user: 'codex', password: 'agent-password' }]);
    assert.ok(prompts.some(entry => entry.prompt.includes('Backlog.md-style workflow layout')));
    assert.ok(prompts.some(entry => entry.prompt.includes('repo-owner password and optional agent passwords')));
    assert.ok(logs.some(message => message.includes('Standard workflow layout:')));
    assert.ok(logs.some(message => message.includes('Hidden password prompts are next')));
  });
});

test('collectWizardAnswers repairs a stale configured master default when the repo primary branch is main', async () => {
  await withTempDir(async root => {
    writeConfig(root);
    const answers = ['Demo', 'n', '', '', '', '', '', '', '', '', '', '', '', '', 'n'];
    const result = await collectWizardAnswers(root, {
      log: () => {},
      detectPrimaryBranchDefaultFn: () => 'main',
      promptFn: async () => answers.shift() ?? '',
    });

    assert.equal(result.primaryBranch, 'main');
  });
});

test('collectWizardAnswers supports custom layout and skipping bootstrap', async () => {
  await withTempDir(async root => {
    writeConfig(root, { repo: 'acme/demo', remote: 'review-remote' });
    const answers = [
      'Acme Workflow',
      'n',
      'owner',
      'acme/repo',
      'http://forgejo.local:3000',
      'review2',
      'forgejo-tasks',
      'tracker',
      'missions',
      'feature/',
      'trunk',
      '../wt/<repo>-<slug>',
      'npm run verify:{{area}}',
      'workflow',
      'n',
    ];
    const result = await collectWizardAnswers(root, {
      users: ['codex'],
      log: () => {},
      promptFn: async () => answers.shift() ?? '',
    });

    assert.equal(result.productName, 'Acme Workflow');
    assert.equal(result.tasksProvider, 'forgejo-tasks');
    assert.equal(result.tasksStorage, 'tracker');
    assert.equal(result.missionsBaseDir, 'missions');
    assert.equal(result.branchPrefix, 'feature/');
    assert.equal(result.primaryBranch, 'trunk');
    assert.equal(result.worktreePattern, '../wt/<repo>-<slug>');
    assert.equal(result.verificationCommand, 'npm run verify:{{area}}');
    assert.equal(result.verificationDefaultArea, 'workflow');
    assert.equal(result.ownerLogin, 'owner');
    assert.equal(result.reviewRepo, 'acme/repo');
    assert.equal(result.baseUrl, 'http://forgejo.local:3000');
    assert.equal(result.reviewRemote, 'review2');
    assert.equal(result.bootstrapReview, false);
  });
});

test('buildWorkflowConfig and writeWorkflowConfig create a usable workflow.config.json', async () => {
  await withTempDir(async root => {
    const config = buildWorkflowConfig({
      productName: 'Demo',
      tasksProvider: 'backlog-md',
      tasksStorage: 'backlog',
      missionsBaseDir: 'docs/missions',
      branchPrefix: 'mission/',
      primaryBranch: 'main',
      worktreePattern: '../<repo>-<slug>',
      verificationCommand: 'npm test',
      verificationDefaultArea: 'docs',
      baseUrl: 'http://localhost:3300/',
      reviewRemote: 'review',
      reviewRepo: 'magnus/demo',
    });
    const configPath = writeWorkflowConfig(root, config);
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    assert.equal(parsed.product.name, 'Demo');
    assert.equal(parsed.adapters.review.baseUrl, 'http://localhost:3300');
    assert.equal(parsed.adapters.review.repo, 'magnus/demo');
    assert.equal(Object.prototype.hasOwnProperty.call(parsed.adapters.missions, 'primaryBranch'), false);
  });
});

test('buildWorkflowConfig preserves explicit nonstandard primary branches', () => {
  const config = buildWorkflowConfig({
    productName: 'Demo',
    tasksProvider: 'backlog-md',
    tasksStorage: 'backlog',
    missionsBaseDir: 'docs/missions',
    branchPrefix: 'mission/',
    primaryBranch: 'trunk',
    worktreePattern: '../<repo>-<slug>',
    verificationCommand: 'npm test',
    verificationDefaultArea: 'docs',
    baseUrl: 'http://localhost:3300/',
    reviewRemote: 'review',
    reviewRepo: 'magnus/demo',
  });

  assert.equal(config.adapters.missions.primaryBranch, 'trunk');
});

test('ensureReviewRemote adds and updates git remotes and readConfiguredReviewRemote reads them', async () => {
  await withTempDir(async root => {
    spawnSync('git', ['init', '-b', 'main'], { cwd: root, encoding: 'utf8' });

    let result = ensureReviewRemote(root, 'review', 'http://localhost:3300/test-org/test-repo.git');
    assert.equal(result.ok, true);
    assert.equal(result.created, true);
    assert.equal(readConfiguredReviewRemote(root, 'review'), 'http://localhost:3300/test-org/test-repo.git');

    result = ensureReviewRemote(root, 'review', 'http://localhost:3300/test-org/other-repo.git');
    assert.equal(result.ok, true);
    assert.equal(result.updated, true);
    assert.equal(readConfiguredReviewRemote(root, 'review'), 'http://localhost:3300/test-org/other-repo.git');
  });
});

test('apiRequest handles success, plain-text payloads, and curl failures', () => {
  const setupReviewModule = loadSetupReviewWithSpawn((_command, args, options = {}) => {
    if (args.includes('http://localhost:3300/success')) {
      assert.equal(options.input, JSON.stringify({ hello: 'world' }));
      return { status: 0, stdout: '{"ok":true}\n201' };
    }
    if (args.includes('http://localhost:3300/text')) {
      return { status: 0, stdout: 'not-json\n200' };
    }
    return { status: 7, stdout: '', stderr: 'connection refused' };
  });

  let result = setupReviewModule.apiRequest('POST', 'http://localhost:3300/success', {
    basicAuth: { user: 'codex', password: 'pw' },
    body: { hello: 'world' },
  });
  assert.equal(result.ok, true);
  assert.equal(result.statusCode, 201);
  assert.deepEqual(result.data, { ok: true });

  result = setupReviewModule.apiRequest('GET', 'http://localhost:3300/text');
  assert.equal(result.ok, true);
  assert.equal(result.data, 'not-json');

  result = setupReviewModule.apiRequest('GET', 'http://localhost:3300/fail');
  assert.equal(result.ok, false);
  assert.match(result.error, /connection refused/);
});

test('promptLine supports visible and hidden prompts', async () => {
  const writes = [];
  const output = {
    write(chunk, _encoding, cb) {
      writes.push(chunk);
      if (typeof cb === 'function') cb();
      return true;
    },
  };

  const answers = [' visible ', ' secret '];
  const mocked = mock.method(readline, 'createInterface', ({ output: rlOutput }) => ({
    stdoutMuted: false,
    question(_prompt, callback) {
      if (rlOutput) {
        rlOutput.write('typed');
      }
      callback(answers.shift());
    },
    close() {},
  }));

  try {
    const visible = await require('../lib/tools/setup-review').promptLine('Prompt: ', { output });
    const hidden = await require('../lib/tools/setup-review').promptLine('Secret: ', { hidden: true, output });
    assert.equal(visible, 'visible');
    assert.equal(hidden, 'secret');
    assert.ok(writes.includes('typed'));
    assert.ok(writes.includes('Secret: '));
    assert.ok(writes.includes('*****'));
    assert.ok(writes.includes('\n'));
  } finally {
    mocked.mock.restore();
  }
});

test('bootstrapReviewSurface reprompts on Forgejo auth failure and succeeds on retry', async () => {
  await withTempDir(async root => {
    writeConfig(root);
    const forgejoHome = path.join(root, '.forgejo-local');
    spawnSync('git', ['init', '-b', 'main'], { cwd: root, encoding: 'utf8' });

    const prompts = [];
    const logs = [];
    let ownerAttempts = 0;
    let agentAttempts = 0;
    const result = await bootstrapReviewSurface(root, {
      baseUrl: 'http://localhost:3300',
      repo: 'test-org/test-repo',
      ownerLogin: 'magnus',
      ownerPassword: 'wrong-owner-password',
      agentPasswords: [{ user: 'codex', password: 'wrong-agent-password' }],
    }, {
      log: message => logs.push(message),
      forgejoHome,
      promptFn: async (prompt, promptOptions = {}) => {
        prompts.push({ prompt, promptOptions });
        if (prompt === 'Password for magnus (input visible): ') return 'owner-password';
        if (prompt === 'Password for codex (input visible, leave blank to skip token creation): ') return 'agent-password';
        return '';
      },
      requestFn(method, url, requestOptions = {}) {
        if (method === 'POST' && url.endsWith('/api/v1/users/magnus/tokens')) {
          ownerAttempts += 1;
          if (ownerAttempts === 1) {
            return { ok: false, statusCode: 401, data: { message: 'denied' } };
          }
          return { ok: true, statusCode: 201, data: { sha1: 'owner-token' } };
        }
        if (method === 'GET' && url.endsWith('/api/v1/repos/test-org/test-repo')) {
          return { ok: true, statusCode: 200, data: {} };
        }
        if (method === 'PUT' && url.endsWith('/api/v1/repos/test-org/test-repo/collaborators/codex')) {
          return { ok: true, statusCode: 204, data: {} };
        }
        if (method === 'POST' && url.endsWith('/api/v1/users/codex/tokens')) {
          agentAttempts += 1;
          if (agentAttempts === 1) {
            return { ok: false, statusCode: 403, data: { message: 'denied' } };
          }
          return { ok: true, statusCode: 201, data: { sha1: 'codex-token' } };
        }
        return { ok: false, statusCode: 500, data: { message: 'unexpected request' } };
      },
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(ownerAttempts, 2);
    assert.equal(agentAttempts, 2);
    assert.equal(prompts.filter(entry => entry.prompt === 'Password for magnus (input visible): ').length, 1);
    assert.equal(prompts.filter(entry => entry.prompt === 'Password for codex (input visible, leave blank to skip token creation): ').length, 1);
    assert.ok(prompts.every(entry => entry.prompt.includes('Password') ? entry.promptOptions.hidden === false : true));
    assert.ok(logs.some(message => message.includes('authentication failed for magnus')));
    assert.ok(logs.some(message => message.includes('authentication failed for codex')));
  });
});

test('bootstrapReviewSurface uses unique token names across reruns', async () => {
  await withTempDir(async root => {
    writeConfig(root);
    const forgejoHome = path.join(root, '.forgejo-local');
    spawnSync('git', ['init', '-b', 'main'], { cwd: root, encoding: 'utf8' });

    const seenTokenNames = new Set();
    const requestFn = (method, url, requestOptions = {}) => {
      if (method === 'POST' && url.includes('/tokens')) {
        const tokenName = requestOptions.body && requestOptions.body.name;
        assert.ok(tokenName);
        assert.equal(seenTokenNames.has(tokenName), false);
        seenTokenNames.add(tokenName);
        return { ok: true, statusCode: 201, data: { sha1: `${tokenName}-sha1` } };
      }
      if (method === 'GET' && url.endsWith('/api/v1/repos/test-org/test-repo')) {
        return { ok: true, statusCode: 200, data: {} };
      }
      if (method === 'PUT' && url.includes('/api/v1/repos/test-org/test-repo/collaborators/')) {
        return { ok: true, statusCode: 204, data: {} };
      }
      return { ok: false, statusCode: 500, data: { message: 'unexpected request' } };
    };

    let result = await bootstrapReviewSurface(root, {
      baseUrl: 'http://localhost:3300',
      repo: 'test-org/test-repo',
      ownerLogin: 'magnus',
      ownerPassword: 'owner-password',
      agentPasswords: [{ user: 'codex', password: 'agent-password' }],
    }, {
      log: () => {},
      forgejoHome,
      requestFn,
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    result = await bootstrapReviewSurface(root, {
      baseUrl: 'http://localhost:3300',
      repo: 'test-org/test-repo',
      ownerLogin: 'magnus',
      ownerPassword: 'owner-password',
      agentPasswords: [{ user: 'codex', password: 'agent-password' }],
    }, {
      log: () => {},
      forgejoHome,
      requestFn,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(seenTokenNames.size, 4);
  });
});

test('bootstrapReviewSurface reports local validation and downstream setup failures', async () => {
  await withTempDir(async root => {
    writeConfig(root);
    const forgejoHome = path.join(root, '.forgejo-local');
    spawnSync('git', ['init', '-b', 'main'], { cwd: root, encoding: 'utf8' });

    let result = await bootstrapReviewSurface(root, {
      baseUrl: '',
      repo: '',
      ownerLogin: 'magnus',
      ownerPassword: 'pw',
      agentPasswords: [],
    }, { log: () => {}, forgejoHome });
    assert.equal(result.ok, false);
    assert.match(result.error, /must define adapters.review.baseUrl/);

    result = await bootstrapReviewSurface(root, {
      baseUrl: 'http://localhost:3300',
      repo: 'test-org/test-repo',
      ownerLogin: 'magnus',
      ownerPassword: '',
      agentPasswords: [],
    }, { log: () => {}, forgejoHome });
    assert.equal(result.ok, false);
    assert.match(result.error, /Password is required/);

    result = await bootstrapReviewSurface(root, {
      baseUrl: 'http://localhost:3300',
      repo: 'test-org/test-repo',
      ownerLogin: 'magnus',
      ownerPassword: 'pw',
      agentPasswords: [],
    }, {
      log: () => {},
      forgejoHome,
      requestFn: () => ({ ok: false, statusCode: 401, data: { message: 'denied' } }),
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /token creation failed/);

    result = await bootstrapReviewSurface(root, {
      baseUrl: 'http://localhost:3300',
      repo: 'test-org/test-repo',
      ownerLogin: 'magnus',
      ownerPassword: 'pw',
      agentPasswords: [{ user: 'codex', password: 'pw2' }],
    }, {
      log: () => {},
      forgejoHome,
      requestFn(method, url) {
        if (method === 'POST' && url.endsWith('/api/v1/users/magnus/tokens')) {
          return { ok: true, statusCode: 201, data: { sha1: 'owner-token' } };
        }
        if (method === 'GET' && url.endsWith('/api/v1/repos/test-org/test-repo')) {
          return { ok: true, statusCode: 200, data: {} };
        }
        if (method === 'PUT' && url.includes('/api/v1/repos/test-org/test-repo/collaborators/')) {
          return { ok: true, statusCode: 204, data: {} };
        }
        if (method === 'POST' && url.endsWith('/api/v1/users/codex/tokens')) {
          return { ok: false, statusCode: 403, data: { message: 'denied' } };
        }
        return { ok: false, statusCode: 500, data: {} };
      },
    });
    assert.equal(result.ok, true);
    assert.equal(fs.readFileSync(path.join(forgejoHome, 'tokens', 'magnus'), 'utf8').trim(), 'owner-token');
    assert.equal(fs.existsSync(path.join(forgejoHome, 'tokens', 'codex')), false);
    assert.equal(result.warnings.length, 1);
    assert.equal(result.warnings[0].user, 'codex');
    assert.match(result.warnings[0].error, /token creation failed for codex/);
  });
});

test('runVerifyEnv delegates to injectable verifier', async () => {
  const calls = [];
  const result = await runVerifyEnv('/tmp/demo', {
    verifyFn: (rootDir) => {
      calls.push(rootDir);
      return { status: 0 };
    },
  });
  assert.deepEqual(calls, ['/tmp/demo']);
  assert.equal(result.status, 0);
});

test('setupReview surfaces bootstrap failures with Forgejo response details', async () => {
  await withTempDir(async root => {
    writeConfig(root);
    const errors = [];
    const exits = [];
    await setupReview([], {
      rootDir: root,
      log: () => {},
      error: message => errors.push(message),
      exit: code => exits.push(code),
      promptFn: async (prompt) => {
        if (prompt.includes('repo-create access')) return '';
        if (prompt.includes('Password for test-org (input visible):')) return 'owner-password';
        if (prompt.includes('Agent Forgejo users')) return 'codex';
        if (prompt.includes('Password for codex')) return 'codex-password';
        return '';
      },
      requestFn: () => ({ ok: false, statusCode: 401, data: { message: 'denied' } }),
    });

    assert.deepEqual(exits, [1]);
    assert.ok(errors.some(message => message.includes('token creation failed')));
    assert.ok(errors.some(message => message.includes('Forgejo response')));
  });
});

test('setupWizard writes config, bootstraps review, and verifies the install', async () => {
  await withTempDir(async root => {
    const logs = [];
    const exits = [];
    spawnSync('git', ['init', '-b', 'main'], { cwd: root, encoding: 'utf8' });
    await setupWizard([], {
      rootDir: root,
      log: message => logs.push(message),
      error: message => logs.push(message),
      exit: code => exits.push(code),
      promptFn: async (prompt) => {
        if (prompt.startsWith('Product name')) return '';
        if (prompt.includes('Use the standard workflow layout')) return '';
        if (prompt.includes('Forgejo login with repo-create access')) return 'magnus';
        if (prompt.includes('Forgejo review repo')) return 'magnus/demo';
        if (prompt.includes('Forgejo base URL')) return 'http://localhost:3300';
        if (prompt.includes('Git review remote name')) return 'review';
        if (prompt.includes('Create/update the Forgejo repo')) return '';
        if (prompt.includes('Password for magnus')) return 'owner-password';
        if (prompt.includes('Agent Forgejo users')) return 'codex';
        if (prompt.includes('Password for codex')) return 'codex-password';
        return '';
      },
      requestFn(method, url) {
        if (method === 'POST' && url.endsWith('/api/v1/users/magnus/tokens')) return { ok: true, statusCode: 201, data: { sha1: 'owner-token' } };
        if (method === 'GET' && url.endsWith('/api/v1/repos/magnus/demo')) return { ok: false, statusCode: 404, data: {} };
        if (method === 'POST' && url.endsWith('/api/v1/user/repos')) return { ok: true, statusCode: 201, data: {} };
        if (method === 'PUT' && url.includes('/api/v1/repos/magnus/demo/collaborators/')) return { ok: true, statusCode: 204, data: {} };
        if (method === 'POST' && url.endsWith('/api/v1/users/codex/tokens')) return { ok: true, statusCode: 201, data: { sha1: 'codex-token' } };
        return { ok: false, statusCode: 500, data: {} };
      },
      verifyFn: () => ({ status: 0 }),
    });

    const parsed = JSON.parse(fs.readFileSync(path.join(root, 'workflow.config.json'), 'utf8'));
    assert.equal(parsed.adapters.review.repo, 'magnus/demo');
    assert.deepEqual(exits, []);
    assert.ok(logs.some(message => message.includes('Wrote')));
  });
});

test('setupWizard continues when optional agent token creation fails', async () => {
  await withTempDir(async root => {
    const logs = [];
    const exits = [];
    spawnSync('git', ['init', '-b', 'main'], { cwd: root, encoding: 'utf8' });
    await setupWizard([], {
      rootDir: root,
      log: message => logs.push(message),
      error: message => logs.push(message),
      exit: code => exits.push(code),
      promptFn: async (prompt) => {
        if (prompt.startsWith('Product name')) return '';
        if (prompt.includes('Use the standard workflow layout')) return '';
        if (prompt.includes('Forgejo login with repo-create access')) return 'magnus';
        if (prompt.includes('Forgejo review repo')) return 'magnus/demo';
        if (prompt.includes('Forgejo base URL')) return 'http://localhost:3300';
        if (prompt.includes('Git review remote name')) return 'review';
        if (prompt.includes('Create/update the Forgejo repo')) return 'y';
        if (prompt === 'Password for magnus (input visible): ') return 'owner-password';
        if (prompt.includes('Agent Forgejo users')) return 'codex';
        if (prompt.includes('Password for codex')) return 'wrong-password';
        return '';
      },
      requestFn(method, url) {
        if (method === 'POST' && url.endsWith('/api/v1/users/magnus/tokens')) {
          return { ok: true, statusCode: 201, data: { sha1: 'owner-token' } };
        }
        if (method === 'GET' && url.endsWith('/api/v1/repos/magnus/demo')) {
          return { ok: false, statusCode: 404, data: {} };
        }
        if (method === 'POST' && url.endsWith('/api/v1/user/repos')) {
          return { ok: true, statusCode: 201, data: { full_name: 'magnus/demo' } };
        }
        if (method === 'PUT' && url.includes('/api/v1/repos/magnus/demo/collaborators/')) {
          return { ok: true, statusCode: 204, data: {} };
        }
        if (method === 'POST' && url.endsWith('/api/v1/users/codex/tokens')) {
          return { ok: false, statusCode: 401, data: { message: 'invalid password' } };
        }
        return { ok: false, statusCode: 500, data: {} };
      },
      verifyFn: () => ({ status: 0 }),
    });

    assert.deepEqual(exits, []);
    assert.ok(logs.some(message => message.includes('Skipping Forgejo token for codex')));
    assert.ok(logs.some(message => message.includes('Forgejo response for codex')));
    assert.ok(fs.existsSync(path.join(root, '.forgejo-local', 'tokens', 'magnus')));
    assert.equal(fs.existsSync(path.join(root, '.forgejo-local', 'tokens', 'codex')), false);
  });
});

test('setupWizard writes Forgejo tokens under rootDir when cwd differs', async () => {
  await withTempDir(async root => {
    const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-setup-review-cwd-'));
    const previousCwd = process.cwd();
    try {
      process.chdir(otherDir);
      spawnSync('git', ['init', '-b', 'main'], { cwd: root, encoding: 'utf8' });
      await setupWizard([], {
        rootDir: root,
        log: () => {},
        error: () => {},
        exit: code => assert.fail(`unexpected exit ${code}`),
        promptFn: async (prompt) => {
          if (prompt.startsWith('Product name')) return '';
          if (prompt.includes('Use the standard workflow layout')) return '';
          if (prompt.includes('Forgejo login with repo-create access')) return 'magnus';
          if (prompt.includes('Forgejo review repo')) return 'magnus/demo';
          if (prompt.includes('Forgejo base URL')) return 'http://localhost:3300';
          if (prompt.includes('Git review remote name')) return 'review';
          if (prompt.includes('Create/update the Forgejo repo')) return '';
          if (prompt.includes('Password for magnus')) return 'owner-password';
          if (prompt.includes('Agent Forgejo users')) return 'codex';
          if (prompt.includes('Password for codex')) return 'codex-password';
          return '';
        },
        requestFn(method, url) {
          if (method === 'POST' && url.endsWith('/api/v1/users/magnus/tokens')) return { ok: true, statusCode: 201, data: { sha1: 'owner-token' } };
          if (method === 'GET' && url.endsWith('/api/v1/repos/magnus/demo')) return { ok: false, statusCode: 404, data: {} };
          if (method === 'POST' && url.endsWith('/api/v1/user/repos')) return { ok: true, statusCode: 201, data: {} };
          if (method === 'PUT' && url.includes('/api/v1/repos/magnus/demo/collaborators/')) return { ok: true, statusCode: 204, data: {} };
          if (method === 'POST' && url.endsWith('/api/v1/users/codex/tokens')) return { ok: true, statusCode: 201, data: { sha1: 'codex-token' } };
          return { ok: false, statusCode: 500, data: {} };
        },
        verifyFn: () => ({ status: 0 }),
      });

      assert.equal(fs.readFileSync(path.join(root, '.forgejo-local', 'tokens', 'magnus'), 'utf8').trim(), 'owner-token');
      assert.equal(fs.readFileSync(path.join(root, '.forgejo-local', 'tokens', 'codex'), 'utf8').trim(), 'codex-token');
      assert.equal(fs.existsSync(path.join(otherDir, '.forgejo-local', 'tokens', 'magnus')), false);
      assert.equal(fs.existsSync(path.join(otherDir, '.forgejo-local', 'tokens', 'codex')), false);
    } finally {
      process.chdir(previousCwd);
      fs.rmSync(otherDir, { recursive: true, force: true });
    }
  });
});

test('setupWizard exits when bootstrap or verify fails', async () => {
  await withTempDir(async root => {
    const exits = [];
    await setupWizard([], {
      rootDir: root,
      log: () => {},
      error: () => {},
      exit: code => exits.push(code),
      promptFn: async (prompt) => {
        if (prompt.startsWith('Product name')) return '';
        if (prompt.includes('Use the standard workflow layout')) return '';
        if (prompt.includes('Forgejo login with repo-create access')) return 'magnus';
        if (prompt.includes('Forgejo review repo')) return 'magnus/demo';
        if (prompt.includes('Forgejo base URL')) return 'http://localhost:3300';
        if (prompt.includes('Git review remote name')) return 'review';
        if (prompt.includes('Create/update the Forgejo repo')) return '';
        if (prompt.includes('Password for magnus')) return '';
        if (prompt.includes('Agent Forgejo users')) return 'codex';
        if (prompt.includes('Password for codex')) return '';
        return '';
      },
      requestFn: () => ({ ok: false, statusCode: 500, data: {} }),
      verifyFn: () => ({ status: 7 }),
    });
    assert.deepEqual(exits, [1]);
  });

  await withTempDir(async root => {
    const exits = [];
    await setupWizard([], {
      rootDir: root,
      log: () => {},
      error: () => {},
      exit: code => exits.push(code),
      promptFn: async (prompt) => {
        if (prompt.startsWith('Product name')) return '';
        if (prompt.includes('Use the standard workflow layout')) return '';
        if (prompt.includes('Forgejo login with repo-create access')) return 'magnus';
        if (prompt.includes('Forgejo review repo')) return 'magnus/demo';
        if (prompt.includes('Forgejo base URL')) return 'http://localhost:3300';
        if (prompt.includes('Git review remote name')) return 'review';
        if (prompt.includes('Create/update the Forgejo repo')) return 'n';
        return '';
      },
      verifyFn: () => ({ status: 7 }),
    });
    assert.deepEqual(exits, [7]);
  });
});

test('bootstrapReviewSurface non-interactive mode creates agent token via owner token', async () => {
  await withTempDir(async root => {
    spawnSync('git', ['init', '-b', 'main'], { cwd: root, encoding: 'utf8' });
    writeConfig(root);
    const forgejoHome = path.join(root, '.forgejo-local');
    fs.mkdirSync(path.join(forgejoHome, 'tokens'), { recursive: true });
    fs.writeFileSync(path.join(forgejoHome, 'tokens', 'magnus'), 'owner-pat\n');
    const logs = [];
    let repoCreated = false;

    const previousForgejoHome = process.env.FORGEJO_HOME;
    process.env.FORGEJO_HOME = forgejoHome;
    try {
      const result = await bootstrapReviewSurface(root, {
        baseUrl: 'http://localhost:3300',
        repo: 'test-org/test-repo',
        ownerLogin: 'magnus',
        ownerPassword: '',
        agentPasswords: [{ user: 'qwen', password: '' }],
      }, {
        interactive: false,
        requestFn(method, url, requestOptions = {}) {
          if (method === 'GET' && url.endsWith('/api/v1/repos/test-org/test-repo')) {
            return { ok: false, statusCode: 404, data: {} };
          }
          if (method === 'POST' && url.endsWith('/api/v1/orgs/test-org/repos')) {
            repoCreated = true;
            return { ok: true, statusCode: 201, data: { full_name: 'test-org/test-repo' } };
          }
          if (method === 'PUT' && url.endsWith('/api/v1/repos/test-org/test-repo/collaborators/qwen')) {
            return { ok: true, statusCode: 204, data: {} };
          }
          if (method === 'POST' && url.endsWith('/api/v1/users/qwen/tokens') && requestOptions.token) {
            assert.equal(requestOptions.token, 'owner-pat');
            return { ok: true, statusCode: 201, data: { sha1: 'qwen-bootstrap-token' } };
          }
          return { ok: false, statusCode: 500, data: {} };
        },
        forgejoHome,
        log: message => logs.push(message),
      });

      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(repoCreated, true);
      assert.equal(fs.readFileSync(path.join(forgejoHome, 'tokens', 'qwen'), 'utf8').trim(), 'qwen-bootstrap-token');
      assert.ok(logs.some(m => m.includes('Wrote Forgejo token for qwen')));
      assert.ok(fs.readFileSync(path.join(forgejoHome, 'tokens', 'magnus'), 'utf8').trim() === 'owner-pat');
    } finally {
      if (previousForgejoHome) {
        process.env.FORGEJO_HOME = previousForgejoHome;
      } else {
        delete process.env.FORGEJO_HOME;
      }
    }
  });
});

test('bootstrapReviewSurface non-interactive returns error when no owner token exists', async () => {
  await withTempDir(async root => {
    writeConfig(root);
    const forgejoHome = path.join(root, '.forgejo-local');
    fs.mkdirSync(path.join(forgejoHome, 'tokens'), { recursive: true });
    const previousForgejoHome = process.env.FORGEJO_HOME;
    process.env.FORGEJO_HOME = forgejoHome;
    try {
      const result = await bootstrapReviewSurface(root, {
        baseUrl: 'http://localhost:3300',
        repo: 'test-org/test-repo',
        ownerLogin: 'magnus',
        ownerPassword: '',
        agentPasswords: [{ user: 'qwen', password: '' }],
      }, {
        interactive: false,
      });

      assert.equal(result.ok, false);
      assert.ok(result.error.includes('No owner token found'));
    } finally {
      if (previousForgejoHome) {
        process.env.FORGEJO_HOME = previousForgejoHome;
      } else {
        delete process.env.FORGEJO_HOME;
      }
    }
  });
});

test('bootstrapReviewSurface non-interactive reports agent token failure via warnings', async () => {
  await withTempDir(async root => {
    spawnSync('git', ['init', '-b', 'main'], { cwd: root, encoding: 'utf8' });
    writeConfig(root);
    const forgejoHome = path.join(root, '.forgejo-local');
    fs.mkdirSync(path.join(forgejoHome, 'tokens'), { recursive: true });
    fs.writeFileSync(path.join(forgejoHome, 'tokens', 'magnus'), 'owner-pat\n');
    const previousForgejoHome = process.env.FORGEJO_HOME;
    process.env.FORGEJO_HOME = forgejoHome;
    try {
      const result = await bootstrapReviewSurface(root, {
        baseUrl: 'http://localhost:3300',
        repo: 'test-org/test-repo',
        ownerLogin: 'magnus',
        ownerPassword: '',
        agentPasswords: [{ user: 'qwen', password: '' }],
      }, {
        interactive: false,
        requestFn(method, url) {
          if (method === 'GET' && url.endsWith('/api/v1/repos/test-org/test-repo')) {
            return { ok: false, statusCode: 404, data: {} };
          }
          if (method === 'POST' && url.endsWith('/api/v1/orgs/test-org/repos')) {
            return { ok: true, statusCode: 201, data: { full_name: 'test-org/test-repo' } };
          }
          if (method === 'PUT' && url.endsWith('/api/v1/repos/test-org/test-repo/collaborators/qwen')) {
            return { ok: true, statusCode: 204, data: {} };
          }
          if (method === 'POST' && url.endsWith('/api/v1/users/qwen/tokens')) {
            return { ok: false, statusCode: 403, data: { message: 'forbidden' } };
          }
          return { ok: false, statusCode: 500, data: {} };
        },
        forgejoHome,
      });

      assert.equal(result.ok, false);
      assert.equal(result.warnings.length, 1);
      assert.equal(result.warnings[0].user, 'qwen');
      assert.match(result.error, /qwen: token creation via owner token failed/);
    } finally {
      if (previousForgejoHome) {
        process.env.FORGEJO_HOME = previousForgejoHome;
      } else {
        delete process.env.FORGEJO_HOME;
      }
    }
  });
});
