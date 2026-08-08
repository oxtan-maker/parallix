import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { agentFamily, type AgentFamily } from '../../domain/agents.js';

/**
 * Resolve known agent families from config/agents.json.
 *
 * Precedence:
 *   1. an explicit top-level `families` array, when the config declares one;
 *   2. otherwise the sorted union of every `steps.<step>.eligible` entry, which
 *      is the shape the shipped config actually uses.
 *
 * Entries that fail `agentFamily()` validation are dropped rather than cast, so
 * an invalid config value can never reach the board as an `AgentFamily`.
 * Returns an empty list — never throws — when the config file is missing,
 * unparsable, or declares neither `families` nor `steps`.
 *
 * This is a Configuration concept (ADR 0053 classification: configuration-or-secret).
 */
export function resolveKnownAgentFamilies(rootDir: string): readonly AgentFamily[] {
  const agentsPath = join(rootDir, 'config', 'agents.json');
  let config: unknown;
  try {
    config = JSON.parse(readFileSync(agentsPath, 'utf8'));
  } catch {
    // Config file missing or malformed — return empty list
    return [];
  }
  const declared = declaredFamilies(config);
  if (declared !== null) { return validFamilies(declared); }
  return validFamilies(eligibleUnion(config)).slice().sort();
}

/** The explicit top-level `families` array, or null when the config declares none. */
function declaredFamilies(config: unknown): readonly unknown[] | null {
  const families = (config as { families?: unknown } | null)?.families;
  return Array.isArray(families) ? families : null;
}

/** Every distinct `steps.<step>.eligible` entry, in first-seen order. */
function eligibleUnion(config: unknown): readonly unknown[] {
  const steps = (config as { steps?: unknown } | null)?.steps;
  if (typeof steps !== 'object' || steps === null) { return []; }
  const seen = new Set<unknown>();
  for (const step of Object.values(steps as Record<string, unknown>)) {
    const eligible = (step as { eligible?: unknown } | null)?.eligible;
    if (!Array.isArray(eligible)) { continue; }
    for (const entry of eligible) { seen.add(entry); }
  }
  return [...seen];
}

/** Keep only entries that pass `agentFamily()` validation. */
function validFamilies(entries: readonly unknown[]): readonly AgentFamily[] {
  const families: AgentFamily[] = [];
  for (const entry of entries) {
    if (typeof entry !== 'string') { continue; }
    try {
      families.push(agentFamily(entry));
    } catch {
      // Not a valid agent family — drop it rather than surface an invalid value.
    }
  }
  return families;
}
