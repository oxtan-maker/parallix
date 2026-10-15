import type { AgentProcessResult, AgentInvocation, AgentLauncher } from "./agent-process-types.js";
import type { ParallixConfiguration } from "../../application/ports/configuration.js";
import { detectLimitHit } from "../../application/services/agent-limit.js";
import { resolveAgentModel } from "../config/product-config.js";
import { selectAgent, assertAgentSupported, resolveNoOutputWatchdogConfig } from "./launcher-selection.js";
import { type BlockContext } from "./agent-block-selection.js";
import { resolveSandboxProfile } from "../process/bubblewrap.js";
import type { SessionMarkerPort } from "../../application/domain-ports.js";
import type { SessionLaunchPolicy, SessionRole } from "../../domain/session.js";


export interface LaunchResultLike {
  stdout?: string;
  stderr?: string;
  status?: number | null;
  signal?: string | null;
  error?: unknown;
}


export type AgentLog = (text: string) => unknown;

export type AgentBlockWriter = (agent: string, until: string, options?: { reason?: string }) => { reason?: string | null } | Promise<{ reason?: string | null }>;

export type AgentFailureDetails = Pick<AgentProcessResult, 'status' | 'signal' | 'stdout' | 'stderr'> & { exitInfo?: string };


export interface StartAgentOptions {
  configuration?: ParallixConfiguration;
  prompt: string | ((agent: string) => string | Promise<string>);
  worktree?: string;
  agent?: string;
  env?: {[key: string]: string};
  exclude?: string[] | Set<string>;
  onLimitHit?: (event: { agent: string; until: string; source?: string }) => unknown;
  onLaunch?: (event: { agent: string; invocation: AgentInvocation | null | undefined; startedAtMs: number }) => unknown | Promise<unknown>;
  slug?: string | null;
  role?: string | null;
  detectLimitHitFn?: typeof detectLimitHit;
  updateAgentBlockFn?: AgentBlockWriter;
  selectAgentFn?: typeof selectAgent;
  resolveAgentModelFn?: typeof resolveAgentModel;
  isAgentBlockedFn?: (agent: string) => boolean | Promise<boolean>;
  /** Checked application port for session markers (architecture migration cutover). */
  sessionMarkerPort?: SessionMarkerPort;
  /** Whether this launch may resume its normal session or requires fresh context. */
  sessionPolicy?: SessionLaunchPolicy;
  log?: AgentLog;
  noOutputWatchdog?: {initialDelayMs?: number, intervalMs?: number, maxNoOutputMs?: number} | boolean;
  launchAgentFn?: AgentLauncher;
  assertAgentSupportedFn?: typeof assertAgentSupported;
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
  /** Runtime-block context (exclude set, all-blocked flag, eligible/blocked sets); one provider keeps wiring minimal. */
  runtimeBlockContextFn?: (_step: string, _tried: ReadonlySet<string>) => Promise<BlockContext>;
}


export type StartAgentLoopDeps = {
  configuration: ParallixConfiguration;
  step: string;
  opts: StartAgentOptions;
  exclude: string[] | Set<string>;
  pinnedAgent: boolean;
  agentOverride: string | undefined;
  log: AgentLog;
  selectAgentFn: typeof selectAgent;
  isAgentBlockedFn: (agent: string) => boolean | Promise<boolean>;
  assertAgentSupportedFn: typeof assertAgentSupported;
  resolveAgentModelFn: typeof resolveAgentModel;
  detectLimitHitFn: typeof detectLimitHit;
  updateAgentBlockFn: AgentBlockWriter;
  launchAgentFn: AgentLauncher | null;
  onLaunch: StartAgentOptions['onLaunch'];
  onLimitHit: StartAgentOptions['onLimitHit'];
  sessionMarkerPort: SessionMarkerPort | undefined;
  worktree: string | undefined;
  slug: string | null;
  role: string | null;
  env: Record<string, string>;
  noOutputWatchdog: { initialDelayMs?: number; intervalMs?: number; maxNoOutputMs?: number } | boolean;
  unrefChild: boolean;
  allowUnsandboxedMutation: boolean;
  refuseFallbackWhenPinned: (_detail: string) => void;
  runtimeBlockContext: (_step: string, _tried: ReadonlySet<string>) => Promise<BlockContext>;
};


/** Mutable state walked by the one launch loop: selection, tried/launched sets, per-agent failures. */
export type StartAgentLoopState = {
  chosen: string | undefined;
  tried: Set<string>;
  launched: Set<string>;
  agentErrors: Map<string, AgentFailureDetails>;
  iteration: number;
};


export type PreparedLaunch = {
  launcher: AgentLauncher;
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


export type LaunchVerdict = { kind: 'continue' } | { kind: 'return'; invocation: AgentInvocation | null | undefined; result: AgentProcessResult };


/** Thrown when `pinnedAgent` is set and the pinned family cannot run the step. */
export class PinnedAgentUnavailableError extends Error {
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
