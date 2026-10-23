import type { ParallixConfiguration } from "../../application/ports/configuration.js";
import { DEFAULT_CONFIGURATION } from "../../application/ports/configuration.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function opencodeCommandCandidates(configuration: ParallixConfiguration) {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const pushCandidate = (candidate?: string | null) => {
    if (!candidate || seen.has(candidate)) {return;}
    seen.add(candidate);
    candidates.push(candidate);
  };

  pushCandidate(configuration.agents.opencodeBin);
  pushCandidate('opencode');
  pushCandidate(path.join(configuration.storage.homeDirectory || os.homedir(), '.opencode', 'bin', 'opencode'));
  pushCandidate(path.join(configuration.storage.homeDirectory || os.homedir(), '.local', 'bin', 'opencode'));

  return candidates;
}

function resolveExistingCommand(candidate: string, configuration: ParallixConfiguration) {
  if (!candidate) {return null;}
  // Absolute/relative paths are checked directly; bare commands are checked
  // through the supplied PATH but retain their bare invocation identity.
  const commandPaths = candidate.includes(path.sep)
    ? [candidate]
    : configuration.agents.searchPath.split(path.delimiter)
      .filter(dir => dir.length > 0)
      .map(dir => path.join(dir, candidate));
  for (const commandPath of commandPaths) {
    try {
      fs.accessSync(commandPath, fs.constants.X_OK);
      return candidate;
    } catch (_) { /* keep looking */ }
  }
  return null;
}

function resolveOpencodeCommand(configuration: ParallixConfiguration = DEFAULT_CONFIGURATION) {
  for (const candidate of opencodeCommandCandidates(configuration)) {
    const resolved = resolveExistingCommand(candidate, configuration);
    if (resolved) {return resolved;}
  }
  return 'opencode';
}

export { resolveOpencodeCommand };
