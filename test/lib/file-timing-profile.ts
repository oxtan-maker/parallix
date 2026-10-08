/**
 * file-timing-profile.ts — runner-side wiring for the opt-in per-file timing
 * profile (TASK-2590). See `file-timing-reporter.ts` for the record format.
 *
 * PARALLIX_TEST_PROFILE=1 (or `true`) writes to
 * `tmp/test-profile/<tier>-<timestamp>.jsonl` under the execution root; any
 * other non-empty value is used as the destination path. Unset, empty, `0`,
 * or `false` disables profiling and leaves the runner argv untouched.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { withFileTimingReporter } from './test-run-plan.js';
import { PROFILE_ENV, PROFILE_TIER_ENV, type FileTimingSummary } from './file-timing-reporter.js';

export interface FileTimingProfile {
  tier: string;
  destination: string;
  nodeArgs: string[];
  env: Record<string, string>;
}

export function profileTierOf(requestedArgs: readonly string[]): string {
  if (requestedArgs.includes('--integration-ci') || requestedArgs.includes('--integration-ci-all')) { return 'integration-ci'; }
  if (requestedArgs.includes('--integration-local')) { return 'integration-local'; }
  if (requestedArgs.includes('--integration')) { return 'integration'; }
  return 'unit';
}

export function resolveFileTimingProfile(options: {
  executionRoot: string;
  requestedArgs: readonly string[];
  nodeArgs: readonly string[];
  env?: NodeJS.ProcessEnv;
  now?: Date;
}): FileTimingProfile | null {
  const raw = (options.env ?? process.env)[PROFILE_ENV]?.trim() ?? '';
  if (raw === '' || raw === '0' || raw.toLowerCase() === 'false') { return null; }
  const tier = profileTierOf(options.requestedArgs);
  const stamp = (options.now ?? new Date()).toISOString().replace(/[:.]/g, '-');
  const destination = raw === '1' || raw.toLowerCase() === 'true'
    ? path.join(options.executionRoot, 'tmp', 'test-profile', `${tier}-${stamp}.jsonl`)
    : path.resolve(options.executionRoot, raw);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const reporterModule = pathToFileURL(path.join(options.executionRoot, 'test', 'lib', 'file-timing-reporter.ts')).href;
  return {
    tier,
    destination,
    nodeArgs: withFileTimingReporter(options.nodeArgs, reporterModule, destination),
    env: { [PROFILE_TIER_ENV]: tier },
  };
}

/** Print the heaviest files from a completed profile; never fails the suite. */
export function printFileTimingSummary(destination: string, limit = 20, write: (line: string) => void = line => console.error(line)): void {
  let summary: FileTimingSummary | undefined;
  try {
    for (const line of fs.readFileSync(destination, 'utf8').split('\n')) {
      if (line.startsWith('{"type":"summary"')) { summary = JSON.parse(line) as FileTimingSummary; }
    }
  } catch (_) {
    // The profile is diagnostic output only.
  }
  if (!summary) {
    write(`[test-profile] no summary written to ${destination}`);
    return;
  }
  write(`[test-profile] tier=${summary.tier} files=${summary.fileCount} sum=${Math.round(summary.sumDurationMs)}ms records=${destination}`);
  for (const entry of summary.files.slice(0, limit)) {
    write(`[test-profile] ${String(Math.round(entry.durationMs)).padStart(7)}ms ${entry.passed ? '' : 'FAIL '}${entry.file}`);
  }
}
