# Mission: Convert 4 integration commands (integrate, rebase, resolve-conflict, review) from CJS to ESM/TypeScript (task-1371)

## Goal

Convert the 4 integration-focused command files from CommonJS (`require`/`module.exports`) to ES Module syntax (`import`/`export`) with TypeScript type annotations. Files are renamed `.js` → `.ts`:

1. **`lib/commands/integrate.js` → `lib/commands/integrate.ts`** (1673 lines, ~100 named exports — the single largest file in the codebase)
2. **`lib/commands/rebase.js` → `lib/commands/rebase.ts`** (635 lines)
3. **`lib/commands/resolve-conflict.js` → `lib/commands/resolve-conflict.ts`** (112 lines)
4. **`lib/commands/review.js` → `lib/commands/review.ts`** (14 lines)

All conversions preserve runtime behavior, public APIs, test pass rates, and JSDoc annotations. The `integrate.js` rename must be detected by `git diff -M` at ≥50% similarity — a rewrite would lose rename detection.

## Why Now

This is Wave 7 of the repository-wide CJS→ESM/TypeScript migration. These 4 command files are the last remaining hand-written `.js` files under `lib/commands/`. All their upstream dependencies (core modules from Wave 1, agents from Wave 2, review from Wave 3, tools from Wave 4) have already been converted to `.ts` ESM. This mission eliminates the last CJS barrier in `lib/commands/`, allowing downstream consumers (CLI entry point `px.js`, other commands, test files) to import exclusively from `.ts` ESM sources without `require()` interop. Completing this wave also enables removing `lib/commands/*.js` from `.eslintignore` and `.gitignore`, tightening the static-analysis gate.

## Refinement Signals

- Predicted NEL bucket: Large (235+)
- Confidence: High
- Selection note: activate as-is; dependency chain is fully resolved
- Main drivers: dependency-wave heuristic (ADR 0036), zero-CJS-debt target (ADR 0042), all upstream waves already merged

## Scope

### Files converted

1. **`lib/commands/integrate.js` → `lib/commands/integrate.ts`** (1673 lines)
   - Imports: `lib/core/git`, `lib/tools/backlog`, `lib/core/state-map`, `lib/tools/forgejo`, `lib/core/fmt`, `lib/core/runtime-matrix`, `lib/core/verification`, `lib/core/product-config`, `lib/review/review-state`, `./stats`
   - Key exports: `integrate` (main function), `finalizeVariantACloseout`, `resolveConflictsForMission`, `buildConflictResolutionPrompt`, `VARIANT_B_AUTOMATION_SUMMARY`, `stashMainWorktreeIfNeeded`, `restoreMainCheckoutStash`, `evaluateTaskStatusForIntegration`, `findExistingSquashCommit`, `printIntegrationPreflight`, all integration-gate functions (≥20 gate exports), `SYNC_MERGED_DIAGNOSTICS`, `printDiagnosticTable`, `reportSyncMergedFailure`
   - Test coverage: `test/integrate.test.js` (1616-line test file, extensive mocking), `test/resolve-conflict.test.js`, `test/integrate-guard.test.js`, `test/integrate-workflow-gate.test.js`, `test/sync-merged-retry.test.js`

2. **`lib/commands/rebase.js` → `lib/commands/rebase.ts`** (635 lines)
   - Imports: `lib/core/git`, `./integrate` (internal — converted in this mission), `lib/core/mission-utils`, `lib/agents/agents`, `lib/tools/forgejo`, `lib/tools/backlog`, `lib/review/review-state`, `lib/core/product-config`, `lib/core/fmt`, `lib/core/verification`
   - Key exports: `rebase` (main function), `buildRebasePrompt`, `parseConflictFilesFromRebaseOutput`
   - Test coverage: `test/rebase.test.js` (723 lines), `test/rebase_hardening.test.js`, `test/rebase_diagnostics.test.js`

3. **`lib/commands/resolve-conflict.js` → `lib/commands/resolve-conflict.ts`** (112 lines)
   - Imports: `./integrate` (internal — converted in this mission), `lib/core/mission-utils`, `lib/agents/agents`, `lib/core/fmt`, `lib/core/verification`
   - Key exports: `resolveConflict` (main function), `buildAgentResolutionPrompt`
   - Test coverage: `test/resolve-conflict.test.js` (493 lines)

4. **`lib/commands/review.js` → `lib/commands/review.ts`** (14 lines)
   - Imports: `../review/review-commands` (internal — already `.ts` from Wave 3)
   - Key exports: `reviewCommand` (wraps `review` from review-commands)
   - Test coverage: `test/review.test.js` (3994 lines), `test/review-commands.test.js`, `test/review-artifacts.test.js`, `test/review-events.test.js`

### Upstream prerequisites (already completed)

- `lib/core/*` → `.ts` (Wave 1: TASK-1366)
- `lib/agents/*` → `.ts` (Wave 2: TASK-1372)
- `lib/review/*` → `.ts` (Wave 3: TASK-1373)
- `lib/tools/*` → `.ts` (Wave 4: TASK-1374)
- `lib/commands/diff.js`, `lib/commands/draft.js`, `lib/commands/status.js`, `lib/commands/verify.js`, `lib/commands/handoff.js`, `lib/commands/checkpoint.js`, `lib/commands/config.js`, `lib/commands/setup.js`, `lib/commands/setup-review.js`, `lib/commands/mission-start.js`, `lib/commands/repair-handoff.js`, `lib/commands/stats.js`, `lib/commands/active.js`, `lib/commands/stats-backfill.js`, `lib/commands/coverage-gate.js` → `.ts` (converted in earlier waves)

### Conversion rules

- Faithful rename per file: `git diff -M --summary <merge-base> -- lib/commands/X.js lib/commands/X.ts` reports a `rename` ≥ 50%. `integrate.js` (1673 lines) must be converted in place — a rewrite would lose rename detection; preserve names, helpers, formatting, comments, export shape.
- Replace `const X = require('...')` with `import X from '...'` / `import { named } from '...'` using paths relative to `lib/commands/` pointing to `.ts` files (e.g., `import { git } from '../core/git.js'`).
- Replace `module.exports = fn` / `module.exports.key = val` with ES `export default` / `export const key = val`.
- Preserve all JSDoc annotations (`/** @type{...} */`, `/** @param{...} */`, `/** @returns{...} */`).
- Add explicit TypeScript types where JSDoc already describes types; use `// @ts-expect-error` only when a third-party or circular dependency genuinely lacks types (document each exception).
- After converting each file: `git rm --cached lib/commands/X.js` (the old `.js` is regenerated by `npm run build:cjs` from the new `.ts`; no `package.json` change needed).
- Add `lib/commands/*.js` to `.gitignore` to suppress compiled output.
- Add `lib/commands/*.js` to `.eslintignore` with `!lib/commands/integrate.js`, `!lib/commands/rebase.js`, `!lib/commands/resolve-conflict.js`, `!lib/commands/review.js` negations for the still-hand-written files. Delete each negation as the corresponding file is converted.
- No changes to `tsconfig.json` are needed — it already includes `lib/**/*.ts` and excludes `lib/**/*.js` from emission.

### Files NOT touched

- `lib/commands/stats.js` — imported by `integrate.js` as `const stats = require('./stats')`; already converted to `.ts` in an earlier wave, no changes needed.
- `px.js` (CLI entry) — not modified; it uses dynamic `require()` to load commands.
- Test files — remain `.js` (the project convention).

## Out of Scope

- Any behavioral changes to the 4 commands (logic must remain identical).
- Converting `px.js` CLI entry to ESM.
- Adding new features, tests, or documentation beyond what the conversion requires.
- Removing CJS interop from other `lib/` directories not already converted.
- Migrating test files from `.js` to `.ts`.
- Changing `.gitignore` or `.eslintignore` patterns for directories other than `lib/commands/`.

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable with concrete evidence.

1. **Rename detection:** `git diff -M --summary $(git merge-base HEAD origin/main) -- lib/commands/integrate.js lib/commands/integrate.ts` reports `rename 100%` or `rename >= 50%`. Same for `rebase.js`, `resolve-conflict.js`, `review.js`.
2. **Zero CJS exports:** `grep -rc 'module\.exports' lib/commands/integrate.ts lib/commands/rebase.ts lib/commands/resolve-conflict.ts lib/commands/review.ts` returns exit code 1 (no matches).
3. **Zero CJS requires:** `grep -rc 'require(' lib/commands/integrate.ts lib/commands/rebase.ts lib/commands/resolve-conflict.ts lib/commands/review.ts` returns exit code 1 (no matches), except `require('node:xxx')` built-in imports which are replaced with native `import`/`require`.
4. **Compiled output absent from tracking:** `git ls-files lib/commands/{integrate,rebase,resolve-conflict,review}.js` produces no output (all 4 `.js` files removed from git index).
5. **TypeScript compilation clean:** `npm run typecheck` (i.e., `tsc --noEmit`) exits with code 0 on the final tree.
6. **ESLint clean:** `npx eslint --ext .js --max-warnings 0 lib/` exits with code 0 on the final tree with compiled `.js` present.
7. **Full test suite passes:** `npm test` exits with code 0 on the final tree.
8. **Packaging integrity:** `npm run prepublishOnly && npm pack --dry-run | grep 'lib/commands/'` shows compiled `.js` files for all 4 commands in the package tarball.
9. **Runtime loadability:** `node -e "require('./lib/commands/integrate')"` and `node -e "require('./lib/commands/rebase')"` and `node -e "require('./lib/commands/resolve-conflict')"` and `node -e "require('./lib/commands/review')"` each load without errors and expose expected exports.
10. **No unfixed skipped tests:** `grep -rn '\.skip\|\.only' test/*.test.js | grep -v '//'` returns no results (no bare `.skip` or `.only` in any test file).
11. **`.gitignore` updated:** `lib/commands/*.js` appears in `.gitignore`.
12. **`.eslintignore` updated:** `lib/commands/*.js` appears in `.eslintignore` with all 4 negation lines removed (since all 4 files are now `.ts`).

## Risks and Assumptions

- **Risk: `integrate.js` is the largest file (1673 lines, ~100 exports).** The conversion must preserve every exported symbol and its signature exactly. Loss of a single export will break downstream consumers. Mitigation: extract the full `module.exports` table before conversion and verify every export has a corresponding ES `export`.
- **Risk: Circular internal imports.** `rebase.js` imports `resolveConflictsForMission` from `integrate.js`, and `resolve-conflict.js` also imports from `integrate.js`. Both are converted in this mission. ES module circular imports behave differently than CJS — the default export must be a named function or the `integrate` file must use named exports for the shared functions. Mitigation: convert `integrate.js` to use named exports for `resolveConflictsForMission`, `buildConflictResolutionPrompt`, and `VARIANT_B_AUTOMATION_SUMMARY` (all already named exports in the CJS version).
- **Assumption: All upstream dependencies are already `.ts` ESM.** The task description confirms TASK-1366, TASK-1372, TASK-1373, TASK-1374 are prerequisites and are assumed complete. If any upstream is still CJS, the `import` statements in the converted files will fail at runtime.
- **Assumption: JSDoc annotations are sufficient for TypeScript type inference.** The existing files are heavily annotated with JSDoc. Most types should carry over cleanly. Manual type additions may be needed for complex callback signatures.
- **Assumption: `git diff -M` rename detection threshold of 50% is achievable.** With faithful in-place conversion (no reordering, no renaming of symbols, no structural changes), rename detection should report 100%.

## Checkpoints

- CP 1: Convert `lib/commands/review.ts` (14 lines) — smallest file, validates the conversion pattern, no internal command dependencies.
- CP 2: Convert `lib/commands/resolve-conflict.ts` (112 lines) — imports from `integrate.js` (internal), validates inter-command import handling.
- CP 3: Convert `lib/commands/rebase.ts` (635 lines) — imports from `integrate.js` (internal), validates larger file conversion with complex conflict parsing.
- CP 4: Convert `lib/commands/integrate.ts` (1673 lines) — largest file, ~100 exports, validates preservation of full API surface.
- CP 5: Update `.gitignore` and `.eslintignore` — add `lib/commands/*.js` to both; remove all 4 negation lines from `.eslintignore`.
- CP 6: Verify `git ls-files lib/commands/{integrate,rebase,resolve-conflict,review}.js` is empty; verify `git diff -M` rename detection for all 4 files.
- CP 7: Run `npm run typecheck` — must be clean.
- CP 8: Run `npm test` — full suite must pass.
- CP 9: Run `./scripts/verify-local.sh static-analysis` — must be green.
- CP 10: Run `npm run prepublishOnly && npm pack --dry-run | grep 'lib/commands/'` — compiled `.js` must appear in package.
- CP 11: Run `node -e "require('./lib/commands/integrate')"` etc. — all 4 commands must load with exports intact.

## Gates

- [ ] ./scripts/verify-local.sh static-analysis
- [ ] npm test
- [ ] test -z "$(git ls-files lib/commands/{integrate,rebase,resolve-conflict,review}.js)"
- [ ] ! grep -rl 'module\.exports' lib/commands/integrate.ts lib/commands/rebase.ts lib/commands/resolve-conflict.ts lib/commands/review.ts
- [ ] npm run prepublishOnly && npm pack --dry-run 2>&1 | grep -q 'lib/commands/'

## Restricted Areas

- **Do not modify `px.js`** (CLI entry point) — it dynamically requires commands and is out of scope.
- **Do not modify test files** — they remain `.js` and should continue to import from the converted `.ts` sources via the compiled `.js` output.
- **Do not modify `tsconfig.json`** — it already correctly targets `lib/**/*.ts`.
- **Do not modify `lib/commands/stats.js`** — already converted to `.ts` in an earlier wave; `integrate.ts` imports it as `./stats.js` (ESM path).
- **Do not change any command behavior** — only module syntax and file extensions change.

## Stop Rules

- Stop if `tsc --noEmit` reports errors that indicate a fundamental misunderstanding of the module system (not just missing type annotations). Escalate before proceeding.
- Stop if any test in `test/integrate.test.js`, `test/rebase.test.js`, or `test/resolve-conflict.test.js` starts failing due to the conversion (not a pre-existing flake). Investigate and fix before proceeding.
- Stop if `git diff -M` rename detection falls below 50% for `integrate.js` — this indicates the conversion was too aggressive (rewritten rather than faithfully migrated).
- Stop if `npm pack --dry-run` does not include compiled `.js` files for any of the 4 commands — this indicates a build pipeline issue.
