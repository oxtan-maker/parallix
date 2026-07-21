import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as fmt from '../fmt.js';
import * as gitModule from '../git.js';

/** @param {{commandRunner?: Function}} [options] */
export function graphifyAvailable(options: { commandRunner?: Function | null } = {}): boolean {
  const commandRunner = options.commandRunner ?? null;
  const cmdRunner = commandRunner || gitModule.run;
  return probeGraphifyAvailability({ commandRunner: cmdRunner }).available;
}

/** @returns {string[]} */
export function graphifyCommandCandidates(): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();

  const pushCandidate = (candidate: string) => {
    if (!candidate || seen.has(candidate)) {return;}
    seen.add(candidate);
    candidates.push(candidate);
  };

  if (process.env.GRAPHIFY_BIN) {pushCandidate(process.env.GRAPHIFY_BIN);}
  pushCandidate('graphify');
  pushCandidate(path.join(os.homedir(), '.local', 'bin', 'graphify'));

  return candidates;
}

/** @param {{commandRunner?: Function}} [options] */
export function probeGraphifyAvailability(options: { commandRunner?: Function | null } = {}): { available: boolean; command?: string; status?: number | null; reason?: string; error?: unknown } {
  const commandRunner = options.commandRunner ?? null;
  const cmdRunner = commandRunner || gitModule.run;
  for (const command of graphifyCommandCandidates()) {
    try {
      const result = cmdRunner(command, ['--help']);
      return {
        available: result.status !== null && result.status !== undefined,
        command,
        status: result.status ?? null
      };
    } catch (error: unknown) {
      const e = error as Error & { code?: string };
      if (e && e.code === 'ENOENT') {
        continue;
      }
      return {
        available: false,
        reason: 'probe-failed',
        command,
        error
      };
    }
  }

  return { available: false, reason: 'missing-command' };
}

/**
 * @param {{rootDir?: string, commandRunner?: Function, log?: Function, startMessage?: string, failureHint?: string}} [options]
 */
/** @param {{rootDir?: string, commandRunner?: Function, log?: Function, startMessage?: string, failureHint?: string}} [options] */
export function updateGraphifyKnowledgeGraph(options: { rootDir?: string; commandRunner?: Function; log?: Function; startMessage?: string; failureHint?: string } = {}): { updated: boolean; skipped: boolean; reason?: string; status?: number } {
  const rootDir = options.rootDir || process.cwd();
  const commandRunner = options.commandRunner;
  const logFn = options.log || fmt.log.plain;
  const startMessage = options.startMessage || 'Updating graphify knowledge graph...';
  const failureHint = options.failureHint || 'Continuing without blocking workflow.';
  const cmdRunner = commandRunner || gitModule.run;
  if (!fs.existsSync(path.join(rootDir, 'graphify-out', 'graph.json'))) {
    logFn(fmt.status('INFO', 'No existing graphify graph found. Skipping knowledge graph update.'));
    return { updated: false, skipped: true, reason: 'missing-graph' };
  }
  const probe = probeGraphifyAvailability({ commandRunner: cmdRunner });
  if (!probe.available) {
    if (probe.reason === 'missing-command') {
      logFn(fmt.status('WARN', 'graphify not found in PATH. Skipping knowledge graph update.'));
      return { updated: false, skipped: true, reason: 'missing-command' };
    }

    const probeError = probe.error && typeof probe.error === 'object' && 'message' in probe.error ? (probe.error as {message:string}).message : 'unknown probe failure';
    logFn(fmt.status('WARN', `graphify probe failed (${probeError}). Skipping knowledge graph update.`));
    return { updated: false, skipped: true, reason: 'probe-failed' };
  }

  logFn(fmt.status('INFO', startMessage));
  const result = cmdRunner(probe.command!, ['update', '.'], {
    cwd: rootDir,
    stdio: 'inherit'
  });

  if (result.status !== 0) {
    logFn(fmt.status('WARN', `graphify update failed with status ${result.status}. ${failureHint}`));
    return { updated: false, skipped: true, reason: 'update-failed', status: result.status };
  }

  return { updated: true, skipped: false };
}
