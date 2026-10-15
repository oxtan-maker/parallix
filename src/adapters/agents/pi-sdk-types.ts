/** Adapter view of the supported Pi SDK generations. Handles stay SDK-owned. */
export type PiModel = { id: string };
export type PiStats = {
  assistantMessages?: number; userMessages?: number; toolCalls?: number; toolResults?: number;
  totalMessages?: number; cost?: number;
  tokens?: Record<string, number | undefined>;
};

export type PiMessage = {
  role?: string; stopReason?: string; errorMessage?: string;
  content?: { type?: string; text?: string; thinking?: string }[];
};

export type PiStreamEvent = {
  type: string; message?: PiMessage; messages?: PiMessage[];
  assistantMessageEvent?: { type?: string; delta?: unknown };
  toolName?: string; toolCallId?: string | null; args?: unknown;
  partialResult?: { content?: unknown }; result?: { content?: unknown }; isError?: boolean;
  attempt?: number; maxAttempts?: number; delayMs?: number; errorMessage?: string;
  aborted?: boolean; willRetry?: boolean; success?: boolean; finalError?: string;
};

export interface PiSession {
  autoCompactionEnabled?: boolean;
  sessionId?: string;
  model?: PiModel;
  prompt(prompt: string): Promise<void>;
  subscribe(listener: (event: PiStreamEvent) => void): () => void;
  dispose?(): void;
  getSessionStats?(): PiStats;
  getLastAssistantText?(): string | undefined;
  getActiveToolNames?(): string[];
}

export interface PiModelRegistry {
  find(provider: string, model: string): PiModel | undefined;
  getAll(): PiModel[];
  refresh?(): Promise<unknown> | unknown;
}

export type PiModelRegistryConstructor = {
  new(runtime: unknown): PiModelRegistry;
  create?: (authStorage: unknown) => PiModelRegistry;
};

export type PiSessionOptions = {
  cwd: string;
  sessionManager: unknown;
  authStorage?: unknown;
  modelRegistry?: PiModelRegistry;
  modelRuntime?: unknown;
  model?: PiModel;
};

export type PiSessionFactory = (options: PiSessionOptions) => Promise<{ session: PiSession; modelFallbackMessage?: string }>;

export interface PiSdk {
  createAgentSession: PiSessionFactory;
  SessionManager: {
    list(worktree: string): Promise<{ id: string; path: string }[]>;
    open(path: string, directory: undefined, worktree: string): unknown;
    create(worktree: string): unknown;
    continueRecent(worktree: string): unknown;
  };
  AuthStorage?: { create?: () => unknown };
  ModelRegistry?: PiModelRegistryConstructor | { create: (authStorage: unknown) => PiModelRegistry };
  ModelRuntime?: { create?: () => Promise<unknown> };
}
