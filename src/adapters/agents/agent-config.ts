import fs from 'node:fs';
import path from 'node:path';
import * as fmt from '../../application/presentation/cli-format.js';
import * as storage from '../storage/storage.js';
import { migrateAgentBlocklists } from '../storage/persistent-data-migration.js';
import { getMainWorktreePath } from '../git/agent-worktree.js';
import { runtimeAssetStore } from '../assets/runtime-assets.js';

type AgentConfig = { blocklist?: {[key: string]: any}, steps?: {[key: string]: any} };

type ReadAgentConfigOptions = {
  mergeLocal?: boolean;
  mainWorktreePath?: string | null;
  warn?: Function;
  targetPath?: string;
};

const CONFIG_PATH = 'config/agents.json';

function buildInvalidAgentConfigError(configPath: string, scope: string, originalError: {message?: string} | null) {
  const location = path.resolve(configPath);
  const detail = originalError && originalError.message ? originalError.message : 'invalid JSON';
  const error: any = new Error(
    `Invalid ${scope} agent config at ${location}: ${detail}. ` +
    'Fix or remove the malformed file before running workflow commands so agent blocking is applied deterministically.'
  );
  error.code = 'WORKFLOW_AGENT_CONFIG_INVALID';
  error.configPath = location;
  error.configScope = scope;
  return error;
}

function isInvalidAgentConfigError(error: {code?: string}) {
  return Boolean(error && error.code === 'WORKFLOW_AGENT_CONFIG_INVALID');
}

function readAgentConfigOrExit(configPath: string = CONFIG_PATH, options: ReadAgentConfigOptions = {}) {
  try {
    return readAgentConfig(configPath, options);
  } catch (error) {
    if (isInvalidAgentConfigError((error as any))) {
      fmt.log.fail((error as any).message);
      process.exit(1);
    }
    throw error;
  }
}

function parseAgentConfigFile(configPath: string, scope: string) {
  try {
    const content = configPath === CONFIG_PATH
      ? runtimeAssetStore.readText(CONFIG_PATH)
      : fs.readFileSync(configPath, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    throw buildInvalidAgentConfigError(configPath, scope, (err as {message?: string}));
  }
}

function readAgentConfig(configPath: string = CONFIG_PATH, options: ReadAgentConfigOptions = {}) {
  const {
    mergeLocal = path.resolve(configPath) === path.resolve(CONFIG_PATH),
    mainWorktreePath,
    warn = fmt.log.warn
  } = options;
  let config: AgentConfig = {};
  if (configPath === CONFIG_PATH || fs.existsSync(configPath)) {
    config = parseAgentConfigFile(configPath, 'workflow');
  }

  if (mergeLocal) {
    config = config || {};
    const projectRoot = configPath === CONFIG_PATH ? process.cwd() : path.resolve(path.dirname(configPath), '..', '..');
    const mainWorktree = mainWorktreePath !== undefined
      ? mainWorktreePath
      : getMainWorktreePath({ cwd: projectRoot, warn });
    const legacyPaths = [
      path.join(path.dirname(configPath), 'agents.local.json'),
      path.join(projectRoot, 'agents.local.json'),
      mainWorktree ? path.join(mainWorktree, 'agents.local.json') : ''
    ].filter(Boolean);
    const targetPath = options.targetPath || storage.resolveAgentsLocalPath({ ensureDir: true });
    if (!fs.existsSync(targetPath)) {
      try {
        migrateAgentBlocklists({
          sourcePaths: legacyPaths,
          destinationPath: targetPath,
          warn: warn as any
        });
      } catch (error) {
        throw buildInvalidAgentConfigError(targetPath, 'local', (error as any));
      }
    }
    if (fs.existsSync(targetPath)) {
      const localConfig = parseAgentConfigFile(targetPath, 'local');
      if (localConfig && localConfig.blocklist) {
        config.blocklist = Object.assign(config.blocklist || {}, localConfig.blocklist);
      }
    }
  }

  return config;
}

function parseBlockUntil(value: string | number) {
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

  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day ||
    parsed.getHours() !== hour
  ) {
    return NaN;
  }

  return parsed.getTime();
}

function isAgentBlocked(agent: string, config: AgentConfig | null) {
  if (!config || !config.blocklist || config.blocklist[agent] === undefined) {
    return false;
  }
  const entry = config.blocklist[agent];
  if (entry === true) {return true;}
  if (entry === false) {return false;}
  if (entry && typeof entry === 'object') {
    if ((entry as any).blocked === true) {return true;}
    if ((entry as any).blocked === false) {return false;}
    if ((entry as any).until) {
      const until = parseBlockUntil((entry as any).until);
      if (!isNaN(until) && until > Date.now()) {
        return true;
      }
    }
  }
  return false;
}

function resolveBlocklistTargetPath(options: {targetPath?: string} = {}) {
  if (options.targetPath) {return options.targetPath;}
  return storage.resolveAgentsLocalPath({ ensureDir: true });
}

function updateAgentBlock(agent: string, until: string, options: {targetPath?: string, reason?: string} = {}) {
  if (!agent || typeof agent !== 'string') {
    throw new Error('updateAgentBlock requires an agent name');
  }
  if (!until || typeof until !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}$/.test(until)) {
    throw new Error(`updateAgentBlock requires an "YYYY-MM-DD HH" timestamp; got: ${until}`);
  }

  const targetPath = resolveBlocklistTargetPath(options);

  let payload: {blocklist?: {[key: string]: any}} = {};
  if (fs.existsSync(targetPath)) {
    try {
      payload = JSON.parse(fs.readFileSync(targetPath, 'utf8')) || {};
    } catch (err) {
      throw buildInvalidAgentConfigError(targetPath, 'local', (err as {message?: string}));
    }
    if (typeof payload !== 'object' || Array.isArray(payload)) {
      throw buildInvalidAgentConfigError(
        targetPath,
        'local',
        new Error('expected a JSON object at the file root')
      );
    }
  }
  if (!payload.blocklist || typeof payload.blocklist !== 'object' || Array.isArray(payload.blocklist)) {
    payload.blocklist = {};
  }
  payload.blocklist[agent] = { until, reason: options.reason };

  storage.writeJson(targetPath, payload);
  return { path: targetPath, blocklist: payload.blocklist };
}

export type { AgentConfig, ReadAgentConfigOptions };
export {
  CONFIG_PATH,
  buildInvalidAgentConfigError,
  isInvalidAgentConfigError,
  readAgentConfigOrExit,
  parseAgentConfigFile,
  readAgentConfig,
  parseBlockUntil,
  isAgentBlocked,
  resolveBlocklistTargetPath,
  updateAgentBlock
};
