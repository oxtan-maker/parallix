/**
 * Cohesive runtime-block selection logic for the workflow launch loop.
 *
 * The loop must never launch a family the authoritative runtime blocklist
 * currently blocks, and must report a clear all-blocked failure when every
 * eligible family for a step is blocked. This module owns that logic plus its
 * default SQLite/config data sources so the launch loop stays small and the
 * block rules have one home.
 */
import { AgentBlockService } from '../../application/services/agent-block-service.js';
import { CONFIG_PATH, readAgentConfig } from './agent-config.js';
import { WORKFLOW_AGENT_NAMES } from './launcher-selection.js';

export interface BlockContext {
  /** Families to exclude from selection: already-tried plus runtime-blocked. */
  readonly exclude: ReadonlySet<string>;
  /** True only when the runtime blocklist blocks every eligible family for the step. */
  readonly allEligibleBlocked: boolean;
  /** Runtime-blocked families that are actually eligible for this step. */
  readonly blockedEligible: readonly string[];
  /** Families the step policy allows, intersected with the blocked set. */
  readonly eligible: readonly string[];
  /** The full runtime-blocked set, used to gate the last-resort fallback. */
  readonly blocked: ReadonlySet<string>;
}

/**
 * Combine the tried set with the runtime-blocked set into one selection exclude
 * set, and report whether every eligible family is blocked. Intersecting the
 * blocked set with the step-eligible set keeps the all-blocked message honest
 * — it only names families the step would have considered.
 */
export function resolveBlockContext(
  eligible: readonly string[],
  tried: ReadonlySet<string>,
  blocked: ReadonlySet<string>,
): BlockContext {
  const blockedEligible = eligible.filter((family) => blocked.has(family));
  return {
    exclude: new Set<string>([...tried, ...blocked]),
    allEligibleBlocked: eligible.length > 0 && blockedEligible.length === eligible.length,
    blockedEligible,
    eligible,
    blocked,
  };
}

/**
 * Filter last-resort fallback candidates by the runtime-blocked set so the
 * single-family escape hatch never selects a blocked family (SC 2/SC 3).
 */
export function filterBlockedFallback(
  candidates: readonly string[],
  blocked: ReadonlySet<string>,
): string[] {
  return candidates.filter((family) => !blocked.has(family));
}

/**
 * Default runtime-block context for a step: the SQLite authoritative blocklist
 * intersected with the config-driven step-eligible set. Reads fail soft so a
 * missing database never poisons selection — the per-agent `isAgentBlockedFn`
 * remains the launch-time backstop. The tried set is threaded through so the
 * exclude set accumulates across loop iterations.
 */
export async function defaultBlockContext(
  step: string,
  tried: ReadonlySet<string>,
): Promise<BlockContext> {
  const eligible = defaultStepEligibleFamilies(step);
  const blocked = await defaultRuntimeBlockedFamilies();
  return resolveBlockContext(eligible, tried, blocked);
}

/**
 * Families the step policy allows, independent of the config blocklist. Used
 * to decide whether the runtime blocklist covers every eligible family for the
 * step. Reads the config blocklist; a missing config yields the full workflow
 * family set so selection degrades rather than crashing.
 */
export function defaultStepEligibleFamilies(step: string): readonly string[] {
  const config = readAgentConfig(CONFIG_PATH, {});
  if (!config || !config.steps || !config.steps[step]) { return [...WORKFLOW_AGENT_NAMES]; }
  return config.steps[step].eligible ?? [...WORKFLOW_AGENT_NAMES];
}

/**
 * Runtime-block authority for workflow selection. SQLite supplies the
 * authoritative blocklist; a family blocked here (for example month-end rate
 * limits) is excluded from selection before any launch is attempted. Reads fail
 * soft so a missing database never poisons selection — the per-agent
 * `isAgentBlockedFn` remains the launch-time backstop.
 */
export async function defaultRuntimeBlockedFamilies(): Promise<ReadonlySet<string>> {
  try {
    const { initOperatorState } = await import('../sqlite/adapter-factory.js');
    const { SqliteBlocklistRepository } = await import('../sqlite/blocklist-repository.js');
    const state = await initOperatorState();
    const now = Date.now();
    const results = await new AgentBlockService(new SqliteBlocklistRepository(state.db)).queryAll(WORKFLOW_AGENT_NAMES, now);
    return new Set(results.filter((result) => result.blocked).map((result) => result.agent));
  } catch (_err) {
    return new Set();
  }
}
