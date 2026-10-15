import { KNOWN_AGENT_NAMES, WORKFLOW_AGENT_NAMES, eligibleAgentsForStep, workflowLauncherStatus, setCommandPathProbe, setLauncherHealthProbe, resolveNoOutputWatchdogConfig } from './launcher-selection.js';
import { readAgentConfig, readAgentConfigOrExit, isAgentBlocked, parseBlockUntil, isInvalidAgentConfigError, updateAgentBlock, resolveBlocklistTargetPath } from './agent-config.js';
import { formatElapsed } from './agent-launch-process.js';
import { shouldPersistLaunchFailureBlock } from './agent-launch-outcome.js';
import type { AgentLauncher } from "./agent-process-types.js";
import { DEFAULT_CONFIGURATION } from "../../application/ports/configuration.js";
import * as fmt from "../../application/presentation/cli-format.js";
import { detectLimitHit } from "../../application/services/agent-limit.js";
import { resolveAgentModel } from "../config/product-config.js";
import { selectAgent, assertAgentSupported } from "./launcher-selection.js";
import { defaultBlockContext } from "./agent-block-selection.js";
import type { StartAgentOptions, AgentFailureDetails, StartAgentLoopState, StartAgentLoopDeps } from './agent-launch-context.js';
import { PinnedAgentUnavailableError } from './agent-launch-context.js';
import { updateAgentBlockChecked, defaultIsAgentBlockedNow, recordSessionMarker } from './agent-launch-authority.js';
import { selectAndGateAgent, prepareLaunch } from './agent-launch-preparation.js';
import { launchPrepared } from './agent-launch-process.js';
import { classifyLaunchOutcome } from './agent-launch-outcome.js';


// Process-wide composition seam for hosts which supply an in-process agent
// port. Production leaves this unset and keeps the concrete launcher default.
let workflowLaunchPort: AgentLauncher | null = null;


function setWorkflowLaunchPort(port: AgentLauncher | null): void {
  workflowLaunchPort = port;
}


function resolveLoopOptions(opts: StartAgentOptions) {
  const {
    agent: agentOverride,
    exclude = [],
    detectLimitHitFn = detectLimitHit,
    updateAgentBlockFn = (agent: string, until: string, options: { reason?: string } = {}) => updateAgentBlockChecked(agent, until, { ...options, configuration: opts.configuration }),
    selectAgentFn = selectAgent,
    resolveAgentModelFn = resolveAgentModel,
    isAgentBlockedFn = (agent: string) => defaultIsAgentBlockedNow(agent, opts.configuration),
    sessionMarkerPort,
    log = fmt.log.plain,
    pinnedAgent = false,
    runtimeBlockContextFn = (step, tried) => defaultBlockContext(step, tried, opts.configuration),
  } = opts;

  return { agentOverride, exclude, detectLimitHitFn, updateAgentBlockFn, selectAgentFn, resolveAgentModelFn, isAgentBlockedFn, sessionMarkerPort, log, pinnedAgent, runtimeBlockContextFn };
}

function launchRuntimeInputs(opts: StartAgentOptions): Pick<StartAgentLoopDeps, 'configuration' | 'worktree' | 'slug' | 'role' | 'env' | 'noOutputWatchdog' | 'unrefChild' | 'allowUnsandboxedMutation'> {
  return {
    configuration: opts.configuration ?? DEFAULT_CONFIGURATION,
    worktree: opts.worktree,
    slug: opts.slug ?? null,
    role: opts.role ?? null,
    env: opts.env ?? {},
    noOutputWatchdog: opts.noOutputWatchdog ?? {},
    unrefChild: opts.unrefChild ?? false,
    allowUnsandboxedMutation: opts.allowUnsandboxedMutation ?? false,
  };
}

async function startAgent(step: string, opts: StartAgentOptions = { prompt: '' }) {
  const { agentOverride, exclude, detectLimitHitFn, updateAgentBlockFn, selectAgentFn, resolveAgentModelFn, isAgentBlockedFn, sessionMarkerPort, log, pinnedAgent, runtimeBlockContextFn } = resolveLoopOptions(opts);
  // `exclude` seeds the tried-set so callers can reserve agents (e.g. exclude
  // the current implementer from reviewer fallback to preserve family separation).
  const excludeIterable = exclude instanceof Set ? exclude : exclude;
  // Track per-agent failure details for accurate exhaustion diagnostics (SC 3)
  const agentErrors = new Map<string, AgentFailureDetails>();
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
    ...launchRuntimeInputs(opts),
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
    refuseFallbackWhenPinned,
    runtimeBlockContext: runtimeBlockContextFn,
  };

  while (true) {
    state.iteration += 1;
    if (await selectAndGateAgent(state, deps)) { continue; }
    const prepared = await prepareLaunch(state, deps);
    if (!prepared) { continue; }
    const chosen = state.chosen || '';
    const { invocation, result } = await launchPrepared(prepared, deps, chosen, state.iteration);
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
