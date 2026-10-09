import type { ParallixConfiguration } from "../../application/ports/configuration.js";
import { DEFAULT_CONFIGURATION } from "../../application/ports/configuration.js";
import fs from 'node:fs';
import { KNOWN_AGENT_NAMES, WORKFLOW_AGENT_NAMES } from './agent-family-names.js';
import { commandInPath, probeLauncherHealth, setCommandPathProbe, setLauncherHealthProbe } from './launcher-probes.js';
import * as fmt from '../../application/presentation/cli-format.js';
import { startCodexDraftAgent, resolveCodexCommand } from './codex.js';
import { startClaudeAgent, resolveClaudeCommand } from './claude.js';
import { startVibeAgent, resolveVibeCommand } from './vibe.js';
import { startOpencodeAgent, resolveOpencodeCommand } from './opencode.js';
import { startPiAgent, resolvePiCommand } from './pi.js';
import { startQwenAgent, resolveQwenCommand } from './qwen.js';
import { CONFIG_PATH, readAgentConfig, isAgentBlocked, type AgentConfig, type ReadAgentConfigOptions } from './agent-config.js';
import { resolveCustomRunner } from '../config/product-config.js';
import { AgentPoolExhaustedError } from '../../domain/agents.js';

interface LauncherStatus {
  agent: string;
  supported: boolean;
  detail: string;
  health?: string;
  reason?: string;
}

type AgentSelectionOptions = ReadAgentConfigOptions & {
  configuration?: ParallixConfiguration;
  config?: AgentConfig | null;
  configPath?: string;
  exclude?: any;
  worktree?: string;
  checkAvailability?: boolean;
};

const LAUNCHERS: {[key: string]: Function} = {
  codex: startCodexDraftAgent,
  claude: startClaudeAgent,
  vibe: startVibeAgent,
  opencode: startOpencodeAgent,
  pi: startPiAgent,
  qwen: startQwenAgent
};

const RESOLVERS: {[key: string]: (_configuration?: ParallixConfiguration) => string} = {
  codex: resolveCodexCommand,
  claude: resolveClaudeCommand,
  vibe: resolveVibeCommand,
  opencode: resolveOpencodeCommand,
  pi: resolvePiCommand,
  qwen: resolveQwenCommand
};

// Runtime dispatch for custom agent family based on configured runner
function resolveCustomLauncher(worktree: string) {
  const runner = resolveCustomRunner(worktree);
  return LAUNCHERS[runner];
}

const RESUME_CAPABLE = new Set(['claude', 'codex', 'custom', 'qwen']);
const HEALTH_PROBE_ARGS: {[key: string]: string[]} = Object.freeze({
  codex: ['--help'],
  claude: ['--help'],
  vibe: ['--help'],
  opencode: ['--help'],
  // Pi's help command initializes its mutable agent state.  Availability is
  // only an executable probe, so use the side-effect-free version command
  // instead; this also works for confined, throwaway PI_CODING_AGENT_DIRs.
  pi: ['--version'],
  qwen: ['--help']
});
const DEFAULT_NO_OUTPUT_INITIAL_DELAY_MS = 60_000;
const DEFAULT_NO_OUTPUT_INTERVAL_MS = 60_000;
const DRAFT_NO_OUTPUT_INITIAL_DELAY_MS = 15_000;
const DRAFT_NO_OUTPUT_INTERVAL_MS = 30_000;



function workflowLauncherStatus(agent: string, worktree?: string, configuration: ParallixConfiguration = DEFAULT_CONFIGURATION): LauncherStatus {
  // For custom agent, resolve to the actual runner. resolveCustomRunner
  // defaults to process.cwd() when worktree is undefined, so this must not
  // be gated behind worktree truthiness — callers like review-loop.ts and
  // active.ts select agents without a worktree, and previously left
  // "custom" unresolvable (RESOLVERS has no "custom" key), permanently
  // excluding it from availability and biasing selection toward claude.
  const effectiveAgent = agent === 'custom'
    ? resolveCustomRunner(worktree)
    : agent;
  // Agent eligibility is configuration-driven.  A configured family without
  // a built-in adapter can still be a usable reviewer when its CLI is on PATH;
  // probe its family name rather than silently removing it from the pool.
  const resolver = RESOLVERS[effectiveAgent] || (() => effectiveAgent);
  const command = resolver(configuration);
  const exists = command.includes('/') ? fs.existsSync(command) : commandInPath(command, configuration);
  if (!exists) {
    return { agent: effectiveAgent, supported: false, detail: command, health: 'missing' };
  }

  const probeArgs = HEALTH_PROBE_ARGS[effectiveAgent] || ['--help'];
  const health = probeLauncherHealth(command, probeArgs, configuration);
  const detail = `${command} ${probeArgs.join(' ')}`.trim();
  // A loaded workstation can delay even --help. The executable is present;
  // let the actual launch report failures rather than exhausting the pool on
  // an inconclusive startup probe.
  if (!health.ok && health.reason === 'ETIMEDOUT') {
    return { agent: effectiveAgent, supported: true, detail, health: 'probe-timeout', reason: health.reason };
  }
  if (!health.ok) {
    return {
      agent: effectiveAgent,
      supported: false,
      detail,
      health: 'probe-failed',
      reason: health.reason
    };
  }

  return { agent: effectiveAgent, supported: true, detail, health: 'ok' };
}

function eligibleAgentsForStep(step: string, options: AgentSelectionOptions = {}) {
  const config = options.config !== undefined
    ? options.config
    : readAgentConfig(options.configPath || CONFIG_PATH, options);
  let eligible: string[];
  if (!config || !config.steps || !config.steps[step]) {
    eligible = WORKFLOW_AGENT_NAMES.slice(); // Use the public workflow agent names
  } else {
    eligible = config.steps[step].eligible || WORKFLOW_AGENT_NAMES.slice();
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
  const envOverride = options.configuration?.agents.override;
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
    throw new AgentPoolExhaustedError(step,
      `All eligible agents for step "${step}" are exhausted (limit-hit or excluded). ` +
      `Tried: ${[...excluded].join(', ')}.`
    );
  }

  let available = pool;
  if (options.checkAvailability !== false) {
    const { worktree } = options;
    const statuses = new Map(
      pool
        .map((agent) => [agent, workflowLauncherStatus(agent, worktree, options.configuration)] as [string, LauncherStatus])
    );
    available = pool.filter((agent) => {
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

function assertAgentSupported(agent: string, worktree?: string, configuration: ParallixConfiguration = DEFAULT_CONFIGURATION) {
  if (!LAUNCHERS[agent]) {
    // Special case: custom is valid but dispatches to a real runner
    if (agent === 'custom') {
      const runner = resolveCustomRunner(worktree);
      if (!LAUNCHERS[runner]) {
        const error: any = new Error(
          `Unknown custom runner: "${runner}". Supported custom runners: ${['opencode', 'pi'].join(', ')}.`
        );
        error.code = 'UNKNOWN_AGENT';
        throw error;
      }
    } else {
      const error: any = new Error(
        `Unknown agent: "${fmt.agent(agent)}". Supported agents: ${WORKFLOW_AGENT_NAMES.join(', ')}.`
      );
      error.code = 'UNKNOWN_AGENT';
      throw error;
    }
  }

  const status = workflowLauncherStatus(agent, worktree, configuration);
  if (!status.supported) {
    const health = status.health ? ` (${status.health})` : '';
    const reason = status.reason ? `; reason: ${status.reason}` : '';
    const displayAgent = agent === 'custom' ? `custom (${status.agent})` : agent;
    const error: any = new Error(
      `Agent "${fmt.agent(displayAgent)}" launcher is not available on this workstation${health}. ` +
      `Looked for: ${fmt.path(status.detail)}${reason}. ` +
      `Ensure ${fmt.agent(displayAgent)} is on your PATH and retry.`
    );
    error.code = 'LAUNCHER_UNAVAILABLE';
    throw error;
  }
}

function resolveNoOutputWatchdogConfig(config: {initialDelayMs?: number, intervalMs?: number, maxNoOutputMs?: number} | boolean, step: string | null = null, configuration: ParallixConfiguration = DEFAULT_CONFIGURATION) {
  if (config === false || !configuration.agents.watchdogEnabled) {
    return null;
  }
  const explicit: {initialDelayMs?: number, intervalMs?: number, maxNoOutputMs?: number} = config && typeof config === 'object' ? config : {};
  let initialDelayMs;
  let intervalMs;
  if (step === 'draft') {
    initialDelayMs = explicit.initialDelayMs ??
      configuration.agents.draftNoOutputInitialMs ??
      DRAFT_NO_OUTPUT_INITIAL_DELAY_MS;
    intervalMs = explicit.intervalMs ??
      configuration.agents.draftNoOutputIntervalMs ??
      DRAFT_NO_OUTPUT_INTERVAL_MS;
  } else {
    initialDelayMs = explicit.initialDelayMs ??
      configuration.agents.noOutputInitialMs ??
      DEFAULT_NO_OUTPUT_INITIAL_DELAY_MS;
    intervalMs = explicit.intervalMs ??
      configuration.agents.noOutputIntervalMs ??
      DEFAULT_NO_OUTPUT_INTERVAL_MS;
  }
  const maxNoOutputMs = step === 'review'
    ? explicit.maxNoOutputMs ?? configuration.agents.reviewNoOutputMaxMs
    : explicit.maxNoOutputMs;
  return { initialDelayMs, intervalMs, maxNoOutputMs };
}


export {
  KNOWN_AGENT_NAMES,
  WORKFLOW_AGENT_NAMES,
  RESUME_CAPABLE,
  LAUNCHERS,
  DEFAULT_NO_OUTPUT_INITIAL_DELAY_MS,
  DRAFT_NO_OUTPUT_INITIAL_DELAY_MS,
  workflowLauncherStatus,
  setCommandPathProbe,
  setLauncherHealthProbe,
  eligibleAgentsForStep,
  weightedRandom,
  selectAgent,
  assertAgentSupported,
  resolveNoOutputWatchdogConfig,
  resolveCustomLauncher
};
