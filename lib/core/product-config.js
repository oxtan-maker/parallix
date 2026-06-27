const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REQUIRED_ADAPTER_KEYS = ['tasks', 'missions', 'verification', 'review', 'agents'];

// Code-owned defaults. An absent workflow.config.json yields a working tool;
// the optional override file overrides only the keys it sets. These defaults
// are the single source of truth — there is no shipped example config, so there
// is no second source to drift from (see task-1233 Scope Amendment).
const DEFAULT_CONFIG = Object.freeze({
  product: {
    name: 'Workflow',
    targetUser: 'Engineering teams using git, task tracking, and code review',
  },
  adapters: {
    tasks: { provider: 'backlog-md', storage: 'backlog', stateMap: 'state-map.json' },
    missions: {
      baseDir: 'missions',
      branchPrefix: 'mission/',
      worktreePattern: '../<repo>-<slug>',
    },
    // No universal cross-repo gate exists, so the default is no validation
    // (no command). A repository opts into a gate by declaring
    // adapters.verification.command in workflow.config.json.
    verification: { defaultArea: 'docs' },
    stats: { path: 'stats.csv' },
    // Unset provider currently keeps Forgejo enabled (isForgejoReviewEnabled
    // treats null as enabled) — a WrGroceries-ism. Flipping review off-by-default
    // for external repos has a large review-subsystem blast radius and is deferred
    // to TASK-1244; WrGroceries already declares review.provider in its own config.
    review: {},
    agents: {},
  },
});

/** @param {unknown} value */
function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** @param {Record<string, unknown>} base @param {Record<string, unknown>} override */
function deepMerge(base, override) {
  if (!isPlainObject(override)) {return base;}
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const val = /** @type {Record<string, unknown>} */(/** @type {unknown} */(out[key]));
    out[key] = isPlainObject(value) && isPlainObject(val)
      ? deepMerge(val, /** @type {Record<string, unknown>} */(value))
      : value;
  }
  return out;
}

// A fresh deep clone of the defaults so callers can never mutate the frozen
// source.
function defaultConfig() {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

function configCandidates(rootDir = process.cwd()) {
  return [path.join(rootDir, 'workflow.config.json')];
}

function findWorkflowConfig(rootDir = process.cwd()) {
  return configCandidates(rootDir).find(candidate => fs.existsSync(candidate)) || null;
}

function loadWorkflowConfig(rootDir = process.cwd()) {
  const configPath = findWorkflowConfig(rootDir);
  if (!configPath) {
    return { found: false, configPath: null, config: null };
  }

  let raw;
  try {
    raw = fs.readFileSync(configPath, 'utf8');
  } catch (error) {
    /** @type {Error & {code?: string}} */
    const e = /** @type {Error & {code?: string}} */(error);
    if (e && e.code === 'ENOENT') {
      return { found: false, configPath: null, config: null };
    }
    throw error;
  }
  try {
    return {
      found: true,
      configPath,
      config: JSON.parse(raw),
      parseError: null,
    };
  } catch (error) {
    return {
      found: true,
      configPath,
      config: null,
      parseError: error,
    };
  }
}

// The effective config a command sees: code-owned defaults with any override
// file merged on top. A missing or malformed override falls back to defaults.
function loadEffectiveConfig(rootDir = process.cwd()) {
  const loaded = loadWorkflowConfig(rootDir);
  if (!loaded.found || loaded.parseError || !isPlainObject(loaded.config)) {
    return defaultConfig();
  }
  // A structurally invalid override (e.g. adapters not an object) falls back to
  // defaults rather than merging a bad shape into the effective config.
  if (validateWorkflowConfig(loaded.config).length > 0) {
    return defaultConfig();
  }
  return deepMerge(defaultConfig(), loaded.config);
}

// The override file is optional and partial: validate only the shape of what it
// provides. Missing sections are filled by code-owned defaults, so absent
// sections are not errors (and there are no placeholder sentinels to detect).
/** @param {unknown} config */
function validateWorkflowConfig(config) {
  if (!isPlainObject(config)) {
    return ['top-level JSON object is required'];
  }

  const cfg = /** @type {Record<string, unknown>} */(config);
  const issues = [];
  if ('product' in /** @type{Record<string,unknown>} */(cfg) && !isPlainObject(/** @type{Record<string,unknown>} */(cfg).product)) {
    issues.push('product must be an object');
  }
  if ('adapters' in /** @type{Record<string,unknown>} */(cfg)) {
    /** @type {Record<string, unknown>} */
    const adapters = /** @type {Record<string, unknown>} */(/** @type{Record<string,unknown>} */(cfg).adapters);
    if (!isPlainObject(adapters)) {
      issues.push('adapters must be an object');
    } else {
      for (const [key, value] of Object.entries(adapters)) {
        if (!isPlainObject(value)) {
          issues.push(`adapters.${key} must be an object`);
        }
      }
    }
  }
  return issues;
}

function detectLegacyRepoLayout(rootDir = process.cwd()) {
  const backlogDir = path.join(rootDir, 'backlog');
  const missionDocsDir = path.join(rootDir, 'docs', 'missions');
  const verifyScript = path.join(rootDir, 'scripts', 'verify-local.sh');

  return fs.existsSync(backlogDir) && fs.existsSync(missionDocsDir) && fs.existsSync(verifyScript);
}

function isStandaloneWorkflowLayout(rootDir = process.cwd()) {
  const workflowIndex = path.join(rootDir, 'workflow', 'index.js');
  const workflowConfig = path.join(rootDir, 'workflow.config.json');

  return fs.existsSync(workflowIndex) && fs.existsSync(workflowConfig);
}

function hasGitRepository(rootDir = process.cwd()) {
  return fs.existsSync(path.join(rootDir, '.git'));
}

/** @param {string} [rootDir] @param {{spawnSyncFn?: typeof spawnSync}} [options] */
function initializeGitRepository(rootDir = process.cwd(), options = {}) {
  /** @type {typeof spawnSync} */
  const spawnSyncFn = options.spawnSyncFn || spawnSync;
  const initMain = spawnSyncFn('git', ['init', '-b', 'main'], {
    cwd: rootDir,
    encoding: 'utf8',
  });
  if (initMain.status === 0) {
    return { ok: true, branch: 'main', mode: 'init-main' };
  }

  const initFallback = spawnSyncFn('git', ['init'], {
    cwd: rootDir,
    encoding: 'utf8',
  });
  if (initFallback.status !== 0) {
    return {
      ok: false,
      message: (initFallback.stderr || initFallback.stdout || initMain.stderr || initMain.stdout || 'git init failed').trim(),
    };
  }

  spawnSyncFn('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], {
    cwd: rootDir,
    encoding: 'utf8',
  });
  return { ok: true, branch: 'main', mode: 'init-fallback' };
}

// Commits the workflow files and any config that exists so the freshly
// initialized repo has a baseline commit. Without this, mission worktrees
// created via `git worktree add` would not have workflow/ or
// workflow.config.json checked out and could not run any workflow command.
function gitIdentityEnv() {
  const env = { ...process.env };
  if (!env.GIT_AUTHOR_NAME) {env.GIT_AUTHOR_NAME = 'Workflow Setup';}
  if (!env.GIT_AUTHOR_EMAIL) {env.GIT_AUTHOR_EMAIL = 'workflow@example.invalid';}
  if (!env.GIT_COMMITTER_NAME) {env.GIT_COMMITTER_NAME = env.GIT_AUTHOR_NAME;}
  if (!env.GIT_COMMITTER_EMAIL) {env.GIT_COMMITTER_EMAIL = env.GIT_AUTHOR_EMAIL;}
  return env;
}

/** @param {string} rootDir @param {{spawnSyncFn?: typeof spawnSync, existsSyncFn?: typeof fs.existsSync}} [options] */
function commitWorkflowBaseline(rootDir, options = {}) {
  /** @type {typeof spawnSync} */
  const spawnSyncFn = options.spawnSyncFn || spawnSync;
  /** @type {typeof fs.existsSync} */
  const existsSyncFn = options.existsSyncFn || fs.existsSync;
  const candidates = ['workflow', 'workflow.config.json'];
  const present = candidates.filter(name => existsSyncFn(path.join(rootDir, name)));
  if (present.length === 0) {
    return { ok: true, committed: false, reason: 'no-workflow-files' };
  }

  const addResult = spawnSyncFn('git', ['add', '-A', '.'], {
    cwd: rootDir,
    encoding: 'utf8',
  });
  if (addResult.status !== 0) {
    return {
      ok: false,
      committed: false,
      message: (addResult.stderr || addResult.stdout || 'git add failed').trim(),
    };
  }

  const commitResult = spawnSyncFn(
    'git',
    ['commit', '-m', 'workflow: initial setup'],
    { cwd: rootDir, encoding: 'utf8', env: gitIdentityEnv() },
  );
  if (commitResult.status !== 0) {
    return {
      ok: false,
      committed: false,
      message: (commitResult.stderr || commitResult.stdout || 'git commit failed').trim(),
    };
  }

  return { ok: true, committed: true, files: present };
}

function ensureStandaloneMissionBaseline(rootDir = process.cwd(), { spawnSyncFn = spawnSync } = {}) {
  if (!isStandaloneWorkflowLayout(rootDir) || !hasGitRepository(rootDir)) {
    return { changed: false, committed: false, skipped: true };
  }

  const statusResult = spawnSyncFn('git', ['status', '--porcelain'], {
    cwd: rootDir,
    encoding: 'utf8',
  });
  if (statusResult.status !== 0) {
    return {
      changed: false,
      committed: false,
      failed: true,
      message: (statusResult.stderr || statusResult.stdout || 'git status failed').trim(),
    };
  }

  const dirtyEntries = (statusResult.stdout || '')
    .split('\n')
    .map(line => line.trimEnd())
    .filter(Boolean);
  const relevantEntries = dirtyEntries.filter(line => {
    const filePath = line.slice(3).trim();
    return !filePath.startsWith('.workflow/') && !filePath.startsWith('.sessions/');
  });

  if (relevantEntries.length === 0) {
    return { changed: dirtyEntries.length > 0, committed: false, skipped: false };
  }

  const conflicted = relevantEntries.filter(line => {
    const state = line.slice(0, 2).trim();
    return ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(state);
  });
  if (conflicted.length > 0) {
    return {
      changed: true,
      committed: false,
      failed: true,
      message: `conflicted files block mission baseline commit: ${conflicted.map(line => line.slice(3).trim()).join(', ')}`,
    };
  }

  const addResult = spawnSyncFn('git', ['add', '-A', '.'], {
    cwd: rootDir,
    encoding: 'utf8',
  });
  if (addResult.status !== 0) {
    return {
      changed: true,
      committed: false,
      failed: true,
      message: (addResult.stderr || addResult.stdout || 'git add failed').trim(),
    };
  }

  const commitResult = spawnSyncFn('git', ['commit', '-m', 'workflow: prepare standalone mission baseline'], {
    cwd: rootDir,
    encoding: 'utf8',
    env: gitIdentityEnv(),
  });
  if (commitResult.status !== 0) {
    return {
      changed: true,
      committed: false,
      failed: true,
      message: (commitResult.stderr || commitResult.stdout || 'git commit failed').trim(),
    };
  }

  return {
    changed: true,
    committed: true,
    entries: relevantEntries.map(line => line.slice(3).trim()),
  };
}

/** @param {string} [rootDir] @param {{isStandaloneWorkflowLayoutFn?: Function, hasGitRepositoryFn?: Function, initializeGitRepositoryFn?: Function, commitWorkflowBaselineFn?: Function}} [options] */
function ensureStandaloneGitRepo(rootDir = process.cwd(), options = {}) {
  /** @type {{isStandaloneWorkflowLayoutFn?: Function, hasGitRepositoryFn?: Function, initializeGitRepositoryFn?: Function, commitWorkflowBaselineFn?: Function}} */
  const opts = options;
  const isStandaloneWorkflowLayoutFn = opts.isStandaloneWorkflowLayoutFn || isStandaloneWorkflowLayout;
  const hasGitRepositoryFn = opts.hasGitRepositoryFn || hasGitRepository;
  const initializeGitRepositoryFn = opts.initializeGitRepositoryFn || initializeGitRepository;
  const commitWorkflowBaselineFn = opts.commitWorkflowBaselineFn || commitWorkflowBaseline;

  if (!isStandaloneWorkflowLayoutFn(rootDir) || hasGitRepositoryFn(rootDir)) {
    return { changed: false, initialized: false };
  }

  const result = initializeGitRepositoryFn(rootDir, options);
  if (!result.ok) {
    return {
      changed: false,
      initialized: false,
      failed: true,
      message: result.message || 'git init failed',
    };
  }

  const commit = commitWorkflowBaselineFn(rootDir, options);

  return {
    changed: true,
    initialized: true,
    branch: result.branch || 'main',
    mode: result.mode || 'init-main',
    baselineCommit: commit,
  };
}

function adapterChecklist() {
  return [
    'Workflow runs on built-in defaults; no config file is required to start',
    'Create workflow.config.json only to override a default (schema: workflow/config/workflow.config.schema.json)',
    'Run `px config` to print the effective configuration',
    'Override adapters.tasks for a different task tracker or storage path',
    'Override adapters.missions for mission document layout and branch/worktree conventions',
    'Override adapters.verification for your repo gate command',
    'Override adapters.review to enable a review provider and remote naming',
  ];
}

// Returns the override file's adapters object, or {} when there is no override.
// Each resolver (resolveTaskStorage, resolveVerificationAdapter, …) applies its
// own code-owned fallback on top of this, so an absent config still yields a
// fully working tool. loadEffectiveConfig (used by `node parallix config`) is
// the document-level view; the per-resolver fallbacks remain the runtime source
// of truth so this change does not shadow them.
function loadAdapterConfig(rootDir = process.cwd()) {
  const explicit = loadWorkflowConfig(rootDir);
  if (!explicit.found || explicit.parseError || !isPlainObject(explicit.config)) {
    return {};
  }
  return isPlainObject(explicit.config.adapters) ? explicit.config.adapters : {};
}

function resolveTaskStorage(rootDir = process.cwd()) {
  const fallbackBaseDir = path.join(rootDir, 'backlog');
  const fallback = {
    baseDir: fallbackBaseDir,
    tasksDir: path.join(fallbackBaseDir, 'tasks'),
    completedDir: path.join(fallbackBaseDir, 'completed'),
    archiveTasksDir: path.join(fallbackBaseDir, 'archive', 'tasks'),
    draftsDir: path.join(fallbackBaseDir, 'drafts'),
  };

  const tasksAdapter = loadAdapterConfig(rootDir).tasks || {};
  const storage = tasksAdapter.storagePath || tasksAdapter.storage;
  if (!storage) {
    return fallback;
  }

  if (typeof storage === 'string') {
    const storageDir = path.resolve(rootDir, storage);
    const storageName = path.basename(storageDir);
    if (storageName === 'tasks') {
      const baseDir = path.dirname(storageDir);
      return {
        baseDir,
        tasksDir: storageDir,
        completedDir: path.join(baseDir, 'completed'),
        archiveTasksDir: path.join(baseDir, 'archive', 'tasks'),
        draftsDir: path.join(baseDir, 'drafts'),
      };
    }

    return {
      baseDir: storageDir,
      tasksDir: path.join(storageDir, 'tasks'),
      completedDir: path.join(storageDir, 'completed'),
      archiveTasksDir: path.join(storageDir, 'archive', 'tasks'),
      draftsDir: path.join(storageDir, 'drafts'),
    };
  }

  if (typeof storage === 'object' && !Array.isArray(storage)) {
    const tasksDir = storage.tasksDir
      ? path.resolve(rootDir, storage.tasksDir)
      : fallback.tasksDir;
    const completedDir = storage.completedDir
      ? path.resolve(rootDir, storage.completedDir)
      : path.join(path.dirname(tasksDir), 'completed');
    const baseDir = path.dirname(tasksDir);

    return {
      baseDir,
      tasksDir,
      completedDir,
      archiveTasksDir: storage.archiveTasksDir
        ? path.resolve(rootDir, storage.archiveTasksDir)
        : path.join(baseDir, 'archive', 'tasks'),
      draftsDir: path.join(baseDir, 'drafts'),
    };
  }

  return fallback;
}

function resolveReviewAdapter(rootDir = process.cwd()) {
  const review = loadAdapterConfig(rootDir).review || {};
  return {
    provider: review.provider || null,
    remote: review.remote || null,
    baseUrl: review.baseUrl || null,
    repo: review.repo || null,
  };
}

function isForgejoReviewEnabled(rootDir = process.cwd()) {
  const review = resolveReviewAdapter(rootDir);
  if (review.provider === null) {return false;}
  return review.provider === 'forgejo';
}

function resolveAgentAdapter() {
  return {};
}

// Returns the configured LLM model string for an agent family, or null when the
// family is not listed under adapters.agents.models. A null return means the
// launcher omits the model parameter entirely so the agent uses its own default.
/** @param {string} agentFamily @param {string} [rootDir] */
function resolveAgentModel(agentFamily, rootDir = process.cwd()) {
  if (!agentFamily || typeof agentFamily !== 'string') {return null;}
  const agents = loadEffectiveConfig(rootDir).adapters.agents;
  if (!isPlainObject(agents) || !isPlainObject(agents.models)) {return null;}
  const model = agents.models[agentFamily];
  return typeof model === 'string' && model.length > 0 ? model : null;
}

function evaluateRepositoryReadiness(rootDir = process.cwd()) {
  const explicit = loadWorkflowConfig(rootDir);

  // No override file: the tool runs on code-owned defaults. This is a ready
  // state, not an "unconfigured" failure — an absent config is valid.
  if (!explicit.found) {
    return {
      mode: 'default',
      configPath: null,
      issues: [],
    };
  }

  if (explicit.parseError) {
    return {
      mode: 'invalid',
      configPath: explicit.configPath,
      issues: [`invalid JSON: ${/** @type{Error} */(explicit.parseError).message}`],
    };
  }

  const issues = validateWorkflowConfig(explicit.config);
  return {
    mode: issues.length === 0 ? 'configured' : 'invalid',
    configPath: explicit.configPath,
    issues,
  };
}

module.exports = {
  REQUIRED_ADAPTER_KEYS,
  DEFAULT_CONFIG,
  defaultConfig,
  adapterChecklist,
  commitWorkflowBaseline,
  configCandidates,
  deepMerge,
  detectLegacyRepoLayout,
  evaluateRepositoryReadiness,
  findWorkflowConfig,
  hasGitRepository,
  initializeGitRepository,
  isForgejoReviewEnabled,
  isStandaloneWorkflowLayout,
  loadWorkflowConfig,
  loadEffectiveConfig,
  loadAdapterConfig,
  resolveAgentAdapter,
  resolveAgentModel,
  resolveReviewAdapter,
  resolveTaskStorage,
  ensureStandaloneMissionBaseline,
  ensureStandaloneGitRepo,
  validateWorkflowConfig,
};
