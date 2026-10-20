import { reportAuthorizedProgress } from '../../application/ports/mission-write-authorization.js';
import * as fmt from "../../application/presentation/cli-format.js";
import { resolveReviewArtifactDir } from "../config/product-config.js";
import { RESUME_CAPABLE, LAUNCHERS, resolveNoOutputWatchdogConfig, resolveCustomLauncher } from "./launcher-selection.js";
import { resolveCustomRunner } from "../config/product-config.js";
import { filterBlockedFallback } from "./agent-block-selection.js";
import { resolveSandboxProfile } from "../process/bubblewrap.js";
import { selectConfinement, supportsNativeSandbox, ConfinementBlockedError, isBubblewrapDisabled, isBubblewrapAvailable, BUBBLEWRAP_COMMAND } from "../process/confinement.js";
import { tryAcquireCustomCapacity, waitForCustomCapacity } from "./custom-capacity.js";
import { FRESH_SESSION_MARKER_PORT } from "../../application/fresh-session-marker-port.js";
import type { SessionMarkerPort } from "../../application/domain-ports.js";
import type { SessionRole } from "../../domain/session.js";
import type { StartAgentLoopState, StartAgentLoopDeps, PreparedLaunch } from './agent-launch-context.js';
import { isAgentPoolExhaustionError, agentPoolExhaustedError } from './agent-launch-outcome.js';
import { normalizeSessionRole, defaultSessionMarkerPort, sessionMissionId, sessionAgentFamily } from './agent-launch-authority.js';


async function applyRecoveryPolicy(state: StartAgentLoopState, deps: StartAgentLoopDeps): Promise<void> {
  if (deps.step === 'act-on-review' && state.chosen) {
    const policy = await deps.runtimeBlockContext(deps.step, state.tried);
    if (!policy.eligible.includes(state.chosen)) {
      deps.refuseFallbackWhenPinned('excluded by active agent policy');
      state.chosen = undefined;
    }
  }
}

function recoveryFallback(candidates: string[], eligible: readonly string[], step: string): string[] {
  return step === 'act-on-review' ? candidates.filter(family => eligible.includes(family)) : candidates;
}

/**
 * Pick the agent for the next attempt and gate it: selection with the
 * single-family escape hatch, the pre-launch blocklist reroute, and the
 * launcher-availability reroute. Returns true when the loop continues with a
 * fresh selection.
 */
export async function selectAndGateAgent(state: StartAgentLoopState, deps: StartAgentLoopDeps): Promise<boolean> {
  await applyRecoveryPolicy(state, deps);
  if (!state.chosen) {
    // Exclude every family the runtime blocklist currently blocks so no launch
    // is ever attempted against a blocked family when another eligible family is
    // available (SC 2). Recomputed each reselect so blocks written mid-loop
    // (for example a limit hit on the previous attempt) take effect immediately.
    const blockedPool = await deps.runtimeBlockContext(deps.step, state.tried);
    const selectExclude = blockedPool.exclude;
    try {
      state.chosen = deps.selectAgentFn(deps.step, { exclude: selectExclude, worktree: deps.worktree, configuration: deps.configuration });
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
      // Last-resort escape hatch: a runtime-blocked family is never a valid
      // fallback, so filter it out before picking one (SC 2/SC 3).
      const fallbackCandidates = recoveryFallback(filterBlockedFallback(excludeList, blockedPool.blocked), blockedPool.eligible, deps.step);
      const fallbackAgent = fallbackCandidates.find((a: string) => !state.launched.has(a));
      if (fallbackAgent !== undefined) {
        state.chosen = fallbackAgent;
        return true;
      }
      // No excluded agent available either. Only name the runtime blocklist when
      // it covers every eligible family for the step and nothing launched or
      // failed yet (SC 3); otherwise keep the generic exhaustion diagnostic,
      // which carries the launched/agentErrors context (SC 3).
      if (blockedPool.allEligibleBlocked && state.launched.size === 0 && state.agentErrors.size === 0) {
        throw new Error(
          `All eligible agents for step "${deps.step}" are blocked by the runtime blocklist: ${blockedPool.blockedEligible.join(', ')}. No agent started.`
        );
      }
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
    deps.assertAgentSupportedFn(state.chosen || '', deps.worktree, deps.configuration);
  } catch (err) {
    /** @type {Error & {code?: string}} */
    const e = (err as Error & { code?: string });
    if (e.code !== 'LAUNCHER_UNAVAILABLE') {
      throw err;
    }
    deps.refuseFallbackWhenPinned(e.message || 'launcher unavailable');
    deps.log(fmt.status('WARN', (err as Error & { code?: string }).message));
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
async function resolveLaunchSession(deps: StartAgentLoopDeps, chosen: string) {
  const { opts, worktree, slug, role, log } = deps;
  let resume = false;
  let sessionId: string | null = null;
  let launchSessionMarkerPort: SessionMarkerPort | undefined;
  let sessionRole: SessionRole | null = null;
  if (worktree && slug && role) {
    sessionRole = normalizeSessionRole(role);
    launchSessionMarkerPort = opts.sessionPolicy === 'fresh-ephemeral'
      ? FRESH_SESSION_MARKER_PORT
      : deps.sessionMarkerPort || await defaultSessionMarkerPort(worktree, deps.configuration);
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

  return { resume, sessionId, launchSessionMarkerPort, sessionRole };
}

function launchConfinement(state: StartAgentLoopState, deps: StartAgentLoopDeps) {
  const { step, worktree } = deps;
  const sandboxProfile = worktree
    ? resolveSandboxProfile(step, worktree, step === 'review' ? resolveReviewArtifactDir(worktree) : null, state.chosen || null, deps.configuration)
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
    const bubblewrapMissing = !isBubblewrapDisabled(deps.configuration) && !isBubblewrapAvailable(); // opt-out lives in process.env, as at the spawn seam
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

  return { effectiveProfile, nativeSandbox };
}

export async function prepareLaunch(state: StartAgentLoopState, deps: StartAgentLoopDeps): Promise<PreparedLaunch | null> {
  const { step, log, opts, worktree } = deps;
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
  log(fmt.status('INFO', `Selected agent for step "${step}": ${fmt.agent(chosen, chosen, customRunner)}${state.iteration > 1 ? ` (attempt ${state.iteration})` : ''}`));

  // Enforce the agent family as the Forgejo identity (ADR 0029 / architecture migration).
  // FORGEJO_USER is set last so the harness-selected identity always wins;
  // a caller-supplied env.FORGEJO_USER cannot override it.
  const agentEnv = { ...deps.env, FORGEJO_USER: chosen };

  // Decide whether to resume the agent's prior session for this (slug, role).
  // Only honored when the caller passed slug+role+worktree AND the previous
  // marker matches the chosen agent family (a fallback to a different family
  // invalidates the prior session).
  const { resume, sessionId, launchSessionMarkerPort, sessionRole } = await resolveLaunchSession(deps, chosen);

  // Resolve the prompt string. If a function was provided, call it with the
  // currently chosen agent name (architecture migration). This ensures that if startAgent
  // falls back to a different family after a limit hit, the fallback agent
  // receives a prompt tailored to its own identity.
  let actualPrompt = typeof opts.prompt === 'function' ? await opts.prompt(chosen) : opts.prompt;
  if (deps.configuration.agents.cliCommand) {
    const cli = "'" + deps.configuration.agents.cliCommand.replaceAll("'", "'\\''") + "'";
    actualPrompt = actualPrompt.replace(/\bpx (?=[a-z-])/g, `${cli} `);
  }

  // Resolve the per-family model override (adapters.agents.models[chosen]).
  // null when the family is not configured, in which case the launcher omits
  // the model flag entirely and the agent uses its own default.
  const model = deps.resolveAgentModelFn(chosen, worktree || process.cwd());
  if (model) {
    log(fmt.status('INFO', `Using configured model for ${fmt.agent(chosen)}: ${model}`));
  }

  const watchdogConfig = resolveNoOutputWatchdogConfig(deps.noOutputWatchdog, step, deps.configuration);

  // This is the sole production policy decision. The AsyncLocalStorage
  // context reaches the shared process seam through every family launcher.
  const { effectiveProfile, nativeSandbox } = launchConfinement(state, deps);

  if (deps.configuration.runtime.workflowOperation) {
    Object.assign(agentEnv, { PARALLIX_WORKFLOW_OPERATION: deps.configuration.runtime.workflowOperation, PARALLIX_WORKFLOW_GENERATION: String(deps.configuration.runtime.workflowGeneration) });
  }
  const customReservation = chosen === 'custom'
    ? await waitForCustomCapacity(worktree, async () => {
      await reportAuthorizedProgress('waiting', 'waiting for provider capacity');
      log(fmt.status('INFO', 'Custom-agent capacity is saturated; waiting for an available slot.'));
    }, root => tryAcquireCustomCapacity(root, deps.configuration))
    : null;
  return { launcher, agentEnv, resume, sessionId, launchSessionMarkerPort, sessionRole, actualPrompt, model, watchdogConfig, customReservation, effectiveProfile, nativeSandbox };
}
