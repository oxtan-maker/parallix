# CP-1: Leaf Modules Converted

## Summary

Converted 4 leaf modules (`fmt`, `git`, `gitignore`, `spawn-tee`) from CommonJS to ES Module syntax with TypeScript `.ts` source files. Each file was renamed `.js` → `.ts`, `require()` replaced with `import`, `module.exports` replaced with named `export` statements. TypeScript compiles `.ts` to `.js` (emitted to project root per `outDir: "."`, then moved to `lib/core/`). The `product-config.js` original was kept (not converted in CP-1) since it's an upstream dependency for state-map.

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| fmt.ts uses ESM syntax | `lib/core/fmt.ts:1` — `import { styleText } from 'node:util';`; `lib/core/fmt.ts:38` — `export function colorize(...)` |
| git.ts uses ESM syntax | `lib/core/git.ts:2` — `import childProcess from 'node:child_process';`; `lib/core/git.ts:5` — `export function git(...)` |
| gitignore.ts uses ESM syntax | `lib/core/gitignore.ts:2` — `import fs from 'node:fs';`; `lib/core/gitignore.ts:115` — `export = ensureWorkflowGitignore;` |
| spawn-tee.ts uses ESM syntax | `lib/core/spawn-tee.ts:2` — `import childProcess from 'node:child_process';`; `lib/core/spawn-tee.ts:70` — `export function spawnAndTee(...)` |
| Zero require() in converted files | `grep -rn 'require(' lib/core/{fmt,git,gitignore,spawn-tee}.ts` returns zero matches |
| Zero module.exports in converted files | `grep -rn 'module.exports' lib/core/{fmt,git,gitignore,spawn-tee}.ts` returns zero matches |
| fmt tests pass | `test/fmt.test.js`: 9 tests — all pass (fmt.status, fmt.agent, fmt.bold, fmt.dim, fmt.table, fmt.semantic, fmt.colors, fmt.colorize) |
| git tests pass | `test/git.test.js`: 12 tests — all pass (git, run, getCurrentBranch, getWorktreeStatus, isDirty, getUncommittedCount, detectRebaseState ×3, getLastCommit, getLastThreeCommits) |
| spawn-tee tests pass | `test/spawn-tee.test.js`: 14 tests — all pass (spawnAndTee transcript retention, tail buffer bounding, limit-hit detection, watchdog ×7, PWD propagation) |
| gitignore tests pass | `test/gitignore.test.js`: 14 tests — all pass (create, append, symlink, non-git-repo, blank lines, duplicate entries, etc.) |
| npm test baseline preserved | 1694 pass, 0 fail, 22 skipped — identical to baseline |
| tsc --noEmit clean | `npm run typecheck` reports zero errors |

## Next action
Convert upstream dependency `product-config.ts` (leaf node, no internal deps) and then convert `state-map.ts` which depends on it.
