# CP-2: Diff-scoped file resolver

## Summary

Implemented `lib/core/mutation-scoper.ts`, which computes the mutation target
file set for a mission diff:

- `getChangedFiles(baseBranch, headRef, opts)` — runs
  `git diff --name-only --diff-filter=ACMR <base>...<head>` and filters to
  in-scope files (`index.js` and `lib/**/*.js`), matching `coverage-gate.ts`'s
  denominator and the mission's "lib/ source files, not test/" boundary
  (`isInScope`).
- `extractLocalDependencies(relFile, opts)` — regex-scans a file's source for
  relative `require('./x')` / `import ... from '../x'` specifiers and resolves
  each to a repo-relative `.js` path, dropping anything outside scope or that
  doesn't exist on disk.
- `resolveCallees(changedFiles, opts)` — BFS over `extractLocalDependencies`
  to build the full transitive closure of local callees reachable from the
  changed files (conservative scoping per the mission's stated assumption:
  "include all callees, not just direct ones").
- `scopeMutationTargets(baseBranch, headRef, opts)` — top-level entry point;
  returns `{ baseBranch, headRef, changedFiles, calleeFiles, targetFiles }`
  where `targetFiles` is the sorted union fed into Stryker's `mutate` array.

This is a regex-based static scan, not a TypeScript compiler-services pass —
per the mission's stop rule ("Stop if diff-scoped callee resolution requires
a full compiler/toolchain... simplify to changed-files-only scoping"), a
lightweight `require`/`import` scanner avoids pulling in `typescript`'s
Program/TypeChecker APIs while still resolving real local dependencies
one hop at a time to full transitive closure. The limitation (it only sees
statically-written relative specifiers — no dynamic `require(x)`, no bare
package imports, no re-exports through barrel indirection it can't parse) is
documented in `docs/adr/adr-mutation-testing.md` (CP-6).

## Goal Check

| File:line | Evidence |
|---|---|
| `lib/core/mutation-scoper.ts:1-146` | Full implementation: `getChangedFiles`, `extractLocalDependencies`, `resolveCallees`, `scopeMutationTargets`, `isInScope` |
| `test/mutation-scoper.test.js:34-40` | `isInScope accepts index.js and lib/**/*.js, rejects test/ and non-js` — passes |
| `test/mutation-scoper.test.js:42-56` | `getChangedFiles filters diff output to in-scope files only` — passes |
| `test/mutation-scoper.test.js:58-61` | `getChangedFiles returns empty array when git diff fails` — passes |
| `test/mutation-scoper.test.js:63-70` | `extractLocalDependencies resolves relative require() specifiers` — passes |
| `test/mutation-scoper.test.js:72-80` | `resolveCallees follows the transitive closure but excludes unrelated files` — passes |
| `test/mutation-scoper.test.js:82-97` | `scopeMutationTargets unions changed files and their transitive callees` — passes |

Command run: `FORCE_COLOR=0 node --test test/mutation-scoper.test.js` →
`tests 6, pass 6, fail 0`. `npx eslint lib/core/mutation-scoper.ts` → clean
(no output). `npx tsc --noEmit` on the file → clean.

Next action: Implement `lib/commands/mutation-gate.ts` (CP-3), wiring
`scopeMutationTargets` (proven here) into a generated `stryker.conf.json`
(proven runnable via the `command` runner in CP-1) with `--dry-run`,
`--baseline-path`, `--threshold`, and ratchet enforcement against
`config/mutation-baseline.json`.
