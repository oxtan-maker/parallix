/**
 * px-entry.ts — the one place integration tests resolve how to launch the px CLI.
 *
 * Starting `src/entry/px.ts` through the tsx loader costs 2-3 s per process;
 * the prebuilt `build/px.mjs` bundle starts in about 0.3 s. The prebuilt
 * integration lanes (`PARALLIX_PREBUILT_PACK=1`) build the bundle from the same
 * commit before running, so there a px spawn runs the bundle. Everywhere else
 * (`npm run test:integration:local`, a focused run) it runs the source.
 *
 * Coverage (ADR 0062): Node's native coverage attributes a tsx subprocess to
 * `src/`, but not a bundle subprocess. Use {@link resolvePxEntryLoader} for px
 * spawns whose verification is their assertions — harness writes by stub
 * agents and CLI round trips. Use {@link SOURCE_PX} only when the test's point
 * is the source entry or loader itself; the call site states why.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

export interface PxEntryLoader {
  /** Absolute path of the CLI entry script. */
  readonly entry: string;
  /** Resolved module for `node --import`, or '' when the entry needs no loader. */
  readonly loader: string;
}

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

export const PREBUILT_PX_ENTRY = path.join(REPO_ROOT, 'build', 'px.mjs');
export const SOURCE_PX_ENTRY = path.join(REPO_ROOT, 'src', 'entry', 'px.ts');
export const TSX_LOADER = createRequire(import.meta.url).resolve('tsx');
export const SOURCE_PX: PxEntryLoader = Object.freeze({ entry: SOURCE_PX_ENTRY, loader: TSX_LOADER });

export interface ResolvePxEntryOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly exists?: (file: string) => boolean;
}

/** The bundle in a prebuilt lane whose bundle exists; the tsx-loaded source otherwise. */
export function resolvePxEntryLoader({ env = process.env, exists = fs.existsSync }: ResolvePxEntryOptions = {}): PxEntryLoader {
  return env.PARALLIX_PREBUILT_PACK === '1' && exists(PREBUILT_PX_ENTRY)
    ? { entry: PREBUILT_PX_ENTRY, loader: '' }
    : SOURCE_PX;
}

/** Node arguments that run px with `args` from the resolved entry. */
export function pxNodeArgs(px: PxEntryLoader, args: readonly string[]): string[] {
  return [...(px.loader ? ['--import', px.loader] : []), px.entry, ...args];
}
