import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateRepositoryGates } from './repository-gates.js';

const REQUIRED_ADAPTER_KEYS = ['tasks', 'missions', 'verification', 'review', 'agents'] as const;

/**
 * The task providers this release implements. Backlog Markdown is the only
 * task adapter that exists, so any other value is a configuration error rather
 * than an extension point (TASK-2455.02).
 */
export const SUPPORTED_TASK_PROVIDERS = ['backlog-md'] as const;

const DEFAULT_CONFIG = Object.freeze({
  product: {
    name: 'Workflow',
  },
  adapters: {
    tasks: { provider: 'backlog-md', storage: 'backlog', stateMap: 'state-map.json' },
    missions: {
      baseDir: 'missions',
      branchPrefix: 'mission/',
      worktreePattern: '../<repo>-<slug>',
    },
    verification: { defaultArea: 'docs' },
    review: {},
    agents: {},
    integrate: {},
  },
});

type PlainObject = Record<string, unknown>;

export function isPlainObject(value: unknown): value is PlainObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function deepMerge(base: PlainObject, override: PlainObject): PlainObject {
  if (!isPlainObject(override)) {return base;}
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const val = out[key] as PlainObject | undefined;
    out[key] = isPlainObject(value) && isPlainObject(val)
      ? deepMerge(val, value)
      : value;
  }
  return out;
}

export function defaultConfig(): typeof DEFAULT_CONFIG {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

export function configCandidates(rootDir: string = process.cwd()): string[] {
  return [path.join(rootDir, 'workflow.config.json')];
}

export function findWorkflowConfig(rootDir: string = process.cwd()): string | null {
  return configCandidates(rootDir).find(candidate => fs.existsSync(candidate)) || null;
}

interface LoadedConfigResult {
  found: boolean;
  configPath: string | null;
  config: unknown;
  parseError: Error | null;
}

export function loadWorkflowConfig(rootDir: string = process.cwd()): LoadedConfigResult {
  const configPath = findWorkflowConfig(rootDir);
  if (!configPath) {
    return { found: false, configPath: null, config: null, parseError: null };
  }

  let raw: string;
  try {
    raw = fs.readFileSync(configPath, 'utf8');
  } catch (error: unknown) {
    const e = error as Error & { code?: string };
    if (e && e.code === 'ENOENT') {
      return { found: false, configPath: null, config: null, parseError: null };
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
  } catch (error: unknown) {
    return {
      found: true,
      configPath,
      config: null,
      parseError: error as Error,
    };
  }
}

export function loadEffectiveConfig(rootDir: string = process.cwd()): typeof DEFAULT_CONFIG {
  const loaded = loadWorkflowConfig(rootDir);
  if (!loaded.found || loaded.parseError || !isPlainObject(loaded.config)) {
    return defaultConfig();
  }
  if (validateWorkflowConfig(loaded.config).length > 0) {
    return defaultConfig();
  }
  return deepMerge(defaultConfig(), loaded.config as PlainObject) as typeof DEFAULT_CONFIG;
}

function isSupportedTaskProvider(value: unknown): boolean {
  return typeof value === 'string' && (SUPPORTED_TASK_PROVIDERS as readonly string[]).includes(value);
}

function taskProviderIssue(value: unknown): string {
  const supported = SUPPORTED_TASK_PROVIDERS.join(', ');
  return `adapters.tasks.provider must be one of: ${supported} (got ${JSON.stringify(value)})`;
}

/**
 * Resolve the configured task provider, rejecting values this release cannot
 * implement. Task composition calls this before it selects the backlog-Markdown
 * adapter, so an unsupported provider stops the lifecycle instead of silently
 * running backlog-Markdown behavior under another provider name.
 */
export function resolveTaskProvider(rootDir: string = process.cwd()): string {
  const tasks = loadAdapterConfig(rootDir).tasks as PlainObject | undefined || {};
  if (!('provider' in tasks)) {
    return DEFAULT_CONFIG.adapters.tasks.provider;
  }
  if (!isSupportedTaskProvider(tasks.provider)) {
    throw new Error(taskProviderIssue(tasks.provider));
  }
  return tasks.provider as string;
}

// ponytail: this validator mirrors config/workflow.config.schema.json. The
// schema is the authoritative contract; keep field checks in sync when it
// changes. Unknown keys stay allowed everywhere the schema sets
// additionalProperties:true (top level, product, and each adapter section);
// only runners/subagents are closed objects and reject unknown keys.
export function validateWorkflowConfig(config: unknown): string[] {
  if (!isPlainObject(config)) {
    return ['top-level JSON object is required'];
  }

  const cfg = config as PlainObject;
  const issues: string[] = [];
  if ('product' in cfg && !isPlainObject(cfg.product)) {
    issues.push('product must be an object');
  }
  if ('adapters' in cfg) {
    const adapters = cfg.adapters as PlainObject | undefined;
    if (!isPlainObject(adapters)) {
      issues.push('adapters must be an object');
    } else {
      for (const [key, value] of Object.entries(adapters)) {
        if (!isPlainObject(value)) {
          issues.push(`adapters.${key} must be an object`);
        }
      }
      validateAdapterSections(adapters, issues);
      issues.push(...validateRepositoryGates(adapters));
    }
  }
  return issues;
}

function validateAdapterSections(adapters: PlainObject, issues: string[]): void {
  const tasks = isPlainObject(adapters.tasks) ? adapters.tasks : null;
  if (tasks) {
    validateStringField(tasks, 'provider', 'adapters.tasks.provider', issues);
    if ('provider' in tasks && typeof tasks.provider === 'string' && !isSupportedTaskProvider(tasks.provider)) {
      issues.push(taskProviderIssue(tasks.provider));
    }
    validateStringField(tasks, 'stateMap', 'adapters.tasks.stateMap', issues);
    if ('storage' in tasks && !isValidTaskStorage(tasks.storage)) {
      issues.push('adapters.tasks.storage must be a string or an object of string values');
    }
  }

  const missions = isPlainObject(adapters.missions) ? adapters.missions : null;
  if (missions) {
    validateStringField(missions, 'baseDir', 'adapters.missions.baseDir', issues);
    validateStringField(missions, 'branchPrefix', 'adapters.missions.branchPrefix', issues);
    validateStringField(missions, 'worktreePattern', 'adapters.missions.worktreePattern', issues);
    validateStringField(missions, 'primaryBranch', 'adapters.missions.primaryBranch', issues);
  }

  const verification = isPlainObject(adapters.verification) ? adapters.verification : null;
  if (verification) {
    validateStringField(verification, 'command', 'adapters.verification.command', issues);
    validateStringField(verification, 'defaultArea', 'adapters.verification.defaultArea', issues);
  }

  const integrate = isPlainObject(adapters.integrate) ? adapters.integrate : null;
  if (integrate) {
    validateStringField(integrate, 'postIntegrateCommand', 'adapters.integrate.postIntegrateCommand', issues);
  }

  // One new configuration key: adapters.prompts. It is a closed object whose
  // single allowed property is `override` (a repo-local default-opinion path).
  // Unknown keys beneath it fail here, through the existing configuration-error
  // path, so a repo cannot invent a second override surface.
  const prompts = isPlainObject(adapters.prompts) ? adapters.prompts : null;
  if (prompts) {
    if ('override' in prompts && typeof prompts.override !== 'string') {
      issues.push('adapters.prompts.override must be a string');
    }
    for (const key of Object.keys(prompts)) {
      if (key !== 'override') {
        issues.push('adapters.prompts may only contain "override"');
      }
    }
  }

  const review = isPlainObject(adapters.review) ? adapters.review : null;
  if (review) {
    validateStringField(review, 'baseUrl', 'adapters.review.baseUrl', issues);
    validateStringField(review, 'remote', 'adapters.review.remote', issues);
    validateStringField(review, 'repo', 'adapters.review.repo', issues);
    if ('provider' in review && !isValidReviewProvider(review.provider)) {
      issues.push('adapters.review.provider must be one of "forgejo", "none", or null');
    }
  }

  const agents = isPlainObject(adapters.agents) ? adapters.agents : null;
  if (agents) {
    if ('maxConcurrentCustom' in agents &&
      (!Number.isInteger(agents.maxConcurrentCustom) || (agents.maxConcurrentCustom as number) < 1)) {
      issues.push('adapters.agents.maxConcurrentCustom must be a positive integer');
    }
    validateAgentModels(agents, issues);
    validateRunnerSelection(agents, issues);
    validateSubagents(agents, issues);
  }
}

function validateStringField(obj: PlainObject, key: string, label: string, issues: string[]): void {
  if (key in obj && typeof obj[key] !== 'string') {
    issues.push(`${label} must be a string`);
  }
}

function isValidTaskStorage(value: unknown): boolean {
  if (typeof value === 'string') {return true;}
  if (!isPlainObject(value)) {return false;}
  // The schema declares the storage object with additionalProperties:true, so
  // only assert every value is a string; never close the object to a fixed key
  // set (task-2455.03 F1: schema-valid configs with extra storage keys must stay valid).
  return Object.keys(value).every(key => typeof value[key] === 'string');
}

function isValidReviewProvider(value: unknown): boolean {
  return value === null || value === 'forgejo' || value === 'none';
}

function validateAgentModels(agents: PlainObject, issues: string[]): void {
  if (!('models' in agents)) {return;}
  const models = agents.models;
  if (!isPlainObject(models)) {
    issues.push('adapters.agents.models must be an object');
    return;
  }
  for (const [family, model] of Object.entries(models)) {
    if (typeof model !== 'string') {
      issues.push(`adapters.agents.models.${family} must be a string`);
    }
  }
}

function validateRunnerSelection(agents: PlainObject, issues: string[]): void {
  if (!('runners' in agents)) {return;}
  const runners = agents.runners;
  if (!isPlainObject(runners)) {
    issues.push('adapters.agents.runners must be an object');
    return;
  }
  for (const key of Object.keys(runners)) {
    if (key !== 'custom') {
      issues.push('adapters.agents.runners may only contain "custom"');
    }
  }
  if ('custom' in runners && typeof runners.custom !== 'string') {
    issues.push('adapters.agents.runners.custom must be a string');
  } else if ('custom' in runners && runners.custom !== 'opencode' && runners.custom !== 'pi') {
    issues.push('adapters.agents.runners.custom must be one of "opencode", "pi"');
  }
}

function validateSubagents(agents: PlainObject, issues: string[]): void {
  if (!('subagents' in agents)) {return;}
  const subagents = agents.subagents;
  if (!isPlainObject(subagents)) {
    issues.push('adapters.agents.subagents must be an object');
    return;
  }
  for (const key of Object.keys(subagents)) {
    if (key !== 'maxParallel') {
      issues.push('adapters.agents.subagents may only contain "maxParallel"');
    }
  }
  if ('maxParallel' in subagents) {
    const value = subagents.maxParallel;
    if (value === null) {return;}
    if (!Number.isInteger(value) || (value as number) < 0) {
      issues.push('adapters.agents.subagents.maxParallel must be a non-negative integer or null');
    }
  }
}

export function detectLegacyRepoLayout(rootDir: string = process.cwd()): boolean {
  const backlogDir = path.join(rootDir, 'backlog');
  const missionDocsDir = path.join(rootDir, 'docs', 'missions');
  const verifyScript = path.join(rootDir, 'scripts', 'verify-local.sh');

  return fs.existsSync(backlogDir) && fs.existsSync(missionDocsDir) && fs.existsSync(verifyScript);
}

export function isStandaloneWorkflowLayout(rootDir: string = process.cwd()): boolean {
  const workflowIndex = path.join(rootDir, 'workflow', 'index.js');
  const workflowConfig = path.join(rootDir, 'workflow.config.json');

  return fs.existsSync(workflowIndex) && fs.existsSync(workflowConfig);
}

export function hasGitRepository(rootDir: string = process.cwd()): boolean {
  return fs.existsSync(path.join(rootDir, '.git'));
}

interface InitializeGitOptions {
  spawnSyncFn?: typeof spawnSync;
}

export function initializeGitRepository(rootDir: string = process.cwd(), options: InitializeGitOptions = {}): { ok: boolean; branch: string; mode: string } | { ok: boolean; message: string } {
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

export function gitIdentityEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (!env.GIT_AUTHOR_NAME) {env.GIT_AUTHOR_NAME = 'Workflow Setup';}
  if (!env.GIT_AUTHOR_EMAIL) {env.GIT_AUTHOR_EMAIL = 'workflow@example.invalid';}
  if (!env.GIT_COMMITTER_NAME) {env.GIT_COMMITTER_NAME = env.GIT_AUTHOR_NAME!;}
  if (!env.GIT_COMMITTER_EMAIL) {env.GIT_COMMITTER_EMAIL = env.GIT_AUTHOR_EMAIL!;}
  return env;
}

interface CommitWorkflowOptions {
  spawnSyncFn?: typeof spawnSync;
  existsSyncFn?: typeof fs.existsSync;
}

export function commitWorkflowBaseline(rootDir: string, options: CommitWorkflowOptions = {}): { ok: boolean; committed: boolean; files?: string[]; message?: string; reason?: string } {
  const spawnSyncFn = options.spawnSyncFn || spawnSync;
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

interface StandaloneBaselineOptions {
  spawnSyncFn?: typeof spawnSync;
}

export function ensureStandaloneMissionBaseline(rootDir: string = process.cwd(), { spawnSyncFn = spawnSync }: StandaloneBaselineOptions = {}): { changed: boolean; committed: boolean; skipped?: boolean; failed?: boolean; message?: string; entries?: string[] } {
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

interface EnsureStandaloneGitRepoOptions {
  isStandaloneWorkflowLayoutFn?: typeof isStandaloneWorkflowLayout;
  hasGitRepositoryFn?: typeof hasGitRepository;
  initializeGitRepositoryFn?: typeof initializeGitRepository;
  commitWorkflowBaselineFn?: typeof commitWorkflowBaseline;
}

export function ensureStandaloneGitRepo(rootDir: string = process.cwd(), options: EnsureStandaloneGitRepoOptions = {}): { changed: boolean; initialized: boolean; branch?: string; mode?: string; baselineCommit?: { ok: boolean; committed: boolean; files?: string[]; message?: string; reason?: string }; failed?: boolean; message?: string } {
  const opts = options;
  const isStandaloneWorkflowLayoutFn = opts.isStandaloneWorkflowLayoutFn || isStandaloneWorkflowLayout;
  const hasGitRepositoryFn = opts.hasGitRepositoryFn || hasGitRepository;
  const initializeGitRepositoryFn = opts.initializeGitRepositoryFn || initializeGitRepository;
  const commitWorkflowBaselineFn = opts.commitWorkflowBaselineFn || commitWorkflowBaseline;

  if (!isStandaloneWorkflowLayoutFn(rootDir) || hasGitRepositoryFn(rootDir)) {
    return { changed: false, initialized: false };
  }

  const initOpts = { spawnSyncFn: (options as unknown as InitializeGitOptions).spawnSyncFn };
  const result = initializeGitRepositoryFn(rootDir, initOpts);
  if (!result.ok) {
    return {
      changed: false,
      initialized: false,
      failed: true,
      message: (result as { message: string }).message || 'git init failed',
    };
  }

  const commitOpts = { spawnSyncFn: (options as unknown as CommitWorkflowOptions).spawnSyncFn, existsSyncFn: (options as unknown as CommitWorkflowOptions).existsSyncFn };
  const commit = commitWorkflowBaselineFn(rootDir, commitOpts);

  return {
    changed: true,
    initialized: true,
    branch: (result as { branch: string }).branch || 'main',
    mode: (result as { mode: string }).mode || 'init-main',
    baselineCommit: commit,
  };
}

export function adapterChecklist(): string[] {
  return [
    'Workflow runs on built-in defaults; no config file is required to start',
    'Create workflow.config.json only to override a default (schema: workflow/config/workflow.config.schema.json)',
    'Run `px config` to print the effective configuration',
    'Override adapters.tasks.storage or adapters.tasks.stateMap for task storage layout; adapters.tasks.provider only accepts backlog-md',
    'Override adapters.missions for mission document layout and branch/worktree conventions',
    'Override adapters.verification for your repo gate command',
    'Override adapters.review to enable a review provider and remote naming',
  ];
}

export function loadAdapterConfig(rootDir: string = process.cwd()): PlainObject {
  const explicit = loadWorkflowConfig(rootDir);
  if (!explicit.found || explicit.parseError || !isPlainObject(explicit.config)) {
    return {};
  }
  return isPlainObject(explicit.config.adapters) ? explicit.config.adapters as PlainObject : {};
}

/**
 * Resolve the repo-local default-opinion override selected by the single
 * `adapters.prompts.override` configuration key, or null when unconfigured. An
 * unconfigured repository keeps today's shipped defaults byte for byte. The
 * assets package reads the resolved absolute path; this resolver owns only the
 * configuration boundary.
 */
export function resolvePromptOverride(rootDir: string = process.cwd()): string | null {
  const prompts = loadAdapterConfig(rootDir).prompts;
  if (!isPlainObject(prompts)) {return null;}
  const override = prompts.override;
  if (typeof override !== 'string' || override.trim() === '') {return null;}
  return path.isAbsolute(override) ? override : path.resolve(rootDir, override);
}

export interface TaskStorageResult {
  baseDir: string;
  tasksDir: string;
  completedDir: string;
  archiveTasksDir: string;
  draftsDir: string;
}

export function resolveTaskStorage(rootDir: string = process.cwd()): TaskStorageResult {
  resolveTaskProvider(rootDir);

  const fallbackBaseDir = path.join(rootDir, 'backlog');
  const fallback: TaskStorageResult = {
    baseDir: fallbackBaseDir,
    tasksDir: path.join(fallbackBaseDir, 'tasks'),
    completedDir: path.join(fallbackBaseDir, 'completed'),
    archiveTasksDir: path.join(fallbackBaseDir, 'archive', 'tasks'),
    draftsDir: path.join(fallbackBaseDir, 'drafts'),
  };

  const tasksAdapter = loadAdapterConfig(rootDir).tasks as PlainObject | undefined || {};
  const storage = (tasksAdapter.storagePath as string) || (tasksAdapter.storage as string);
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
    const storageObj = storage as PlainObject;
    const tasksDir = storageObj.tasksDir
      ? path.resolve(rootDir, storageObj.tasksDir as string)
      : fallback.tasksDir;
    const completedDir = storageObj.completedDir
      ? path.resolve(rootDir, storageObj.completedDir as string)
      : path.join(path.dirname(tasksDir), 'completed');
    const baseDir = path.dirname(tasksDir);

    return {
      baseDir,
      tasksDir,
      completedDir,
      archiveTasksDir: storageObj.archiveTasksDir
        ? path.resolve(rootDir, storageObj.archiveTasksDir as string)
        : path.join(baseDir, 'archive', 'tasks'),
      draftsDir: path.join(baseDir, 'drafts'),
    };
  }

  return fallback;
}

interface ReviewAdapterResult {
  provider: string | null;
  remote: string | null;
  baseUrl: string | null;
  repo: string | null;
}

export function resolveReviewAdapter(rootDir: string = process.cwd()): ReviewAdapterResult {
  const review = loadAdapterConfig(rootDir).review as PlainObject | undefined || {};
  return {
    provider: (review.provider as string) || null,
    remote: (review.remote as string) || null,
    baseUrl: (review.baseUrl as string) || null,
    repo: (review.repo as string) || null,
  };
}

/** Resolve the review artifact directory from workflow configuration. */
export function resolveReviewArtifactDir(rootDir: string = process.cwd()): string {
  const review = loadAdapterConfig(rootDir).review as PlainObject | undefined || {};
  const configured = typeof review.tmpDir === 'string' && review.tmpDir.trim()
    ? review.tmpDir.trim()
    : null;
  return configured ? (path.isAbsolute(configured) ? configured : path.resolve(rootDir, configured)) : os.tmpdir();
}

export function isForgejoReviewEnabled(rootDir: string = process.cwd()): boolean {
  const review = resolveReviewAdapter(rootDir);
  if (review.provider === null) {return false;}
  return review.provider === 'forgejo';
}

export function resolveAgentAdapter(): PlainObject {
  return {};
}

export function resolveAgentModel(agentFamily: string, rootDir: string = process.cwd()): string | null {
  if (!agentFamily || typeof agentFamily !== 'string') {return null;}
  const agents = loadEffectiveConfig(rootDir).adapters.agents as PlainObject | undefined;
  if (!isPlainObject(agents)) {return null;}
  const models = agents.models as PlainObject | undefined;
  if (!isPlainObject(models)) {return null;}
  const model = models[agentFamily];
  return typeof model === 'string' && model.length > 0 ? model : null;
}

export function resolveCustomRunner(rootDir: string = process.cwd()): string {
  const agents = loadEffectiveConfig(rootDir).adapters.agents as PlainObject | undefined;
  if (!isPlainObject(agents)) {return 'opencode';}
  const runners = agents.runners as PlainObject | undefined;
  if (!isPlainObject(runners)) {return 'opencode';}
  const customRunner = runners.custom;
  return typeof customRunner === 'string' && ['opencode', 'pi'].includes(customRunner) ? customRunner : 'opencode';
}

export function resolveMaxConcurrentCustom(rootDir: string = process.cwd()): number {
  const agents = loadEffectiveConfig(rootDir).adapters.agents as PlainObject | undefined;
  const max = agents && agents.maxConcurrentCustom;
  return Number.isInteger(max) && (max as number) > 0 ? max as number : Infinity;
}

/** The first worktree is Git's canonical checkout; mission worktrees are not policy authorities. */
export function resolveCanonicalRepositoryRoot(rootDir: string = process.cwd()): string {
  const result = spawnSync('git', ['-C', rootDir, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' });
  const first = result.status === 0 ? result.stdout.match(/^worktree (.+)$/m)?.[1] : null;
  return first ? path.resolve(first) : path.resolve(rootDir);
}

export function resolveCanonicalMaxConcurrentCustom(rootDir: string = process.cwd()): number {
  const canonicalRoot = resolveCanonicalRepositoryRoot(rootDir);
  const loaded = loadWorkflowConfig(canonicalRoot);
  if (loaded.found && (loaded.parseError || validateWorkflowConfig(loaded.config).length > 0)) {
    throw new Error(`Invalid workflow.config.json at ${loaded.configPath}: adapters.agents.maxConcurrentCustom admission fails closed`);
  }
  return resolveMaxConcurrentCustom(canonicalRoot);
}

interface RepositoryReadinessResult {
  mode: string;
  configPath: string | null;
  issues: string[];
}

export function evaluateRepositoryReadiness(rootDir: string = process.cwd()): RepositoryReadinessResult {
  const explicit = loadWorkflowConfig(rootDir);

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
      issues: [`invalid JSON: ${(explicit.parseError as Error).message}`],
    };
  }

  const issues = validateWorkflowConfig(explicit.config);
  return {
    mode: issues.length === 0 ? 'configured' : 'invalid',
    configPath: explicit.configPath,
    issues,
  };
}

export { REQUIRED_ADAPTER_KEYS, DEFAULT_CONFIG };
