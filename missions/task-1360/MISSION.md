# Mission: Clean up ESLint violations so the static-analysis gate passes stage 1 (task-1360)

## Goal

Drain all 603 ESLint errors from `lib/` so that `./scripts/verify-local.sh static-analysis` exits 0 at stage 1 (ESLint), enabling the combined three-stage static-analysis gate to be measured end-to-end once TASK-1361 also lands.

## Why Now

TASK-1353 merged the static-analysis gate (`./scripts/verify-local.sh static-analysis`) on `main`. The gate currently aborts at stage 1 — ESLint reports 603 errors across `lib/`, so no mission that opts into the static-analysis area can proceed, and success criterion 4 of task-1353 (combined three-stage runtime) cannot be measured. Draining this backlog unblocks the gate for all downstream missions.

## Refinement Signals

- Estimated agent % usage limit: 25-50%
- Confidence: High
- Selection note: activate as-is
- Main drivers: gate is permanently red; 490 of 603 errors are auto-fixable via `--fix`; remaining 113 are mechanical but require judgment (no-unused-vars removal, eqeqeq null-ish idioms, 2 no-undef root causes).

## Scope

Files in `lib/` that carry ESLint errors. Per the top offenders:

- `lib/review/review-commands.js` (57 errors)
- `lib/commands/stats.js` (49 errors)
- `lib/core/mission-utils.js` (49 errors)
- `lib/tools/forgejo.js` (44 errors)
- `lib/tools/backlog.js` (36 errors)
- `lib/agents/opencode-telemetry.js` (31 errors)
- `lib/commands/stats-backfill.js` (27 errors)
- `lib/agents/limit-hit.js` (23 errors)
- `lib/review/review-loop.js` (23 errors)
- `lib/tools/setup-review.js` (23 errors)
- `lib/review/review-artifacts.js` (22 errors)
- `lib/agents/opencode.js` (21 errors)
- `lib/agents/codex-telemetry.js` (14 errors)
- `lib/commands/integrate.js` (14 errors)
- `lib/review/review-events.js` (13 errors)
- `lib/agents/agents.js` (11 errors)
- `lib/agents/claude-telemetry.js` (10 errors)
- `lib/commands/coverage-gate.js` (10 errors)
- `lib/commands/draft.js` (10 errors)
- `lib/agents/claude.js` (9 errors)
- All other `lib/**/*.js` files with any ESLint errors

Fix categories:

1. **490 `curly` errors** — run `eslint --fix` to auto-add braces around single-line if bodies.
2. **95 `no-unused-vars` errors** — remove dead variable bindings and unused function parameters. Do not add `/* eslint-disable */` comments.
3. **16 `eqeqeq` errors** — investigate each `== null` / `!= null` usage. Preserve intentional null-ish idioms (where `== null` is used to check both `null` and `undefined`), converting only where the comparison targets a known non-null value. Document each decision inline.
4. **2 `no-undef` errors** — root-cause and fix:
   - `lib/commands/rebase.js:360` — `fetchReviewBranchFn` is not defined (missing import or reference).
   - `lib/review/review-commands.js:1161` — `os` is not defined (missing `const os = require('os')` import).

Constraints:

- Do not change the 8 configured rules in `.eslintrc.cjs`.
- Do not add any `eslint-disable` or `eslint-disable-next-line` comments.
- Do not change `.eslintrc.cjs` or `package.json` eslint version pin.

## Out of Scope

- Changing `.eslintrc.cjs` rules or relaxing any rule to warning.
- Adding `eslint-disable` comments anywhere.
- ESLint cleanup for files outside `lib/` (e.g., `scripts/`, test files).
- TypeScript/type errors (handled by TASK-1361, stage 2 of the gate).
- Wiring the static-analysis gate into the integration pipeline as a required gate (tracked in TASK-1362).
- Modifying `scripts/verify-local.sh`.

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

- **SC1:** `./scripts/verify-local.sh static-analysis` exits 0 at stage 1 (ESLint stage prints `PASS: ESLint clean` and proceeds to stage 2).
- **SC2:** `./node_modules/.bin/eslint --ext .js --max-warnings 0 lib/` exits 0 with **zero** errors and **zero** warnings.
- **SC3:** Zero `eslint-disable`, `eslint-disable-next-line`, or `eslint-disable-line` comments exist anywhere in `lib/` as a result of this mission.
- **SC4:** Both `no-undef` findings are resolved: `os` is imported in `lib/review/review-commands.js` and `fetchReviewBranchFn` is properly referenced/imported in `lib/commands/rebase.js`.
- **SC5:** All 16 `eqeqeq` fixes either preserve the `== null` / `!= null` null-ish idiom (with an inline comment noting the intent) or convert to `=== null` / `!== null` only where the operand is provably non-null/non-undefined. No `eqeqeq` errors remain.
- **SC6:** `.eslintrc.cjs` is unchanged from its pre-mission state (same 8 rules at `"error"` severity).
- **SC7:** `npm test` passes (0 failures, same or fewer skipped tests than baseline).

## Risks and Assumptions

- **Risk:** Auto-fixing `curly` with `--fix` may alter control-flow readability in edge cases (e.g., `else` clauses). Mitigation: review the diff for `curly` changes; revert any that introduce misleading nesting.
- **Risk:** Removing a `no-unused-vars` binding could break code that relies on side effects of an unused parameter (e.g., callback signatures). Mitigation: verify each removal does not change behavior; if the parameter is part of a callback signature, keep it but prefix with `_` if the convention supports it, or leave it if removing it would alter the call site contract.
- **Risk:** Rewriting `eqeqeq` `== null` to `=== null` could introduce nullish-reference errors if callers pass `undefined`. Mitigation: trace callers; only convert where the value is known to be a non-null object or primitive string/number.
- **Assumption:** `npm install` dependencies are available for linting (project-local eslint ^8.57.0).
- **Assumption:** The `lib/` directory is the sole ESLint target; no ESLint errors exist in other directories that would interfere with the gate.
- **Assumption:** TASK-1353's gate script (`verify-local.sh`) is stable and will not change during this mission.

## Checkpoints

- **CP 1:** Run `eslint --fix` on `lib/` — resolves 490 `curly` errors. Verify remaining count.
- **CP 2:** Drain 95 `no-unused-vars` errors — remove dead bindings. Verify count drops to 18 (16 eqeqeq + 2 no-undef).
- **CP 3:** Root-cause and fix 2 `no-undef` errors (`os` import, `fetchReviewBranchFn` reference). Verify count drops to 16.
- **CP 4:** Resolve 16 `eqeqeq` errors — deliberate conversion or preservation with comments. Verify `lib/` lints clean.
- **CP 5:** Final gate check — `./scripts/verify-local.sh static-analysis` stage 1 passes, `npm test` passes.

## Gates

- [ ] `./node_modules/.bin/eslint --ext .js --max-warnings 0 lib/` exits 0
- [ ] `npm test` passes
- [ ] `./scripts/verify-local.sh static-analysis` stage 1 prints `PASS: ESLint clean`

## Restricted Areas

- **`.eslintrc.cjs`** — do not modify rules, parser options, or env settings.
- **`scripts/verify-local.sh`** — do not alter the gate script.
- **`package.json`** — do not change dependency versions.
- **Non-`lib/` directories** — do not touch ESLint in `scripts/`, `test/`, or any other directory.
- **Do not add suppression comments** — no `eslint-disable`, `eslint-disable-next-line`, or `eslint-disable-line` anywhere in `lib/`.

## Stop Rules

- Stop if fixing a `no-unused-vars` removal would require changing a public API callback signature (preserve the parameter).
- Stop if any `eqeqeq` fix would alter runtime null/undefined semantics; preserve the original `== null` idiom in that case.
- Stop if `npm test` begins failing due to ESLint-related changes (indicates behavioral regression).
- Stop if the `no-undef` root cause reveals a deeper architectural issue requiring design discussion (flag as a separate task).
- Stop if `.eslintrc.cjs` needs modification to reach a clean state — this indicates the scope has shifted from code cleanup to config relaxation, which is out of scope.
