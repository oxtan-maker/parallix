/**
 * file-timing-reporter.ts — opt-in per-file wall-time profile (TASK-2590).
 *
 * Enabled only when the runner is started with PARALLIX_TEST_PROFILE set; see
 * {@link withFileTimingReporter}. Node's process-isolated runner emits one
 * top-level `test:complete` event per test file whose duration is the file's
 * child-process wall time (spawn, imports, bootstrap, and every test). This
 * reporter keeps only those events and writes JSON Lines to its destination:
 *
 *   {"type":"file","tier":"integration-ci","file":"test/x.test.ts","durationMs":1234.5,"passed":true}
 *   ...
 *   {"type":"summary","tier":"integration-ci","fileCount":N,"sumDurationMs":…,"files":[…sorted desc…]}
 *
 * It observes events only; selection, isolation, concurrency, timeouts, and
 * assertions are decided elsewhere and are unchanged by its presence.
 */
import path from 'node:path';
import type { TestEvent } from 'node:test/reporters';

export const PROFILE_ENV = 'PARALLIX_TEST_PROFILE';
export const PROFILE_TIER_ENV = 'PARALLIX_TEST_PROFILE_TIER';

export interface FileTimingRecord {
  type: 'file';
  tier: string;
  file: string;
  durationMs: number;
  passed: boolean;
}

export interface FileTimingSummary {
  type: 'summary';
  tier: string;
  fileCount: number;
  sumDurationMs: number;
  files: Array<Pick<FileTimingRecord, 'file' | 'durationMs' | 'passed'>>;
}

/**
 * True when `event` is the per-file aggregate emitted by the process-isolated
 * runner: a top-level completion whose name is the test file itself.
 */
export function isFileCompletion(event: TestEvent, cwd: string = process.cwd()): boolean {
  if (event.type !== 'test:complete') { return false; }
  const { file, name, nesting } = event.data as { file?: string; name?: string; nesting?: number };
  if (nesting !== 0 || typeof file !== 'string' || typeof name !== 'string') { return false; }
  return path.resolve(cwd, name) === path.resolve(cwd, file);
}

export function summarizeFileTimings(records: readonly FileTimingRecord[], tier: string): FileTimingSummary {
  const files = records
    .map(({ file, durationMs, passed }) => ({ file, durationMs, passed }))
    .sort((a, b) => b.durationMs - a.durationMs || a.file.localeCompare(b.file));
  return {
    type: 'summary',
    tier,
    fileCount: files.length,
    sumDurationMs: Math.round(files.reduce((sum, entry) => sum + entry.durationMs, 0) * 10) / 10,
    files,
  };
}

export default async function* fileTimingReporter(source: AsyncIterable<TestEvent>) {
  const tier = process.env[PROFILE_TIER_ENV] || 'unknown';
  const cwd = process.cwd();
  const records: FileTimingRecord[] = [];
  for await (const event of source) {
    if (!isFileCompletion(event, cwd)) { continue; }
    const data = event.data as { file: string; details: { duration_ms: number; passed?: boolean; error?: unknown } };
    const record: FileTimingRecord = {
      type: 'file',
      tier,
      file: path.relative(cwd, data.file),
      durationMs: Math.round(data.details.duration_ms * 10) / 10,
      passed: data.details.error === undefined,
    };
    records.push(record);
    yield `${JSON.stringify(record)}\n`;
  }
  yield `${JSON.stringify(summarizeFileTimings(records, tier))}\n`;
}
