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
exports.setCommandPathProbe = exports.DRAFT_NO_OUTPUT_INITIAL_DELAY_MS = exports.DEFAULT_NO_OUTPUT_INITIAL_DELAY_MS = exports.LAUNCHERS = exports.RESUME_CAPABLE = exports.WORKFLOW_AGENT_NAMES = exports.KNOWN_AGENT_NAMES = void 0;
exports.workflowLauncherStatus = workflowLauncherStatus;
exports.eligibleAgentsForStep = eligibleAgentsForStep;
exports.weightedRandom = weightedRandom;
exports.selectAgent = selectAgent;
exports.assertAgentSupported = assertAgentSupported;
exports.resolveNoOutputWatchdogConfig = resolveNoOutputWatchdogConfig;
exports.resolveCustomLauncher = resolveCustomLauncher;
const node_fs_1 = __importDefault(require("node:fs"));
const node_child_process_1 = require("node:child_process");
const fmt = __importStar(require("../core/fmt.js"));
const codex_js_1 = require("./codex.js");
const claude_js_1 = require("./claude.js");
const vibe_js_1 = require("./vibe.js");
const opencode_js_1 = require("./opencode.js");
const pi_js_1 = require("./pi.js");
const agent_config_js_1 = require("./agent-config.js");
const product_config_js_1 = require("../core/product-config.js");
const custom_capacity_js_1 = require("./custom-capacity.js");
const LAUNCHERS = {
    codex: codex_js_1.startCodexDraftAgent,
    claude: claude_js_1.startClaudeAgent,
    vibe: vibe_js_1.startVibeAgent,
    opencode: opencode_js_1.startOpencodeAgent,
    pi: pi_js_1.startPiAgent
};
exports.LAUNCHERS = LAUNCHERS;
const RESOLVERS = {
    codex: codex_js_1.resolveCodexCommand,
    claude: claude_js_1.resolveClaudeCommand,
    vibe: vibe_js_1.resolveVibeCommand,
    opencode: opencode_js_1.resolveOpencodeCommand,
    pi: pi_js_1.resolvePiCommand
};
// Runtime dispatch for custom agent family based on configured runner
function resolveCustomLauncher(worktree) {
    const runner = (0, product_config_js_1.resolveCustomRunner)(worktree);
    return LAUNCHERS[runner];
}
const RESUME_CAPABLE = new Set(['claude', 'codex', 'custom']);
exports.RESUME_CAPABLE = RESUME_CAPABLE;
const HEALTH_PROBE_ARGS = Object.freeze({
    codex: ['--help'],
    claude: ['--help'],
    vibe: ['--help'],
    opencode: ['--help'],
    pi: ['--help']
});
const LAUNCHER_HEALTH_TIMEOUT_MS = 3000;
const DEFAULT_NO_OUTPUT_INITIAL_DELAY_MS = 60_000;
exports.DEFAULT_NO_OUTPUT_INITIAL_DELAY_MS = DEFAULT_NO_OUTPUT_INITIAL_DELAY_MS;
const DEFAULT_NO_OUTPUT_INTERVAL_MS = 60_000;
const DRAFT_NO_OUTPUT_INITIAL_DELAY_MS = 15_000;
exports.DRAFT_NO_OUTPUT_INITIAL_DELAY_MS = DRAFT_NO_OUTPUT_INITIAL_DELAY_MS;
const DRAFT_NO_OUTPUT_INTERVAL_MS = 30_000;
const WORKFLOW_AGENT_NAMES = Object.freeze(['codex', 'claude', 'vibe', 'custom']);
exports.WORKFLOW_AGENT_NAMES = WORKFLOW_AGENT_NAMES;
const KNOWN_AGENT_NAMES = Object.freeze([
    ...WORKFLOW_AGENT_NAMES,
    'human'
]);
exports.KNOWN_AGENT_NAMES = KNOWN_AGENT_NAMES;
let commandPathProbe = null;
function commandInPath(name) {
    if (commandPathProbe) {
        return commandPathProbe(name) || false;
    }
    const result = (0, node_child_process_1.spawnSync)('bash', ['-c', `command -v ${name}`], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
    });
    return result.status === 0 && result.stdout.trim().length > 0;
}
function workflowLauncherStatus(agent, worktree) {
    // For custom agent, resolve to the actual runner. resolveCustomRunner
    // defaults to process.cwd() when worktree is undefined, so this must not
    // be gated behind worktree truthiness — callers like review-loop.ts and
    // active.ts select agents without a worktree, and previously left
    // "custom" unresolvable (RESOLVERS has no "custom" key), permanently
    // excluding it from availability and biasing selection toward claude.
    const effectiveAgent = agent === 'custom'
        ? (0, product_config_js_1.resolveCustomRunner)(worktree)
        : agent;
    // Agent eligibility is configuration-driven.  A configured family without
    // a built-in adapter can still be a usable reviewer when its CLI is on PATH;
    // probe its family name rather than silently removing it from the pool.
    const resolver = RESOLVERS[effectiveAgent] || (() => effectiveAgent);
    const command = resolver();
    const exists = command.includes('/') ? node_fs_1.default.existsSync(command) : commandInPath(command);
    if (!exists) {
        return { agent: effectiveAgent, supported: false, detail: command, health: 'missing' };
    }
    const probeArgs = HEALTH_PROBE_ARGS[effectiveAgent] || ['--help'];
    const probe = (0, node_child_process_1.spawnSync)(command, probeArgs, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: LAUNCHER_HEALTH_TIMEOUT_MS
    });
    if (probe.error || probe.status !== 0) {
        const pErr = probe.error || new Error('');
        const reason = probe.error
            ? (pErr.code || pErr.message)
            : `exit ${probe.status}`;
        return {
            agent: effectiveAgent,
            supported: false,
            detail: `${command} ${probeArgs.join(' ')}`.trim(),
            health: 'probe-failed',
            reason
        };
    }
    return { agent: effectiveAgent, supported: true, detail: `${command} ${probeArgs.join(' ')}`.trim(), health: 'ok' };
}
function eligibleAgentsForStep(step, options = {}) {
    const config = options.config !== undefined
        ? options.config
        : (0, agent_config_js_1.readAgentConfig)(options.configPath || agent_config_js_1.CONFIG_PATH, options);
    let eligible;
    if (!config || !config.steps || !config.steps[step]) {
        eligible = WORKFLOW_AGENT_NAMES.slice(); // Use the public workflow agent names
    }
    else {
        eligible = config.steps[step].eligible || WORKFLOW_AGENT_NAMES.slice();
    }
    return eligible.filter((agent) => !(0, agent_config_js_1.isAgentBlocked)(agent, config));
}
function weightedRandom(agents, weights) {
    const total = agents.reduce((sum, agent) => sum + (weights[agent] || 1), 0);
    let r = Math.random() * total;
    for (const agent of agents) {
        r -= weights[agent] || 1;
        if (r <= 0) {
            return agent;
        }
    }
    return agents[agents.length - 1];
}
function selectAgent(step, options = {}) {
    const envOverride = process.env.WORKFLOW_AGENT;
    const excluded = options.exclude instanceof Set ? options.exclude : new Set();
    const eligible = eligibleAgentsForStep(step, options);
    if (envOverride && !excluded.has(envOverride) && eligible.includes(envOverride) &&
        (envOverride !== 'custom' || (0, custom_capacity_js_1.isCustomCapacityAvailable)(options.worktree))) {
        return envOverride;
    }
    const pool = eligible.filter((agent) => !excluded.has(agent) &&
        (agent !== 'custom' || (0, custom_capacity_js_1.isCustomCapacityAvailable)(options.worktree)));
    if (eligible.length === 0) {
        throw new Error(`No agents are eligible for workflow step: ${step}`);
    }
    if (pool.length === 0) {
        throw new Error(`All eligible agents for step "${step}" are exhausted (limit-hit or excluded). ` +
            `Tried: ${[...excluded].join(', ')}.`);
    }
    const { worktree } = options;
    const statuses = new Map(pool
        .map((agent) => [agent, workflowLauncherStatus(agent, worktree)]));
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
        throw new Error(`No eligible agents have a working launcher for step "${step}". ` +
            `Eligible but blocked: ${blockers.join(', ')}. ` +
            `Set WORKFLOW_AGENT=<name> to override or install a supported agent.`);
    }
    const config = options.config !== undefined
        ? options.config
        : (0, agent_config_js_1.readAgentConfig)(options.configPath || agent_config_js_1.CONFIG_PATH, options);
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
function assertAgentSupported(agent, worktree) {
    if (!LAUNCHERS[agent]) {
        // Special case: custom is valid but dispatches to a real runner
        if (agent === 'custom') {
            const runner = (0, product_config_js_1.resolveCustomRunner)(worktree);
            if (!LAUNCHERS[runner]) {
                const error = new Error(`Unknown custom runner: "${runner}". Supported custom runners: ${['opencode', 'pi'].join(', ')}.`);
                error.code = 'UNKNOWN_AGENT';
                throw error;
            }
        }
        else {
            const error = new Error(`Unknown agent: "${fmt.agent(agent)}". Supported agents: ${WORKFLOW_AGENT_NAMES.join(', ')}.`);
            error.code = 'UNKNOWN_AGENT';
            throw error;
        }
    }
    const status = workflowLauncherStatus(agent, worktree);
    if (!status.supported) {
        const health = status.health ? ` (${status.health})` : '';
        const reason = status.reason ? `; reason: ${status.reason}` : '';
        const displayAgent = agent === 'custom' ? `custom (${status.agent})` : agent;
        const error = new Error(`Agent "${fmt.agent(displayAgent)}" launcher is not available on this workstation${health}. ` +
            `Looked for: ${fmt.path(status.detail)}${reason}. ` +
            `Ensure ${fmt.agent(displayAgent)} is on your PATH and retry.`);
        error.code = 'LAUNCHER_UNAVAILABLE';
        throw error;
    }
}
function readPositiveMsEnv(name) {
    const raw = process.env[name];
    if (raw === undefined || raw === '') {
        return null;
    }
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : null;
}
function resolveNoOutputWatchdogConfig(config, step = null) {
    if (config === false || process.env.WORKFLOW_AGENT_NO_OUTPUT_WATCHDOG === '0') {
        return null;
    }
    const explicit = config && typeof config === 'object' ? config : {};
    let initialDelayMs;
    let intervalMs;
    if (step === 'draft') {
        initialDelayMs = explicit.initialDelayMs ??
            readPositiveMsEnv('WORKFLOW_DRAFT_AGENT_NO_OUTPUT_INITIAL_MS') ??
            DRAFT_NO_OUTPUT_INITIAL_DELAY_MS;
        intervalMs = explicit.intervalMs ??
            readPositiveMsEnv('WORKFLOW_DRAFT_AGENT_NO_OUTPUT_INTERVAL_MS') ??
            DRAFT_NO_OUTPUT_INTERVAL_MS;
    }
    else {
        initialDelayMs = explicit.initialDelayMs ??
            readPositiveMsEnv('WORKFLOW_AGENT_NO_OUTPUT_INITIAL_MS') ??
            DEFAULT_NO_OUTPUT_INITIAL_DELAY_MS;
        intervalMs = explicit.intervalMs ??
            readPositiveMsEnv('WORKFLOW_AGENT_NO_OUTPUT_INTERVAL_MS') ??
            DEFAULT_NO_OUTPUT_INTERVAL_MS;
    }
    return { initialDelayMs, intervalMs };
}
const setCommandPathProbe = (fn) => {
    commandPathProbe = typeof fn === 'function' ? fn : null;
};
exports.setCommandPathProbe = setCommandPathProbe;
