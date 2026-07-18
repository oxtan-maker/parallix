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
  const sourceRoot = path.basename(rootDir) === 'dist'
    ? path.dirname(rootDir)
    : rootDir;

  pairs.push([path.join(sourceRoot, 'px.ts'), path.join(sourceRoot, 'dist', 'px.js')]);
  pairs.push([path.join(sourceRoot, 'index.ts'), path.join(sourceRoot, 'dist', 'index.js')]);

  const commandsDir = path.join(sourceRoot, 'lib', 'commands');
  if (fs.existsSync(commandsDir)) {
    for (const entry of fs.readdirSync(commandsDir)) {
      if (!entry.endsWith('.ts')) {
        continue;
      }
      const tsPath = path.join(commandsDir, entry);
      const jsPath = path.join(sourceRoot, 'dist', 'lib', 'commands', entry.replace(/\.ts$/, '.js'));
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
    + '\nRun `npm run build` to regenerate, or set PARALLIX_SKIP_BUILD_CHECK=1 to bypass.\n';
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
 *   - Root entrypoints: px.ts <-> dist/px.js, index.ts <-> dist/index.js
 *   - All lib/commands/*.ts <-> dist/lib/commands/*.js pairs
 *
 * Returns true when all pairs are fresh (or source has no sibling JS).
 * Prints a clear error with the `npm run build` instruction and
 * exits non-zero on any staleness detected.
 *
 * This check is only meaningful against a source checkout: `.ts` sources are
 * excluded from the published npm package (see package.json's "files" entry
 * `!lib/**\/*.ts`), so an installed package has no `.ts` files to compare
 * against and every pair is skipped via findStaleBuildArtifacts' `!fs.existsSync(tsPath)`
 * branch, always ok. That's intentional (task-1424): tarball extraction
 * assigns each file its own extraction-time mtime in directory-sorted order,
 * and "<name>.ts" always sorts after "<name>.js", so a packaged-and-installed
 * `.ts`/`.js` pair would otherwise always look stale regardless of actual
 * build freshness. The checkout-side guard (npm run prepack/publish:guard)
 * still runs against the full source tree before packing, so a genuinely
 * stale checkout is still caught before it is ever shipped.
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
