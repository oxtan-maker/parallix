"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SHIPPED_STATE_MAP_PATH = void 0;
exports.resolveStateMapPath = resolveStateMapPath;
exports.loadStateMap = loadStateMap;
exports.normalizeState = normalizeState;
exports.toActual = toActual;
exports.toVirtual = toVirtual;
exports.transitionVirtual = transitionVirtual;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const product_config_js_1 = require("./product-config.js");
const fmt_js_1 = require("./fmt.js");
const package_root_js_1 = require("./package-root.js");
const SHIPPED_STATE_MAP_PATH = node_path_1.default.join((0, package_root_js_1.packageRoot)(__dirname), 'config', 'state-map.json');
exports.SHIPPED_STATE_MAP_PATH = SHIPPED_STATE_MAP_PATH;
function resolveRepoRelativePath(rootDir, repoRelativePath) {
    if (!repoRelativePath || typeof repoRelativePath !== 'string') {
        return null;
    }
    return node_path_1.default.isAbsolute(repoRelativePath)
        ? repoRelativePath
        : node_path_1.default.join(rootDir, repoRelativePath);
}
function resolveStateMapPath(options = {}) {
    if (typeof options === 'string') {
        return options;
    }
    const opts = options;
    const rootDir = opts.rootDir || process.cwd();
    const config = opts.config || (0, product_config_js_1.loadEffectiveConfig)(rootDir);
    const adapters = config.adapters;
    const configuredPath = adapters?.tasks?.stateMap;
    const repoPath = resolveRepoRelativePath(rootDir, configuredPath ?? null);
    if (repoPath && node_fs_1.default.existsSync(repoPath)) {
        return repoPath;
    }
    return opts.fallbackPath || SHIPPED_STATE_MAP_PATH;
}
function loadStateMap(options = {}) {
    const stateMapPath = resolveStateMapPath(options);
    try {
        return JSON.parse(node_fs_1.default.readFileSync(stateMapPath, 'utf8'));
    }
    catch {
        return {};
    }
}
function normalizeState(value) {
    if (typeof value !== 'string') {
        return value;
    }
    return value.trim().toLowerCase();
}
function resolveMap(mapOrOptions) {
    if (mapOrOptions && typeof mapOrOptions === 'object' && !Array.isArray(mapOrOptions)) {
        if (Object.prototype.hasOwnProperty.call(mapOrOptions, 'rootDir')
            || Object.prototype.hasOwnProperty.call(mapOrOptions, 'config')
            || Object.prototype.hasOwnProperty.call(mapOrOptions, 'fallbackPath')) {
            return loadStateMap(mapOrOptions);
        }
    }
    return mapOrOptions || loadStateMap();
}
function toActual(virtualState, map = loadStateMap()) {
    const m = resolveMap(map) || {};
    if (Object.prototype.hasOwnProperty.call(m, virtualState)) {
        return m[virtualState];
    }
    return virtualState;
}
function toVirtual(actualState, map = loadStateMap()) {
    const m = resolveMap(map) || {};
    const normalizedActual = normalizeState(actualState);
    for (const [virtual, actual] of Object.entries(m)) {
        if (normalizeState(actual) === normalizedActual) {
            return virtual;
        }
    }
    return actualState;
}
function transitionVirtual(transitionTaskFn, slug, virtualState, options = {}, mapParam) {
    let map;
    if (mapParam && typeof mapParam === 'object' && !Array.isArray(mapParam)) {
        if (Object.prototype.hasOwnProperty.call(mapParam, 'rootDir')
            || Object.prototype.hasOwnProperty.call(mapParam, 'config')
            || Object.prototype.hasOwnProperty.call(mapParam, 'fallbackPath')) {
            map = loadStateMap(mapParam);
        }
        else {
            map = mapParam;
        }
    }
    else {
        map = loadStateMap();
    }
    map = resolveMap(map);
    const actual = toActual(virtualState, map);
    if (actual === null) {
        const opts = options;
        const logFn = opts.log || fmt_js_1.log.plain;
        logFn((0, fmt_js_1.status)('INFO', `Virtual state '${virtualState}' has no backlog.md mapping for this board; skipping status write.`));
        return true;
    }
    return transitionTaskFn(slug, actual, options);
}
