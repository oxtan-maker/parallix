import { monotonicNowMs } from '../../application/lifecycle-timing.js';
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
  setLauncherHealthProbe,
  eligibleAgentsForStep,
  selectAgent,
  assertAgentSupported,
  resolveNoOutputWatchdogConfig,
  resolveCustomLauncher
} from './launcher-selection.js';
import { resolveCustomRunner } from '../config/product-config.js';
import { warmPiSdk } from './pi.js';
import { resolveSandboxProfile, withSandboxProfile } from '../process/bubblewrap.js';
import { selectConfinement, supportsNativeSandbox, ConfinementBlockedError, isBubblewrapDisabled, isBubblewrapAvailable, BUBBLEWRAP_COMMAND } from '../process/confinement.js';
import { waitForCustomCapacity } from './custom-capacity.js';
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
  noOutputWatchdog?: {initialDelayMs?: number, intervalMs?: number, maxNoOutputMs?: number} | boolean;
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
  /**
   * Task-2513 explicit consent: allow a mutating launch to run unsandboxed when
   * Bubblewrap is unavailable and the family exposes no native sandbox. Explicit
   * by contract — defaults false, never implied by a fallback or default setting.
   */
  allowUnsandboxedMutation?: boolean;
}

// Process-wide composition seam for hosts which supply an in-process agent
// port. Production leaves this unset and keeps the concrete launcher default.
let workflowLaunchPort: Function | null = null;

function setWorkflowLaunchPort(port: Function | null): void {
  workflowLaunchPort = port;
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

const NON_BLOCKING_CREDENTIAL_ERROR_PATTERNS = Object.freeze([
  /\bauth(?:entication)?\b/i,
  /\bunauthorized\b/i,
  /\bforbidden\b/i,
  /\bapi\s+key\b/i,
]);

const CREDENTIAL_REFRESH_ERROR_PATTERNS = Object.freeze([
  ...NON_BLOCKING_CREDENTIAL_ERROR_PATTERNS,
  /\b(?:access\s+)?(?:token|credential)s?\b.*\bexpired\b|\bexpired\b.*\b(?:access\s+)?(?:token|credential)s?\b/i,
]);

const NON_BLOCKING_LAUNCH_ERROR_PATTERNS = Object.freeze([
  // task-2380: Claude missing-session resume error (also recovered per-family
  // in claude.ts). Deterministic, agent-specific — never poison the blocklist.
  /no conversation found with session id:/i,
  /\b(?:invalid|unknown|unsupported|unrecognized)\s+model\b/i,
  /\bmodel\s+(?:identifier|id)\s+(?:is\s+)?invalid\b/i,
  /\b(?:model\s+not\s+found|no\s+such\s+model)\b/i,
  /\bunknown\s+option\b/i,
  /\bunsupported\s+(flag|option)\b/i,
  ...NON_BLOCKING_CREDENTIAL_ERROR_PATTERNS,
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
// unsupported CLI flags, home/bootstrap failures, missing-session resume) are
// per-invocation and repeat on every retry, so they must never poison the
// persistent blocklist. Custom agents are never blocked.
//
// Beyond those deterministic errors, a family-wide block is persisted ONLY when
// the failure is positively classified as a genuine provider-wide availability
// or quota condition. The decision routes through the same `detectLimitHit`
// classifier the limit-hit branch uses (task-2536) so both block-persistence
// sites agree on one bar: an ambiguous non-zero exit with no quota/429/
// resource_exhausted signal (e.g. a bare `exit 1` / "generic crash") stays local
// to the failing launch instead of becoming a three-hour family block while the
// family is live. A process-kill signal is still caught by detectLimitHit's
// short-block path and preserved.
function shouldPersistLaunchFailureBlock(agent: string, result: LaunchResultLike | null | undefined) {
  if (!result || agent === 'custom') {return false;}
  const combined = [
    result.stderr || '',
    result.stdout || '',
    result.error?.message || '',
    result.error?.code || ''
  ].join('\n');
  if (NON_BLOCKING_LAUNCH_ERROR_PATTERNS.some(pattern => pattern.test(combined))) {return false;}
  const hit = detectLimitHit({
    agent,
    stdout: result.stdout,
    stderr: result.stderr,
    // detectLimitHit's `status` is number|undefined; normalise the null that a
    // spawned-but-closed child emits (spawn-tee close event) to undefined so the
    // classifier's `typeof status === 'number'` gate behaves as intended.
    status: result.status ?? undefined,
    signal: result.signal,
    error: result.error ?? null
  });
  return !!hit && !hit.reroute;
}

function needsCredentialRefresh(result: LaunchResultLike): boolean {
  return CREDENTIAL_REFRESH_ERROR_PATTERNS.some(pattern => pattern.test([
    result.stderr || '', result.stdout || '', result.error?.message || '', result.error?.code || ''
  ].join('\n')));
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

// A watchdog tick is only news once the agent's output has been silent this long.
const QUIET_STREAM_REPORT_MS = 15_000;

function formatElapsed(elapsedMs: number) {
  const seconds = Math.max(0, Math.round(elapsedMs / 1000));
  if (seconds < 60) {return `${seconds}s`;}
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`;
}

/** One line per family that actually launched, naming how it ended. */
function agentPoolExhaustedError(step: string, launched: Set<unknown>, agentErrors: Map<any, any>): Error {
  const errorDetails = [...agentErrors.entries()].map(([agent, details]) => {
    const status = details.exitInfo === 'stalled'
      ? 'stalled (no output)'
      : (details.status !== undefined && details.status !== null
        ? `exit ${details.status}`
        : (details.signal ? `signal ${details.signal}` : 'unknown'));
    const stderrSnippet = details.stderr ? ` (${details.stderr.trim().split('\n')[0]})` : '';
    return `${agent}: ${status}${stderrSnippet}`;
  }).join('; ');
  return new Error(
    `All eligible agents exhausted for step "${step}". ` +
    `Tried: ${[...launched].join(', ')}. Errors: ${errorDetails}.`
  );
}

/** How a launch failure reads in the blocklist entry. */
function launchFailureBlockReason(result: any): string {
  if (result?.signal) { return `signal ${result.signal}`; }
  if (result?.error?.code) { return result.error.code; }
  if (result?.status !== null && result?.status !== 0) {
    return result?.stderr ? `exit ${result.status}: ${result.stderr.trim().split('\n')[0]}` : `exit ${result.status}`;
  }
  return 'transient crash';
}

/**
 * Block retry candidates only on a positive availability/quota classification
 * (task-2536). Deterministic setup/config errors and every ambiguous non-zero
 * exit fall through to the next family without poisoning agents.local.json.
 * This is the second of two block-persistence sites; both agree on one bar via
 * shouldPersistLaunchFailureBlock.
 *
 * NOTE (task-2536 round-1 F2): under default wiring this is unreachable —
 * startAgent's limit-hit check uses the same detectLimitHit classifier, so a
 * positive classification is caught and persisted there first. It is retained
 * as defence-in-depth for callers that inject a non-default detectLimitHitFn;
 * do not read it as a live production block path.
 */
async function persistLaunchFailureBlock(agent: string, result: any, updateAgentBlockFn: Function, log: Function): Promise<void> {
  if (!shouldPersistLaunchFailureBlock(agent, result)) {
    log(fmt.status('INFO', `Skipping blocklist write for ${fmt.agent(agent)}; failure not positively classified as a provider availability/quota block.`));
    return;
  }
  const blockReason = launchFailureBlockReason(result);
  const blockUntil = formatBlockUntil(new Date(Date.now() + DEFAULT_FALLBACK_HOURS * 60 * 60 * 1000));
  try {
    const blockResult = await updateAgentBlockFn(agent, blockUntil, { reason: blockReason });
    log(fmt.status('INFO', `Wrote checked AgentBlock for ${fmt.agent(agent)} (${DEFAULT_FALLBACK_HOURS}h block, ${blockResult.reason || blockReason})`));
  } catch (err) {
    log(fmt.status('WARN', `Could not persist blocklist entry for ${fmt.agent(agent)}: ${(err as any).message}`));
  }
}


/** Recognized agent-pool exhaustion signals (real selectAgent and test mocks). */
function isAgentPoolExhaustionError(err: unknown): boolean {
  const message = (err as any)?.message || '';
  return message.includes('exhausted') || message.includes('No agents available');
}

type StartAgentLoopDeps = {
  step: string;
  opts: StartAgentOptions;
  exclude: string[] | Set<string>;
  pinnedAgent: boolean;
  agentOverride: string | undefined;
  log: Function;
  selectAgentFn: Function;
  isAgentBlockedFn: Function;
  assertAgentSupportedFn: Function;
  resolveAgentModelFn: Function;
  detectLimitHitFn: Function;
  updateAgentBlockFn: Function;
  launchAgentFn: Function | null;
  onLaunch: Function | undefined;
  onLimitHit: Function | undefined;
  sessionMarkerPort: SessionMarkerPort | undefined;
  worktree: string | undefined;
  slug: string | null;
  role: string | null;
  env: Record<string, string>;
  noOutputWatchdog: { initialDelayMs?: number; intervalMs?: number; maxNoOutputMs?: number } | boolean;
  unrefChild: boolean;
  allowUnsandboxedMutation: boolean;
  refuseFallbackWhenPinned: (_detail: string) => void;
};

/** Mutable state walked by the one launch loop: selection, tried/launched sets, per-agent failures. */
type StartAgentLoopState = {
  chosen: string | undefined;
  tried: Set<string>;
  launched: Set<string>;
  agentErrors: Map<any, any>;
  iteration: number;
};

type PreparedLaunch = {
  launcher: Function;
  agentEnv: Record<string, string>;
  resume: boolean;
  sessionId: string | null;
  launchSessionMarkerPort: SessionMarkerPort | undefined;
  sessionRole: SessionRole | null;
  actualPrompt: string;
  model: string | null;
  watchdogConfig: ReturnType<typeof resolveNoOutputWatchdogConfig>;
  customReservation: { release: () => void; bindChild: (_pid?: number) => void } | null;
  effectiveProfile: ReturnType<typeof resolveSandboxProfile> | null;
  nativeSandbox: boolean;
};

/**
 * Pick the agent for the next attempt and gate it: selection with the
 * single-family escape hatch, the pre-launch blocklist reroute, and the
 * launcher-availability reroute. Returns true when the loop continues with a
 * fresh selection.
 */
async function selectAndGateAgent(state: StartAgentLoopState, deps: StartAgentLoopDeps): Promise<boolean> {
  if (!state.chosen) {
    try {
      state.chosen = deps.selectAgentFn(deps.step, { exclude: state.tried, worktree: deps.worktree });
    } catch (err) {
      // Only catch pool exhaustion errors from selectAgent.
      // Configuration errors (no eligible agents, no working launcher) must
      // propagate unchanged to preserve diagnostics (SC 3).
      if (!isAgentPoolExhaustionError(err)) {
        throw err;
      }
      // Pool exhausted — try excluded agents as last resort before throwing.
      // This restores the single-family escape hatch: when no different-family
      // reviewer is available, the implementer reviews its own work.
      const excludeList = deps.exclude instanceof Set ? [...deps.exclude] : deps.exclude;
      const fallbackAgent = excludeList.find((a: string) => !state.launched.has(a));
      if (fallbackAgent !== undefined) {
        state.chosen = fallbackAgent;
        return true;
      }
      // No excluded agent available either; build clear exhaustion diagnostics (SC 3)
      throw agentPoolExhaustedError(deps.step, state.launched, state.agentErrors);
    }
  } else if (await deps.isAgentBlockedFn(state.chosen)) {
    deps.refuseFallbackWhenPinned('currently blocked by the block authority');
    // Pre-launch blocklist gate. An explicit `agent:` override (e.g. a pinned
    // reviewer/implementer carried over from the mission's Review) bypasses
    // selectAgent's blocklist filter. Without this check, a known-blocked
    // family is relaunched immediately and the harness wastes a retry hitting
    // the same limit. Reroute through normal selection on the next iteration.
    deps.log(fmt.status('WARN', `Pinned agent "${fmt.agent(state.chosen)}" is currently blocked; rerouting via selectAgent for step "${deps.step}".`));
    state.tried.add(state.chosen);
    state.chosen = undefined;
    return true;
  }
  try {
    deps.assertAgentSupportedFn(state.chosen || '', deps.worktree);
  } catch (err) {
    /** @type {Error & {code?: string}} */
    const e = (err as any);
    if (e.code !== 'LAUNCHER_UNAVAILABLE') {
      throw err;
    }
    deps.refuseFallbackWhenPinned(e.message || 'launcher unavailable');
    deps.log(fmt.status('WARN', (err as any).message));
    // Only reroute for launcher-availability failures (missing or probe-failed).
    // A pinned agent already threw above, so every remaining caller reroutes
    // through normal selection on the next iteration.
    state.tried.add(state.chosen || '');
    state.chosen = undefined;
    return true;
  }
  return false;
}

/**
 * Resolve everything the launch needs: launcher (custom runners included),
 * session resume, prompt and model, and the custom-capacity reservation.
 * Waits for custom capacity before returning a launch reservation.
 */
async function prepareLaunch(state: StartAgentLoopState, deps: StartAgentLoopDeps): Promise<PreparedLaunch | null> {
  const { step, log, opts, worktree, slug, role } = deps;
  const chosen = state.chosen || '';
  state.tried.add(chosen);
  state.launched.add(chosen);

  // For custom agent, resolve the actual launcher based on configuration.
  // resolveCustomRunner/resolveCustomLauncher default to process.cwd()
  // when worktree is undefined, so this must not be gated behind worktree
  // truthiness (LAUNCHERS has no "custom" key, so skipping this branch
  // silently drops the launcher to undefined and later crashes the launch).
  let launcher = LAUNCHERS[state.chosen || ''];
  let customRunner: string | undefined;
  if (state.chosen === 'custom') {
    launcher = resolveCustomLauncher(worktree as string);
    customRunner = resolveCustomRunner(worktree as string);
  }
  if (deps.launchAgentFn) {
    launcher = deps.launchAgentFn;
  }
  // The pi runner loads its SDK lazily inside the launcher, and that dynamic
  // import blocks the event loop synchronously for ~1 s on a cold host.
  // Warm the cache here, in the non-deadline prepare phase, so the
  // launch-confirmed boundary and its lifecycle persistence deadline never
  // inherit that cost (TASK-2582 agent-smoke). Skipped for injected
  // launchers (test doubles) to keep them hermetic.
  if (customRunner === 'pi' && !deps.launchAgentFn) {
    await warmPiSdk();
  }
  log(fmt.status('INFO', `Selected agent for step "${step}": ${fmt.agent(chosen, chosen, customRunner)}${state.iteration > 1 ? ` (attempt ${state.iteration})` : ''}`));

  // Enforce the agent family as the Forgejo identity (ADR 0029 / architecture migration).
  // FORGEJO_USER is set last so the harness-selected identity always wins;
  // a caller-supplied env.FORGEJO_USER cannot override it.
  const agentEnv = { ...deps.env, FORGEJO_USER: chosen };

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
    launchSessionMarkerPort = deps.sessionMarkerPort || await defaultSessionMarkerPort(worktree);
    resume = RESUME_CAPABLE.has(chosen) &&
      await launchSessionMarkerPort.shouldResume(
        sessionMissionId(slug),
        sessionRole,
        sessionAgentFamily(chosen),
      );
    const marker = await launchSessionMarkerPort.find(sessionMissionId(slug), sessionRole);
    sessionId = marker?.sessionId ?? null;
  }
  if (slug && role) {
    if (resume) {
      log(fmt.status('INFO', `Resuming ${fmt.agent(chosen)} session for ${fmt.slug(slug)} (${role}).${sessionId ? ` Session: ${sessionId}` : ''}`));
    } else if (RESUME_CAPABLE.has(chosen)) {
      log(fmt.status('INFO', `No prior ${fmt.agent(chosen)} session for ${fmt.slug(slug)} (${role}); launching fresh.`));
    }
  }

  // Resolve the prompt string. If a function was provided, call it with the
  // currently chosen agent name (architecture migration). This ensures that if startAgent
  // falls back to a different family after a limit hit, the fallback agent
  // receives a prompt tailored to its own identity.
  let actualPrompt = typeof opts.prompt === 'function' ? opts.prompt(chosen) : opts.prompt;
  if (process.env.PARALLIX_CLI_COMMAND) {
    const cli = "'" + process.env.PARALLIX_CLI_COMMAND.replaceAll("'", "'\\''") + "'";
    actualPrompt = actualPrompt.replace(/\bpx (?=[a-z-])/g, `${cli} `);
  }

  // Resolve the per-family model override (adapters.agents.models[chosen]).
  // null when the family is not configured, in which case the launcher omits
  // the model flag entirely and the agent uses its own default.
  const model = deps.resolveAgentModelFn(chosen, worktree || process.cwd());
  if (model) {
    log(fmt.status('INFO', `Using configured model for ${fmt.agent(chosen)}: ${model}`));
  }

  const watchdogConfig = resolveNoOutputWatchdogConfig(deps.noOutputWatchdog, step);

  // This is the sole production policy decision. The AsyncLocalStorage
  // context reaches the shared process seam through every family launcher.
  const sandboxProfile = worktree
    ? resolveSandboxProfile(step, worktree, step === 'review' ? resolveReviewArtifactDir(worktree) : null, state.chosen || null)
    : null;
  // Task-2513: a mutating launch must never silently fall back to
  // unsandboxed execution. Read-only (review) profiles skip the gate and
  // keep their existing confinement path untouched. When Bubblewrap is
  // missing (not merely disabled via the pre-existing PARALLIX_NO_BUBBLEWRAP
  // opt-out), select the family's native sandbox where supported, require
  // explicit operator consent to run unsandboxed, otherwise block.
  let effectiveProfile = sandboxProfile;
  // When native sandbox is selected, tell the launcher to enable the
  // family's own sandbox (qwen `-s`, codex already defaults to it). Other
  // families ignore the flag and rely on Bubblewrap, which is present here.
  let nativeSandbox = false;
  if (sandboxProfile?.worktreeWritable) {
    const bubblewrapMissing = !isBubblewrapDisabled() && !isBubblewrapAvailable(); // opt-out lives in process.env, as at the spawn seam
    if (bubblewrapMissing) {
      const confinement = selectConfinement({
        mutating: true,
        bubblewrapAvailable: false,
        nativeSandboxSupported: supportsNativeSandbox(state.chosen || null),
        operatorConsent: deps.allowUnsandboxedMutation
      });
      if (confinement === 'blocked') {
        throw new ConfinementBlockedError(
          state.chosen || 'mutating agent',
          'bubblewrap unavailable with no native-sandbox fallback and no consent'
        );
      }
      nativeSandbox = confinement === 'native-sandbox';
      // The only unsandboxed outcome is explicit operator consent. Warn here,
      // not in the availability probe, so native-sandbox (confined) and
      // blocked launches do not emit a false "unsandboxed" alarm.
      if (confinement === 'unsandboxed-consented') {
        fmt.log.warn(
          `bubblewrap (${BUBBLEWRAP_COMMAND}) not found or not executable and ${state.chosen || 'the agent'} has no supported native sandbox; the agent is running UNSANDBOXED with full filesystem access (operator consented).`
        );
      }
      // native-sandbox or consented: skip Bubblewrap so the launcher's own
      // sandbox (where supported) is the fallback defense.
      effectiveProfile = null;
    }
  }

  const customReservation = chosen === 'custom'
    ? await waitForCustomCapacity(worktree, () => {
      log(fmt.status('INFO', 'Custom-agent capacity is saturated; waiting for an available slot.'));
    })
    : null;
  return { launcher, agentEnv, resume, sessionId, launchSessionMarkerPort, sessionRole, actualPrompt, model, watchdogConfig, customReservation, effectiveProfile, nativeSandbox };
}

/**
 * Stop an already-spawned agent child after a launch callback rejects.
 * SIGTERM first, then SIGKILL escalation once the grace poll runs out. A
 * Bubblewrap-wrapped agent dies with its wrapper (--die-with-parent), so
 * signalling the direct child covers both wrapped and unwrapped launches.
 */
async function stopLaunchedChild(child: { pid?: number } | null): Promise<void> {
  const pid = child?.pid;
  if (typeof pid !== 'number') { return; }
  const isAlive = (): boolean => {
    try { process.kill(pid, 0); return true; }
    catch (err) { return (err as NodeJS.ErrnoException).code === 'EPERM'; }
  };
  if (!isAlive()) { return; }
  try { process.kill(pid, 'SIGTERM'); } catch { return; }
  for (let attempt = 0; attempt < 40 && isAlive(); attempt += 1) {
    await new Promise((resolve) => { setTimeout(resolve, 50); });
  }
  if (isAlive()) {
    try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
  }
}

/** Run the launcher, announce the invocation, and await the result. */
async function launchPrepared(prepared: PreparedLaunch, deps: StartAgentLoopDeps, chosen: string): Promise<{ invocation: any; result: any }> {
  const { step, log, slug, unrefChild } = deps;
  const { launcher, agentEnv, resume, sessionId, model, watchdogConfig, customReservation, effectiveProfile, nativeSandbox, launchSessionMarkerPort, sessionRole, actualPrompt } = prepared;
  let invocation;
  let result;
  let launchedChild: { pid?: number } | null = null;
  // The lifecycle persistence deadline (TASK-2582 SC8) is measured from
  // destination-work start to successful persistence. Destination work starts
  // when the agent's child process actually spawns, so the clock begins at the
  // real spawn (onSpawn), not before the launcher: pre-spawn launch prep is
  // environment-dependent and must not count against the persistence budget
  // (e.g. the custom family's synchronous CLI feature-detect, which shells out
  // to the agent's own binary and can take hundreds of ms on a loaded host).
  // The pre-launcher instant is the fallback for launchers that never report a
  // spawn, keeping the deadline conservative there rather than resetting it at
  // onLaunch.
  let startedAtMs = monotonicNowMs();
  try {
    const launchResult = withSandboxProfile(effectiveProfile, () => launcher({
      prompt: actualPrompt,
      worktree: deps.worktree,
      env: agentEnv,
      resume,
      sessionId,
      model,
      sandbox: nativeSandbox,
      slug,
      role: sessionRole,
      sessionMarkerPort: launchSessionMarkerPort,
      teeOptions: {
        onSpawn: (child: {pid?: number}) => {
          // The child is spawned now: destination work has started, so the
          // lifecycle persistence deadline starts here (not pre-spawn).
          startedAtMs = monotonicNowMs();
          launchedChild = child;
          customReservation?.bindChild(child.pid);
        },
        ...(unrefChild ? { unrefChild: true } : {}),
        ...(watchdogConfig
          ? {
              noOutputWatchdog: {
                ...watchdogConfig,
                onNoOutput: (evt: {pid: number, elapsedMs: number, sawOutput?: boolean, msSinceLastOutput?: number | null}) => {
                  // The watchdog keeps ticking after the agent's first output,
                  // so on a healthy run it announced "Still waiting ... last
                  // visible output 0s ago" while the agent was visibly
                  // streaming. Only speak up when the stream has actually
                  // gone quiet; a live agent is its own progress report.
                  if (evt.sawOutput && (evt.msSinceLastOutput ?? 0) < QUIET_STREAM_REPORT_MS) { return; }
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
                    `${evt.sawOutput ? 'Still waiting on' : 'No output yet from'} ${fmt.agent(chosen)} for step "${step}" after ${formatElapsed(evt.elapsedMs)} ` +
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
    // The spawned child's pid rides on the invocation so a launch callback
    // (and its diagnostics) can name the process it confirmed.
    // TypeScript's synchronous control-flow analysis cannot see the callback
    // assignment above, even though spawnAndTee invokes it before returning.
    const launchedPid = (launchedChild as { pid?: number } | null)?.pid;
    if (invocation && typeof launchedPid === 'number') {
      invocation.childPid = launchedPid;
    }
    if (invocation) {
      // The prompt is one of the args and runs to hundreds of lines. Echoing it
      // buries the launch line (and the rest of the run) in harness text nobody
      // reads, so summarize it by default and keep the verbatim command on DEBUG.
      const echoedArgs = invocation.args
        .map((arg: string) => (!process.env.DEBUG && String(arg).includes('\n') ? `<prompt: ${String(arg).length} chars>` : arg))
        .join(' ');
      log(fmt.status('INFO', `Launching: ${fmt.command(`${invocation.command} ${echoedArgs}`)}`));
      if (invocation.options && invocation.options.cwd) {
        log(fmt.status('INFO', `Working directory: ${fmt.path(invocation.options.cwd)}`));
      }
    }

    if (deps.onLaunch) {
      try {
        await deps.onLaunch({ agent: chosen, invocation, startedAtMs });
      } catch (err) {
        // A rejecting launch callback (a refused authoritative boundary, a
        // failed current-work publication) must not leave the already-spawned
        // agent running: stop it, then propagate the failure (TASK-2582 F4).
        await stopLaunchedChild(launchedChild);
        throw err;
      }
    }

    result = resultPromise ? await resultPromise : launchResult.result;
  } finally {
    customReservation?.release();
  }
  return { invocation, result };
}

type LaunchVerdict = { kind: 'continue' } | { kind: 'return'; invocation: any; result: any };

/**
 * Classify the launch outcome: limit hits (reroute or block), launcher
 * spawn failures, and launch failures (reroute, or return for the caller to
 * report when pinned). Returns kind 'return' when the loop ends.
 */
async function classifyLaunchOutcome(state: StartAgentLoopState, deps: StartAgentLoopDeps, chosen: string, invocation: any, result: any): Promise<LaunchVerdict> {
  const { log } = deps;
  if (result?.error?.code === 'NO_OUTPUT_TIMEOUT') {
    deps.refuseFallbackWhenPinned('reviewer produced no output before configured liveness deadline');
    log(fmt.status('WARN', `No output from ${fmt.agent(chosen)} before the configured liveness deadline; rerouting without block.`));
    state.agentErrors.set(chosen, { exitInfo: 'stalled', stderr: result.stderr, stdout: result.stdout });
    state.tried.add(chosen);
    state.launched.add(chosen);
    state.chosen = undefined;
    return { kind: 'continue' };
  }
  // Pass exit metadata so detectLimitHit only treats matching transcript text
  // as a real limit hit when the launcher actually failed. A successful run
  // (status === 0) that happens to contain limit-hit phrases — for example,
  // an agent reviewing code or logs that quote those phrases — must not block
  // the healthy agent.
  const limitHit = deps.detectLimitHitFn({
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
      const label = limitHit.kind === 'entitlement' ? 'Model entitlement failure' : 'Transient limit';
      const action = limitHit.kind === 'entitlement'
        ? `Check the configured Qwen model and account entitlement, then retry.`
        : 'Rerouting without block.';
      log(fmt.status('WARN', `${label} for ${fmt.agent(chosen)}; ${limitHit.reason}. ${action}`));
      state.tried.add(chosen);
      state.chosen = undefined;
      return { kind: 'continue' };
    }

    log(fmt.status('WARN', `Limit hit detected for ${fmt.agent(chosen)}; reset estimate "${limitHit.until}" (${limitHit.source}). Blocking and retrying.`));
    try {
      const blockResult = await deps.updateAgentBlockFn(chosen, limitHit.until, { reason: limitHit.reason });
      log(fmt.status('INFO', `Wrote checked AgentBlock for ${fmt.agent(chosen)} (${blockResult.reason || 'limit'})`));
    } catch (err) {
      log(fmt.status('WARN', `Could not persist blocklist entry for ${fmt.agent(chosen)}: ${(err as any).message}`));
    }
    if (typeof deps.onLimitHit === 'function') {
      deps.onLimitHit({ agent: chosen, until: limitHit.until, source: limitHit.source });
    }
    deps.refuseFallbackWhenPinned(`usage limit hit; blocked until ${limitHit.until}`);
    // A pinned agent fails loudly above; everything else reselects next round.
    state.chosen = undefined;
    return { kind: 'continue' };
  }

  // Reroute if the launcher binary could not be started (ENOENT = not found, EACCES = not executable).
  if (result && result.error && (result.error.code === 'ENOENT' || result.error.code === 'EACCES')) {
    deps.refuseFallbackWhenPinned(`launcher could not be started (${result.error.code})`);
    log(fmt.status('WARN', `Launcher for "${chosen}" could not be started (${result.error.code}); rerouting.`));
    state.tried.add(chosen);
    state.chosen = undefined;
    return { kind: 'continue' };
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
    if (needsCredentialRefresh(result)) {
      log(fmt.status('WARN', `Agent ${fmt.agent(chosen)} credentials need refreshing; re-authenticate the ${chosen} launcher before retrying.`));
    }
    // Pinned work has no next eligible agent: hand the failed result back so
    // the caller reports the owner's own exit status (TASK-2294.01).
    if (deps.pinnedAgent && deps.agentOverride) {
      log(fmt.status('WARN', `Pinned agent ${fmt.agent(chosen)} failed to complete (${exitInfo}${stderrSnippet}); no fallback is permitted for this step.`));
      return { kind: 'return', invocation, result };
    }
    log(fmt.status('WARN', `Agent ${fmt.agent(chosen)} failed to complete (${exitInfo}${stderrSnippet}); retrying with next eligible agent.`));
    state.agentErrors.set(chosen, {
      exitInfo,
      stderr: result.stderr,
      stdout: result.stdout,
      signal: result.signal,
      status: result.status,
    });
    state.tried.add(chosen);
    state.launched.add(chosen);
    // Block retry candidates only on a positive availability/quota
    // classification (task-2536). Deterministic setup/config errors and every
    // ambiguous non-zero exit fall through to the next family without
    // poisoning agents.local.json. This is the second of two block-persistence
    // sites; both now agree on one bar via shouldPersistLaunchFailureBlock.
    //
    // NOTE (task-2536 round-1 F2): under default wiring this branch is
    // unreachable — startAgent's site-1 limit-hit check (L653) uses the same
    // detectLimitHit classifier this helper calls, so a positive availability/
    // quota classification is caught and persisted at site 1 first, and this
    // helper only runs after a falsy site-1 result. It is retained solely as
    // defence-in-depth for callers that inject a non-default detectLimitHitFn;
    // do not read it as a live production block path.
    await persistLaunchFailureBlock(chosen, result, deps.updateAgentBlockFn, log);
    state.chosen = undefined;
    return { kind: 'continue' };
  }
  return { kind: 'return', invocation, result };
}

/**
 * Record the session marker so a subsequent same-(slug, role) launch knows
 * which family last ran here. Only persisted when the run exited cleanly
 * (status 0 and no spawn error); a failed launch must not overwrite the
 * canonical session marker with a stale transcript.
 */
async function recordSessionMarker(deps: StartAgentLoopDeps, prepared: PreparedLaunch, chosen: string, result: any): Promise<void> {
  const { worktree, slug, role } = deps;
  if (!(worktree && slug && role && result && result.status === 0 && !result.error)) { return; }
  const launchSessionId = result && result.sessionId ? result.sessionId : null;
  if (!prepared.launchSessionMarkerPort || !prepared.sessionRole) {
    throw new Error('SessionMarkerPort and canonical role are required');
  }
  try {
    await prepared.launchSessionMarkerPort.save({
      missionId: sessionMissionId(slug),
      role: prepared.sessionRole,
      agent: sessionAgentFamily(chosen),
      lastLaunched: new Date().toISOString(),
      sessionId: launchSessionId,
    });
  } catch (err) {
    // Diagnostic: log full error details and database state
    if (process.env.PARALLIX_DEBUG_SQL) {
      const { getOperatorStateCacheSize } = await import('../sqlite/adapter-factory.js');
      const e = err as Error & { code?: string };
      process.stderr.write(`[sql-error] save failed: code=${e.code ?? 'n/a'} message="${e.message}\n`);
      process.stderr.write(`[sql-error] cacheSize=${getOperatorStateCacheSize()} pid=${process.pid}\n`);
      process.stderr.write(`[sql-error] stack:\n${e.stack ?? 'n/a'}\n`);
    }
    throw new Error(`Could not persist session marker for ${slug} (${role}): ${(err as Error).message}`);
  }
}

async function startAgent(step: string, opts: StartAgentOptions = { prompt: '' }) {
  const {
    agent: agentOverride,
    exclude = [],
    detectLimitHitFn = detectLimitHit,
    updateAgentBlockFn = updateAgentBlockChecked,
    selectAgentFn = selectAgent,
    resolveAgentModelFn = resolveAgentModel,
    isAgentBlockedFn = defaultIsAgentBlockedNow,
    sessionMarkerPort,
    log = fmt.log.plain,
    pinnedAgent = false,
  } = opts;

  // `exclude` seeds the tried-set so callers can reserve agents (e.g. exclude
  // the current implementer from reviewer fallback to preserve family separation).
  const excludeIterable = exclude instanceof Set ? exclude : exclude;
  // Track per-agent failure details for accurate exhaustion diagnostics (SC 3)
  const agentErrors = new Map();
  // Track agents actually launched (not just pre-excluded) for accurate reporting
  const state: StartAgentLoopState = {
    tried: new Set(excludeIterable),
    launched: new Set(),
    agentErrors,
    chosen: agentOverride,
    iteration: 0,
  };

  // Single explicit-fail branch for pinned work (TASK-2294.01). Every reroute
  // point below calls it before clearing `chosen`, so a pinned agent never
  // reaches `selectAgent` and the caller sees why the owner could not run.
  const refuseFallbackWhenPinned = (detail: string) => {
    if (pinnedAgent && agentOverride) {
      throw new PinnedAgentUnavailableError(agentOverride, detail);
    }
  };

  const deps: StartAgentLoopDeps = {
    step,
    opts,
    exclude: excludeIterable,
    pinnedAgent,
    agentOverride,
    log,
    selectAgentFn,
    isAgentBlockedFn,
    assertAgentSupportedFn: opts.assertAgentSupportedFn ?? assertAgentSupported,
    resolveAgentModelFn,
    detectLimitHitFn,
    updateAgentBlockFn,
    launchAgentFn: opts.launchAgentFn ?? workflowLaunchPort,
    onLaunch: opts.onLaunch,
    onLimitHit: opts.onLimitHit,
    sessionMarkerPort,
    worktree: opts.worktree,
    slug: opts.slug ?? null,
    role: opts.role ?? null,
    env: opts.env ?? {},
    noOutputWatchdog: opts.noOutputWatchdog ?? {},
    unrefChild: opts.unrefChild ?? false,
    allowUnsandboxedMutation: opts.allowUnsandboxedMutation ?? false,
    refuseFallbackWhenPinned,
  };

  while (true) {
    state.iteration += 1;
    if (await selectAndGateAgent(state, deps)) { continue; }
    const prepared = await prepareLaunch(state, deps);
    if (!prepared) { continue; }
    const chosen = state.chosen || '';
    const { invocation, result } = await launchPrepared(prepared, deps, chosen);
    const verdict = await classifyLaunchOutcome(state, deps, chosen, invocation, result);
    if (verdict.kind === 'continue') { continue; }
    await recordSessionMarker(deps, prepared, chosen, verdict.result);
    return { agent: chosen, invocation: verdict.invocation, result: verdict.result };
  }
}

// Legacy alias kept for backwards compatibility — draft.js calls this directly.
// Returns { agent, invocation, result } so callers can log which agent ran.
async function startDraftAgent(opts: StartAgentOptions = { prompt: '' }) {
  return startAgent('draft', opts);
}

export {
  KNOWN_AGENT_NAMES,
  formatElapsed,
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
  setWorkflowLaunchPort,
  setLauncherHealthProbe,
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
