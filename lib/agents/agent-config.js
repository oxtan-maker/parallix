"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONFIG_PATH = void 0;
exports.buildInvalidAgentConfigError = buildInvalidAgentConfigError;
exports.isInvalidAgentConfigError = isInvalidAgentConfigError;
exports.readAgentConfigOrExit = readAgentConfigOrExit;
exports.parseAgentConfigFile = parseAgentConfigFile;
exports.readAgentConfig = readAgentConfig;
exports.parseBlockUntil = parseBlockUntil;
exports.isAgentBlocked = isAgentBlocked;
exports.resolveBlocklistTargetPath = resolveBlocklistTargetPath;
exports.updateAgentBlock = updateAgentBlock;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const fmt = __importStar(require("../core/fmt.js"));
const storage = __importStar(require("../core/storage.js"));
const persistent_data_migration_js_1 = require("../core/persistent-data-migration.js");
const worktree_js_1 = require("./worktree.js");
const package_root_js_1 = require("../core/package-root.js");
const CONFIG_PATH = node_path_1.default.join((0, package_root_js_1.packageRoot)(__dirname), 'config', 'agents.json');
exports.CONFIG_PATH = CONFIG_PATH;
function buildInvalidAgentConfigError(configPath, scope, originalError) {
    const location = node_path_1.default.resolve(configPath);
    const detail = originalError && originalError.message ? originalError.message : 'invalid JSON';
    const error = new Error(`Invalid ${scope} agent config at ${location}: ${detail}. ` +
        'Fix or remove the malformed file before running workflow commands so agent blocking is applied deterministically.');
    error.code = 'WORKFLOW_AGENT_CONFIG_INVALID';
    error.configPath = location;
    error.configScope = scope;
    return error;
}
function isInvalidAgentConfigError(error) {
    return Boolean(error && error.code === 'WORKFLOW_AGENT_CONFIG_INVALID');
}
function readAgentConfigOrExit(configPath = CONFIG_PATH, options = {}) {
    try {
        return readAgentConfig(configPath, options);
    }
    catch (error) {
        if (isInvalidAgentConfigError(error)) {
            fmt.log.fail(error.message);
            process.exit(1);
        }
        throw error;
    }
}
function parseAgentConfigFile(configPath, scope) {
    try {
        return JSON.parse(node_fs_1.default.readFileSync(configPath, 'utf8'));
    }
    catch (err) {
        throw buildInvalidAgentConfigError(configPath, scope, err);
    }
}
function readAgentConfig(configPath = CONFIG_PATH, options = {}) {
    const { mergeLocal = node_path_1.default.resolve(configPath) === node_path_1.default.resolve(CONFIG_PATH), mainWorktreePath, warn = fmt.log.warn } = options;
    let config = {};
    if (node_fs_1.default.existsSync(configPath)) {
        config = parseAgentConfigFile(configPath, 'workflow');
    }
    if (mergeLocal) {
        config = config || {};
        const projectRoot = node_path_1.default.resolve(node_path_1.default.dirname(configPath), '..', '..');
        const mainWorktree = mainWorktreePath !== undefined
            ? mainWorktreePath
            : (0, worktree_js_1.getMainWorktreePath)({ cwd: projectRoot, warn });
        const legacyPaths = [
            node_path_1.default.join(node_path_1.default.dirname(configPath), 'agents.local.json'),
            node_path_1.default.join(projectRoot, 'agents.local.json'),
            mainWorktree ? node_path_1.default.join(mainWorktree, 'agents.local.json') : ''
        ].filter(Boolean);
        const targetPath = options.targetPath || storage.resolveAgentsLocalPath({ ensureDir: true });
        if (!node_fs_1.default.existsSync(targetPath)) {
            try {
                (0, persistent_data_migration_js_1.migrateAgentBlocklists)({
                    sourcePaths: legacyPaths,
                    destinationPath: targetPath,
                    warn: warn
                });
            }
            catch (error) {
                throw buildInvalidAgentConfigError(targetPath, 'local', error);
            }
        }
        if (node_fs_1.default.existsSync(targetPath)) {
            const localConfig = parseAgentConfigFile(targetPath, 'local');
            if (localConfig && localConfig.blocklist) {
                config.blocklist = Object.assign(config.blocklist || {}, localConfig.blocklist);
            }
        }
    }
    return config;
}
function parseBlockUntil(value) {
    if (typeof value !== 'string') {
        return NaN;
    }
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2})$/);
    if (!match) {
        return NaN;
    }
    const [, yearStr, monthStr, dayStr, hourStr] = match;
    const year = Number(yearStr);
    const month = Number(monthStr);
    const day = Number(dayStr);
    const hour = Number(hourStr);
    const parsed = new Date(year, month - 1, day, hour, 0, 0, 0);
    if (parsed.getFullYear() !== year ||
        parsed.getMonth() !== month - 1 ||
        parsed.getDate() !== day ||
        parsed.getHours() !== hour) {
        return NaN;
    }
    return parsed.getTime();
}
function isAgentBlocked(agent, config) {
    if (!config || !config.blocklist || config.blocklist[agent] === undefined) {
        return false;
    }
    const entry = config.blocklist[agent];
    if (entry === true) {
        return true;
    }
    if (entry === false) {
        return false;
    }
    if (entry && typeof entry === 'object') {
        if (entry.blocked === true) {
            return true;
        }
        if (entry.blocked === false) {
            return false;
        }
        if (entry.until) {
            const until = parseBlockUntil(entry.until);
            if (!isNaN(until) && until > Date.now()) {
                return true;
            }
        }
    }
    return false;
}
function resolveBlocklistTargetPath(options = {}) {
    if (options.targetPath) {
        return options.targetPath;
    }
    return storage.resolveAgentsLocalPath({ ensureDir: true });
}
function updateAgentBlock(agent, until, options = {}) {
    if (!agent || typeof agent !== 'string') {
        throw new Error('updateAgentBlock requires an agent name');
    }
    if (!until || typeof until !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}$/.test(until)) {
        throw new Error(`updateAgentBlock requires an "YYYY-MM-DD HH" timestamp; got: ${until}`);
    }
    const targetPath = resolveBlocklistTargetPath(options);
    let payload = {};
    if (node_fs_1.default.existsSync(targetPath)) {
        try {
            payload = JSON.parse(node_fs_1.default.readFileSync(targetPath, 'utf8')) || {};
        }
        catch (err) {
            throw buildInvalidAgentConfigError(targetPath, 'local', err);
        }
        if (typeof payload !== 'object' || Array.isArray(payload)) {
            throw buildInvalidAgentConfigError(targetPath, 'local', new Error('expected a JSON object at the file root'));
        }
    }
    if (!payload.blocklist || typeof payload.blocklist !== 'object' || Array.isArray(payload.blocklist)) {
        payload.blocklist = {};
    }
    payload.blocklist[agent] = { until, reason: options.reason };
    storage.writeJson(targetPath, payload);
    return { path: targetPath, blocklist: payload.blocklist };
}
