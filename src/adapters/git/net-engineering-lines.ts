import { spawnSync } from 'node:child_process';
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

export function computeNEL(range: string, options: { cwd?: string } = {}): number {
  const result = spawnSync('git', ['diff', '--numstat', '-w', range], {
    cwd: options.cwd || process.cwd(),
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  });
  if (result.status !== 0) { return 0; }

  let total = 0;
  for (const line of (result.stdout || '').split('\n')) {
    if (!line.trim()) { continue; }
    const [additions, deletions, ...pathParts] = line.split('\t');
    if (!additions || !deletions || pathParts.length === 0) { continue; }
    if (additions === '-' || deletions === '-') { continue; }
    if (isExcluded(pathParts.join('\t'))) { continue; }
    total += (Number.parseInt(additions, 10) || 0) + (Number.parseInt(deletions, 10) || 0);
  }
  return total;
}

export function computeNELRecord(range: string, options: { cwd?: string } = {}) {
  const nel = computeNEL(range, options);
  return { nel, bucket: classifyBucket(nel) };
}
