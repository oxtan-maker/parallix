const fs = require('fs');
const path = require('path');
const { loadEffectiveConfig } = require('./product-config');

const SHIPPED_STATE_MAP_PATH = path.join(__dirname, '..', '..', 'config', 'state-map.json');

/** @param {string} rootDir @param {string} repoRelativePath */
function resolveRepoRelativePath(rootDir, repoRelativePath) {
  if (!repoRelativePath || typeof repoRelativePath !== 'string') {return null;}
  return path.isAbsolute(repoRelativePath)
    ? repoRelativePath
    : path.join(rootDir, repoRelativePath);
}

/** @param {{rootDir?: string, config?: any, fallbackPath?: string}|string} [options] */
function resolveStateMapPath(options = {}) {
  if (typeof options === 'string') {return options;}

  /** @type {{rootDir?: string, config?: any, fallbackPath?: string}} */
  const opts = options;
  const rootDir = opts.rootDir || process.cwd();
  const config = opts.config || loadEffectiveConfig(rootDir);
  const configuredPath = config.adapters?.tasks?.stateMap;
  const repoPath = resolveRepoRelativePath(rootDir, configuredPath);

  if (repoPath && fs.existsSync(repoPath)) {
    return repoPath;
  }
  return opts.fallbackPath || SHIPPED_STATE_MAP_PATH;
}

function loadStateMap(options = {}) {
  const stateMapPath = resolveStateMapPath(options);
  try {
    return JSON.parse(fs.readFileSync(stateMapPath, 'utf8'));
  } catch (_) {
    return {};
  }
}

/** @param {unknown} value */
function normalizeState(value) {
  if (typeof value !== 'string') {return value;}
  return value.trim().toLowerCase();
}

// Virtual workflow state → actual backlog.md state name.
// Returns null if the virtual state explicitly maps to null (no backlog.md write).
// Returns the virtual name unchanged if it has no entry in the map (identity).
/** @param {Record<string, any> | any} mapOrOptions */
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

/** @param {string} virtualState @param {Record<string, any>} [map] */
function toActual(virtualState, map = loadStateMap()) {
  /** @type {Record<string, any>} */
  const m = resolveMap(map) || {};
  if (Object.prototype.hasOwnProperty.call(m, virtualState)) {
    return m[virtualState];
  }
  return virtualState;
}

// Actual backlog.md state name → virtual workflow state name.
// Returns the actual name unchanged if no reverse mapping exists (identity).
/** @param {string} actualState @param {Record<string, any>} [map] */
function toVirtual(actualState, map = loadStateMap()) {
  /** @type {Record<string, any>} */
  const m = resolveMap(map) || {};
  const normalizedActual = normalizeState(actualState);
  for (const [virtual, actual] of Object.entries(m)) {
    if (normalizeState(actual) === normalizedActual) {return virtual;}
  }
  return actualState;
}

// Wraps a transitionTask call: resolves virtual → actual, then delegates.
// If the virtual state maps to null, logs an info line and returns true (no-op).
/**
 * @param {Function} transitionTaskFn
 * @param {string} slug
 * @param {string} virtualState
 * @param {{log?: Function}} [options]
 * @param {Record<string, any>} [map]
 */
function transitionVirtual(transitionTaskFn, slug, virtualState, options = {}, map = loadStateMap(options)) {
  map = resolveMap(map);
  const actual = toActual(virtualState, map);
  if (actual === null) {
    const fmt = require('./fmt');
    /** @type {{log?: Function}} */
    const opts = options;
    const log = opts.log || fmt.log.plain;
    log(fmt.status('INFO', `Virtual state '${virtualState}' has no backlog.md mapping for this board; skipping status write.`));
    return true;
  }
  return transitionTaskFn(slug, actual, options);
}

module.exports = { SHIPPED_STATE_MAP_PATH, loadStateMap, normalizeState, resolveStateMapPath, toActual, toVirtual, transitionVirtual };
