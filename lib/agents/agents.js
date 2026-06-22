const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const fmt = require('../core/fmt');
const { startCodexDraftAgent, resolveCodexCommand } = require('./codex');
const { startClaudeAgent, resolveClaudeCommand } = require('./claude');
const { startMistralAgent, resolveMistralCommand } = require('./mistral');
const { startOpencodeAgent, resolveOpencodeCommand } = require('./opencode');
const { detectLimitHit } = require('./limit-hit');
const sessions = require('../tools/sessions');
const storage = require('../core/storage');
const { resolveAgentModel } = require('../core/product-config');
const { migrateAgentBlocklists } = require('../core/persistent-data-migration');

// Launchers whose CLI accepts a per-call resume flag threaded by startAgent.
// Each launcher outputs a session resume hint at the end of its run (e.g.
// "codex resume <id>", "opencode -s ses_<id>",
// "claude --resume <id>"). The resume flag is only used when the caller
// passes slug+role+worktree and the session marker matches the chosen agent.
// qwen (opencode) always uses --continue; claude uses --continue; codex uses
// `exec resume --last`.
const RESUME_CAPABLE = new Set(['claude', 'codex', 'qwen']);

const CONFIG_PATH = path.join(__dirname, '..', '..', 'config', 'agents.json');

// Test hook: when set, used instead of spawning `command -v` to check PATH.
let _commandPathProbe = null;

const LAUNCHERS = {
  codex: startCodexDraftAgent,
  claude: startClaudeAgent,
  mistral: startMistralAgent,
  qwen: startOpencodeAgent
};

const RESOLVERS = {
  codex: resolveCodexCommand,
  claude: resolveClaudeCommand,
  mistral: resolveMistralCommand,
  qwen: resolveOpencodeCommand
};

const HEALTH_PROBE_ARGS = Object.freeze({
  codex: ['--help'],
  claude: ['--help'],
  mistral: ['--help'],
  qwen: ['--help']
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

function workflowLauncherStatus(agent) {
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
    const reason = probe.error
      ? probe.error.code || probe.error.message
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

function commandInPath(name) {
  if (_commandPathProbe) {
    return _commandPathProbe(name) || false;
  }
  const result = spawnSync('bash', ['-c', `command -v ${name}`], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  });
  return result.status === 0 && result.stdout.trim().length > 0;
}

function buildInvalidAgentConfigError(configPath, scope, originalError) {
  const location = path.resolve(configPath);
  const detail = originalError && originalError.message ? originalError.message : 'invalid JSON';
  const error = new Error(
    `Invalid ${scope} agent config at ${location}: ${detail}. ` +
    'Fix or remove the malformed file before running workflow commands so agent blocking is applied deterministically.'
  );
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
  } catch (error) {
    if (isInvalidAgentConfigError(error)) {
      fmt.log.fail(error.message);
      process.exit(1);
    }
    throw error;
  }
}

function parseAgentConfigFile(configPath, scope) {
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    throw buildInvalidAgentConfigError(configPath, scope, err);
  }
}

function readAgentConfig(configPath = CONFIG_PATH, options = {}) {
  const {
    mergeLocal = path.resolve(configPath) === path.resolve(CONFIG_PATH),
    mainWorktreePath,
    warn = fmt.log.warn
  } = options;
  let config = null;
  if (fs.existsSync(configPath)) {
    config = parseAgentConfigFile(configPath, 'workflow');
  }

  if (mergeLocal) {
    config = config || {};
    const projectRoot = path.resolve(path.dirname(configPath), '..', '..');
    const mainWorktree = mainWorktreePath !== undefined
      ? mainWorktreePath
      : getMainWorktreePath({ cwd: projectRoot, warn });
    const legacyPaths = [
      path.join(path.dirname(configPath), 'agents.local.json'),
      path.join(projectRoot, 'agents.local.json'),
      mainWorktree ? path.join(mainWorktree, 'agents.local.json') : null
    ].filter(Boolean);
    const targetPath = options.targetPath || storage.resolveAgentsLocalPath({ ensureDir: true });
    if (!fs.existsSync(targetPath)) {
      try {
        migrateAgentBlocklists({
          sourcePaths: legacyPaths,
          destinationPath: targetPath,
          warn
        });
      } catch (error) {
        throw buildInvalidAgentConfigError(targetPath, 'local', error);
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

function getMainWorktreePath(options = {}) {
  const { cwd = process.cwd(), warn = fmt.log.warn } = options;
  try {
    const commonDir = getGitPath(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
    if (commonDir && MainWorktreeDetector.byCommonDir.has(commonDir)) {
      return MainWorktreeDetector.byCommonDir.get(commonDir);
    }

    const result = spawnSync('git', ['-C', cwd, 'worktree', 'list', '--porcelain'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1000
    });
    if (result.status !== 0) {
      warn(
        `Could not inspect git worktrees while looking for main-worktree agents.local.json; ` +
        `skipping that lookup (git exited with status ${result.status}).`
      );
      return null;
    }

    const lines = result.stdout.split('\n');
    const mainWorktreePath = detectMainWorktreePath(lines, cwd, commonDir);
    if (mainWorktreePath) {
      if (commonDir) MainWorktreeDetector.byCommonDir.set(commonDir, mainWorktreePath);
      return mainWorktreePath;
    }

    // Fallback: pick the first worktree whose HEAD points to main
    let i = 0;
    while (i < lines.length) {
      if (lines[i].startsWith('worktree ')) {
        const wt = lines[i].slice('worktree '.length).trim();
        const branchLineIdx = i + 1;
        if (branchLineIdx < lines.length && lines[branchLineIdx].startsWith('branch refs/heads/main')) {
          if (commonDir) MainWorktreeDetector.byCommonDir.set(commonDir, wt);
          return wt;
        }
      }
      i++;
    }

    // Last resort: the first worktree in the list that isn't the current cwd
    for (i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('worktree ')) {
        const wt = lines[i].slice('worktree '.length).trim();
        if (wt !== cwd) {
          if (commonDir) MainWorktreeDetector.byCommonDir.set(commonDir, wt);
          return wt;
        }
      }
    }
  } catch (err) {
    const detail = err && (err.code || err.message) ? (err.code || err.message) : 'unknown error';
    warn(
      `Could not inspect git worktrees while looking for main-worktree agents.local.json; ` +
      `skipping that lookup (${detail}).`
    );
    return null;
  }

  warn(
    'Could not determine the main worktree from `git worktree list --porcelain`; ' +
    'skipping main-worktree agents.local.json lookup.'
  );
  return null;
}

// Extract the known main worktree path from the repo metadata so worktree
// iteration doesn't accidentally pick the current (non-main) worktree.
// Cached per git common directory to avoid repeated subprocess calls without
// leaking a temp-repo answer into later tests or nested workflow invocations.
const MainWorktreeDetector = {
  byCommonDir: new Map()
};

function getGitPath(cwd, args) {
  const result = spawnSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 1000
  });
  if (result.status !== 0) {
    return null;
  }
  return result.stdout.trim() || null;
}

function parseWorktreePaths(lines) {
  return lines
    .filter(line => line.startsWith('worktree '))
    .map(line => line.slice('worktree '.length).trim())
    .filter(Boolean);
}

function detectMainWorktreePath(lines, cwd, commonDir) {
  const worktrees = parseWorktreePaths(lines);
  if (worktrees.length === 0) {
    return null;
  }

  const resolvedCommonDir = commonDir ? path.resolve(commonDir) : null;
  for (const wt of worktrees) {
    const gitDir = getGitPath(wt, ['rev-parse', '--absolute-git-dir']);
    const wtCommonDir = getGitPath(wt, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
    if (
      gitDir &&
      wtCommonDir &&
      path.resolve(gitDir) === path.resolve(wtCommonDir) &&
      (!resolvedCommonDir || path.resolve(wtCommonDir) === resolvedCommonDir)
    ) {
      return wt;
    }
  }

  const currentTopLevel = getGitPath(cwd, ['rev-parse', '--show-toplevel']);
  if (currentTopLevel && worktrees.length === 1 && path.resolve(worktrees[0]) === path.resolve(currentTopLevel)) {
    return worktrees[0];
  }
  return null;
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

function isAgentBlocked(agent, config) {
  if (!config || !config.blocklist || config.blocklist[agent] === undefined) {
    return false;
  }
  const entry = config.blocklist[agent];
  if (entry === true) return true;
  if (entry === false) return false;
  if (entry && typeof entry === 'object') {
    if (entry.blocked === true) return true;
    if (entry.blocked === false) return false;
    if (entry.until) {
      const until = parseBlockUntil(entry.until);
      if (!isNaN(until) && until > Date.now()) {
        return true;
      }
    }
  }
  return false;
}

function eligibleAgentsForStep(step, options = {}) {
  const config = options.config !== undefined
    ? options.config
    : readAgentConfig(options.configPath || CONFIG_PATH, options);
  let eligible;
  if (!config || !config.steps || !config.steps[step]) {
    eligible = Object.keys(LAUNCHERS);
  } else {
    eligible = config.steps[step].eligible || Object.keys(LAUNCHERS);
  }
  return eligible.filter(agent => !isAgentBlocked(agent, config));
}

function weightedRandom(agents, weights) {
  const total = agents.reduce((sum, a) => sum + (weights[a] || 1), 0);
  let r = Math.random() * total;
  for (const agent of agents) {
    r -= weights[agent] || 1;
    if (r <= 0) return agent;
  }
  return agents[agents.length - 1];
}

function selectAgent(step, options = {}) {
  const envOverride = process.env.WORKFLOW_AGENT;
  const excluded = options.exclude instanceof Set ? options.exclude : new Set();
  const eligible = eligibleAgentsForStep(step, options);
  // Honor the env override only when it is in the current eligible-and-unblocked
  // pool and not already excluded (a previous limit-hit attempt in the same
  // startAgent retry loop). A pinned agent that is hard-blocked in
  // agents.local.json or excluded by step eligibility falls through to normal
  // selection — matches parallix/docs/agents.md, which documents that
  // WORKFLOW_AGENT is honored alongside the eligibility config and blocklist.
  if (envOverride && !excluded.has(envOverride) && eligible.includes(envOverride)) {
    return envOverride;
  }

  const pool = eligible.filter(agent => !excluded.has(agent));
  if (eligible.length === 0) {
    throw new Error(`No agents are eligible for workflow step: ${step}`);
  }
  if (pool.length === 0) {
    throw new Error(
      `All eligible agents for step "${step}" are exhausted (limit-hit or excluded). ` +
      `Tried: ${[...excluded].join(', ')}.`
    );
  }

  // Filter to agents that are both eligible (per config) and supported (launcher present).
  const statuses = new Map(
    pool
      .filter(agent => LAUNCHERS[agent])
      .map(agent => [agent, workflowLauncherStatus(agent)])
  );
  const available = pool.filter(agent => {
    const status = statuses.get(agent);
    return Boolean(status && status.supported);
  });
  if (available.length === 0) {
    const blockers = pool.map(agent => {
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

function assertAgentSupported(agent) {
  if (!LAUNCHERS[agent]) {
    const error = new Error(
      `Unknown agent: "${fmt.agent(agent)}". Supported agents: ${Object.keys(LAUNCHERS).join(', ')}.`
    );
    error.code = 'UNKNOWN_AGENT';
    throw error;
  }

  const status = workflowLauncherStatus(agent);
  if (!status.supported) {
    const health = status.health ? ` (${status.health})` : '';
    const reason = status.reason ? `; reason: ${status.reason}` : '';
    const error = new Error(
      `Agent "${fmt.agent(agent)}" launcher is not available on this workstation${health}. ` +
      `Looked for: ${fmt.path(status.detail)}${reason}. ` +
      `Ensure ${fmt.agent(agent)} is on your PATH and retry.`
    );
    error.code = 'LAUNCHER_UNAVAILABLE';
    throw error;
  }
}

function resolveBlocklistTargetPath(options = {}) {
  if (options.targetPath) return options.targetPath;
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
  if (fs.existsSync(targetPath)) {
    // Match the read-path contract (parseAgentConfigFile): malformed local agent
    // JSON is a hard failure, not a silent overwrite. Otherwise a limit hit on a
    // corrupted agents.local.json would destroy whatever was on disk.
    try {
      payload = JSON.parse(fs.readFileSync(targetPath, 'utf8')) || {};
    } catch (err) {
      throw buildInvalidAgentConfigError(targetPath, 'local', err);
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
  payload.blocklist[agent] = { until };

  storage.writeJson(targetPath, payload);
  return { path: targetPath, blocklist: payload.blocklist };
}

function defaultIsAgentBlockedNow(agent) {
  try {
    const config = readAgentConfig(CONFIG_PATH, {});
    return isAgentBlocked(agent, config);
  } catch (err) {
    // If the config is malformed, surface that through the launcher path
    // (assertAgentSupported / launch) instead of silently rerouting. Treat as
    // not-blocked here so the existing error path runs.
    return false;
  }
}

function readPositiveMsEnv(name) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function resolveNoOutputWatchdogConfig(config = {}, step = null) {
  if (config === false || process.env.WORKFLOW_AGENT_NO_OUTPUT_WATCHDOG === '0') {
    return null;
  }
  const explicit = config && typeof config === 'object' ? config : {};
  // Draft gets a shorter default watchdog to surface agent-launch visibility
  // quickly; the generic default (60s) is too slow for the draft entrypoint
  // where an operator cannot tell launch from hang.
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

function formatElapsed(elapsedMs) {
  const seconds = Math.max(0, Math.round(elapsedMs / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`;
}

async function startAgent(step, opts = {}) {
  const {
    prompt,
    worktree,
    agent: agentOverride,
    env = {},
    exclude = [],
    onLimitHit,
    onLaunch,
    slug = null,
    role = null,
    detectLimitHitFn = detectLimitHit,
    updateAgentBlockFn = updateAgentBlock,
    selectAgentFn = selectAgent,
    resolveAgentModelFn = resolveAgentModel,
    isAgentBlockedFn = defaultIsAgentBlockedNow,
    sessionsModule = sessions,
    log = fmt.log.plain,
    noOutputWatchdog = {}
  } = opts;

  // `exclude` seeds the tried-set so callers can reserve agents (e.g. exclude
  // the current implementer from reviewer fallback to preserve family separation).
  const excludeIterable = exclude instanceof Set ? exclude : exclude;
  const tried = new Set(excludeIterable);
  // Track per-agent failure details for accurate exhaustion diagnostics (SC 3)
  const agentErrors = new Map();
  // Track agents actually launched (not just pre-excluded) for accurate reporting
  const launched = new Set();
  let iteration = 0;
  let chosen = agentOverride;

  while (true) {
    iteration += 1;
    if (!chosen) {
      try {
        chosen = selectAgentFn(step, { exclude: tried });
      } catch (err) {
        // Only catch pool exhaustion errors from selectAgent.
        // Configuration errors (no eligible agents, no working launcher) must
        // propagate unchanged to preserve diagnostics (SC 3).
        // Exhaustion is indicated by:
        // - "exhausted" from real selectAgent pool exhaustion ("are exhausted")
        // - "No agents available" from test mocks simulating exhaustion
        if (!err.message || !(
          err.message.includes('exhausted') ||
          err.message.includes('No agents available')
        )) {
          throw err;
        }
        // Pool exhausted; build clear exhaustion diagnostics with per-agent errors (SC 3)
        const errorDetails = [...agentErrors.entries()].map(([agent, details]) => {
          const status = details.exitInfo === 'stalled'
            ? 'stalled (no output)'
            : (details.status !== undefined && details.status !== null
              ? `exit ${details.status}`
              : (details.signal ? `signal ${details.signal}` : 'unknown'));
          const stderrSnippet = details.stderr ? ` (${details.stderr.trim().split('\n')[0]})` : '';
          return `${agent}: ${status}${stderrSnippet}`;
        }).join('; ');
        const launchedList = [...launched].join(', ');
        throw new Error(
          `All eligible agents exhausted for step "${step}". ` +
          `Tried: ${launchedList}. Errors: ${errorDetails}.`
        );
      }
    } else if (isAgentBlockedFn(chosen)) {
      // Pre-launch blocklist gate. An explicit `agent:` override (e.g. a pinned
      // reviewer/implementer carried over from review-state.json) bypasses
      // selectAgent's blocklist filter. Without this check, a known-blocked
      // family is relaunched immediately and the harness wastes a retry hitting
      // the same limit. Reroute through normal selection on the next iteration.
      log(fmt.status('WARN', `Pinned agent "${fmt.agent(chosen)}" is currently blocked in agents.local.json; rerouting via selectAgent for step "${step}".`));
      tried.add(chosen);
      chosen = null;
      continue;
    }

    try {
      assertAgentSupported(chosen);
    } catch (err) {
      if (err.code !== 'LAUNCHER_UNAVAILABLE') {
        throw err;
      }
      log(fmt.status('WARN', err.message));
      // Only reroute for launcher-availability failures (missing or probe-failed).
      tried.add(chosen);
      // If the caller pinned a specific agent, allow one retry that ignores
      // the override and falls back to normal selection (matches limit-hit logic).
      if (agentOverride && agentOverride === chosen && iteration === 1) {
        chosen = null;
        continue;
      }
      chosen = null;
      continue;
    }
    tried.add(chosen);
    launched.add(chosen);

    const launcher = LAUNCHERS[chosen];
    log(fmt.status('INFO', `Selected agent for step "${step}": ${fmt.agent(chosen)}${iteration > 1 ? ` (attempt ${iteration})` : ''}`));

    // Enforce the agent family as the Forgejo identity (ADR 0029 / task-095).
    // FORGEJO_USER is set last so the harness-selected identity always wins;
    // a caller-supplied env.FORGEJO_USER cannot override it.
    const agentEnv = { ...env, FORGEJO_USER: chosen };

    // Decide whether to resume the agent's prior session for this (slug, role).
    // Only honored when the caller passed slug+role+worktree AND the previous
    // marker matches the chosen agent family (a fallback to a different family
    // invalidates the prior session).
    const resume = Boolean(
      worktree && slug && role &&
      RESUME_CAPABLE.has(chosen) &&
      sessionsModule.shouldResume(worktree, slug, role, chosen)
    );
    const sessionId = sessionsModule.getSessionId(worktree, slug, role);
    if (slug && role) {
      if (resume) {
        log(fmt.status('INFO', `Resuming ${fmt.agent(chosen)} session for ${fmt.slug(slug)} (${role}).${sessionId ? ` Session: ${sessionId}` : ''}`));
      } else if (RESUME_CAPABLE.has(chosen)) {
        log(fmt.status('INFO', `No prior ${fmt.agent(chosen)} session for ${fmt.slug(slug)} (${role}); launching fresh.`));
      }
    }

    // Resolve the prompt string. If a function was provided, call it with the
    // currently chosen agent name (TASK-1051). This ensures that if startAgent
    // falls back to a different family after a limit hit, the fallback agent
    // receives a prompt tailored to its own identity.
    const actualPrompt = typeof prompt === 'function' ? prompt(chosen) : prompt;

    // Resolve the per-family model override (adapters.agents.models[chosen]).
    // null when the family is not configured, in which case the launcher omits
    // the model flag entirely and the agent uses its own default.
    const model = resolveAgentModelFn(chosen, worktree || process.cwd());
    if (model) {
      log(fmt.status('INFO', `Using configured model for ${fmt.agent(chosen)}: ${model}`));
    }

    const watchdogConfig = resolveNoOutputWatchdogConfig(noOutputWatchdog, step);
    const launchResult = launcher({
      prompt: actualPrompt,
      worktree,
      env: agentEnv,
      resume,
      sessionId,
      model,
      slug,
      role,
      teeOptions: watchdogConfig ? {
        noOutputWatchdog: {
          ...watchdogConfig,
          onNoOutput: ({ pid, elapsedMs }) => {
            const stage = elapsedMs < (step === 'draft' ? DRAFT_NO_OUTPUT_INITIAL_DELAY_MS : DEFAULT_NO_OUTPUT_INITIAL_DELAY_MS)
              ? 'starting up'
              : 'running';
            log(fmt.status(
              'INFO',
              `No output yet from ${fmt.agent(chosen)} for step "${step}" after ${formatElapsed(elapsedMs)} ` +
              `(pid ${pid || 'unknown'}, agent ${stage}). ` +
              `Launcher is still running; stdout/stderr have not produced visible output.`
            ));
          }
        }
      } : {}
    });
    const { invocation, resultPromise } = launchResult;
    if (invocation) {
      log(fmt.status('INFO', `Launching: ${fmt.command(`${invocation.command} ${invocation.args.join(' ')}`)}`));
      if (invocation.options && invocation.options.cwd) {
        log(fmt.status('INFO', `Working directory: ${fmt.path(invocation.options.cwd)}`));
      }
    }

    if (onLaunch) {
      await onLaunch({ agent: chosen, invocation });
    }

    const result = resultPromise ? await resultPromise : launchResult.result;

    // Pass exit metadata so detectLimitHit only treats matching transcript text
    // as a real limit hit when the launcher actually failed. A successful run
    // (status === 0) that happens to contain limit-hit phrases — for example,
    // an agent reviewing code or logs that quote those phrases — must not block
    // the healthy agent.
    const limitHit = detectLimitHitFn({
      agent: chosen,
      stdout: result && result.stdout,
      stderr: result && result.stderr,
      status: result && result.status,
      signal: result && result.signal,
      error: result && result.error
    });

    if (limitHit) {
      log(fmt.status('WARN', `Limit hit detected for ${fmt.agent(chosen)}; reset estimate "${limitHit.until}" (${limitHit.source}). Blocking and retrying.`));
      try {
        const blockResult = updateAgentBlockFn(chosen, limitHit.until);
        log(fmt.status('INFO', `Wrote blocklist entry for ${fmt.agent(chosen)} -> ${fmt.path(blockResult.path)}`));
      } catch (err) {
        log(fmt.status('WARN', `Could not persist blocklist entry for ${fmt.agent(chosen)}: ${err.message}`));
      }
      if (typeof onLimitHit === 'function') {
        onLimitHit({ agent: chosen, until: limitHit.until, source: limitHit.source });
      }
      // Reset chosen so next iteration reselects, but only when no explicit override.
      // If the caller pinned a specific agent, fail loudly — there is no fallback.
      if (agentOverride && agentOverride === chosen && iteration === 1) {
        // Allow one retry that ignores the override.
        chosen = null;
        continue;
      }
      chosen = null;
      continue;
    }

    // Reroute if the launcher binary could not be started (ENOENT = not found, EACCES = not executable).
    if (result && result.error && (result.error.code === 'ENOENT' || result.error.code === 'EACCES')) {
      log(fmt.status('WARN', `Launcher for "${chosen}" could not be started (${result.error.code}); rerouting.`));
      tried.add(chosen);
      if (agentOverride && agentOverride === chosen && iteration === 1) {
        chosen = null;
        continue;
      }
      chosen = null;
      continue;
    }

    // Detect launch failure: agent started but exited with non-zero status and
    // no limit-hit was detected. This catches errors like "Model not found" in
    // opencode that cause the launcher to exit immediately with an error code.
    // Retry with the next eligible agent instead of returning the failure.
    // Only treat `status !== null && status !== 0` or `signal` (with no spawn
    // error) as a launch failure; `status: null` without signal is ambiguous
    // (spawn-tee close event can emit null code) and should not trigger a retry.
    const launchFailed = result &&
      ((result.status !== null && result.status !== 0) || (result.signal && !result.error)) &&
      !limitHit;
    if (launchFailed) {
      const exitInfo = result.signal
        ? `signal ${result.signal}`
        : `exit ${result.status}`;
      const stderrSnippet = result && result.stderr
        ? ` (${result.stderr.trim().split('\n')[0]})`
        : '';
      log(fmt.status('WARN', `Agent ${fmt.agent(chosen)} failed to complete (${exitInfo}${stderrSnippet}); retrying with next eligible agent.`));
      agentErrors.set(chosen, {
        exitInfo,
        stderr: result.stderr,
        stdout: result.stdout,
        signal: result.signal,
        status: result.status,
      });
      tried.add(chosen);
      launched.add(chosen);
      chosen = null;
      continue;
    }
    // Record the marker so a subsequent same-(slug, role) launch knows which
    // family last ran here. We only persist when the run exited cleanly
    // (status 0 and no spawn error); a failed launch should not overwrite
    // the canonical session marker with a stale transcript.
    if (worktree && slug && role && result && result.status === 0 && !result.error) {
      try {
        const sessionId = result && result.sessionId ? result.sessionId : null;
        sessionsModule.writeSession(worktree, slug, role, { agent: chosen, sessionId });
      } catch (err) {
        log(fmt.status('WARN', `Could not persist session marker for ${fmt.slug(slug)} (${role}): ${err.message}`));
      }
    }

    return { agent: chosen, invocation, result };
  }
}

// Legacy alias kept for backwards compatibility — draft.js calls this directly.
// Returns { agent, invocation, result } so callers can log which agent ran.
async function startDraftAgent(opts = {}) {
  return startAgent('draft', opts);
}

module.exports = {
  KNOWN_AGENT_NAMES,
  WORKFLOW_AGENT_NAMES,
  startAgent,
  startDraftAgent,
  selectAgent,
  eligibleAgentsForStep,
  readAgentConfig,
  readAgentConfigOrExit,
  assertAgentSupported,
  workflowLauncherStatus,
  setCommandPathProbe: (fn) => { _commandPathProbe = fn; },
  isAgentBlocked,
  parseBlockUntil,
  isInvalidAgentConfigError,
  updateAgentBlock,
  resolveBlocklistTargetPath,
  resolveNoOutputWatchdogConfig
};
