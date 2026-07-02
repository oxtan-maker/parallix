# Mission: Fix all TypeScript no-unused-vars warnings and promote to errors (task-1401)

## Goal

Eliminate all 244 TypeScript `no-unused-vars` ESLint warnings across 23 files in `lib/` and the root `px.ts`, and change the `no-unused-vars` ESLint rule from `warn` to `error` so that future JS-to-TS migrations cannot reintroduce these warnings.

## Why Now

The JS-to-TS migration missions produced 244 `no-unused-vars` warnings (0 errors) that pass the static-analysis gate despite being visually noisy and masking real issues. The warnings fall into four categories: unused function parameters from fixed interface signatures, unused caught-error bindings, unused type-only imports, and unused local variable assignments. Leaving them means every developer and every AI agent sees hundreds of false-positive warnings on every lint run, degrading signal quality and discouraging the lint gate.

## Refinement Signals

- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: 244 mechanical fixes with a single ESLint config change; scope is fully bounded by the static-analysis output
- Main drivers: volume of warnings (244), clear fix pattern (underscore-prefix params, remove dead imports), ESLint config change prevents regression

## Scope

### In scope

1. **ESLint config change** (`eslint.config.mjs`): Change the `no-unused-vars` rule from `['warn', {...}]` to `['error', {...}]` in both the `.ts` and `.js` file configs (lines 70 and 117). The existing ignore patterns (`/^_/`, `/^_|^name$/`, `/^_/`) already cover the fix strategy.

2. **Unused caught-error bindings** — rename to `_` prefix (6 occurrences across 3 files):
   - `lib/agents/agents.ts:595` — `catch (err)` → `catch (_err)`
   - `lib/commands/draft.ts:491` — `catch (error)` → `catch (_error)`
   - `lib/core/mission-utils.ts:932` — `catch (e)` → `catch (_e)`
   - `lib/core/mission-utils.ts:949` — `catch (err)` → `catch (_err)`

3. **Unused function parameters** — rename to `_` prefix (218 occurrences across 21 files). These are all callback/event/command handler parameters whose signatures are fixed by external interfaces. Rename strategy: single-param → `_`, multi-param → `_1`, `_2`, etc. Notable clusters:
   - `lib/review/review-artifacts.ts`: ~82 unused params across many callbacks
   - `lib/review/review-commands.ts`: ~51 unused params across command handlers
   - `lib/review/review-loop.ts`: ~18 unused params
   - `lib/review/rebase.ts`: ~18 unused params
   - `lib/review/review-polling.ts`: ~12 unused params
   - `lib/review/review-events.ts`: ~14 unused params
   - `lib/commands/stats-backfill.ts`: ~14 unused params
   - `lib/core/state-map.ts`: ~4 unused params
   - `lib/commands/config.ts`: ~3 unused params
   - `lib/core/gitignore.ts`: ~3 unused params
   - All remaining files with 1–2 unused params each

4. **Unused type imports** — remove dead imports (12 occurrences in 1 file):
   - `lib/commands/stats.ts`: Remove unused type imports `CsvData`, `TelemetryToStatsOptions`, `UpsertStatsRowOptions`, `RecordStageStatsOptions`, `RecordIntegrationStatsOptions`, `RecordActiveStatsOptions`, `RecordReviewStatsOptions`, `RenderWeeklyStatsReportOptions`, `RenderRangeStatsReportOptions`, `MissionStats`, `AccModeOptions`, `StatsCmdOptions` (lines 31–100)

5. **Unused value imports** — remove or prefix (3 occurrences in 2 files):
   - `lib/commands/stats.ts:175` — `getPrimaryWorktree` import unused → remove
   - `lib/core/git.ts:1` — `childProcess` import unused → remove
   - `lib/review/review-state.ts:290` — `result` assigned but never used → prefix to `_result`

6. **Root file** — `px.ts:11` — `(id: string)` parameter unused → rename to `_id`

7. **Other unused params** — remaining ~12 occurrences spread across `lib/core/fmt.ts`, `lib/core/persistent-data-migration.ts`, `lib/core/spawn-tee.ts`, `lib/core/storage.ts`, `lib/core/verification.ts`, `lib/commands/coverage-gate.ts`, `lib/commands/rebase.ts`, `lib/commands/resolve-conflict.ts`, `lib/review/review-state.ts`

### Out of scope

- Changing `tsconfig.json` or TypeScript compiler options
- Fixing warnings in non-`.ts` files (JS files, if any, are excluded by the compiled-js ignores)
- Changing the ESLint ignore patterns (the existing patterns are sufficient)
- Modifying `lib/index.ts` unless it introduces new warnings
- Adding new ESLint rules beyond changing `no-unused-vars` from warn to error
- Test changes (no tests are affected by unused-variable fixes)

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

1. `./scripts/verify-local.sh static-analysis` reports **0 warnings** from ESLint (not just 0 errors). The output must show `PASS: ESLint clean` with no warning lines.
2. `eslint.config.mjs` contains `no-unused-vars` set to `['error', {...}]` in **both** the `.ts` config block (line ~70) and the `.js` config block (line ~117). Verified by grepping the file for `'no-unused-vars': ['error'`.
3. `npx tsc --noEmit` reports **0 errors** (tsc typecheck remains clean).
4. All 12 unused type/value imports listed in Scope item 4–5 are removed from `lib/commands/stats.ts` (verified by confirming zero `CsvData`, `TelemetryToStatsOptions`, `UpsertStatsRowOptions`, `RecordStageStatsOptions`, `RecordIntegrationStatsOptions`, `RecordActiveStatsOptions`, `RecordReviewStatsOptions`, `RenderWeeklyStatsReportOptions`, `RenderRangeStatsReportOptions`, `MissionStats`, `AccModeOptions`, `StatsCmdOptions`, `getPrimaryWorktree` imports remain in that file).
5. The `childProcess` import is removed from `lib/core/git.ts:1`.
6. Zero files in `lib/` or `px.ts` contain `catch (err)`, `catch (error)`, `catch (e)` patterns where the binding is not underscore-prefixed. Verified by grep for `catch \((err|error|e)\)` with no leading underscore.
7. Zero ESLint `no-unused-vars` warnings appear in the static-analysis output for any of the 23 originally-warned files.

## Risks and Assumptions

- **Risk**: Some callback parameters may be used dynamically (e.g., via `arguments.length` checks or spread). Assumption: none of the 218 unused params are accessed this way — verified by reading each file's context.
- **Risk**: Removing unused imports could break barrel exports if the import exists solely for side effects. Assumption: all 13 removed imports are type-only or value-only imports with no side effects — verified by checking `import type` vs `import` and confirming the imported symbols are not re-exported.
- **Assumption**: The ESLint ignore patterns (`/^_/`, `/^_|^name$/`, `/^_/`) are correct and sufficient for our fix strategy. No changes to these patterns are needed.
- **Assumption**: Renaming parameters to `_`, `_1`, `_2` does not change runtime behavior. Parameters are not destructured or referenced elsewhere.
- **Risk**: `lib/review/review-artifacts.ts` has 82 warnings — the largest cluster. Risk of missing one. Mitigation: run ESLint incrementally after fixing to catch any stragglers.

## Checkpoints

- CP 1: Change `eslint.config.mjs` — set `no-unused-vars` from `warn` to `error` in both config blocks. Verify with `./scripts/verify-local.sh static-analysis` that warnings are now errors (expected: ESLint fails with errors, confirming the rule change took effect).
- CP 2: Fix unused imports — remove all dead imports in `lib/commands/stats.ts` (12 type imports + `getPrimaryWorktree`), `lib/core/git.ts` (`childProcess`), and verify no new tsc errors.
- CP 3: Fix unused caught-error bindings — rename `err`/`error`/`e` to `_err`/`_error`/`_e` in `lib/agents/agents.ts`, `lib/commands/draft.ts`, `lib/core/mission-utils.ts`.
- CP 4: Fix unused function parameters — rename all unused params to `_` prefix across remaining 20 files, prioritizing by warning count (review-artifacts, review-commands, review-loop, rebase, review-events, review-polling, stats-backfill, then the rest).
- CP 5: Final verification — `./scripts/verify-local.sh static-analysis` passes with 0 warnings and 0 errors. `npx tsc --noEmit` passes. Test-hygiene check passes.

## Gates

- [ ] ./scripts/verify-local.sh static-analysis
- [ ] ./scripts/verify-local.sh docs

## Restricted Areas

- `node_modules/` — do not modify
- `dist/` — do not modify (generated output)
- `test/` — do not modify (no test changes needed)
- `eslint.config.mjs` — only change the `no-unused-vars` rule severity from `warn` to `error`; do not modify ignore patterns, parser config, or other rules
- `tsconfig.json` — do not modify
- `package.json` — do not modify dependency versions

## Stop Rules

- Stop immediately if `npx tsc --noEmit` reports errors after any fix — revert that change and investigate.
- Stop if any removed import causes a downstream file to fail compilation (indicates a hidden dependency or re-export).
- Stop if ESLint reports new errors in files not originally warned about (indicates collateral damage).
- Stop if any callback parameter rename breaks a runtime call site (indicates the parameter is used indirectly).
