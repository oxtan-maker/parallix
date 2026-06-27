import fs from 'node:fs';
import path from 'node:path';
import { loadEffectiveConfig } from './product-config.js';
import { log, status } from './fmt.js';

const SHIPPED_STATE_MAP_PATH = path.join(__dirname, '..', '..', 'config', 'state-map.json');

interface StateMapOptions {
  rootDir?: string;
  config?: Record<string, unknown>;
  fallbackPath?: string;
}

interface AdaptersConfig {
  tasks?: { stateMap?: string };
}

function resolveRepoRelativePath(rootDir: string, repoRelativePath: string | null): string | null {
  if (!repoRelativePath || typeof repoRelativePath !== 'string') {return null;}
  return path.isAbsolute(repoRelativePath)
    ? repoRelativePath
    : path.join(rootDir, repoRelativePath);
}

export function resolveStateMapPath(options: StateMapOptions | string = {}): string {
  if (typeof options === 'string') {return options;}

  const opts: StateMapOptions = options;
  const rootDir = opts.rootDir || process.cwd();
  const config = opts.config || loadEffectiveConfig(rootDir);
  const adapters = (config as Record<string, unknown>).adapters as AdaptersConfig | undefined;
  const configuredPath = adapters?.tasks?.stateMap as string | undefined;
  const repoPath = resolveRepoRelativePath(rootDir, configuredPath ?? null);

  if (repoPath && fs.existsSync(repoPath)) {
    return repoPath;
  }
  return opts.fallbackPath || SHIPPED_STATE_MAP_PATH;
}

export function loadStateMap(options: StateMapOptions = {}): Record<string, unknown> {
  const stateMapPath = resolveStateMapPath(options);
  try {
    return JSON.parse(fs.readFileSync(stateMapPath, 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function normalizeState(value: unknown): string | unknown {
  if (typeof value !== 'string') {return value;}
  return value.trim().toLowerCase();
}

function resolveMap(mapOrOptions: Record<string, unknown> | unknown): Record<string, unknown> {
  if (mapOrOptions && typeof mapOrOptions === 'object' && !Array.isArray(mapOrOptions)) {
    if (Object.prototype.hasOwnProperty.call(mapOrOptions, 'rootDir')
      || Object.prototype.hasOwnProperty.call(mapOrOptions, 'config')
      || Object.prototype.hasOwnProperty.call(mapOrOptions, 'fallbackPath')) {
      return loadStateMap(mapOrOptions as StateMapOptions);
    }
  }
  return (mapOrOptions as Record<string, unknown>) || loadStateMap();
}

export function toActual(virtualState: string, map: Record<string, unknown> = loadStateMap()): string | null {
  const m = resolveMap(map) || {};
  if (Object.prototype.hasOwnProperty.call(m, virtualState)) {
    return m[virtualState] as string | null;
  }
  return virtualState;
}

export function toVirtual(actualState: string, map: Record<string, unknown> = loadStateMap()): string {
  const m = resolveMap(map) || {};
  const normalizedActual = normalizeState(actualState) as string;
  for (const [virtual, actual] of Object.entries(m)) {
    if (normalizeState(actual) === normalizedActual) {return virtual;}
  }
  return actualState;
}

interface TransitionVirtualOptions {
  log?: (msg: string) => void;
}

interface TransitionTaskFn {
  (slug: string, actual: string, options: TransitionVirtualOptions): boolean;
}

export function transitionVirtual(transitionTaskFn: TransitionTaskFn, slug: string, virtualState: string, options: TransitionVirtualOptions = {}, mapParam?: Record<string, unknown>): boolean {
  let map: Record<string, unknown>;
  if (mapParam && typeof mapParam === 'object' && !Array.isArray(mapParam)) {
    if (Object.prototype.hasOwnProperty.call(mapParam, 'rootDir')
      || Object.prototype.hasOwnProperty.call(mapParam, 'config')
      || Object.prototype.hasOwnProperty.call(mapParam, 'fallbackPath')) {
      map = loadStateMap(mapParam as StateMapOptions);
    } else {
      map = mapParam;
    }
  } else {
    map = loadStateMap();
  }
  map = resolveMap(map);
  const actual = toActual(virtualState, map);
  if (actual === null) {
    const opts = options;
    const logFn = opts.log || log.plain;
    logFn(status('INFO', `Virtual state '${virtualState}' has no backlog.md mapping for this board; skipping status write.`));
    return true;
  }
  return transitionTaskFn(slug, actual, options);
}

export { SHIPPED_STATE_MAP_PATH };
