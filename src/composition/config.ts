import path from 'node:path';
import type { ParallixConfiguration } from '../application/ports/configuration.js';

type Source = Readonly<Record<string, string | undefined>>;

/** Finite non-negative number, or null when unset, empty or invalid. */
function milliseconds(value: string | undefined): number | null {
  if (value === undefined || value === '') { return null; }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/** Positive integer, or null when unset or invalid (callers apply their default). */
function positiveInteger(value: string | undefined): number | null {
  const parsed = value ? parseInt(value, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** Opt-out switch: any non-empty value other than `0`. */
function optOut(value: string | undefined): boolean {
  const trimmed = value?.trim();
  return Boolean(trimmed) && trimmed !== '0';
}

/**
 * The only place that interprets host environment variables. Callers supply
 * the source so production and tests share one contract without touching
 * global state.
 */
export function resolveConfiguration(source: Source): ParallixConfiguration {
  const e = (name: string): string | undefined => source[name];
  return Object.freeze({
    forgejo: Object.freeze({
      url: e('FORGEJO_URL'), repo: e('FORGEJO_REPO'), user: e('FORGEJO_USER'),
      authorizedApprover: e('FORGEJO_AUTHORIZED_APPROVER'), gatekeeperUser: e('FORGEJO_GATEKEEPER_USER'),
      home: e('FORGEJO_HOME'), token: e('FORGEJO_TOKEN'), tokenFile: e('FORGEJO_TOKEN_FILE'),
      unavailableForTests: e('PARALLIX_TEST_NO_FORGEJO') === '1',
      nodeTestContext: Boolean(e('NODE_TEST_CONTEXT')),
    }),
    storage: Object.freeze({
      parallixHome: e('PARALLIX_HOME'), localAppData: e('LOCALAPPDATA'),
      homeDirectory: e('HOME'), debugSql: e('PARALLIX_DEBUG_SQL'),
      xdgDataHome: e('XDG_DATA_HOME'), xdgConfigHome: e('XDG_CONFIG_HOME'), xdgCacheHome: e('XDG_CACHE_HOME'),
    }),
    agents: Object.freeze({
      override: e('WORKFLOW_AGENT'),
      watchdogEnabled: e('WORKFLOW_AGENT_NO_OUTPUT_WATCHDOG') !== '0',
      noOutputInitialMs: milliseconds(e('WORKFLOW_AGENT_NO_OUTPUT_INITIAL_MS')),
      noOutputIntervalMs: milliseconds(e('WORKFLOW_AGENT_NO_OUTPUT_INTERVAL_MS')),
      draftNoOutputInitialMs: milliseconds(e('WORKFLOW_DRAFT_AGENT_NO_OUTPUT_INITIAL_MS')),
      draftNoOutputIntervalMs: milliseconds(e('WORKFLOW_DRAFT_AGENT_NO_OUTPUT_INTERVAL_MS')),
      reviewNoOutputMaxMs: milliseconds(e('WORKFLOW_REVIEW_AGENT_NO_OUTPUT_MAX_MS')),
      opencodeBin: e('OPENCODE_BIN'), piBin: e('PI_BIN'), nvmBin: e('NVM_BIN'),
      graphifyBin: e('GRAPHIFY_BIN'), codexHome: e('CODEX_HOME'),
      searchPath: e('PATH') ?? '', cliCommand: e('PARALLIX_CLI_COMMAND'),
      keepTempArtifacts: e('PARALLIX_KEEP_TEMP_ARTIFACTS') === '1',
      bubblewrapDisabled: optOut(e('PARALLIX_NO_BUBBLEWRAP')),
      claudeRawStream: e('PARALLIX_CLAUDE_RAW_STREAM') !== undefined && e('PARALLIX_CLAUDE_RAW_STREAM') !== '' && e('PARALLIX_CLAUDE_RAW_STREAM') !== '0',
    }),
    terminal: Object.freeze({
      hostEnvironment: Object.freeze(Object.fromEntries([
        'PATH', 'HOME', 'TERM', 'SHELL', 'LANG', 'USER', 'LOGNAME', 'PARALLIX_HOME', 'XDG_CONFIG_HOME', 'XDG_STATE_HOME', 'XDG_DATA_HOME',
      ].map(name => [name, e(name)]))),
      missionTerminal: e('PARALLIX_MISSION_TERMINAL'), missionSocket: e('PARALLIX_MISSION_SOCKET'),
      tmux: e('TMUX'),
      stateDir: e('PARALLIX_TERMINAL_STATE_DIR') ? path.resolve(e('PARALLIX_TERMINAL_STATE_DIR')!) : undefined,
      runtimeDir: e('XDG_RUNTIME_DIR'), xdgDataHome: e('XDG_DATA_HOME'),
    }),
    decision: Object.freeze({
      provider: e('JEV_CODE_PROVIDER')?.trim(), baseUrl: e('TYPESAFE_BASE_URL')?.trim(),
      apiKeys: Object.freeze({
        TYPESAFE_API_KEY: e('TYPESAFE_API_KEY')?.trim(),
        OPENROUTER_API_KEY: e('OPENROUTER_API_KEY')?.trim(),
        AI_GATEWAY_API_KEY: e('AI_GATEWAY_API_KEY')?.trim(),
      }),
      timeoutMs: e('JEV_CODE_TIMEOUT_MS')?.trim(), model: e('TYPESAFE_DEFAULT_MODEL')?.trim(),
      reviewMode: e('PARALLIX_JEV_REVIEW')?.trim().toLowerCase(),
    }),
    runtime: Object.freeze({
      gitIdentity: resolveGitIdentity(source),
      ci: Boolean(e('CI')), noTui: e('PARALLIX_NO_TUI') === '1', debug: Boolean(e('DEBUG')),
      noColor: e('NO_COLOR'), forceColor: e('FORCE_COLOR'), term: e('TERM'),
      integrationGateBypass: e('PARALLIX_TEST_ALLOW_INTEGRATION_GATE_BYPASS') === '1',
      credentialRedactor: e('PARALLIX_CREDENTIAL_REDACTOR'), verifyArea: e('VERIFY_AREA'),
      primaryWorktree: e('PRIMARY_WORKTREE'), missionYearOverride: e('MISSION_YEAR_OVERRIDE'),
      tmpDir: e('WORKFLOW_TMP_DIR'),
      reviewPollIntervalMs: positiveInteger(e('AUTONOMOUS_REVIEW_POLL_INTERVAL_MS')),
      reviewPollTimeoutMs: positiveInteger(e('AUTONOMOUS_REVIEW_POLL_TIMEOUT_MS')),
    }),
    setup: Object.freeze({
      nonInteractive: e('WORKFLOW_SETUP_NON_INTERACTIVE'), productName: e('WORKFLOW_SETUP_PRODUCT_NAME'),
      reviewProvider: e('WORKFLOW_SETUP_REVIEW_PROVIDER'), ownerLogin: e('WORKFLOW_SETUP_OWNER_LOGIN'),
      forgejoUrl: e('WORKFLOW_SETUP_FORGEJO_URL'), forgejoRepo: e('WORKFLOW_SETUP_FORGEJO_REPO'),
      agentUsers: e('WORKFLOW_SETUP_AGENT_USERS'), ownerPassword: e('WORKFLOW_SETUP_OWNER_PASSWORD'),
      agentPassword: e('WORKFLOW_SETUP_AGENT_PASSWORD'), reviewRemote: e('WORKFLOW_SETUP_REVIEW_REMOTE'),
    }),
    forwardedEnvironment: source,
  });
}

/** Resolve from the live process environment; the single ambient read of the application. */
export function resolveProcessConfiguration(): ParallixConfiguration {
  return resolveConfiguration(process.env);
}

function resolveGitIdentity(source: Source) {
  const e = (name: string) => source[name];
  return Object.freeze({
        authorName: e('GIT_AUTHOR_NAME') || 'Workflow Setup', authorEmail: e('GIT_AUTHOR_EMAIL') || 'workflow@example.invalid',
        committerName: e('GIT_COMMITTER_NAME') || e('GIT_AUTHOR_NAME') || 'Workflow Setup',
        committerEmail: e('GIT_COMMITTER_EMAIL') || e('GIT_AUTHOR_EMAIL') || 'workflow@example.invalid',
  });
}
