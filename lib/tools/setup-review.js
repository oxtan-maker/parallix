const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawnSync } = require('child_process');
const fmt = require('../core/fmt');
const { eligibleAgentsForStep } = require('../agents/agents');
const { resolveReviewAdapter } = require('../core/product-config');
const {
  resolveForgejoHome,
  resolveForgejoSettings,
  reviewRemoteUrl,
} = require('./forgejo');
const { loadWorkflowConfig } = require('../core/product-config');
const { ensureWorkflowGitignore } = require('../core/gitignore');

let tokenNameCounter = 0;
const REVIEW_TOKEN_SCOPES = ['write:user', 'write:repository', 'write:issue', 'write:organization'];
const PASSWORD_PROMPT_OPTIONS = { hidden: false };

function parseRepoSlug(repo) {
  if (typeof repo !== 'string') {return null;}
  const match = repo.trim().match(/^([^/\s]+)\/([^/\s]+)$/);
  if (!match) {return null;}
  return { owner: match[1], repo: match[2] };
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeBaseUrl(baseUrl) {
  return typeof baseUrl === 'string' ? baseUrl.replace(/\/+$/, '') : baseUrl;
}

function buildTokenName(repoName, user, suffix = `${Date.now()}-${++tokenNameCounter}`) {
  return `workflow-${repoName}-${user}-${suffix}`;
}

function passwordPrompt(user, options = {}) {
  const { allowBlank = false } = options;
  return allowBlank
    ? `Password for ${user} (input visible, leave blank to skip token creation): `
    : `Password for ${user} (input visible): `;
}

function parseYesNo(value, defaultValue = true) {
  if (typeof value !== 'string' || value.trim() === '') {return defaultValue;}
  const normalized = value.trim().toLowerCase();
  if (['y', 'yes'].includes(normalized)) {return true;}
  if (['n', 'no'].includes(normalized)) {return false;}
  return defaultValue;
}

function defaultProductName(rootDir = process.cwd()) {
  return path.basename(rootDir) || 'Workflow Project';
}

function defaultRepoSlug(rootDir = process.cwd(), ownerLogin = 'human') {
  return `${ownerLogin}/${path.basename(rootDir) || 'project'}`;
}

function detectPrimaryBranchDefault(rootDir = process.cwd(), options = {}) {
  const { spawnSyncFn = spawnSync, configuredPrimaryBranch = null } = options;
  const listResult = spawnSyncFn(
    'git',
    ['-C', rootDir, 'branch', '--list', '--format=%(refname:short)', 'main', 'master'],
    { encoding: 'utf8' }
  );
  const branches = listResult.status === 0
    ? (listResult.stdout || '').split('\n').map(value => value.trim()).filter(Boolean)
    : [];

  if (configuredPrimaryBranch && branches.includes(configuredPrimaryBranch)) {
    return configuredPrimaryBranch;
  }

  const currentResult = spawnSyncFn('git', ['-C', rootDir, 'branch', '--show-current'], {
    encoding: 'utf8',
  });
  const currentBranch = currentResult.status === 0 ? (currentResult.stdout || '').trim() : '';
  if (currentBranch === 'main' || currentBranch === 'master') {
    return currentBranch;
  }

  if (branches.includes('main')) {return 'main';}
  if (branches.includes('master')) {return 'master';}
  if (configuredPrimaryBranch) {return configuredPrimaryBranch;}
  return 'main';
}

function standardLayoutDescription() {
  return [
    'standard = markdown task storage in `backlog/`',
    'missions in `docs/missions/`',
    'mission/* branches with auto-detected `main`/`master` primary',
    'worktrees in `../<repo>-<slug>`',
    'verification via `npm test` with default area `docs`',
  ].join('; ');
}

function buildReviewAdapterConfig(answers) {
  const provider = answers.reviewProvider || 'forgejo';
  if (provider !== 'forgejo') {
    return { provider };
  }
  return {
    provider: 'forgejo',
    baseUrl: normalizeBaseUrl(answers.baseUrl),
    remote: answers.reviewRemote,
    repo: answers.reviewRepo,
  };
}

function buildWorkflowConfig(answers) {
  const missions = {
    baseDir: answers.missionsBaseDir,
    branchPrefix: answers.branchPrefix,
    worktreePattern: answers.worktreePattern,
  };
  if (
    typeof answers.primaryBranch === 'string' &&
    answers.primaryBranch.trim() &&
    !['main', 'master'].includes(answers.primaryBranch.trim())
  ) {
    missions.primaryBranch = answers.primaryBranch.trim();
  }

  return {
    product: {
      name: answers.productName,
      targetUser: 'Engineering teams using git, task tracking, and code review',
    },
    adapters: {
      tasks: {
        provider: answers.tasksProvider,
        storage: answers.tasksStorage,
      },
      missions,
      verification: {
        command: answers.verificationCommand,
        defaultArea: answers.verificationDefaultArea,
      },
      review: buildReviewAdapterConfig(answers),
      agents: {},
    },
  };
}

function writeWorkflowConfig(rootDir, config) {
  const configPath = path.join(rootDir, 'workflow.config.json');
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return configPath;
}

function suggestedForgejoUsers() {
  return unique([
    ...eligibleAgentsForStep('active'),
    ...eligibleAgentsForStep('review'),
  ]);
}

function tokenFilePath(user, forgejoHome = resolveForgejoHome()) {
  return path.join(forgejoHome, 'tokens', user);
}

function ensureTokenDir(forgejoHome = resolveForgejoHome()) {
  const dir = path.join(forgejoHome, 'tokens');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function resolveBootstrapForgejoHome(rootDir = process.cwd(), explicitForgejoHome) {
  if (explicitForgejoHome) {return explicitForgejoHome;}
  return path.join(rootDir, '.forgejo-local');
}

function readConfiguredReviewRemote(rootDir = process.cwd(), remoteName = 'review') {
  const result = spawnSync('git', ['-C', rootDir, 'remote', 'get-url', remoteName], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {return null;}
  return (result.stdout || '').trim() || null;
}

function evaluateReviewSetup(rootDir = process.cwd(), options = {}) {
  const {
    users = suggestedForgejoUsers(),
    remoteName,
    remoteUrlFn = reviewRemoteUrl,
    getRemoteUrlFn = readConfiguredReviewRemote,
    tokenPathFn = tokenFilePath,
    requestFn = apiRequest,
  } = options;
  const reviewAdapter = resolveReviewAdapter(rootDir);
  if (reviewAdapter.provider !== 'forgejo') {
    return {
      required: false,
      ok: true,
      issues: [],
      steps: [],
    };
  }
  const review = resolveForgejoSettings(rootDir);
  if (review.repo === '' || !review.url) {
    return {
      required: false,
      ok: true,
      issues: [],
      steps: [],
    };
  }

  const expectedRemote = remoteUrlFn(rootDir);
  const configuredRemoteName = remoteName || reviewAdapter.remote || 'review';
  const issues = [];
  const steps = [];
  const missingUsers = users.filter(user => !fs.existsSync(tokenPathFn(user)));

  if (missingUsers.length > 0) {
    issues.push(`missing Forgejo tokens for: ${missingUsers.join(', ')}`);
    steps.push('Run `px setup` and enter Forgejo passwords for the agent users you plan to run.');
  }

  const currentRemote = getRemoteUrlFn(rootDir, configuredRemoteName);
  if (!currentRemote) {
    issues.push(`git remote "${configuredRemoteName}" is missing`);
    steps.push('Run `px setup` to create the review remote.');
  } else if (expectedRemote && currentRemote !== expectedRemote) {
    issues.push(`git remote "${configuredRemoteName}" points at ${currentRemote} instead of ${expectedRemote}`);
    steps.push('Run `px setup` to update the review remote URL.');
  }

  if (missingUsers.length === 0) {
    const normalizedBaseUrl = normalizeBaseUrl(review.url);
    for (const user of users) {
      const tokenPath = tokenPathFn(user);
      const token = fs.readFileSync(tokenPath, 'utf8').trim();
      if (!token) {
        issues.push(`Forgejo token for ${user} is empty`);
        steps.push('Run `px setup-review` to rotate the empty token file.');
        continue;
      }
      const probe = requestFn('GET', `${normalizedBaseUrl}/api/v1/repos/${review.repo}`, { token });
      if (isAuthFailure(probe)) {
        issues.push(`Forgejo token for ${user} is invalid or expired (HTTP ${probe.statusCode})`);
        steps.push('Run `px setup-review` and re-enter the Forgejo passwords to rotate local PATs.');
      } else if (!probe.ok && probe.statusCode === 404) {
        issues.push(`Forgejo review repo ${review.repo} is missing or inaccessible for ${user}`);
        steps.push('Run `px setup` to recreate the review repo and refresh token/remote wiring.');
      } else if (!probe.ok && probe.statusCode === null) {
        issues.push(`Forgejo at ${normalizedBaseUrl} is unreachable while validating ${user}`);
        steps.push('Start Forgejo and rerun `px verify-env` or `px setup-review`.');
      }
    }
  }

  if (issues.length === 0) {
    return { required: true, ok: true, issues: [], steps: [] };
  }

  return { required: true, ok: false, issues, steps };
}

function apiRequest(method, requestUrl, options = {}) {
  const args = [
    '-s',
    '-X', method,
    '-H', 'Content-Type: application/json',
    '-w', '\n%{http_code}',
  ];
  if (options.basicAuth) {
    args.push('-u', `${options.basicAuth.user}:${options.basicAuth.password}`);
  }
  if (options.token) {
    args.push('-H', `Authorization: token ${options.token}`);
  }
  if (options.body) {
    args.push('--data-binary', '@-');
  }
  args.push(requestUrl);

  const result = spawnSync('curl', args, {
    encoding: 'utf8',
    input: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (result.status !== 0 || !result.stdout) {
    return {
      ok: false,
      statusCode: null,
      error: (result.stderr || result.stdout || 'curl failed').trim(),
    };
  }

  const output = result.stdout.trim();
  const lastLineIndex = output.lastIndexOf('\n');
  const statusCode = Number(lastLineIndex === -1 ? output : output.slice(lastLineIndex + 1));
  const payload = lastLineIndex === -1 ? '' : output.slice(0, lastLineIndex).trim();

  let data = null;
  if (payload) {
    try {
      data = JSON.parse(payload);
    } catch (_) {
      data = payload;
    }
  }

  return {
    ok: statusCode >= 200 && statusCode < 300,
    statusCode,
    data,
    error: null,
  };
}

function createToken(baseUrl, user, password, tokenName, requestFn = apiRequest, scopes = REVIEW_TOKEN_SCOPES) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const result = requestFn('POST', `${normalizedBaseUrl}/api/v1/users/${encodeURIComponent(user)}/tokens`, {
    basicAuth: { user, password },
    body: { name: tokenName, scopes },
  });
  if (!result.ok) {
    return {
      ok: false,
      error: `token creation failed for ${user} (HTTP ${result.statusCode || 'n/a'})`,
      statusCode: result.statusCode,
      response: result.data,
    };
  }
  const token = result.data && result.data.sha1;
  if (!token) {
    return {
      ok: false,
      error: `token creation for ${user} did not return a token`,
      statusCode: result.statusCode,
      response: result.data,
    };
  }
  return { ok: true, token };
}

function ensureRepo(baseUrl, repoSlug, ownerLogin, ownerToken, requestFn = apiRequest) {
  const repoInfo = parseRepoSlug(repoSlug);
  if (!repoInfo) {
    return { ok: false, error: `invalid review repo slug: ${repoSlug}` };
  }

  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const existing = requestFn('GET', `${normalizedBaseUrl}/api/v1/repos/${repoInfo.owner}/${repoInfo.repo}`, {
    token: ownerToken,
  });
  if (existing.ok) {
    return { ok: true, created: false };
  }
  if (existing.statusCode && existing.statusCode !== 404) {
    return {
      ok: false,
      error: `failed to check review repo ${repoSlug} (HTTP ${existing.statusCode})`,
      response: existing.data,
    };
  }

  const payload = { name: repoInfo.repo, private: true, auto_init: false, default_branch: 'main' };
  const createUrl = repoInfo.owner === ownerLogin
    ? `${normalizedBaseUrl}/api/v1/user/repos`
    : `${normalizedBaseUrl}/api/v1/orgs/${encodeURIComponent(repoInfo.owner)}/repos`;
  const created = requestFn('POST', createUrl, {
    token: ownerToken,
    body: payload,
  });
  if (!created.ok) {
    return {
      ok: false,
      error: `failed to create review repo ${repoSlug} (HTTP ${created.statusCode || 'n/a'})`,
      response: created.data,
    };
  }
  return { ok: true, created: true };
}

function ensureRepoCollaborator(baseUrl, repoSlug, ownerToken, collaborator, permission = 'write', requestFn = apiRequest) {
  const repoInfo = parseRepoSlug(repoSlug);
  if (!repoInfo) {
    return { ok: false, error: `invalid review repo slug: ${repoSlug}` };
  }
  if (!collaborator || collaborator === repoInfo.owner) {
    return { ok: true, skipped: true };
  }

  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const result = requestFn('PUT', `${normalizedBaseUrl}/api/v1/repos/${repoInfo.owner}/${repoInfo.repo}/collaborators/${encodeURIComponent(collaborator)}`, {
    token: ownerToken,
    body: { permission },
  });
  if (!result.ok) {
    return {
      ok: false,
      error: `failed to add review collaborator ${collaborator} to ${repoSlug} (HTTP ${result.statusCode || 'n/a'})`,
      response: result.data,
    };
  }
  return { ok: true, created: true };
}

function ensureRepoCollaborators(baseUrl, repoSlug, ownerToken, collaborators = [], permission = 'write', requestFn = apiRequest) {
  const uniqueCollaborators = unique(collaborators.map(user => (typeof user === 'string' ? user.trim() : '')).filter(Boolean));
  const created = [];
  for (const collaborator of uniqueCollaborators) {
    const result = ensureRepoCollaborator(baseUrl, repoSlug, ownerToken, collaborator, permission, requestFn);
    if (!result.ok) {
      return result;
    }
    if (result.created) {
      created.push(collaborator);
    }
  }
  return { ok: true, created };
}

function ensureReviewRemote(rootDir, remoteName, remoteUrl) {
  const current = readConfiguredReviewRemote(rootDir, remoteName);
  const args = current
    ? ['-C', rootDir, 'remote', 'set-url', remoteName, remoteUrl]
    : ['-C', rootDir, 'remote', 'add', remoteName, remoteUrl];
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.status !== 0) {
    return {
      ok: false,
      error: (result.stderr || result.stdout || `git remote ${current ? 'set-url' : 'add'} failed`).trim(),
    };
  }
  return { ok: true, created: !current, updated: Boolean(current && current !== remoteUrl) };
}

async function promptLine(prompt, options = {}) {
  const { hidden = false, input = process.stdin, output = process.stdout } = options;
  return await new Promise((resolve) => {
    const rl = readline.createInterface({ input, output, terminal: true });
    if (!hidden) {
      rl.question(prompt, answer => {
        rl.close();
        resolve(answer.trim());
      });
      return;
    }

    const originalWrite = output.write.bind(output);
    const maskChunk = (chunk) => {
      const value = typeof chunk === 'string' ? chunk : String(chunk);
      let masked = '';
      for (const character of value) {
        if (character === '\r' || character === '\n') {
          continue;
        }
        if (character === '\b' || character === '\x7f') {
          masked += '\b \b';
          continue;
        }
        if (character < ' ' || character === '\u001b') {
          continue;
        }
        masked += '*';
      }
      return masked;
    };
    output.write = (chunk, encoding, cb) => {
      if (rl.stdoutMuted) {
        const masked = maskChunk(chunk);
        if (masked) {
          return originalWrite(masked, encoding, cb);
        }
        if (typeof cb === 'function') {cb();}
        return true;
      }
      return originalWrite(chunk, encoding, cb);
    };
    rl.stdoutMuted = true;
    originalWrite(prompt);
    rl.question('', answer => {
      output.write = originalWrite;
      rl.close();
      output.write('\n');
      resolve(answer.trim());
    });
  });
}

function isAuthFailure(result) {
  return Boolean(result && (result.statusCode === 401 || result.statusCode === 403));
}

async function createTokenWithRetries(setup, user, initialPassword, options = {}) {
  const {
    allowBlank = false,
    log = fmt.log.info,
    promptFn,
    maxAttempts = 3,
    requestFn = apiRequest,
    scopes = REVIEW_TOKEN_SCOPES,
  } = options;

  const repoInfo = parseRepoSlug(setup.repo);
  if (!repoInfo) {
    return { ok: false, error: `invalid review repo slug: ${setup.repo}` };
  }

  let password = typeof initialPassword === 'string' ? initialPassword : '';
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (!password) {
      if (typeof promptFn !== 'function') {
        return allowBlank
          ? { ok: true, skipped: true }
          : { ok: false, error: `Password is required for ${user}.` };
      }
      password = await promptFn(
        passwordPrompt(user, { allowBlank }),
        PASSWORD_PROMPT_OPTIONS
      );
    }

    if (!password) {
      if (allowBlank) {
        return { ok: true, skipped: true };
      }
      if (attempt === maxAttempts) {
        return { ok: false, error: `Password is required for ${user}.` };
      }
      log(fmt.status('WARN', `Password is required for ${user}. Attempt ${attempt} of ${maxAttempts}.`));
      continue;
    }

    const tokenResult = createToken(
      setup.baseUrl,
      user,
      password,
      buildTokenName(repoInfo.repo, user),
      requestFn,
      scopes
    );
    if (tokenResult.ok) {return tokenResult;}
    if (!isAuthFailure(tokenResult) || attempt === maxAttempts || typeof promptFn !== 'function') {
      return tokenResult;
    }

    log(fmt.status('WARN', `Forgejo authentication failed for ${user}. Attempt ${attempt} of ${maxAttempts}; please try again.`));
    password = '';
  }

  return { ok: false, error: `token creation failed for ${user}` };
}

async function collectSetupAnswers(rootDir = process.cwd(), options = {}) {
  const {
    promptFn = promptLine,
    log = fmt.log.info,
    users = suggestedForgejoUsers(),
  } = options;
  const review = resolveForgejoSettings(rootDir);
  const repoInfo = parseRepoSlug(review.repo || '');
  const defaultOwnerLogin = repoInfo ? repoInfo.owner : 'human';
  const defaultUsers = users.join(',');

  log(fmt.status('INFO', `Forgejo setup target: ${review.url || 'unset'} / ${review.repo || 'unset'}`));
  log(fmt.status('INFO', 'Forgejo review bootstrap will ask for one repo-creating login password and then optional passwords for each listed agent user.'));
  log(fmt.status('INFO', 'Leave an agent password blank to skip writing a token for that user on this machine.'));

  const ownerLogin = (await promptFn(`Forgejo login with repo-create access [${defaultOwnerLogin}]: `)) || defaultOwnerLogin;
  const ownerPassword = await promptFn(passwordPrompt(ownerLogin), PASSWORD_PROMPT_OPTIONS);
  const userList = (await promptFn(`Agent Forgejo users [${defaultUsers}]: `)) || defaultUsers;
  const agentUsers = unique(userList.split(',').map(value => value.trim()).filter(Boolean));
  const agentPasswords = [];

  for (const user of agentUsers) {
    const password = await promptFn(passwordPrompt(user, { allowBlank: true }), PASSWORD_PROMPT_OPTIONS);
    if (password) {
      agentPasswords.push({ user, password });
    }
  }

  return {
    baseUrl: review.url,
    repo: review.repo,
    ownerLogin,
    ownerPassword,
    agentPasswords,
    agentUsers,
  };
}

async function collectWizardAnswers(rootDir = process.cwd(), options = {}) {
  const {
    promptFn = promptLine,
    log = fmt.log.info,
    users = suggestedForgejoUsers(),
    loadWorkflowConfigFn = loadWorkflowConfig,
    detectPrimaryBranchDefaultFn = detectPrimaryBranchDefault,
  } = options;

  const existing = loadWorkflowConfigFn(rootDir);
  const existingConfig = existing.found ? existing.config : null;
  const existingAdapters = existingConfig && existingConfig.adapters ? existingConfig.adapters : {};
  const existingReview = existingAdapters.review || {};
  const existingTasks = existingAdapters.tasks || {};
  const existingMissions = existingAdapters.missions || {};
  const existingVerification = existingAdapters.verification || {};
  const defaultPrimaryBranch = detectPrimaryBranchDefaultFn(rootDir, {
    configuredPrimaryBranch: existingMissions.primaryBranch || null,
  });

  const productName = (await promptFn(`Product name [${(existingConfig && existingConfig.product && existingConfig.product.name) || defaultProductName(rootDir)}]: `))
    || (existingConfig && existingConfig.product && existingConfig.product.name)
    || defaultProductName(rootDir);
  log(fmt.status('INFO', `Standard workflow layout: ${standardLayoutDescription()}`));
  const useDefaults = parseYesNo(
    await promptFn('Use the standard markdown task workflow layout and defaults? [Y/n]: '),
    true
  );

  const ownerLoginDefault = parseRepoSlug(existingReview.repo || '')?.owner || 'human';
  const ownerLogin = (await promptFn(`Forgejo login with repo-create access [${ownerLoginDefault}]: `)) || ownerLoginDefault;
  const repoDefault = existingReview.repo || defaultRepoSlug(rootDir, ownerLogin);
  const reviewRepo = (await promptFn(`Forgejo review repo [${repoDefault}]: `)) || repoDefault;
  const baseUrl = normalizeBaseUrl((await promptFn(`Forgejo base URL [${existingReview.baseUrl || 'http://localhost:3300'}]: `)) || existingReview.baseUrl || 'http://localhost:3300');
  const reviewRemote = (await promptFn(`Git review remote name [${existingReview.remote || 'review'}]: `)) || existingReview.remote || 'review';

  if (!useDefaults) {
    log(fmt.status('INFO',
      'Verification command runs the primary gate. Put the {{area}} token where the detected ' +
      'changed-area name (docs, workflow, server, ...) should be substituted. Typical patterns: ' +
      '"./scripts/verify-local.sh {{area}}" (shell script), "npm run verify -- {{area}}" (npm ' +
      'script), or "make verify-{{area}}" (make target). Omit {{area}} to always run one command; ' +
      'leave it as `npm test` for the no-op-friendly default.'));
  }

  const defaults = useDefaults ? {
    tasksProvider: 'backlog-md',
    tasksStorage: 'backlog',
    missionsBaseDir: 'docs/missions',
    branchPrefix: 'mission/',
    primaryBranch: defaultPrimaryBranch,
    worktreePattern: '../<repo>-<slug>',
    verificationCommand: 'npm test',
    verificationDefaultArea: 'docs',
  } : {
    tasksProvider: (await promptFn(`Task provider [${existingTasks.provider || 'backlog-md'}]: `)) || existingTasks.provider || 'backlog-md',
    tasksStorage: (await promptFn(`Task storage path [${existingTasks.storage || 'backlog'}]: `)) || existingTasks.storage || 'backlog',
    missionsBaseDir: (await promptFn(`Mission base dir [${existingMissions.baseDir || 'docs/missions'}]: `)) || existingMissions.baseDir || 'docs/missions',
    branchPrefix: (await promptFn(`Mission branch prefix [${existingMissions.branchPrefix || 'mission/'}]: `)) || existingMissions.branchPrefix || 'mission/',
    primaryBranch: (await promptFn(`Primary branch [${defaultPrimaryBranch}]: `)) || defaultPrimaryBranch,
    worktreePattern: (await promptFn(`Worktree pattern [${existingMissions.worktreePattern || '../<repo>-<slug>'}]: `)) || existingMissions.worktreePattern || '../<repo>-<slug>',
    verificationCommand: (await promptFn(`Verification command [${existingVerification.command || 'npm test'}]: `)) || existingVerification.command || 'npm test',
    verificationDefaultArea: (await promptFn(`Default verification area [${existingVerification.defaultArea || 'docs'}]: `)) || existingVerification.defaultArea || 'docs',
  };

  const bootstrapReview = parseYesNo(
    await promptFn('Create/update the Forgejo repo, token files, and review remote now? This will ask for the repo-owner password and optional agent passwords. [Y/n]: '),
    true
  );

  log(fmt.status('INFO', `Setup target: ${baseUrl} / ${reviewRepo}`));

  let ownerPassword = '';
  const agentPasswords = [];
  const defaultUsers = users.join(',');
  let agentUsers = users;
  if (bootstrapReview) {
    log(fmt.status('INFO', 'Forgejo bootstrap is enabled. Hidden password prompts are next: first for the repo-creating login, then once per listed agent user.'));
    ownerPassword = await promptFn(passwordPrompt(ownerLogin), PASSWORD_PROMPT_OPTIONS);
    const userList = (await promptFn(`Agent Forgejo users [${defaultUsers}]: `)) || defaultUsers;
    agentUsers = unique(userList.split(',').map(value => value.trim()).filter(Boolean));
    for (const user of agentUsers) {
      const password = await promptFn(passwordPrompt(user, { allowBlank: true }), PASSWORD_PROMPT_OPTIONS);
      if (password) {
        agentPasswords.push({ user, password });
      }
    }
  }

  return {
    productName,
    ownerLogin,
    baseUrl,
    reviewRepo,
    reviewRemote,
    bootstrapReview,
    ownerPassword,
    agentPasswords,
    agentUsers,
    ...defaults,
  };
}

function writeToken(user, token, forgejoHome = resolveForgejoHome()) {
  ensureTokenDir(forgejoHome);
  const file = tokenFilePath(user, forgejoHome);
  fs.writeFileSync(file, `${token}\n`, { mode: 0o600 });
  return file;
}

/**
 * Create Forgejo tokens for agent users using an existing owner token.
 * This is the non-interactive bootstrap path: the owner token (admin-level)
 * is used to authenticate POST requests to the Forgejo user-token API.
 *
 * @param {string} baseUrl - Forgejo base URL
 * @param {string} repoSlug - Repository slug for token naming
 * @param {string} ownerToken - Owner's Forgejo PAT
 * @param {Array} agentPasswords - Array of {user, password} to create tokens for
 * @param {object} repoInfo - Parsed repo slug {owner, repo}
 * @param {object} options - Injected dependencies
 * @returns {{ ok: boolean, createdTokens: Array, warnings?: Array }}
 */
function tokenCreateViaOwnerToken(baseUrl, repoSlug, ownerToken, agentPasswords, repoInfo, options = {}) {
  const { requestFn = apiRequest, writeTokenFn, buildTokenNameFn = buildTokenName, forgejoHome: injectedForgejoHome } = options;
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const forgejoHome = typeof injectedForgejoHome === 'string' ? injectedForgejoHome : resolveForgejoHome();

  const createdTokens = [];
  const warnings = [];

  for (const agent of agentPasswords) {
    const tokenName = buildTokenNameFn(repoInfo.repo, agent.user);
    const result = requestFn('POST', `${normalizedBaseUrl}/api/v1/users/${encodeURIComponent(agent.user)}/tokens`, {
      token: ownerToken,
      body: { name: tokenName, scopes: REVIEW_TOKEN_SCOPES },
    });
    if (!result.ok) {
      warnings.push({
        user: agent.user,
        error: `token creation via owner token failed (HTTP ${result.statusCode || 'n/a'})`,
        response: result.data,
      });
      continue;
    }
    const token = result.data && result.data.sha1;
    if (!token) {
      warnings.push({
        user: agent.user,
        error: 'token creation via owner token did not return a token',
        response: result.data,
      });
      continue;
    }
    const filePath = writeTokenFn(agent.user, token, forgejoHome);
    createdTokens.push({ user: agent.user, path: filePath });
  }

  if (createdTokens.length === 0) {
    const firstWarning = warnings[0];
    const detail = firstWarning
      ? `${firstWarning.user}: ${firstWarning.error}`
      : 'no requested agent token was created';
    return { ok: false, createdTokens, warnings, error: detail };
  }

  return { ok: true, createdTokens, warnings };
}

async function bootstrapReviewSurface(rootDir = process.cwd(), setup, options = {}) {
  const {
    log = fmt.log.info,
    promptFn,
    requestFn = apiRequest,
    maxPasswordAttempts = 3,
    interactive = true,
  } = options;
  const forgejoHome = resolveBootstrapForgejoHome(rootDir, options.forgejoHome);
  const repoInfo = parseRepoSlug(setup.repo);
  if (!setup.baseUrl || !repoInfo) {
    return { ok: false, error: 'workflow.config.json must define adapters.review.baseUrl and adapters.review.repo before setup can run.' };
  }

  const baseUrl = normalizeBaseUrl(setup.baseUrl);
  const collaboratorUsers = unique([
    ...(Array.isArray(setup.agentUsers) ? setup.agentUsers : []),
    ...(Array.isArray(setup.agentPasswords) ? setup.agentPasswords.map(agent => agent.user) : []),
  ].filter(Boolean));

  if (interactive) {
    // Original interactive path: prompt for owner password, create tokens for all users
    const ownerTokenResult = await createTokenWithRetries({
      ...setup,
      baseUrl,
    }, setup.ownerLogin, setup.ownerPassword, {
      allowBlank: false,
      log,
      promptFn,
      maxAttempts: maxPasswordAttempts,
      requestFn,
    });
    if (!ownerTokenResult.ok) {return ownerTokenResult;}

    const ownerTokenPath = writeToken(setup.ownerLogin, ownerTokenResult.token, forgejoHome);
    const repoResult = ensureRepo(baseUrl, setup.repo, setup.ownerLogin, ownerTokenResult.token, requestFn);
    if (!repoResult.ok) {return repoResult;}

    const collaboratorResult = ensureRepoCollaborators(baseUrl, setup.repo, ownerTokenResult.token, collaboratorUsers, 'write', requestFn);
    if (!collaboratorResult.ok) {return collaboratorResult;}
    if (collaboratorResult.created.length > 0) {
      log(fmt.status('PASS', `Granted write access on ${setup.repo} to ${collaboratorResult.created.join(', ')}`));
    }

    const createdTokens = [{ user: setup.ownerLogin, path: ownerTokenPath }];
    const warnings = [];
    for (const agent of setup.agentPasswords) {
      const tokenResult = await createTokenWithRetries({
        ...setup,
        baseUrl,
      }, agent.user, agent.password, {
        allowBlank: true,
        log,
        promptFn,
        maxAttempts: maxPasswordAttempts,
        requestFn,
      });
      if (!tokenResult.ok) {
        warnings.push({
          user: agent.user,
          error: tokenResult.error,
          response: tokenResult.response,
        });
        continue;
      }
      if (tokenResult.skipped) {continue;}
      createdTokens.push({ user: agent.user, path: writeToken(agent.user, tokenResult.token, forgejoHome) });
    }

    const remoteUrl = reviewRemoteUrl(rootDir);
    const remoteName = resolveReviewAdapter(rootDir).remote || 'review';
    const remoteResult = remoteUrl ? ensureReviewRemote(rootDir, remoteName, remoteUrl) : { ok: true, created: false, updated: false };
    if (!remoteResult.ok) {return remoteResult;}

    log(fmt.status('PASS', `Forgejo repo ${setup.repo} ${repoResult.created ? 'created' : 'already exists'}.`));
    for (const tokenInfo of createdTokens) {
      log(fmt.status('PASS', `Wrote Forgejo token for ${tokenInfo.user} to ${tokenInfo.path}`));
    }
    for (const warning of warnings) {
      log(fmt.status('WARN', `Skipping Forgejo token for ${warning.user}: ${warning.error}`));
      if (warning.response) {
        log(fmt.status('INFO', `Forgejo response for ${warning.user}: ${JSON.stringify(warning.response)}`));
      }
    }
    log(fmt.status('PASS', `Review remote "${remoteName}" now points at ${remoteUrl}`));

    return { ok: true, warnings };
  }

  // Non-interactive path: use an existing owner token (e.g. human) to create
  // tokens for agent users via the Forgejo user-token creation API.
  // This is the bootstrap path called from handoff when an agent user's token
  // is missing but another user has a valid token file.
  const ownerTokenPath = path.join(forgejoHome, 'tokens', setup.ownerLogin);
  let ownerToken = null;
  if (fs.existsSync(ownerTokenPath)) {
    ownerToken = fs.readFileSync(ownerTokenPath, 'utf8').trim();
  }
  if (!ownerToken) {
    return { ok: false, error: `No owner token found for ${setup.ownerLogin} at ${ownerTokenPath}. A token file for an existing user (typically human) is required to bootstrap new agent tokens.` };
  }

  const repoResult = ensureRepo(baseUrl, setup.repo, setup.ownerLogin, ownerToken, requestFn);
  if (!repoResult.ok) {return repoResult;}

  const collaboratorResult = ensureRepoCollaborators(baseUrl, setup.repo, ownerToken, collaboratorUsers, 'write', requestFn);
  if (!collaboratorResult.ok) {return collaboratorResult;}
  if (collaboratorResult.created.length > 0) {
    log(fmt.status('PASS', `Granted write access on ${setup.repo} to ${collaboratorResult.created.join(', ')}`));
  }

  const tokensResult = tokenCreateViaOwnerToken(baseUrl, setup.repo, ownerToken, setup.agentPasswords, repoInfo, { requestFn, writeTokenFn: writeToken, forgejoHome, log });
  if (!tokensResult.ok) {return tokensResult;}

  const { createdTokens, warnings } = tokensResult;
  for (const tokenInfo of createdTokens) {
    log(fmt.status('PASS', `Wrote Forgejo token for ${tokenInfo.user} to ${tokenInfo.path}`));
  }
  for (const warning of warnings) {
    log(fmt.status('WARN', `Skipping Forgejo token for ${warning.user}: ${warning.error}`));
    if (warning.response) {
      log(fmt.status('INFO', `Forgejo response for ${warning.user}: ${JSON.stringify(warning.response)}`));
    }
  }

  const remoteUrl = reviewRemoteUrl(rootDir);
  const remoteName = resolveReviewAdapter(rootDir).remote || 'review';
  const remoteResult = remoteUrl ? ensureReviewRemote(rootDir, remoteName, remoteUrl) : { ok: true, created: false, updated: false };
  if (!remoteResult.ok) {return remoteResult;}

  log(fmt.status('PASS', `Forgejo repo ${setup.repo} ${repoResult.created ? 'created' : 'already exists'}.`));
  log(fmt.status('PASS', `Review remote "${remoteName}" now points at ${remoteUrl}`));

  return { ok: true, warnings, createdTokens };
}

async function setupReview(_args, options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;
  const exit = options.exit || process.exit;
  const promptFn = options.promptFn || promptLine;
  const setup = await collectSetupAnswers(rootDir, { promptFn, log });
  const result = await bootstrapReviewSurface(rootDir, setup, {
    ...options,
    forgejoHome: resolveBootstrapForgejoHome(rootDir, options.forgejoHome),
  });
  if (!result.ok) {
    error(fmt.status('FAIL', result.error));
    if (result.response) {
      error(fmt.status('INFO', `Forgejo response: ${JSON.stringify(result.response)}`));
    }
    exit(1);
    return;
  }
}

async function runVerifyEnv(rootDir, options = {}) {
  const verifyFn = options.verifyFn || ((cwd) => spawnSync('node', ['workflow', 'verify-env'], {
    cwd,
    stdio: 'inherit',
    encoding: 'utf8',
  }));
  return verifyFn(rootDir);
}

function buildNonInteractiveAnswers(rootDir, options = {}) {
  const log = options.log || fmt.log.plain;
  const env = process.env;
  const productName = env.WORKFLOW_SETUP_PRODUCT_NAME || defaultProductName(rootDir);
  const reviewProvider = env.WORKFLOW_SETUP_REVIEW_PROVIDER || 'none';
  const primaryBranch = detectPrimaryBranchDefault(rootDir);

  const answers = {
    productName,
    reviewProvider,
    tasksProvider: 'backlog-md',
    tasksStorage: 'backlog',
    missionsBaseDir: 'docs/missions',
    branchPrefix: 'mission/',
    primaryBranch,
    worktreePattern: '../<repo>-<slug>',
    verificationCommand: 'npm test',
    verificationDefaultArea: 'docs',
    bootstrapReview: false,
  };

  if (reviewProvider === 'forgejo') {
    const ownerLogin = env.WORKFLOW_SETUP_OWNER_LOGIN || 'human';
    const baseUrl = normalizeBaseUrl(env.WORKFLOW_SETUP_FORGEJO_URL || 'http://localhost:3300');
    const reviewRepo = env.WORKFLOW_SETUP_FORGEJO_REPO || defaultRepoSlug(rootDir, ownerLogin);
    const reviewRemote = env.WORKFLOW_SETUP_REVIEW_REMOTE || 'review';
    const ownerPassword = env.WORKFLOW_SETUP_OWNER_PASSWORD || '';
    const agentUserList = env.WORKFLOW_SETUP_AGENT_USERS
      ? env.WORKFLOW_SETUP_AGENT_USERS.split(',').map(u => u.trim()).filter(Boolean)
      : suggestedForgejoUsers();
    const agentPassword = env.WORKFLOW_SETUP_AGENT_PASSWORD || '';
    const agentPasswords = agentPassword
      ? agentUserList.map(user => ({ user, password: agentPassword }))
      : [];
    Object.assign(answers, {
      ownerLogin, baseUrl, reviewRepo, reviewRemote,
      bootstrapReview: Boolean(ownerPassword),
      ownerPassword, agentPasswords, agentUsers: agentUserList,
    });
    log(fmt.status('INFO', `Non-interactive setup: product=${productName}, repo=${reviewRepo}, url=${baseUrl}`));
  } else {
    log(fmt.status('INFO', `Non-interactive setup: product=${productName}, review=none (no Forgejo)`));
  }

  return answers;
}

async function setupWizard(_args, options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;
  const exit = options.exit || process.exit;
  const promptFn = options.promptFn || promptLine;
  const forgejoHome = resolveBootstrapForgejoHome(rootDir, options.forgejoHome);

  const nonInteractive = (_args && _args.includes('--non-interactive')) || process.env.WORKFLOW_SETUP_NON_INTERACTIVE === '1';
  const answers = nonInteractive
    ? buildNonInteractiveAnswers(rootDir, { log })
    : await collectWizardAnswers(rootDir, { ...options, promptFn, log });
  const configPath = writeWorkflowConfig(rootDir, buildWorkflowConfig(answers));
  log(fmt.status('PASS', `Wrote ${configPath}`));

  const gitignoreResult = ensureWorkflowGitignore(rootDir, { logFn: log });
  if (gitignoreResult.created) {
    log(fmt.status('PASS', `Created .gitignore with ${gitignoreResult.appended} workflow entries in ${fmt.path(rootDir)}`));
  } else if (gitignoreResult.appended > 0) {
    log(fmt.status('PASS', `Appended ${gitignoreResult.appended} workflow entries to .gitignore in ${fmt.path(rootDir)}`));
  } else if (gitignoreResult.skipped) {
    log(fmt.status('INFO', `.gitignore in ${fmt.path(rootDir)}: ${gitignoreResult.reason === 'symlink' ? 'symbolic link (skipped)' : 'not a git repo (skipped)'}`));
  } else {
    log(fmt.status('PASS', `.gitignore in ${fmt.path(rootDir)} already contains all workflow entries`));
  }

  if (answers.bootstrapReview) {
    const result = await bootstrapReviewSurface(rootDir, {
      baseUrl: answers.baseUrl,
      repo: answers.reviewRepo,
      ownerLogin: answers.ownerLogin,
      ownerPassword: answers.ownerPassword,
      agentPasswords: answers.agentPasswords,
      agentUsers: answers.agentUsers,
    }, {
      ...options,
      forgejoHome,
    });
    if (!result.ok) {
      error(fmt.status('FAIL', result.error));
      if (result.response) {
        error(fmt.status('INFO', `Forgejo response: ${JSON.stringify(result.response)}`));
      }
      exit(1);
      return;
    }
  } else {
    log(fmt.status('INFO', 'Skipped Forgejo bootstrap. You can run `px setup-review` later if needed.'));
  }

  const verifyResult = await runVerifyEnv(rootDir, options);
  if (verifyResult && typeof verifyResult.status === 'number' && verifyResult.status !== 0) {
    exit(verifyResult.status);
  }
}

module.exports = setupReview;
module.exports.setupReview = setupReview;
module.exports.setupWizard = setupWizard;
module.exports.apiRequest = apiRequest;
module.exports.buildWorkflowConfig = buildWorkflowConfig;
module.exports.collectWizardAnswers = collectWizardAnswers;
module.exports.defaultProductName = defaultProductName;
module.exports.defaultRepoSlug = defaultRepoSlug;
module.exports.parseYesNo = parseYesNo;
module.exports.runVerifyEnv = runVerifyEnv;
module.exports.bootstrapReviewSurface = bootstrapReviewSurface;
module.exports.collectSetupAnswers = collectSetupAnswers;
module.exports.createToken = createToken;
module.exports.ensureRepo = ensureRepo;
module.exports.ensureReviewRemote = ensureReviewRemote;
module.exports.evaluateReviewSetup = evaluateReviewSetup;
module.exports.parseRepoSlug = parseRepoSlug;
module.exports.promptLine = promptLine;
module.exports.readConfiguredReviewRemote = readConfiguredReviewRemote;
module.exports.suggestedForgejoUsers = suggestedForgejoUsers;
module.exports.tokenFilePath = tokenFilePath;
module.exports.writeToken = writeToken;
module.exports.writeWorkflowConfig = writeWorkflowConfig;
module.exports.resolveBootstrapForgejoHome = resolveBootstrapForgejoHome;
module.exports.buildNonInteractiveAnswers = buildNonInteractiveAnswers;
