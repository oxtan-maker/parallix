# Mission: Complete TypeScript migration for Parallix CLI (task-1364)

## Goal

Convert the remaining 7 JavaScript source files in `lib/` to TypeScript, producing a fully-typed codebase with zero hand-written `.js` source files under `lib/`. All 50+ existing tests must pass, `tsc --noEmit` must report clean, and `./scripts/verify-local.sh static-analysis` must pass with compiled `.js` present on disk.

## Why Now

- The TypeScript migration infrastructure (build:cjs, gitignore patterns, ESLint flat-config with compiled-JS ignores) was finalized in TASK-1367. All subsequent waves (TASK-1366 onward) have been rebasing on top of it.
- 50 of ~57 `lib/` source files are already `.ts` — only 7 remain, representing the last ~737 lines of hand-written JavaScript.
- Two of the remaining files (`nels.js`, `subagent-limit.js`) are explicitly referenced in `eslint.config.mjs` as negation overrides (lines 84–127). Until they are converted, the flat-config must maintain a separate linting block for legacy JS.
- Keeping any JS source in `lib/` risks confusion about what is hand-written vs generated, undermining the "`.ts` is the only source of truth in git" principle established in the mission description.

## Refinement Signals

- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: Straightforward mechanical conversion; no architectural decisions required.
- Main drivers: Finalize TS migration; remove ESLint flat-config negation overrides; eliminate mixed-language source tree.

## Scope

### In scope

1. **Convert 7 `lib/` JS files to `.ts`** (faithful rename, ≥50% `git diff -M`):
   - `lib/core/nels.js` (199 lines) — NEL computation and bucket classification
   - `lib/core/subagent-limit.js` (28 lines) — subagent limit prefix builder
   - `lib/commands/mission-start.js` (262 lines) — mission startup preflight
   - `lib/commands/setup.js` (3 lines) — setup wizard re-export wrapper
   - `lib/commands/verify.js` (1 line) — verification re-export wrapper
   - `lib/commands/repair-handoff.js` (230 lines) — handoff repair logic
   - `lib/commands/setup-review.js` (14 lines) — setup-review command wrapper

2. **Per-file conversion steps** (as defined in the backlog task):
   - Rename `.js` → `.ts` with minimal changes (faithful rename)
   - Replace `require`/`module.exports` with `import`/`export`
   - Add inline `@type` annotations where JSDoc is sparse
   - `git rm --cached` the old `.js` file
   - Update `.gitignore` to include `D/*.js` for each directory (if not already present)
   - Update `eslint.config.mjs`: remove the explicit `files: ['lib/core/nels.js', 'lib/core/subagent-limit.js']` negation block (lines 83–127) once both files are converted
   - Verify with `tsc --noEmit`, `npm test`, and `./scripts/verify-local.sh static-analysis`

3. **ESLint flat-config cleanup**: Remove the dedicated `lib/core/nels.js` / `lib/core/subagent-limit.js` linting override block (lines 83–127 of `eslint.config.mjs`) since those files will cease to exist as `.js`.

4. **Compile-time verification**: After all conversions, `npm run build:cjs` must produce all compiled `.js` artifacts without errors; `npm pack --dry-run` must list them under `lib/`; `node -e "require('./lib/X')"` must load each converted module with exports intact.

### Out of scope

- Converting test files (`test/*.test.js`) — they remain as CJS per existing convention.
- Converting root-level files (`index.js`, `px.js`) — already converted to `.ts` (`index.ts`, `px.ts` exist).
- Adding new features or refactoring logic.
- Changing the `build:cjs` script or `tsconfig.json` structure (infrastructure is already in place).
- Migrating the `files` array in `package.json` (already includes `"lib/"`).
- Updating documentation beyond reflecting the completed migration state.

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion is falsifiable and enumerates specific elements.

1. **Zero hand-written `.js` under `lib/`**: `git ls-files 'lib/**/*.js'` returns no files (only compiled artifacts, which are gitignored). Verified by `git ls-files lib/**/*.js` returning empty.

2. **All 7 files converted to `.ts` with faithful rename**: For each of the 7 files, `git diff -M --summary <merge-base> -- <old-path> <new-path>` reports rename ≥50%. Specifically:
   - `lib/core/nels.js` → `lib/core/nels.ts`
   - `lib/core/subagent-limit.js` → `lib/core/subagent-limit.ts`
   - `lib/commands/mission-start.js` → `lib/commands/mission-start.ts`
   - `lib/commands/setup.js` → `lib/commands/setup.ts`
   - `lib/commands/verify.js` → `lib/commands/verify.ts`
   - `lib/commands/repair-handoff.js` → `lib/commands/repair-handoff.ts`
   - `lib/commands/setup-review.js` → `lib/commands/setup-review.ts`

3. **No `require`/`module.exports` in converted files**: `grep -r 'require(' lib/core/nels.ts lib/core/subagent-limit.ts lib/commands/mission-start.ts lib/commands/setup.ts lib/commands/verify.ts lib/commands/repair-handoff.ts lib/commands/setup-review.ts` returns zero matches. Only `import`/`export` syntax remains.

4. **TypeScript compilation clean**: `tsc --noEmit` exits with code 0 and produces zero diagnostic messages.

5. **All existing tests pass**: `npm test` exits with code 0 and reports at least 107 passing tests (baseline preserved from pre-mission state).

6. **Static-analysis gate passes**: `./scripts/verify-local.sh static-analysis` exits with code 0 with compiled `.js` present on disk (produced by `npm run build:cjs` before the gate runs).

7. **ESLint flat-config simplified**: The dedicated `files: ['lib/core/nels.js', 'lib/core/subagent-limit.js']` block (lines 83–127 of `eslint.config.mjs`) is removed. All remaining lint rules are covered by the general `**/*.ts` block only.

8. **Distribution works end-to-end**: `npm run prepublishOnly && npm pack --dry-run | grep 'lib/'` lists compiled `.js` files under `lib/core/`, `lib/commands/`, `lib/agents/`, `lib/tools/`, and `lib/review/`. Each module loads via `node -e "require('./lib/X')"`.

## Risks and Assumptions

- **Assumption**: All 7 files already have sufficient JSDoc annotations (the backlog task notes 283+ `@param`/`@returns` annotations exist across the codebase). If JSDoc is sparse on any file, inline `@type` annotations will be added.
- **Risk**: Circular dependencies. The backlog task permits a minimal lazy `require()` only to break genuine circular dependencies. Current codebase has none identified among the 7 files, but the converter must verify.
- **Risk**: `mission-start.js` has extensive inline JSDoc type annotations (`/** @param {...} */`) that may need restructuring for ES module syntax. The conversion pattern (faithful rename, preserve export shape) minimizes risk here.
- **Risk**: `eslint.config.mjs` line 84 hardcodes the paths `lib/core/nels.js` and `lib/core/subagent-limit.js`. These must be removed during the mission, or ESLint will fail on non-existent files.
- **Assumption**: The `build:cjs` script (`tsc --rootDir . --outDir . --module CommonJS --moduleResolution Node --esModuleInterop`) already handles all `lib/**/*.ts` files generically — no `package.json` change is needed per-wave.
- **Assumption**: `.gitignore` already covers `lib/core/*.js`, `lib/commands/*.js`, `lib/agents/*.js`, `lib/tools/*.js`, `lib/review/*.js` (confirmed by reading the file).

## Checkpoints

- CP 1: Convert the 3 smallest files (`lib/commands/setup.js`, `lib/commands/verify.js`, `lib/commands/setup-review.js`), verify rename ≥50%, `tsc --noEmit` clean, `npm test` at baseline.
- CP 2: Convert `lib/core/subagent-limit.js`, verify rename ≥50%, `tsc --noEmit` clean, `npm test` at baseline, confirm `build:cjs` produces `lib/core/subagent-limit.js`.
- CP 3: Convert `lib/core/nels.js` (largest core file, 199 lines, complex glob matching logic), verify rename ≥50%, `tsc --noEmit` clean, `npm test` at baseline (include `test/nels.test.js`), confirm `build:cjs` produces `lib/core/nels.js`.
- CP 4: Convert `lib/commands/repair-handoff.js` (230 lines, async logic, git rebase integration), verify rename ≥50%, `tsc --noEmit` clean, `npm test` at baseline (include `test/repair-handoff.test.js`).
- CP 5: Convert `lib/commands/mission-start.js` (262 lines, most complex command, many injected dependencies), verify rename ≥50%, `tsc --noEmit` clean, `npm test` at baseline (include `test/mission-start.test.js`).
- CP 6: Remove the `lib/core/nels.js` / `lib/core/subagent-limit.js` ESLint flat-config override block (lines 83–127 of `eslint.config.mjs`). Run `./scripts/verify-local.sh static-analysis` with compiled `.js` present. Run `npm pack --dry-run` to verify distribution. Final `git ls-files 'lib/**/*.js'` confirms zero tracked JS source files.

## Gates

- [ ] npm run typecheck
- [ ] npm test
- [ ] ./scripts/verify-local.sh static-analysis
- [ ] git ls-files 'lib/**/*.js'

## Restricted Areas

- **Do not modify** `tsconfig.json` — the existing config (`allowJs: false`, `strict: true`, `module: NodeNext`) is correct for the migration.
- **Do not modify** `package.json` scripts — `build:cjs`, `pretest`, `prepublishOnly` are already configured.
- **Do not modify** test files (`test/*.test.js`) — they remain as CJS.
- **Do not convert** root-level `index.js` or `px.js` — they are already `index.ts` and `px.ts`.
- **Do not alter** the `files` array in `package.json` — it already includes `"lib/"`.
- **Do not modify** `.gitignore` beyond ensuring per-directory `*.js` globs are present (they already are).

## Stop Rules

- Stop if `tsc --noEmit` fails with errors that cannot be resolved by adding type annotations (indicating a deeper architectural issue). Escalate rather than hack around.
- Stop if `npm test` regresses below the baseline count (107 tests). Investigate and restore before proceeding.
- Stop if any file's `git diff -M` rename percentage drops below 50% — indicates over-aggressive rewriting. Revert to a more faithful conversion.
- Stop if `./scripts/verify-local.sh static-analysis` fails after conversion — the gate must pass before merging.
- Stop if a circular dependency is discovered that cannot be broken with a minimal lazy `require()` — escalate for architectural review.
