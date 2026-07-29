import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentFamily } from '../../domain/agents.js';

/**
 * Resolve known agent families from config/agents.json.
 *
 * Reads the agents.json configuration file via readFileSync and returns
 * the list of recognized agent family strings. Returns an empty list
 * when the config file is missing or malformed.
 *
 * This is a Configuration concept (ADR 0053 classification: configuration-or-secret).
 */
export function resolveKnownAgentFamilies(rootDir: string): readonly AgentFamily[] {
  const agentsPath = join(rootDir, 'config', 'agents.json');
  try {
    const raw = readFileSync(agentsPath, 'utf8');
    const config = JSON.parse(raw);
    if (Array.isArray(config?.families)) {
      return config.families.filter((f: unknown): f is string => typeof f === 'string')
        .map((f: string) => f as AgentFamily);
    }
  } catch {
    // Config file missing or malformed — return empty list
  }
  return [];
}
