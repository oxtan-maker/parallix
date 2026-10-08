/**
 * Typed operator configuration resolved once at the composition root from the
 * host environment (`src/composition/config.ts`). Adapters and use cases take
 * the slice they need instead of interpreting `process.env` themselves.
 * `forwardedEnvironment` is the opaque host environment, for handing to child
 * processes only; nothing may interpret individual keys from it.
 */
export type OptionalString = string | undefined;

export interface ForgejoConfiguration {
  readonly url: OptionalString;
  readonly repo: OptionalString;
  readonly user: OptionalString;
  readonly authorizedApprover: OptionalString;
  readonly gatekeeperUser: OptionalString;
  readonly home: OptionalString;
  readonly token: OptionalString;
  readonly tokenFile: OptionalString;
  /** Test switch: report the provider as unreachable without probing it. */
  readonly unavailableForTests: boolean;
  /** True under the node test runner, where a missing Forgejo home must not leak the developer's. */
  readonly nodeTestContext: boolean;
}

export interface StorageConfiguration {
  readonly parallixHome: OptionalString;
  readonly localAppData: OptionalString;
  readonly homeDirectory: OptionalString;
  readonly debugSql: OptionalString;
}

export interface AgentConfiguration {
  readonly override: OptionalString;
  readonly watchdogEnabled: boolean;
  readonly noOutputInitialMs: number | null;
  readonly noOutputIntervalMs: number | null;
  readonly draftNoOutputInitialMs: number | null;
  readonly draftNoOutputIntervalMs: number | null;
  readonly reviewNoOutputMaxMs: number | null;
  readonly opencodeBin: OptionalString;
  readonly piBin: OptionalString;
  readonly nvmBin: OptionalString;
  readonly graphifyBin: OptionalString;
  readonly codexHome: OptionalString;
  readonly searchPath: string;
  readonly cliCommand: OptionalString;
  readonly keepTempArtifacts: boolean;
  readonly bubblewrapDisabled: boolean;
  readonly claudeRawStream: boolean;
}

export interface TerminalConfiguration {
  readonly missionTerminal: OptionalString;
  readonly missionSocket: OptionalString;
  readonly tmux: OptionalString;
  readonly stateDir: OptionalString;
  readonly runtimeDir: OptionalString;
  readonly xdgDataHome: OptionalString;
}

export interface DecisionConfiguration {
  readonly provider: OptionalString;
  readonly baseUrl: OptionalString;
  readonly apiKeys: Readonly<Record<'TYPESAFE_API_KEY' | 'OPENROUTER_API_KEY' | 'AI_GATEWAY_API_KEY', OptionalString>>;
  readonly timeoutMs: OptionalString;
  readonly model: OptionalString;
  readonly reviewMode: OptionalString;
}

export interface RuntimeConfiguration {
  readonly ci: boolean;
  readonly noTui: boolean;
  readonly debug: boolean;
  readonly noColor: OptionalString;
  readonly forceColor: OptionalString;
  readonly term: OptionalString;
  readonly integrationGateBypass: boolean;
  readonly credentialRedactor: OptionalString;
  readonly verifyArea: OptionalString;
  readonly primaryWorktree: OptionalString;
  readonly missionYearOverride: OptionalString;
  readonly tmpDir: OptionalString;
  readonly reviewPollIntervalMs: number | null;
  readonly reviewPollTimeoutMs: number | null;
}

export interface SetupConfiguration {
  readonly nonInteractive: OptionalString;
  readonly productName: OptionalString;
  readonly reviewProvider: OptionalString;
  readonly ownerLogin: OptionalString;
  readonly forgejoUrl: OptionalString;
  readonly forgejoRepo: OptionalString;
  readonly agentUsers: OptionalString;
  readonly ownerPassword: OptionalString;
  readonly agentPassword: OptionalString;
  readonly reviewRemote: OptionalString;
}

export interface ParallixConfiguration {
  readonly forgejo: ForgejoConfiguration;
  readonly storage: StorageConfiguration;
  readonly agents: AgentConfiguration;
  readonly terminal: TerminalConfiguration;
  readonly decision: DecisionConfiguration;
  readonly runtime: RuntimeConfiguration;
  readonly setup: SetupConfiguration;
  /** Opaque host environment for child processes; never interpret keys from it. */
  readonly forwardedEnvironment: Readonly<Record<string, string | undefined>>;
}
