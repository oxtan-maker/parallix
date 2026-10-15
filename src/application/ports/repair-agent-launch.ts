import type { InvalidContractBlocker } from '../../domain/rebound-policy.js';

/** The repair kernel's agent-launch boundary, supplied by composition. */
export interface ReboundLaunchOptions extends Record<string, unknown> {
  prompt: string | ((agent: string) => string);
  agent?: string;
  worktree?: string;
  slug?: string;
  role?: string;
  exclude?: string[];
  pinnedAgent?: boolean;
  sessionPolicy?: import('../../domain/session.js').SessionLaunchPolicy;
}

/** Minimal launch port: the kernel never imports the agents adapter. */
export type ReboundStartAgent = (
  _step: string,
  _options: ReboundLaunchOptions,
) => Promise<{ agent?: string | null; result?: { status?: number | null; invalidContract?: InvalidContractBlocker } | null } | null | undefined>;
