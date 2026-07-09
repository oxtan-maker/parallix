import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import * as fmt from '../core/fmt.js';
import { startCodexDraftAgent, resolveCodexCommand } from './codex.js';
import { startClaudeAgent, resolveClaudeCommand } from './claude.js';
import { startVibeAgent, resolveVibeCommand } from './vibe.js';
import { startOpencodeAgent, resolveOpencodeCommand } from './opencode.js';
import { CONFIG_PATH, readAgentConfig, isAgentBlocked, type AgentConfig, type ReadAgentConfigOptions } from './agent-config.js';

interface LauncherStatus {
  agent: string;
  supported: boolean;
  detail: string;
  health?: string;
  reason?: string;
}

type AgentSelectionOptions = ReadAgentConfigOptions & {
  config?: AgentConfig | null;
  configPath?: string;
  exclude?: any;
};

const LAUNCHERS: {[key: string]: Function} = {
  codex: startCodexDraftAgent,
  claude: startClaudeAgent,
  vibe: startVibeAgent,
  custom: startOpencodeAgent
};

const RESOLVERS: {[key: string]: () => string} = {
  codex: resolveCodexCommand,
  claude: resolveClaudeCommand,
  vibe: resolveVibeCommand,
  custom: resolveOpencodeCommand
};

const RESUME_CAPABLE = new Set(['claude', 'codex', 'custom']);
const HEALTH_PROBE_ARGS: {[key: string]: string[]} = Object.freeze({
  codex: ['--help'],
  claude: ['--help'],
  vibe: ['--help'],
  custom: ['--help']
});
const LAUNCHER_HEALTH_TIMEOUT_MS = 3000;
const DEFAULT_NO_OUTPUT_INITIAL_DELAY_MS = 60_000;
const DEFAULT_NO_OUTPUT_INTERVAL_MS = 60_000;
const DRAFT_NO_OUTPUT_INITIAL_DELAY_MS = 15_000;
const DRAFT_NO_OUTPUT_INTERVAL_MS = 30_000;

const WORKFLOW_AGENT_NAMES = Object.freeze(Object.keys(LAUNCHERS));
const KNOWN_AGENT_NAMES = Object.freeze([
  ...WORKFLOW_AGENT_NAMES,
  'human'
]);

let commandPathProbe: ((name: string) => string | null) | null = null;

function commandInPath(name: string) {
  if (commandPathProbe) {
    return commandPathProbe(name) || false;
  }
  const result = spawnSync('bash', ['-c', `command -v ${name}`], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  });
  return result.status === 0 && result.stdout.trim().length > 0;
}

function workflowLauncherStatus(agent: string): LauncherStatus {
  const resolver = RESOLVERS[agent];
  if (!resolver) {
    return { agent, supported: false, detail: `unknown agent: ${agent}` };
  }
  const command = resolver();
  const exists = command.includes('/') ? fs.existsSync(command) : commandInPath(command);
  if (!exists) {
    return { agent, supported: false, detail: command, health: 'missing' };
  }

  const probeArgs = HEALTH_PROBE_ARGS[agent] || ['--help'];
  const probe = spawnSync(command, probeArgs, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: LAUNCHER_HEALTH_TIMEOUT_MS
  });

  if (probe.error || probe.status !== 0) {
    const pErr: Error & {code?: string} = probe.error || new Error('');
    const reason = probe.error
      ? (pErr.code || pErr.message)
      : `exit ${probe.status}`;
    return {
      agent,
      supported: false,
      detail: `${command} ${probeArgs.join(' ')}`.trim(),
      health: 'probe-failed',
      reason
    };
  }

  return { agent, supported: true, detail: `${command} ${probeArgs.join(' ')}`.trim(), health: 'ok' };
}

function eligibleAgentsForStep(step: string, options: AgentSelectionOptions = {}) {
  const config = options.config !== undefined
    ? options.config
    : readAgentConfig(options.configPath || CONFIG_PATH, options);
  let eligible: string[];
  if (!config || !config.steps || !config.steps[step]) {
    eligible = Object.keys(LAUNCHERS);
  } else {
    eligible = config.steps[step].eligible || Object.keys(LAUNCHERS);
  }
  return eligible.filter((agent) => !isAgentBlocked(agent, config));
}

function weightedRandom(agents: string[], weights: {[key: string]: number}) {
  const total = agents.reduce((sum, agent) => sum + (weights[agent] || 1), 0);
  let r = Math.random() * total;
  for (const agent of agents) {
    r -= weights[agent] || 1;
    if (r <= 0) {return agent;}
  }
  return agents[agents.length - 1];
}

function selectAgent(step: string, options: AgentSelectionOptions = {}) {
  const envOverride = process.env.WORKFLOW_AGENT;
  const excluded = options.exclude instanceof Set ? options.exclude : new Set();
  const eligible = eligibleAgentsForStep(step, options);
  if (envOverride && !excluded.has(envOverride) && eligible.includes(envOverride)) {
    return envOverride;
  }

  const pool = eligible.filter((agent) => !excluded.has(agent));
  if (eligible.length === 0) {
    throw new Error(`No agents are eligible for workflow step: ${step}`);
  }
  if (pool.length === 0) {
    throw new Error(
      `All eligible agents for step "${step}" are exhausted (limit-hit or excluded). ` +
      `Tried: ${[...excluded].join(', ')}.`
    );
  }

  const statuses = new Map(
    pool
      .filter((agent) => LAUNCHERS[agent])
      .map((agent) => [agent, workflowLauncherStatus(agent)] as [string, LauncherStatus])
  );
  const available = pool.filter((agent) => {
    const status = statuses.get(agent);
    return Boolean(status && status.supported);
  });
  if (available.length === 0) {
    const blockers = pool.map((agent) => {
      const status = statuses.get(agent) || { detail: agent, reason: 'unsupported-agent' };
      const suffix = status.reason ? `; ${status.reason}` : '';
      return `${agent} (looked for: ${status.detail}${suffix})`;
    });
    throw new Error(
      `No eligible agents have a working launcher for step "${step}". ` +
      `Eligible but blocked: ${blockers.join(', ')}. ` +
      `Set WORKFLOW_AGENT=<name> to override or install a supported agent.`
    );
  }

  const config = options.config !== undefined
    ? options.config
    : readAgentConfig(options.configPath || CONFIG_PATH, options);
  const stepConfig = config && config.steps && config.steps[step] ? config.steps[step] : {};
  const selection = stepConfig.selection || 'random';

  if (selection === 'weighted') {
    const weights = stepConfig.weights || {};
    return weightedRandom(available, weights);
  }

  if (selection === 'random') {
    return available[Math.floor(Math.random() * available.length)];
  }

  return available[0];
}

function assertAgentSupported(agent: string) {
  if (!LAUNCHERS[agent]) {
    const error: any = new Error(
      `Unknown agent: "${fmt.agent(agent)}". Supported agents: ${Object.keys(LAUNCHERS).join(', ')}.`
    );
    error.code = 'UNKNOWN_AGENT';
    throw error;
  }

  const status = workflowLauncherStatus(agent);
  if (!status.supported) {
    const health = status.health ? ` (${status.health})` : '';
    const reason = status.reason ? `; reason: ${status.reason}` : '';
    const error: any = new Error(
      `Agent "${fmt.agent(agent)}" launcher is not available on this workstation${health}. ` +
      `Looked for: ${fmt.path(status.detail)}${reason}. ` +
      `Ensure ${fmt.agent(agent)} is on your PATH and retry.`
    );
    error.code = 'LAUNCHER_UNAVAILABLE';
    throw error;
  }
}

function readPositiveMsEnv(name: string) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {return null;}
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function resolveNoOutputWatchdogConfig(config: {initialDelayMs?: number, intervalMs?: number} | boolean, step: string | null = null) {
  if (config === false || process.env.WORKFLOW_AGENT_NO_OUTPUT_WATCHDOG === '0') {
    return null;
  }
  const explicit: {initialDelayMs?: number, intervalMs?: number} = config && typeof config === 'object' ? config : {};
  let initialDelayMs;
  let intervalMs;
  if (step === 'draft') {
    initialDelayMs = explicit.initialDelayMs ??
      readPositiveMsEnv('WORKFLOW_DRAFT_AGENT_NO_OUTPUT_INITIAL_MS') ??
      DRAFT_NO_OUTPUT_INITIAL_DELAY_MS;
    intervalMs = explicit.intervalMs ??
      readPositiveMsEnv('WORKFLOW_DRAFT_AGENT_NO_OUTPUT_INTERVAL_MS') ??
      DRAFT_NO_OUTPUT_INTERVAL_MS;
  } else {
    initialDelayMs = explicit.initialDelayMs ??
      readPositiveMsEnv('WORKFLOW_AGENT_NO_OUTPUT_INITIAL_MS') ??
      DEFAULT_NO_OUTPUT_INITIAL_DELAY_MS;
    intervalMs = explicit.intervalMs ??
      readPositiveMsEnv('WORKFLOW_AGENT_NO_OUTPUT_INTERVAL_MS') ??
      DEFAULT_NO_OUTPUT_INTERVAL_MS;
  }
  return { initialDelayMs, intervalMs };
}

const setCommandPathProbe = (fn: ((name: string) => string | null) | null) => {
  commandPathProbe = typeof fn === 'function' ? fn : null;
};

export {
  KNOWN_AGENT_NAMES,
  WORKFLOW_AGENT_NAMES,
  RESUME_CAPABLE,
  LAUNCHERS,
  DEFAULT_NO_OUTPUT_INITIAL_DELAY_MS,
  DRAFT_NO_OUTPUT_INITIAL_DELAY_MS,
  workflowLauncherStatus,
  setCommandPathProbe,
  eligibleAgentsForStep,
  weightedRandom,
  selectAgent,
  assertAgentSupported,
  resolveNoOutputWatchdogConfig
};
