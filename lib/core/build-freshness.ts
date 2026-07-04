import fs from 'node:fs';
import path from 'node:path';
import * as fmt from './fmt.js';

export interface BuildFreshnessStatus {
  ok: boolean;
  stale: string[];
  message: string | null;
}

function collectBuildArtifactPairs(rootDir: string): [string, string][] {
  const pairs: [string, string][] = [];

  pairs.push([path.join(rootDir, 'px.ts'), path.join(rootDir, 'px.js')]);
  pairs.push([path.join(rootDir, 'index.ts'), path.join(rootDir, 'index.js')]);

  const commandsDir = path.join(rootDir, 'lib', 'commands');
  if (fs.existsSync(commandsDir)) {
    for (const entry of fs.readdirSync(commandsDir)) {
      if (!entry.endsWith('.ts')) {
        continue;
      }
      const tsPath = path.join(commandsDir, entry);
      const jsPath = path.join(commandsDir, entry.replace(/\.ts$/, '.js'));
      pairs.push([tsPath, jsPath]);
    }
  }

  return pairs;
}

export function findStaleBuildArtifacts(rootDir: string): string[] {
  const stale: string[] = [];

  for (const [tsPath, jsPath] of collectBuildArtifactPairs(rootDir)) {
    if (!fs.existsSync(tsPath)) {
      continue;
    }
    if (!fs.existsSync(jsPath)) {
      stale.push(`${tsPath} (no compiled sibling)`);
      continue;
    }
    const tsStat = fs.statSync(tsPath);
    const jsStat = fs.statSync(jsPath);
    if (jsStat.mtimeMs < tsStat.mtimeMs) {
      stale.push(`${jsPath} (mtime ${jsStat.mtimeMs} < ${tsPath} mtime ${tsStat.mtimeMs})`);
    }
  }

  return stale;
}

export function formatBuildFreshnessMessage(stale: string[]): string {
  return '[parallix] Stale build detected. One or more compiled artifacts are older than their TypeScript source:\n'
    + stale.map((entry) => `  - ${entry}`).join('\n')
    + '\nRun `npm run build:cjs` to regenerate, or set PARALLIX_SKIP_BUILD_CHECK=1 to bypass.\n';
}

export function getBuildFreshnessStatus(rootDir: string): BuildFreshnessStatus {
  if (process.env.PARALLIX_SKIP_BUILD_CHECK === '1') {
    return { ok: true, stale: [], message: null };
  }

  const stale = findStaleBuildArtifacts(rootDir);
  if (stale.length === 0) {
    return { ok: true, stale, message: null };
  }

  return {
    ok: false,
    stale,
    message: formatBuildFreshnessMessage(stale),
  };
}

/**
 * Verify that compiled JavaScript artifacts are fresh relative to their
 * TypeScript sources.  Skips when PARALLIX_SKIP_BUILD_CHECK=1.
 *
 * Checks:
 *   - Root entrypoints: px.ts <-> px.js, index.ts <-> index.js
 *   - All lib/commands/*.ts <-> lib/commands/*.js pairs
 *
 * Returns true when all pairs are fresh (or source has no sibling JS).
 * Prints a clear error with the `npm run build:cjs` instruction and
 * exits non-zero on any staleness detected.
 */
export function assertBuildFreshness(
  rootDir: string,
  exitFn: (_code?: number) => never = process.exit,
  errorFn: (_msg: string) => void = fmt.log.plainError,
): void {
  const status = getBuildFreshnessStatus(rootDir);
  if (!status.ok) {
    errorFn(status.message || formatBuildFreshnessMessage(status.stale));
    exitFn(1);
  }
}
