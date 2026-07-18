/**
 * package-root.ts - resolve the Parallix package root from a module's __dirname.
 *
 * ADR 0044 phase T2 (docs/adr/0044-workflow-distribution-model.md §6, §9):
 * package-owned assets (prompts/, templates/, config/, data/, executable
 * scripts) must resolve from the installed package root rather than from a
 * fixed count of `..` segments or from process.cwd(). This helper walks
 * upward from a caller-supplied directory (always its module `__dirname`) to
 * the nearest ancestor whose package.json is named `@magnusekdahl/parallix`.
 *
 * It deliberately never consults process.cwd(): the anchor is the module's
 * own location, so resolution is identical whether the process runs inside
 * the checkout, from an installed node_modules copy, or from an unrelated CWD.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const PACKAGE_NAME = '@magnusekdahl/parallix';

// Cache resolved roots per starting directory. Module locations are stable for
// the lifetime of a process, so this avoids repeated filesystem walks without
// ever reaching into process.cwd().
const rootCache = new Map<string, string>();

/**
 * Walk upward from `fromDir` and return the nearest directory containing a
 * package.json whose `name` is `@magnusekdahl/parallix`.
 *
 * @param fromDir Starting directory; callers pass their module `__dirname`.
 * @throws if no matching package.json is found on the ancestor chain.
 */
export function packageRoot(fromDir: string): string {
  if (typeof fromDir !== 'string' || fromDir.length === 0) {
    throw new Error(`packageRoot: fromDir must be a non-empty string, received ${String(fromDir)}`);
  }

  const start = path.resolve(fromDir);
  const cached = rootCache.get(start);
  if (cached !== undefined) {return cached;}

  let dir = start;
  // Bounded by the filesystem: dirname('/') === '/', which ends the loop.
  for (;;) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      let name: unknown;
      try {
        name = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).name;
      } catch {
        // Malformed package.json: ignore and keep walking upward.
        name = undefined;
      }
      if (name === PACKAGE_NAME) {
        rootCache.set(start, dir);
        return dir;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) {break;}
    dir = parent;
  }

  throw new Error(
    `packageRoot: could not find a package.json named ${PACKAGE_NAME} ` +
    `on the ancestor chain of ${start}`,
  );
}
