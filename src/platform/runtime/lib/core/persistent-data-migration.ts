import fs from 'node:fs';
import path from 'node:path';
import * as storage from './storage.js';

// TASK-2322.08 removed `migrateStats` and its CSV reader/writer helpers.
// `<PARALLIX_HOME>/stats.csv` is no longer a runtime authority, target, or
// migration destination: measurements live in the measurement database
// (ADR 0053). This module now migrates only the legacy agent blocklists.

interface BlocklistSource { filePath: string; payload: Record<string, unknown>; blocklist: Record<string, unknown>; }

function readBlocklistSource(filePath: string, warn: (..._args: unknown[]) => void, hardFailure = false): BlocklistSource | null {
  if (!filePath || !fs.existsSync(filePath)) {return null;}
  try {
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('expected a JSON object at the file root');
    }
    if (
      payload.blocklist !== undefined &&
      (!payload.blocklist || typeof payload.blocklist !== 'object' || Array.isArray(payload.blocklist))
    ) {
      throw new Error('expected blocklist to be a JSON object');
    }
    return { filePath, payload, blocklist: (payload.blocklist as Record<string, unknown>) || {} };
  } catch (error) {
    if (hardFailure) {throw error;}
    warn(`Skipping malformed legacy agent blocklist ${path.resolve(filePath)}: ${(error as Error).message}`);
    return null;
  }
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Merge agent blocklists from legacy sources into the destination file.
 * Reports conflicts via `warn` when the same agent appears in multiple sources
 * with different values. Existing destination entries take lowest precedence.
 * @param options - Migration configuration (warn callback, destinationPath, sourcePaths)
 * @returns Result with destination path, merged blocklist, and conflict details
 */
function migrateAgentBlocklists(options: { warn?: (..._args: unknown[]) => void; destinationPath?: string; sourcePaths?: string[] } = {}): { destinationPath: string; blocklist: Record<string, unknown>; conflicts: unknown[] } {
  const opts = options;
  const warn = opts.warn || (() => {});
  const destinationPath = opts.destinationPath || storage.resolveAgentsLocalPath({ ensureDir: true });
  const sources = (opts.sourcePaths || [])
    .map(filePath => readBlocklistSource(filePath, warn))
    .filter(Boolean) as BlocklistSource[];
  const destination = readBlocklistSource(destinationPath, warn, true);
  const selected: Record<string, unknown> = {};
  const selectedFrom: Record<string, string> = {};
  const conflicts: unknown[] = [];

  for (const s of [...sources, ...(destination ? [destination] : [])]) {
    if (!s) {continue;}
    for (const [agent, value] of Object.entries(s.blocklist)) {
      if (Object.prototype.hasOwnProperty.call(selected, agent) && !sameValue(selected[agent], value)) {
        const conflict = {
          agent,
          previousSource: selectedFrom[agent],
          previousValue: selected[agent],
          selectedSource: s.filePath,
          selectedValue: value
        };
        conflicts.push(conflict);
        warn(
          `Agent blocklist conflict for "${agent}": ${path.resolve(s.filePath)} takes precedence over ` +
          `${path.resolve(selectedFrom[agent])}; selected=${JSON.stringify(value)} previous=${JSON.stringify(selected[agent])}`
        );
      }
      selected[agent] = value;
      selectedFrom[agent] = s.filePath;
    }
  }

  const payload: Record<string, unknown> = destination ? { ...destination.payload } : {};
  payload.blocklist = selected;
  const content = `${JSON.stringify(payload, null, 2)}\n`;
  const current = fs.existsSync(destinationPath) ? fs.readFileSync(destinationPath, 'utf8') : null;
  if (current !== content) {storage.writeFileAtomic(destinationPath, content);}
  return { destinationPath, blocklist: selected, conflicts };
}

export {
  migrateAgentBlocklists
};
