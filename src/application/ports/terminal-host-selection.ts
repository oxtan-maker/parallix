/**
 * Terminal selection for one mission command (TASK-2861.01).
 *
 * One owner decides whether a command inherits the live mission terminal,
 * hosts a new operation window, or runs through the pipe host. Foreground
 * hosting, workflow-executor hosting and standalone agent launches all ask it,
 * so the same configuration cannot select differently per caller. Provider and
 * input-contract restrictions are explicit inputs; the configured host and
 * `whenUnavailable` are resolved once by the configuration adapter.
 */

export type TerminalHostKind = 'auto' | 'pipe' | 'tmux';
export type TerminalUnavailablePolicy = 'fallback' | 'fail';

export interface TerminalHostConfig {
  readonly host: TerminalHostKind;
  readonly whenUnavailable: TerminalUnavailablePolicy;
}

/** What the terminal host reports about whether it can run. */
export interface TerminalHostAvailability {
  readonly available: boolean;
  readonly reason: string | null;
}

export interface TerminalHostSelectionInput {
  readonly config: TerminalHostConfig;
  /** The command already runs inside this mission's hosted terminal. */
  readonly inherited: boolean;
  /** The foreground caller has an interactive terminal to host; workflow executors are hosted for the retained console without one. */
  readonly interactive: boolean;
  /** Provider or input-contract reason this command cannot be hosted; read only when hosting is still possible. */
  readonly restriction?: () => string | null;
  /** The terminal host probe; read only when hosting is still possible. */
  readonly probe: () => TerminalHostAvailability;
}

export type TerminalHostSelection =
  /** Run inside the live mission terminal; host nothing. */
  | { readonly kind: 'inherited' }
  /** Host a new operation window. */
  | { readonly kind: 'hosted' }
  /**
   * Run through the pipe host. `reason` is set whenever hosting was wanted but
   * not used; `notify` is true when the operator explicitly requested tmux and
   * must be told, rather than the reason only being recorded.
   */
  | { readonly kind: 'pipe'; readonly reason: string | null; readonly notify: boolean }
  /** An explicit tmux request with `whenUnavailable: "fail"` that cannot be honoured. */
  | { readonly kind: 'refused'; readonly reason: string };

function unavailable(config: TerminalHostConfig, reason: string): TerminalHostSelection {
  return config.host === 'tmux' && config.whenUnavailable === 'fail'
    ? { kind: 'refused', reason }
    : { kind: 'pipe', reason, notify: config.host === 'tmux' };
}

/**
 * Choose the terminal for one command. An inherited terminal wins, then an
 * explicit pipe override and a missing interactive terminal, all before any
 * restriction or tmux probe runs.
 */
export function selectTerminalHost(input: TerminalHostSelectionInput): TerminalHostSelection {
  const { config } = input;
  if (input.inherited) { return { kind: 'inherited' }; }
  if (config.host === 'pipe' || !input.interactive) { return { kind: 'pipe', reason: null, notify: false }; }
  const restriction = input.restriction?.() ?? null;
  if (restriction) { return unavailable(config, restriction); }
  const probe = input.probe();
  return probe.available ? { kind: 'hosted' } : unavailable(config, probe.reason ?? 'tmux is not available');
}

/** What a hosted launch that failed to prepare or start becomes: a refusal, or the pipe host with its reason. */
export function selectionAfterLaunchFailure(config: TerminalHostConfig, reason: string): { readonly kind: 'pipe'; readonly reason: string; readonly notify: true } | { readonly kind: 'refused'; readonly reason: string } {
  return config.host === 'tmux' && config.whenUnavailable === 'fail'
    ? { kind: 'refused', reason }
    : { kind: 'pipe', reason, notify: true };
}
