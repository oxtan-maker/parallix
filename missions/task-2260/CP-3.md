# CP-3 — Final verification of the two-file TS cleanup

## Summary

Ran the mission-declared gate, the mandatory integration gate, and the full test suite against the final tree. Both target files are free of `@ts-ignore`, `npm run typecheck` is clean, and both `./scripts/verify-local.sh all` and `./scripts/verify-local.sh integrate` exit 0 (the latter ends with `=== PASS: integration:integration-suite ===`; its 25 skips are the suite's pre-existing conditional skips, with `fail 0`).

Total diff for the mission is two source files, 10 insertions / 11 deletions:

- `src/platform/runtime/lib/commands/integrate.ts` — `@ts-ignore` replaced by an `if (context.task.matches)` guard plus a real `(match: string)` parameter annotation (CP-1).
- `src/platform/runtime/lib/tools/setup-review.ts` — 5 `@ts-ignore` directives replaced by narrowing the existing early-return guard onto the normalized `baseUrl`, plus an honest JSDoc contract (CP-2).

**Two things worth flagging to the reviewer:**

1. The mission's diagnosis of the `setup-review.ts` errors (`setup.repo` possibly undefined) was incorrect — `setup` is declared `any`, so the real five diagnostics were `TS2345` on the **`baseUrl`** argument. The applied fix targets the actual errors; see CP-2 for the reproduction. The mission-prescribed `repo?: string` JSDoc change was still applied, since it makes the documented contract match the runtime guard (AC#3).
2. Backlog AC#6 predicts "2,156+ pass". The current default suite reports **1298 tests, 1298 pass, 0 fail, 0 skipped**; the 2,156 figure predates the current `test/run-default-tests.js` default scope and is not a regression signal. Observed totals also vary run to run (1241–1300 across four runs) because the runner passes `--test-force-exit` (`test/run-default-tests.js:207`), which returns control as soon as the final result prints. Every run reported `fail 0` and exit code 0.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 / AC#1: zero `@ts-ignore` in both target files | `grep -rn "@ts-ignore" src/platform/runtime/lib/commands/integrate.ts src/platform/runtime/lib/tools/setup-review.ts` → no matches; former sites now `src/platform/runtime/lib/commands/integrate.ts:1348` and `src/platform/runtime/lib/tools/setup-review.ts:934`, `:937`, `:1011`, `:1014`, `:1020` | PASS |
| AC#2: `context.task.matches` typed/guarded | `src/platform/runtime/lib/commands/integrate.ts:1348-1350` — runtime guard + `(match: string)`; contract declares `matches?: string[]` at `src/platform/runtime/lib/commands/integrate.ts:1253` | PASS |
| AC#3: `setup.repo` typed/guarded | `src/platform/runtime/lib/tools/setup-review.ts:893` — `repo?: string`; guarded by `parseRepoSlug` at `:907` and the `!repoInfo` early return at `:912` | PASS |
| SC2 / AC#4: `npm run typecheck` passes, 0 errors | `npm run typecheck` (`tsc --noEmit`) exits 0 with no diagnostics | PASS |
| SC3 / AC#5: static-analysis stages (ESLint, tsc typecheck, test-hygiene, test typecheck) all pass | `./scripts/verify-local.sh all` — exit 0; the four stages are defined at `scripts/verify-local.sh:344` and are also covered by `test/verify-local-integrate.test.ts` | PASS |
| SC4 / AC#6: `npm test` passes | `npm test` — `tests 1298 / pass 1298 / fail 0 / skipped 0`, exit 0 (see note 2 above re: the AC's 2,156 figure) | PASS |
| Mission gate ran on final tree | `./scripts/verify-local.sh all` — exit 0, `fail 0` | PASS |
| Mandatory integration gate ran | `./scripts/verify-local.sh integrate` — exit 0, final line `=== PASS: integration:integration-suite ===`, `pass 1314 / fail 0`; entrypoint at `scripts/verify-local.sh:353`, behavior covered by `"verify-local integrate resolves the unconditional integration suite for every required area class (task-2292)"` in `test/verify-local-integrate.test.ts` | PASS |
| SC5 / AC#7: no behavioral change, revert-safe | Modules covering both changes green: `npm test -- test/integrate.test.ts test/integrate-guard.test.ts test/task-1039-integrate.test.ts test/task-1124-integrate.test.ts test/setup-review.test.ts` → 114/114 pass, incl. `"bootstrapReviewSurface writes token files and configures the review remote"` (`test/setup-review.test.ts:150`) and `"bootstrapReviewSurface non-interactive mode creates agent token via owner token"`. Both changes reuse guards already present (`src/platform/runtime/lib/tools/setup-review.ts:912`); `resolveTaskFile` always pairs `reason: 'ambiguous'` with `matches` (`src/platform/runtime/lib/tools/backlog.ts:102`, `:126`, `:131`) | PASS |
| SC6: no new `@ts-expect-error` / `@ts-ignore` / `@type` assertions | `src/platform/runtime/lib/commands/integrate.ts:1348-1350` and `src/platform/runtime/lib/tools/setup-review.ts:907-914` — plain truthiness guards and a TS parameter annotation only; pre-existing inert casts at `src/platform/runtime/lib/tools/setup-review.ts:922`, `:931`, `:960` left untouched per Out of Scope | PASS |
| DoD#3: no focused/bare-skipped tests introduced | No test files changed; the test-hygiene stage of `./scripts/verify-local.sh all` reports "PASS: no test-hygiene violations" (stage defined at `scripts/verify-local.sh:344`) | PASS |
| Restricted areas honored | `git diff --stat` limited to `src/platform/runtime/lib/commands/integrate.ts` and `src/platform/runtime/lib/tools/setup-review.ts` — no `tsconfig*.json` change, no new files, no signature/return-type changes | PASS |

Next action: re-run `px review task-2260 --submit` now that the Goal Check cites `./scripts/verify-local.sh all` and the mandatory `./scripts/verify-local.sh integrate` gate — and flag for the reviewer that the mission's `setup.repo` diagnosis was wrong (the fix narrows `baseUrl` instead, see CP-2) and that Backlog AC#6's "2,156+" pass count is stale relative to the current default suite.
