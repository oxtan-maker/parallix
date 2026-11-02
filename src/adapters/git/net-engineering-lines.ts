import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { CommandOutputLimitError } from './git.js';
import {
  BUCKET_MEDIUM_MAX,
  BUCKET_SMALL_MAX,
  classifyNelBucket,
} from '../../domain/net-engineering-lines.js';

export const EXCLUSION_PATTERNS = [
  'missions/**',
  'backlog/**',
  'review-*',
  'CP-*',
  '**/*.md',
  'docs/**',
  'package-lock.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'coverage/**',
  '*lock*',
  '*.lock',
] as const;

export { BUCKET_SMALL_MAX, BUCKET_MEDIUM_MAX };

export function classifyBucket(nel: number) {
  return classifyNelBucket(nel);
}

function patternMatches(value: string, pattern: string): boolean {
  let expression = '';
  let index = 0;
  while (index < pattern.length) {
    const character = pattern[index];
    if (character === '*') {
      if (pattern[index + 1] === '*') {
        if (pattern[index + 2] === '/') {
          expression += '(?:.*/)?';
          index += 3;
          continue;
        }
        expression += '.*';
        index += 2;
        continue;
      }
      expression += '[^/]*';
    } else if (character === '?') {
      expression += '[^/]';
    } else if ('.+^${}()|[]\\'.includes(character)) {
      expression += `\\${character}`;
    } else {
      expression += character;
    }
    index += 1;
  }
  return new RegExp(`^${expression}$`).test(value);
}

export function isExcluded(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return EXCLUSION_PATTERNS.some(pattern => patternMatches(normalized, pattern));
}

export const NEL_DIFF_MAX_BUFFER = 50 * 1024 * 1024;

/** A diff range is a local revision expression; anything else never reaches a diagnostic. */
function safeRange(range: string): string {
  return /^[A-Za-z0-9._@^~+/-]{1,200}$/.test(range) ? range : '<unprintable range>';
}

/** A truncated --numstat read would fabricate a statistic rather than report an empty diff. */
function rejectTruncatedDiff(result: SpawnSyncReturns<string>, range: string, limitBytes: number): void {
  const code = (result.error as { code?: string } | undefined)?.code ?? '';
  if (code !== 'ENOBUFS' && code !== 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') { return; }
  throw new CommandOutputLimitError(`git diff --numstat ${safeRange(range)}`, code, limitBytes,
    'net engineering lines cannot be counted from truncated diff output; narrow the range');
}

/** One numstat row's counted lines; excluded, binary and malformed rows count as zero. */
function numstatRowLines(row: string): number {
  if (!row.trim()) { return 0; }
  const [additions, deletions, ...pathParts] = row.split('\t');
  if (!additions || !deletions || pathParts.length === 0) { return 0; }
  if (additions === '-' || deletions === '-') { return 0; }
  if (isExcluded(pathParts.join('\t'))) { return 0; }
  return (Number.parseInt(additions, 10) || 0) + (Number.parseInt(deletions, 10) || 0);
}

export function computeNEL(range: string, options: { cwd?: string; maxBuffer?: number } = {}): number {
  const limitBytes = options.maxBuffer ?? NEL_DIFF_MAX_BUFFER;
  const result = spawnSync('git', ['diff', '--numstat', '-w', range], {
    cwd: options.cwd || process.cwd(),
    encoding: 'utf8',
    maxBuffer: limitBytes,
  });
  rejectTruncatedDiff(result, range, limitBytes);
  if (result.status !== 0) { return 0; }
  return (result.stdout || '').split('\n').reduce((total, row) => total + numstatRowLines(row), 0);
}

export function computeNELRecord(range: string, options: { cwd?: string; maxBuffer?: number } = {}) {
  const nel = computeNEL(range, options);
  return { nel, bucket: classifyBucket(nel) };
}
