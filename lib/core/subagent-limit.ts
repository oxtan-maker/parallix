import { loadEffectiveConfig } from './product-config.js';

// Build a prompt-injection prefix that instructs the agent to limit
// concurrent subagent forks. Returns a non-empty advisory string when
// maxParallel >= 1, or an empty string when the setting is absent, null,
// zero, or negative (backward-compatible default).
//
// Prefix length target: under 200 characters.
//
// @param {number | null | undefined} [maxParallel] — explicit value override;
//   when omitted the function reads from the effective workflow config.
/** @param {number | null | undefined} [maxParallel] */
export function buildSubagentLimitPrefix(maxParallel: number | null | undefined) {
  let value = maxParallel;
  if (value === undefined || value === null) {
    const cfg = loadEffectiveConfig();
    const agents = cfg.adapters?.agents as { [key: string]: unknown } | undefined;
    const sub = agents?.subagents as { maxParallel?: number } | undefined;
    value = sub && typeof sub.maxParallel === 'number' ? sub.maxParallel : null;
  }
  if (typeof value !== 'number' || value < 1) {
    return '';
  }
  return `Do not spawn more than ${value} parallel subagents. If you need more, pause and wait.\n`;
}
