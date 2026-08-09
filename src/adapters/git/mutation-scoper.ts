/**
 * mutation-scoper.ts - resolve the diff-scoped file set for mutation testing.
 *
 * Computes the files changed between a base branch and a head ref, then
 * resolves their direct (depth-1) local callees by scanning
 * static import statements — a lightweight regex-based scan,
 * not a full TypeScript compiler pass (see docs/adr/adr-mutation-testing.md
 * for why: a full compiler-services pass was ruled out by the mission's stop
 * rules as unacceptable added complexity for a diff-scoping utility).
 *
 * Scope is restricted to the TypeScript production source under `src/`,
 * matching coverage-gate.ts's denominator and the mission's "production source,
 * not test/ files" boundary (TASK-2328 retired the CommonJS mirror).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { git as gitFnDefault } from './git.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..', '..');

const IMPORT_FROM_RE = /(?:import|export)[^'"]*from\s+['"](\.\.?\/[^'"]+)['"]/g;

interface GitLike {
  (_args: string[], _options?: Record<string, unknown>): { status: number | null; stdout: string; stderr: string };
}

interface ScoperOptions {
  gitFn?: GitLike;
  fsModule?: typeof fs;
  repoRoot?: string;
}

interface ScopeResult {
  baseBranch: string;
  headRef: string;
  changedFiles: string[];
  calleeFiles: string[];
  targetFiles: string[];
}

/** The production source root; everything mutation testing may target. */
const RUNTIME_SOURCE_ROOT = 'src/';

function isInScope(relPath: string): boolean {
  return relPath.startsWith(RUNTIME_SOURCE_ROOT)
    && relPath.endsWith('.ts')
    && !relPath.endsWith('.d.ts');
}

/** Compute the set of in-scope source files changed between baseBranch and headRef. */
function getChangedFiles(baseBranch: string, headRef = 'HEAD', options: ScoperOptions = {}): string[] {
  const { gitFn = gitFnDefault, repoRoot = REPO_ROOT } = options;
  const result = gitFn(['-C', repoRoot, 'diff', '--name-only', '--diff-filter=ACMR', `${baseBranch}...${headRef}`]);
  if (result.status !== 0) {
    return [];
  }
  return Array.from(new Set(
    result.stdout
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .filter(isInScope)
  )).sort();
}

/**
 * Resolve a single relative import specifier to a repo-relative `.ts` path, if
 * it exists in-scope. ESM specifiers name the emitted `.js` file, so the `.js`
 * suffix is rewritten back onto the authored TypeScript.
 */
function resolveSpecifier(fromAbsFile: string, specifier: string, repoRoot: string, fsModule: typeof fs): string | null {
  const fromDir = path.dirname(fromAbsFile);
  let candidate = path.resolve(fromDir, specifier);
  if (candidate.endsWith('.js')) {
    candidate = `${candidate.slice(0, -3)}.ts`;
  } else if (!candidate.endsWith('.ts')) {
    candidate = `${candidate}.ts`;
  }
  if (!fsModule.existsSync(candidate)) {
    return null;
  }
  const rel = path.relative(repoRoot, candidate).split(path.sep).join('/');
  return isInScope(rel) ? rel : null;
}

/** Scan a file's source for local import specifiers, resolved to repo-relative paths. */
function extractLocalDependencies(relFile: string, options: ScoperOptions = {}): string[] {
  const { repoRoot = REPO_ROOT, fsModule = fs } = options;
  const absFile = path.join(repoRoot, relFile);
  if (!fsModule.existsSync(absFile)) {return [];}
  const source = fsModule.readFileSync(absFile, 'utf8');
  const found = new Set<string>();
  for (const re of [IMPORT_FROM_RE]) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(source)) !== null) {
      const resolved = resolveSpecifier(absFile, match[1], repoRoot, fsModule);
      if (resolved) {found.add(resolved);}
    }
  }
  return Array.from(found);
}

/** Resolve direct (depth-1) local callees of the given changed files. Full transitive closure is intentionally avoided to prevent hub-file blowup (e.g. a changed handoff.ts pulling in agents/*, review/*, tools/*) which can exceed the 60s mutation-testing budget — see docs/adr/adr-mutation-testing.md. */
function resolveCallees(changedFiles: string[], options: ScoperOptions = {}): string[] {
  const callees = new Set<string>();
  for (const file of changedFiles) {
    const deps = extractLocalDependencies(file, options);
    for (const dep of deps) {
      callees.add(dep);
    }
  }
  return Array.from(callees).sort();
}

/** Compute the full diff-scoped mutation target set: changed files + their direct local callees. */
function scopeMutationTargets(baseBranch: string, headRef = 'HEAD', options: ScoperOptions = {}): ScopeResult {
  const changedFiles = getChangedFiles(baseBranch, headRef, options);
  const calleeFiles = resolveCallees(changedFiles, options);
  const targetFiles = Array.from(new Set([...changedFiles, ...calleeFiles])).sort();
  return { baseBranch, headRef, changedFiles, calleeFiles, targetFiles };
}

export default scopeMutationTargets;
export type { ScopeResult };
export {
  scopeMutationTargets,
  getChangedFiles,
  resolveCallees,
  extractLocalDependencies,
  isInScope,
};
