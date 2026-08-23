import * as fmt from '../../application/presentation/cli-format.js';
import { isSpuriousCodexExit } from './codex.js';
import { isSpuriousVibeExit } from './vibe.js';
import { isSpuriousOpencodeExit } from './opencode.js';
import { isSpuriousQwenExit } from './qwen.js';
import { detectLimitHit, formatBlockUntil, DEFAULT_FALLBACK_HOURS } from '../../application/services/agent-limit.js';
import { resolveAgentModel, resolveReviewArtifactDir } from '../config/product-config.js';
import {
  CONFIG_PATH,
  readAgentConfig,
  readAgentConfigOrExit,
  parseBlockUntil,
  isAgentBlocked,
  isInvalidAgentConfigError,
  updateAgentBlock,
  resolveBlocklistTargetPath
} from './agent-config.js';
import { resolveAgentBlockAuthority } from './agent-block-authority.js';
import {
  KNOWN_AGENT_NAMES,
  WORKFLOW_AGENT_NAMES,
  RESUME_CAPABLE,
  LAUNCHERS,
  DEFAULT_NO_OUTPUT_INITIAL_DELAY_MS,
  DRAFT_NO_OUTPUT_INITIAL_DELAY_MS,
  workflowLauncherStatus,
  setCommandPathProbe,
  eligibleAgentsForStep,
  selectAgent,
  assertAgentSupported,
  resolveNoOutputWatchdogConfig,
  resolveCustomLauncher
} from './launcher-selection.js';
import { resolveCustomRunner } from '../config/product-config.js';
import { resolveSandboxProfile, withSandboxProfile } from '../process/bubblewrap.js';
import { tryAcquireCustomCapacity } from './custom-capacity.js';
import type { SessionMarkerPort } from '../../application/domain-ports.js';
import type { AgentFamily } from '../../domain/agents.js';
import type { MissionId } from '../../domain/mission.js';
import type { SessionRole } from '../../domain/session.js';

interface LaunchResultLike {
  stdout?: string;
  stderr?: string;
  status?: number | null;
  signal?: string | null;
  error?: {code?: string, message?: string} | null;
}

interface StartAgentOptions {
  prompt: string | Function;
  worktree?: string;
  agent?: string;
  env?: {[key: string]: string};
  exclude?: any;
  onLimitHit?: Function;
  onLaunch?: Function;
  slug?: string | null;
  role?: string | null;
  detectLimitHitFn?: Function;
  updateAgentBlockFn?: Function;
  selectAgentFn?: Function;
  resolveAgentModelFn?: Function;
  isAgentBlockedFn?: Function;
  /** Checked application port for session markers (architecture migration cutover). */
  sessionMarkerPort?: SessionMarkerPort;
  log?: Function;
  noOutputWatchdog?: {initialDelayMs?: number, intervalMs?: number} | boolean;
  launchAgentFn?: Function;
  assertAgentSupportedFn?: Function;
  /**
   * Board fire-and-forget dispatch: unref the launched child (and its pipes)
   * so the board process can exit on q/Ctrl+C while the action runs on.
   * CLI callers leave this unset and keep the child ref'd until it exits.
   */
  unrefChild?: boolean;
  /**
   * Refuse every fallback for the pinned `agent`. Used by work that a specific
   * actor owns outright — conflict resolution belongs to the mission
   * implementer (TASK-2294.01), so a blocked, saturated, unavailable,
   * limit-hit or failed implementer must surface as an error instead of
   * silently rerouting through `selectAgent`.
   */
  pinnedAgent?: boolean;
}

/** Thrown when `pinnedAgent` is set and the pinned family cannot run the step. */
class PinnedAgentUnavailableError extends Error {
  code = 'PINNED_AGENT_UNAVAILABLE';
  agent: string;
  detail: string;
  constructor(agent: string, detail: string) {
    super(`Pinned agent "${agent}" cannot run this step: ${detail}`);
    this.name = 'PinnedAgentUnavailableError';
    this.agent = agent;
    this.detail = detail;
  }
}

const NON_BLOCKING_LAUNCH_ERROR_PATTERNS = Object.freeze([
  // task-2380: Claude missing-session resume error (also recovered per-family
  // in claude.ts). Deterministic, agent-specific — never poison the blocklist.
  /no conversation found with session id:/i,
  /\b(?:invalid|unknown|unsupported|unrecognized)\s+model\b/i,
  /\bmodel\s+(?:identifier|id)\s+(?:is\s+)?invalid\b/i,
  /\b(?:model\s+not\s+found|no\s+such\s+model)\b/i,
  /\bunknown\s+option\b/i,
  /\bunsupported\s+(flag|option)\b/i,
  /\bauth(?:entication)?\b/i,
  /\bunauthorized\b/i,
  /\bforbidden\b/i,
  /\bapi\s+key\b/i,
  /\bread-only file system\b/i,
  /\b(home|bootstrap)\s+(error|failed|cannot|denied|not\s+found)\b/i,
  /\bpermission\s+denied\b/i,
  // (a) websocket / connection failures — transient infrastructure issues
  /failed to connect to websocket/i,
  /\bconnection refused\b/i,
  /\bECONNREFUSED\b/i,
  /\bos error 1\b/i,
  // (b) provider reachability errors — provider endpoints unreachable
  /provider endpoints are unreachable/i,
  /\breachability\b/i,
  /\bendpoint unreachable\b/i,
    // (c) generic os-error / transient runtime failures (non-quota)
    /\bos error \d+\b/i,
    // (d) timeout errors — transient waits exceeded
    /\btimeout\b/i,
    /\btimed\s+out\b/i,
    /\bdeadline\s+exceeded\b/i,
    /\brequest\s+timed\s+out\b/i,
    // (e) sandbox / permission-denial errors that are not auth-related
    /\bsandbox\s+violation\b/i,
    /\bsandbox\s+denied\b/i,
    /\btool\s+call\s+denied\b/i,
    /\baction\s+denied\b/i,
    /\bapproval\s+denied\b/i,
    // (f) provider reachability / connectivity errors not already covered
    /\bEPIPE\b/i,
    /\bETIMEDOUT\b/i,
    /\bENETUNREACH\b/i,
    /\bENOTFOUND\b/i,
    /\bEAI_AGAIN\b/i,
    /\bsocket\s+hang\s+up\b/i,
    /\bfetch\s+failed\b/i,
    /\bservice\s+unavailable\b/i,
    /\bgateway\s+timeout\b/i,
    /\boverloaded\b/i,
    /\btemporarily\s+unavailable\b/i,
    /\bplease\s+try\s+again\b/i,
    /\bretry\s+after\b/i,
    // (g) prompt rejection errors
    /\bprompt\s+rejected\b/i,
    /\bprompt\s+blocked\b/i,
    /\bcontent\s+policy\b/i,
    /\bcontent\s+filter\b/i,
    /\bsafety\s+filter\b/i,
    // (h) invocation argument errors
    /\binvalid\s+argument\b/i,
    /\binvalid\s+option\b/i,
    /\binvalid\s+parameter\b/i,
    /\bmissing\s+required\b/i,
    /\bargument\s+error\b/i,
    // (i) resource exhaustion not rate-limit related
    /\b(out of memory|OOM)\b/i,
    /\bmemory\s+limit\b/i,
    /\bcontext\s+window\s+exceeded\b/i,
    /\btoken\s+limit\s+exceeded\b/i
]);

const defaultSessionMarkerPorts = new Map<string, Promise<SessionMarkerPort>>();

/**
 * Build the sole production session-marker authority on demand.  This keeps
 * SQLite out of the launcher module's static graph while making an unavailable
 * database an explicit launch failure instead of falling back to worktree files.
 */
async function defaultSessionMarkerPort(worktree: string): Promise<SessionMarkerPort> {
  const { ConcreteGitReadAdapter } = await import('../backlog/concrete-git-read-adapter.js');
  const repositoryId = await new ConcreteGitReadAdapter({ rootDir: worktree }).loadRepositoryId();
  let port = defaultSessionMarkerPorts.get(repositoryId);
  if (!port) {
    port = (async () => {
      const { initOperatorState } = await import('../sqlite/adapter-factory.js');
      const { SqliteSessionMarkerAdapter } = await import('../sqlite/session-marker-adapter.js');
      const { db } = await initOperatorState();
      return new SqliteSessionMarkerAdapter(db, repositoryId);
    })();
    defaultSessionMarkerPorts.set(repositoryId, port);
  }
  try {
    return await port;
  } catch (error) {
    defaultSessionMarkerPorts.delete(repositoryId);
    throw error;
  }
}

/**
 * Runtime callers describe the participant identity while SessionMarker uses
 * the checked workflow stage. Keep that translation at this boundary instead
 * of casting unchecked strings through the application port.
 */
function normalizeSessionRole(role: string): SessionRole {
  switch (role) {
    case 'implementer':
      return 'execute';
    case 'reviewer':
      return 'review';
    case 'execute':
    case 'draft':
    case 'review':
      return role;
    default:
      throw new Error(`Unsupported session marker role: ${role}`);
  }
}

/**
 * Launcher inputs have already passed mission lookup and agent selection.
 * Keep their checked identities as branded values without adding a second
 * runtime dependency on domain constructors here. The authoritative
 * SessionMarker adapter validates them again at every persistence boundary.
 */
function sessionMissionId(slug: string): MissionId {
  return slug as MissionId;
}

function sessionAgentFamily(agent: string): AgentFamily {
  return agent as AgentFamily;
}

// Deterministic config/setup errors (invalid model IDs, auth failures,
// unsupported CLI flags, home/bootstrap failures) must not poison the
// persistent blocklist — only transient failures (runtime crashes, network
// errors) deserve a block. Custom agents are never blocked.
function shouldPersistLaunchFailureBlock(agent: string, result: LaunchResultLike | null | undefined) {
  if (!result || agent === 'custom') {return false;}
  const combined = [
    result.stderr || '',
    result.stdout || '',
    result.error?.message || '',
    result.error?.code || ''
  ].join('\n');
  if (!combined.trim()) {return true;}
  return !NON_BLOCKING_LAUNCH_ERROR_PATTERNS.some(pattern => pattern.test(combined));
}

async function defaultIsAgentBlockedNow(agent: string) {
  try {
    const { initOperatorState } = await import('../sqlite/adapter-factory.js');
    const { SqliteBlocklistRepository } = await import('../sqlite/blocklist-repository.js');
    const { AgentBlockService } = await import('../../application/services/agent-block-service.js');
    const config = readAgentConfig(CONFIG_PATH, {});
    const state = await initOperatorState();
    const runtimeBlock = await new AgentBlockService(new SqliteBlocklistRepository(state.db)).query(agent);
    return resolveAgentBlockAuthority(agent, runtimeBlock, config).blocked;
  } catch (_err) {
    // If the config is malformed, surface that through the launcher path
    // (assertAgentSupported / launch) instead of silently rerouting. Treat as
    // not-blocked here so the existing error path runs.
    return false;
  }
}

/** Persist runtime blocks through the checked authority without changing the synchronous config seam. */
async function updateAgentBlockChecked(agent: string, until: string, options: {reason?: string} = {}) {
  const { initOperatorState } = await import('../sqlite/adapter-factory.js');
  const { SqliteBlocklistRepository } = await import('../sqlite/blocklist-repository.js');
  const { AgentBlockService } = await import('../../application/services/agent-block-service.js');
  const state = await initOperatorState();
  return new AgentBlockService(new SqliteBlocklistRepository(state.db)).block(agent, until, options.reason ?? null);
}

function formatElapsed(elapsedMs: number) {
  const seconds = Math.max(0, Math.round(elapsedMs / 1000));
  if (seconds < 60) {return `${seconds}s`;}
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`;
}

async function startAgent(step: string, opts: StartAgentOptions = { prompt: '' }) {
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
    updateAgentBlockFn = updateAgentBlockChecked,
    selectAgentFn = selectAgent,
    resolveAgentModelFn = resolveAgentModel,
    isAgentBlockedFn = defaultIsAgentBlockedNow,
    sessionMarkerPort,
    log = fmt.log.plain,
    noOutputWatchdog = {},
    launchAgentFn = null,
    assertAgentSupportedFn = assertAgentSupported,
    unrefChild = false,
    pinnedAgent = false
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

  // Single explicit-fail branch for pinned work (TASK-2294.01). Every reroute
  // point below calls it before clearing `chosen`, so a pinned agent never
  // reaches `selectAgent` and the caller sees why the owner could not run.
  const refuseFallbackWhenPinned = (detail: string) => {
    if (pinnedAgent && agentOverride) {
      throw new PinnedAgentUnavailableError(agentOverride, detail);
    }
  };

  while (true) {
    iteration += 1;
    if (!chosen) {
      try {
        chosen = selectAgentFn(step, { exclude: tried, worktree });
      } catch (err) {
        // Only catch pool exhaustion errors from selectAgent.
        // Configuration errors (no eligible agents, no working launcher) must
        // propagate unchanged to preserve diagnostics (SC 3).
        // Exhaustion is indicated by:
        // - "exhausted" from real selectAgent pool exhaustion ("are exhausted")
        // - "No agents available" from test mocks simulating exhaustion
        if (!((err as any).message || '').includes('exhausted') &&
          !((err as any).message || '').includes('No agents available')
        ) {
          throw err;
        }
        // Pool exhausted — try excluded agents as last resort before throwing.
        // This restores the single-family escape hatch: when no different-family
        // reviewer is available, the implementer reviews its own work.
        const excludeIterableOrig = exclude instanceof Set ? [...exclude] : exclude;
        const fallbackAgent = excludeIterableOrig.find((a: string) => !launched.has(a));
        if (fallbackAgent !== undefined) {
          chosen = fallbackAgent;
          continue;
        }
        // No excluded agent available either; build clear exhaustion diagnostics (SC 3)
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
    } else if (await isAgentBlockedFn(chosen)) {
      refuseFallbackWhenPinned('currently blocked by the block authority');
      // Pre-launch blocklist gate. An explicit `agent:` override (e.g. a pinned
      // reviewer/implementer carried over from the mission's Review) bypasses
      // selectAgent's blocklist filter. Without this check, a known-blocked
      // family is relaunched immediately and the harness wastes a retry hitting
      // the same limit. Reroute through normal selection on the next iteration.
      log(fmt.status('WARN', `Pinned agent "${fmt.agent(chosen)}" is currently blocked; rerouting via selectAgent for step "${step}".`));
      tried.add(chosen);
      chosen = undefined;
      continue;
    }

    try {
      assertAgentSupportedFn(chosen || '', worktree);
    } catch (err) {
      /** @type {Error & {code?: string}} */
      const e = (err as any);
      if (e.code !== 'LAUNCHER_UNAVAILABLE') {
        throw err;
      }
      refuseFallbackWhenPinned(e.message || 'launcher unavailable');
      log(fmt.status('WARN', (err as any).message));
      // Only reroute for launcher-availability failures (missing or probe-failed).
      tried.add(chosen || '');
      // If the caller pinned a specific agent, allow one retry that ignores
      // the override and falls back to normal selection (matches limit-hit logic).
      if (agentOverride && agentOverride === chosen && iteration === 1) {
        chosen = undefined;
        continue;
      }
      chosen = undefined;
      continue;
    }
    tried.add(chosen || '');
    launched.add(chosen || '');

    // For custom agent, resolve the actual launcher based on configuration.
    // resolveCustomRunner/resolveCustomLauncher default to process.cwd()
    // when worktree is undefined, so this must not be gated behind worktree
    // truthiness (LAUNCHERS has no "custom" key, so skipping this branch
    // silently drops the launcher to undefined and later crashes the launch).
    let launcher = LAUNCHERS[chosen || ''];
    let customRunner: string | undefined;
    if (chosen === 'custom') {
      launcher = resolveCustomLauncher(worktree as string);
      customRunner = resolveCustomRunner(worktree as string);
    }
    if (launchAgentFn) {
      launcher = launchAgentFn;
    }
    log(fmt.status('INFO', `Selected agent for step "${step}": ${fmt.agent(chosen || '', chosen || '', customRunner)}${iteration > 1 ? ` (attempt ${iteration})` : ''}`));

    // Enforce the agent family as the Forgejo identity (ADR 0029 / architecture migration).
    // FORGEJO_USER is set last so the harness-selected identity always wins;
    // a caller-supplied env.FORGEJO_USER cannot override it.
    const agentEnv = { ...env, FORGEJO_USER: chosen };

    // Decide whether to resume the agent's prior session for this (slug, role).
    // Only honored when the caller passed slug+role+worktree AND the previous
    // marker matches the chosen agent family (a fallback to a different family
    // invalidates the prior session).
    let resume = false;
    let sessionId: string | null = null;
    let launchSessionMarkerPort: SessionMarkerPort | undefined;
    let sessionRole: SessionRole | null = null;
    if (worktree && slug && role) {
      sessionRole = normalizeSessionRole(role);
      launchSessionMarkerPort = sessionMarkerPort || await defaultSessionMarkerPort(worktree);
      resume = RESUME_CAPABLE.has(chosen || '') &&
        await launchSessionMarkerPort.shouldResume(
          sessionMissionId(slug),
          sessionRole,
          sessionAgentFamily(chosen || ''),
        );
      const marker = await launchSessionMarkerPort.find(sessionMissionId(slug), sessionRole);
      sessionId = marker?.sessionId ?? null;
    }
    if (slug && role) {
      if (resume) {
        log(fmt.status('INFO', `Resuming ${fmt.agent(chosen || '')} session for ${fmt.slug(slug)} (${role}).${sessionId ? ` Session: ${sessionId}` : ''}`));
      } else if (RESUME_CAPABLE.has(chosen || '')) {
        log(fmt.status('INFO', `No prior ${fmt.agent(chosen || '')} session for ${fmt.slug(slug)} (${role}); launching fresh.`));
      }
    }

    // Resolve the prompt string. If a function was provided, call it with the
    // currently chosen agent name (architecture migration). This ensures that if startAgent
    // falls back to a different family after a limit hit, the fallback agent
    // receives a prompt tailored to its own identity.
    const actualPrompt = typeof prompt === 'function' ? prompt(chosen) : prompt;

    // Resolve the per-family model override (adapters.agents.models[chosen]).
    // null when the family is not configured, in which case the launcher omits
    // the model flag entirely and the agent uses its own default.
    const model = resolveAgentModelFn(chosen || '', worktree || process.cwd());
    if (model) {
      log(fmt.status('INFO', `Using configured model for ${fmt.agent(chosen || '')}: ${model}`));
    }

    const watchdogConfig = resolveNoOutputWatchdogConfig(noOutputWatchdog, step);
    const customReservation = chosen === 'custom'
      ? tryAcquireCustomCapacity(worktree)
      : null;
    if (chosen === 'custom' && !customReservation) {
      refuseFallbackWhenPinned('custom-agent capacity is saturated');
      log(fmt.status('WARN', 'Custom-agent capacity is saturated; selecting another eligible agent.'));
      tried.add(chosen);
      chosen = undefined;
      continue;
    }

    let invocation;
    let result;
    try {
      // This is the sole production policy decision. The AsyncLocalStorage
      // context reaches the shared process seam through every family launcher.
      const sandboxProfile = worktree
        ? resolveSandboxProfile(step, worktree, step === 'review' ? resolveReviewArtifactDir(worktree) : null, chosen || null)
        : null;
      const launchResult = withSandboxProfile(sandboxProfile, () => launcher({
        prompt: actualPrompt,
        worktree,
        env: agentEnv,
        resume,
        sessionId,
        model,
        slug,
        role: sessionRole,
        sessionMarkerPort: launchSessionMarkerPort,
        teeOptions: {
          ...(unrefChild ? { unrefChild: true } : {}),
          ...(watchdogConfig
            ? {
                noOutputWatchdog: {
                  ...watchdogConfig,
                  onNoOutput: (evt: {pid: number, elapsedMs: number, sawOutput?: boolean, msSinceLastOutput?: number | null}) => {
                    const stage = evt.elapsedMs < (step === 'draft' ? DRAFT_NO_OUTPUT_INITIAL_DELAY_MS : DEFAULT_NO_OUTPUT_INITIAL_DELAY_MS)
                      ? 'starting up'
                      : 'running';
                    // The watchdog is observational and keeps reporting after
                    // the agent's first output, so the wording has to stay
                    // truthful once output has already been seen.
                    const detail = evt.sawOutput
                      ? `last visible output ${formatElapsed(evt.msSinceLastOutput ?? 0)} ago`
                      : 'stdout/stderr have not produced visible output';
                    log(fmt.status(
                      'INFO',
                      `${evt.sawOutput ? 'Still waiting on' : 'No output yet from'} ${fmt.agent(chosen || '')} for step "${step}" after ${formatElapsed(evt.elapsedMs)} ` +
                      `(pid ${evt.pid || 'unknown'}, agent ${stage}). ` +
                      `Launcher is still running; ${detail}.`
                    ));
                  }
                }
              }
            : {})
        }
      }));
      const { invocation: launchedInvocation, resultPromise } = launchResult;
      invocation = launchedInvocation;
      if (invocation) {
        log(fmt.status('INFO', `Launching: ${fmt.command(`${invocation.command} ${invocation.args.join(' ')}`)}`));
        if (invocation.options && invocation.options.cwd) {
          log(fmt.status('INFO', `Working directory: ${fmt.path(invocation.options.cwd)}`));
        }
      }

      if (onLaunch) {
        await onLaunch({ agent: chosen, invocation });
      }

      result = resultPromise ? await resultPromise : launchResult.result;
    } finally {
      customReservation?.release();
    }

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
      // Reroute signal: transient limit (e.g. qwen rate-limit) — exclude from
      // current retry cycle without persisting a long block to blocklist.
      if (limitHit.reroute) {
        log(fmt.status('WARN', `Transient limit for ${fmt.agent(chosen || '')}; ${limitHit.reason}. Rerouting without block.`));
        tried.add(chosen || '');
        if (agentOverride && agentOverride === chosen && iteration === 1) {
          chosen = undefined;
          continue;
        }
        chosen = undefined;
        continue;
      }

      log(fmt.status('WARN', `Limit hit detected for ${fmt.agent(chosen || '')}; reset estimate "${limitHit.until}" (${limitHit.source}). Blocking and retrying.`));
      try {
        const blockResult = await updateAgentBlockFn(chosen || '', limitHit.until, { reason: limitHit.reason });
        log(fmt.status('INFO', `Wrote checked AgentBlock for ${fmt.agent(chosen || '')} (${blockResult.reason || 'limit'})`));
      } catch (err) {
        log(fmt.status('WARN', `Could not persist blocklist entry for ${fmt.agent(chosen || '')}: ${(err as any).message}`));
      }
      if (typeof onLimitHit === 'function') {
        onLimitHit({ agent: chosen, until: limitHit.until, source: limitHit.source });
      }
      refuseFallbackWhenPinned(`usage limit hit; blocked until ${limitHit.until}`);
      // Reset chosen so next iteration reselects, but only when no explicit override.
      // If the caller pinned a specific agent, fail loudly — there is no fallback.
      if (agentOverride && agentOverride === chosen && iteration === 1) {
        // Allow one retry that ignores the override.
        chosen = undefined;
        continue;
      }
      chosen = undefined;
      continue;
    }

    // Reroute if the launcher binary could not be started (ENOENT = not found, EACCES = not executable).
    if (result && result.error && (result.error.code === 'ENOENT' || result.error.code === 'EACCES')) {
      refuseFallbackWhenPinned(`launcher could not be started (${result.error.code})`);
      log(fmt.status('WARN', `Launcher for "${chosen || ''}" could not be started (${result.error.code}); rerouting.`));
      tried.add(chosen || '');
      if (agentOverride && agentOverride === chosen && iteration === 1) {
        chosen = undefined;
        continue;
      }
      chosen = undefined;
      continue;
    }

    // Detect launch failure: agent started but exited with non-zero status and
    // no limit-hit was detected. This catches errors like "Model not found" in
    // opencode that cause the launcher to exit immediately with an error code.
    // Retry with the next eligible agent instead of returning the failure.
    // Only treat `status !== null && status !== 0` or `signal` (with no spawn
    // error) as a launch failure; `status: null` without signal is ambiguous
    // (spawn-tee close event can emit null code) and should not trigger a retry.
    // Spurious opencode v2.0.0 JSON-mode exits (exit 1 after a valid
    // "reason":"stop" completion) are excluded — the agent completed, the
    // non-zero code is a post-run cleanup race. Codex and Vibe get the
    // same treatment via their own family-specific telemetry evidence
    // (result.telemetry carrying real, non-zero token usage) rather than an
    // opencode-specific stdout pattern — see isSpuriousCodexExit (codex.ts)
    // and isSpuriousVibeExit (vibe.ts).
    const launchFailed = result &&
      ((result.status !== null && result.status !== 0) || (result.signal && !result.error)) &&
      !limitHit &&
      !isSpuriousOpencodeExit(result) &&
      !(chosen === 'codex' && isSpuriousCodexExit(result)) &&
      !(chosen === 'vibe' && isSpuriousVibeExit(result)) &&
      !(chosen === 'qwen' && isSpuriousQwenExit(result));
    if (launchFailed) {
      const exitInfo = result.signal
        ? `signal ${result.signal}`
        : `exit ${result.status}`;
      const stderrSnippet = result && result.stderr
        ? ` (${result.stderr.trim().split('\n')[0]})`
        : '';
      // Pinned work has no next eligible agent: hand the failed result back so
      // the caller reports the owner's own exit status (TASK-2294.01).
      if (pinnedAgent && agentOverride) {
        log(fmt.status('WARN', `Pinned agent ${fmt.agent(chosen || '')} failed to complete (${exitInfo}${stderrSnippet}); no fallback is permitted for this step.`));
        return { agent: chosen, invocation, result };
      }
      log(fmt.status('WARN', `Agent ${fmt.agent(chosen || '')} failed to complete (${exitInfo}${stderrSnippet}); retrying with next eligible agent.`));
      agentErrors.set(chosen || '', {
        exitInfo,
        stderr: result.stderr,
        stdout: result.stdout,
        signal: result.signal,
        status: result.status,
      });
      tried.add(chosen || '');
      launched.add(chosen || '');
      // Block retry candidates only when the failure looks transient. Deterministic
      // setup/config errors (invalid model id, auth failure, read-only HOME, etc.)
      // should fall through to the next family without poisoning agents.local.json.
       if (shouldPersistLaunchFailureBlock(chosen || '', result)) {
         let blockReason = 'transient crash';
         if (result?.signal) { blockReason = `signal ${result.signal}`; }
         else if (result?.error?.code) { blockReason = result.error.code; }
          else if (result?.status !== null && result?.status !== 0) {
            blockReason = result?.stderr
              ? `exit ${result.status}: ${result.stderr.trim().split('\n')[0]}`
              : `exit ${result.status}`;
          }
         const blockUntil = formatBlockUntil(new Date(Date.now() + DEFAULT_FALLBACK_HOURS * 60 * 60 * 1000));
         try {
           const blockResult = await updateAgentBlockFn(chosen || '', blockUntil, { reason: blockReason });
           log(fmt.status('INFO', `Wrote checked AgentBlock for ${fmt.agent(chosen || '')} (${DEFAULT_FALLBACK_HOURS}h block, ${blockResult.reason || blockReason})`));
         } catch (err) {
          log(fmt.status('WARN', `Could not persist blocklist entry for ${fmt.agent(chosen || '')}: ${(err as any).message}`));
          }
       } else {
        log(fmt.status('INFO', `Skipping blocklist write for ${fmt.agent(chosen || '')}; launch failure looks like a deterministic config/setup error.`));
      }
      chosen = undefined;
      continue;
    }
    // Record the marker so a subsequent same-(slug, role) launch knows which
    // family last ran here. We only persist when the run exited cleanly
    // (status 0 and no spawn error); a failed launch should not overwrite
    // the canonical session marker with a stale transcript.
    if (worktree && slug && role && result && result.status === 0 && !result.error) {
      const launchSessionId = result && result.sessionId ? result.sessionId : null;
      if (!launchSessionMarkerPort || !sessionRole) {
        throw new Error('SessionMarkerPort and canonical role are required');
      }
      try {
        await launchSessionMarkerPort.save({
          missionId: sessionMissionId(slug),
          role: sessionRole,
          agent: sessionAgentFamily(chosen || ''),
          lastLaunched: new Date().toISOString(),
          sessionId: launchSessionId,
        });
      } catch (err) {
        // Diagnostic: log full error details and database state
        if (process.env.PARALLIX_DEBUG_SQL) {
          const { getOperatorStateCacheSize } = await import('../sqlite/adapter-factory.js');
          const e = err as Error & { code?: string };
          process.stderr.write(`[sql-error] save failed: code=${e.code ?? 'n/a'} message="${e.message}"\n`);
          process.stderr.write(`[sql-error] cacheSize=${getOperatorStateCacheSize()} pid=${process.pid}\n`);
          process.stderr.write(`[sql-error] stack:\n${e.stack ?? 'n/a'}\n`);
        }
        throw new Error(`Could not persist session marker for ${slug} (${role}): ${(err as Error).message}`);
      }
    }

    return { agent: chosen, invocation, result };
  }
}

// Legacy alias kept for backwards compatibility — draft.js calls this directly.
// Returns { agent, invocation, result } so callers can log which agent ran.
async function startDraftAgent(opts: StartAgentOptions = { prompt: '' }) {
  return startAgent('draft', opts);
}

export {
  KNOWN_AGENT_NAMES,
  WORKFLOW_AGENT_NAMES,
  PinnedAgentUnavailableError,
  startAgent,
  startDraftAgent,
  selectAgent,
  eligibleAgentsForStep,
  readAgentConfig,
  readAgentConfigOrExit,
  assertAgentSupported,
  workflowLauncherStatus,
  setCommandPathProbe,
  isAgentBlocked,
  parseBlockUntil,
  isInvalidAgentConfigError,
  updateAgentBlock,
  resolveBlocklistTargetPath,
  defaultIsAgentBlockedNow,
  updateAgentBlockChecked,
  resolveNoOutputWatchdogConfig,
  shouldPersistLaunchFailureBlock
};
