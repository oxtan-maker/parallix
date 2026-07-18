"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CONFIG = exports.REQUIRED_ADAPTER_KEYS = void 0;
exports.isPlainObject = isPlainObject;
exports.deepMerge = deepMerge;
exports.defaultConfig = defaultConfig;
exports.configCandidates = configCandidates;
exports.findWorkflowConfig = findWorkflowConfig;
exports.loadWorkflowConfig = loadWorkflowConfig;
exports.loadEffectiveConfig = loadEffectiveConfig;
exports.validateWorkflowConfig = validateWorkflowConfig;
exports.detectLegacyRepoLayout = detectLegacyRepoLayout;
exports.isStandaloneWorkflowLayout = isStandaloneWorkflowLayout;
exports.hasGitRepository = hasGitRepository;
exports.initializeGitRepository = initializeGitRepository;
exports.gitIdentityEnv = gitIdentityEnv;
exports.commitWorkflowBaseline = commitWorkflowBaseline;
exports.ensureStandaloneMissionBaseline = ensureStandaloneMissionBaseline;
exports.ensureStandaloneGitRepo = ensureStandaloneGitRepo;
exports.adapterChecklist = adapterChecklist;
exports.loadAdapterConfig = loadAdapterConfig;
exports.resolveTaskStorage = resolveTaskStorage;
exports.resolveReviewAdapter = resolveReviewAdapter;
exports.isForgejoReviewEnabled = isForgejoReviewEnabled;
exports.resolveAgentAdapter = resolveAgentAdapter;
exports.resolveAgentModel = resolveAgentModel;
exports.resolveCustomRunner = resolveCustomRunner;
exports.resolveMaxConcurrentCustom = resolveMaxConcurrentCustom;
exports.evaluateRepositoryReadiness = evaluateRepositoryReadiness;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_child_process_1 = require("node:child_process");
const REQUIRED_ADAPTER_KEYS = ['tasks', 'missions', 'verification', 'review', 'agents'];
exports.REQUIRED_ADAPTER_KEYS = REQUIRED_ADAPTER_KEYS;
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
        verification: { defaultArea: 'docs' },
        stats: { path: 'stats.csv' },
        review: {},
        agents: {},
        integrate: {},
    },
});
exports.DEFAULT_CONFIG = DEFAULT_CONFIG;
function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function deepMerge(base, override) {
    if (!isPlainObject(override)) {
        return base;
    }
    const out = { ...base };
    for (const [key, value] of Object.entries(override)) {
        const val = out[key];
        out[key] = isPlainObject(value) && isPlainObject(val)
            ? deepMerge(val, value)
            : value;
    }
    return out;
}
function defaultConfig() {
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}
function configCandidates(rootDir = process.cwd()) {
    return [node_path_1.default.join(rootDir, 'workflow.config.json')];
}
function findWorkflowConfig(rootDir = process.cwd()) {
    return configCandidates(rootDir).find(candidate => node_fs_1.default.existsSync(candidate)) || null;
}
function loadWorkflowConfig(rootDir = process.cwd()) {
    const configPath = findWorkflowConfig(rootDir);
    if (!configPath) {
        return { found: false, configPath: null, config: null, parseError: null };
    }
    let raw;
    try {
        raw = node_fs_1.default.readFileSync(configPath, 'utf8');
    }
    catch (error) {
        const e = error;
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
    }
    catch (error) {
        return {
            found: true,
            configPath,
            config: null,
            parseError: error,
        };
    }
}
function loadEffectiveConfig(rootDir = process.cwd()) {
    const loaded = loadWorkflowConfig(rootDir);
    if (!loaded.found || loaded.parseError || !isPlainObject(loaded.config)) {
        return defaultConfig();
    }
    if (validateWorkflowConfig(loaded.config).length > 0) {
        return defaultConfig();
    }
    return deepMerge(defaultConfig(), loaded.config);
}
function validateWorkflowConfig(config) {
    if (!isPlainObject(config)) {
        return ['top-level JSON object is required'];
    }
    const cfg = config;
    const issues = [];
    if ('product' in cfg && !isPlainObject(cfg.product)) {
        issues.push('product must be an object');
    }
    if ('adapters' in cfg) {
        const adapters = cfg.adapters;
        if (!isPlainObject(adapters)) {
            issues.push('adapters must be an object');
        }
        else {
            for (const [key, value] of Object.entries(adapters)) {
                if (!isPlainObject(value)) {
                    issues.push(`adapters.${key} must be an object`);
                }
            }
        }
    }
    const agents = isPlainObject(cfg.adapters?.agents)
        ? cfg.adapters.agents
        : null;
    if (agents && 'maxConcurrentCustom' in agents &&
        (!Number.isInteger(agents.maxConcurrentCustom) || agents.maxConcurrentCustom < 1)) {
        issues.push('adapters.agents.maxConcurrentCustom must be a positive integer');
    }
    return issues;
}
function detectLegacyRepoLayout(rootDir = process.cwd()) {
    const backlogDir = node_path_1.default.join(rootDir, 'backlog');
    const missionDocsDir = node_path_1.default.join(rootDir, 'docs', 'missions');
    const verifyScript = node_path_1.default.join(rootDir, 'scripts', 'verify-local.sh');
    return node_fs_1.default.existsSync(backlogDir) && node_fs_1.default.existsSync(missionDocsDir) && node_fs_1.default.existsSync(verifyScript);
}
function isStandaloneWorkflowLayout(rootDir = process.cwd()) {
    const workflowIndex = node_path_1.default.join(rootDir, 'workflow', 'index.js');
    const workflowConfig = node_path_1.default.join(rootDir, 'workflow.config.json');
    return node_fs_1.default.existsSync(workflowIndex) && node_fs_1.default.existsSync(workflowConfig);
}
function hasGitRepository(rootDir = process.cwd()) {
    return node_fs_1.default.existsSync(node_path_1.default.join(rootDir, '.git'));
}
function initializeGitRepository(rootDir = process.cwd(), options = {}) {
    const spawnSyncFn = options.spawnSyncFn || node_child_process_1.spawnSync;
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
function gitIdentityEnv() {
    const env = { ...process.env };
    if (!env.GIT_AUTHOR_NAME) {
        env.GIT_AUTHOR_NAME = 'Workflow Setup';
    }
    if (!env.GIT_AUTHOR_EMAIL) {
        env.GIT_AUTHOR_EMAIL = 'workflow@example.invalid';
    }
    if (!env.GIT_COMMITTER_NAME) {
        env.GIT_COMMITTER_NAME = env.GIT_AUTHOR_NAME;
    }
    if (!env.GIT_COMMITTER_EMAIL) {
        env.GIT_COMMITTER_EMAIL = env.GIT_AUTHOR_EMAIL;
    }
    return env;
}
function commitWorkflowBaseline(rootDir, options = {}) {
    const spawnSyncFn = options.spawnSyncFn || node_child_process_1.spawnSync;
    const existsSyncFn = options.existsSyncFn || node_fs_1.default.existsSync;
    const candidates = ['workflow', 'workflow.config.json'];
    const present = candidates.filter(name => existsSyncFn(node_path_1.default.join(rootDir, name)));
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
    const commitResult = spawnSyncFn('git', ['commit', '-m', 'workflow: initial setup'], { cwd: rootDir, encoding: 'utf8', env: gitIdentityEnv() });
    if (commitResult.status !== 0) {
        return {
            ok: false,
            committed: false,
            message: (commitResult.stderr || commitResult.stdout || 'git commit failed').trim(),
        };
    }
    return { ok: true, committed: true, files: present };
}
function ensureStandaloneMissionBaseline(rootDir = process.cwd(), { spawnSyncFn = node_child_process_1.spawnSync } = {}) {
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
function ensureStandaloneGitRepo(rootDir = process.cwd(), options = {}) {
    const opts = options;
    const isStandaloneWorkflowLayoutFn = opts.isStandaloneWorkflowLayoutFn || isStandaloneWorkflowLayout;
    const hasGitRepositoryFn = opts.hasGitRepositoryFn || hasGitRepository;
    const initializeGitRepositoryFn = opts.initializeGitRepositoryFn || initializeGitRepository;
    const commitWorkflowBaselineFn = opts.commitWorkflowBaselineFn || commitWorkflowBaseline;
    if (!isStandaloneWorkflowLayoutFn(rootDir) || hasGitRepositoryFn(rootDir)) {
        return { changed: false, initialized: false };
    }
    const initOpts = { spawnSyncFn: options.spawnSyncFn };
    const result = initializeGitRepositoryFn(rootDir, initOpts);
    if (!result.ok) {
        return {
            changed: false,
            initialized: false,
            failed: true,
            message: result.message || 'git init failed',
        };
    }
    const commitOpts = { spawnSyncFn: options.spawnSyncFn, existsSyncFn: options.existsSyncFn };
    const commit = commitWorkflowBaselineFn(rootDir, commitOpts);
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
function loadAdapterConfig(rootDir = process.cwd()) {
    const explicit = loadWorkflowConfig(rootDir);
    if (!explicit.found || explicit.parseError || !isPlainObject(explicit.config)) {
        return {};
    }
    return isPlainObject(explicit.config.adapters) ? explicit.config.adapters : {};
}
function resolveTaskStorage(rootDir = process.cwd()) {
    const fallbackBaseDir = node_path_1.default.join(rootDir, 'backlog');
    const fallback = {
        baseDir: fallbackBaseDir,
        tasksDir: node_path_1.default.join(fallbackBaseDir, 'tasks'),
        completedDir: node_path_1.default.join(fallbackBaseDir, 'completed'),
        archiveTasksDir: node_path_1.default.join(fallbackBaseDir, 'archive', 'tasks'),
        draftsDir: node_path_1.default.join(fallbackBaseDir, 'drafts'),
    };
    const tasksAdapter = loadAdapterConfig(rootDir).tasks || {};
    const storage = tasksAdapter.storagePath || tasksAdapter.storage;
    if (!storage) {
        return fallback;
    }
    if (typeof storage === 'string') {
        const storageDir = node_path_1.default.resolve(rootDir, storage);
        const storageName = node_path_1.default.basename(storageDir);
        if (storageName === 'tasks') {
            const baseDir = node_path_1.default.dirname(storageDir);
            return {
                baseDir,
                tasksDir: storageDir,
                completedDir: node_path_1.default.join(baseDir, 'completed'),
                archiveTasksDir: node_path_1.default.join(baseDir, 'archive', 'tasks'),
                draftsDir: node_path_1.default.join(baseDir, 'drafts'),
            };
        }
        return {
            baseDir: storageDir,
            tasksDir: node_path_1.default.join(storageDir, 'tasks'),
            completedDir: node_path_1.default.join(storageDir, 'completed'),
            archiveTasksDir: node_path_1.default.join(storageDir, 'archive', 'tasks'),
            draftsDir: node_path_1.default.join(storageDir, 'drafts'),
        };
    }
    if (typeof storage === 'object' && !Array.isArray(storage)) {
        const storageObj = storage;
        const tasksDir = storageObj.tasksDir
            ? node_path_1.default.resolve(rootDir, storageObj.tasksDir)
            : fallback.tasksDir;
        const completedDir = storageObj.completedDir
            ? node_path_1.default.resolve(rootDir, storageObj.completedDir)
            : node_path_1.default.join(node_path_1.default.dirname(tasksDir), 'completed');
        const baseDir = node_path_1.default.dirname(tasksDir);
        return {
            baseDir,
            tasksDir,
            completedDir,
            archiveTasksDir: storageObj.archiveTasksDir
                ? node_path_1.default.resolve(rootDir, storageObj.archiveTasksDir)
                : node_path_1.default.join(baseDir, 'archive', 'tasks'),
            draftsDir: node_path_1.default.join(baseDir, 'drafts'),
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
    if (review.provider === null) {
        return false;
    }
    return review.provider === 'forgejo';
}
function resolveAgentAdapter() {
    return {};
}
function resolveAgentModel(agentFamily, rootDir = process.cwd()) {
    if (!agentFamily || typeof agentFamily !== 'string') {
        return null;
    }
    const agents = loadEffectiveConfig(rootDir).adapters.agents;
    if (!isPlainObject(agents)) {
        return null;
    }
    const models = agents.models;
    if (!isPlainObject(models)) {
        return null;
    }
    const model = models[agentFamily];
    return typeof model === 'string' && model.length > 0 ? model : null;
}
function resolveCustomRunner(rootDir = process.cwd()) {
    const agents = loadEffectiveConfig(rootDir).adapters.agents;
    if (!isPlainObject(agents)) {
        return 'opencode';
    }
    const runners = agents.runners;
    if (!isPlainObject(runners)) {
        return 'opencode';
    }
    const customRunner = runners.custom;
    return typeof customRunner === 'string' && ['opencode', 'pi'].includes(customRunner) ? customRunner : 'opencode';
}
function resolveMaxConcurrentCustom(rootDir = process.cwd()) {
    const agents = loadEffectiveConfig(rootDir).adapters.agents;
    const max = agents && agents.maxConcurrentCustom;
    return Number.isInteger(max) && max > 0 ? max : Infinity;
}
function evaluateRepositoryReadiness(rootDir = process.cwd()) {
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
            issues: [`invalid JSON: ${explicit.parseError.message}`],
        };
    }
    const issues = validateWorkflowConfig(explicit.config);
    return {
        mode: issues.length === 0 ? 'configured' : 'invalid',
        configPath: explicit.configPath,
        issues,
    };
}
