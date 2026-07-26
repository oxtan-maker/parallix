# Mission: TS cleanup — resolve 6 @ts-ignore directives in lib/ with proper types (task-2260)

## Goal
Remove all 6 `@ts-ignore` directives from `src/platform/runtime/lib/commands/integrate.ts` and `src/platform/runtime/lib/tools/setup-review.ts` by introducing proper type narrowing (optional types + runtime guards) instead of suppression comments.

## Why Now
TASK-2224 converted 6 `@ts-expect-error` directives to `@ts-ignore` as a scoped tradeoff — without `strict` on the test project, the `@ts-expect-error` directives became unused (TS2578). These `@ts-ignore` comments are silent; they suppress errors without surfacing regressions. Resolving them with proper types restores type safety on these call sites and aligns with ADR-0044 (workflow distribution model) which requires the `lib/` layer to use explicit types.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: 2 source files, 6 `@ts-ignore` lines, inline JSDoc-only types, no behavioral change, no new test files needed

## Scope
- `src/platform/runtime/lib/commands/integrate.ts` — resolve 1 `@ts-ignore` at line 1348 (`context.task.matches` possibly undefined). Fix: add `if (context.task.matches)` guard around the `.forEach()` call.
- `src/platform/runtime/lib/tools/setup-review.ts` — resolve 5 `@ts-ignore` directives at lines 934, 938, 1013, 1017, 1024 (`setup.repo` possibly undefined). Fix: update JSDoc type annotation on `bootstrapReviewSurface` to mark `repo` as optional (`repo?: string`), and extract a typed local variable `const repo = setup.repo` after the existing early-return guard (`if (!setup.baseUrl || !repoInfo)`) to satisfy downstream callers that expect `string`.

## Out of Scope
- Converting other `@ts-ignore` or `@ts-expect-error` directives outside these 2 files.
- Adding unit tests for the type narrowing changes (no behavioral change).
- Refactoring the inline JSDoc types into a shared TypeScript interface (that is a future task).
- Modifying `tsconfig.json` or `strict` settings.

## Success Criteria
- SC1: Zero `@ts-ignore` directives remain in `src/platform/runtime/lib/commands/integrate.ts` and `src/platform/runtime/lib/tools/setup-review.ts` after the fix.
- SC2: `npm run typecheck` passes with no new TypeScript errors (exit code 0, 0 errors).
- SC3: `./scripts/verify-local.sh static-analysis` passes all 4 stages (ESLint, tsc --checkJs, test-hygiene, typecheck).
- SC4: `npm test` passes unchanged (all existing tests pass, 0 failures).
- SC5: No behavioral change — the guards use the same early-return logic already present in the functions; reverting the commit restores the `@ts-ignore` directives with identical runtime behavior.
- SC6: No new `@ts-expect-error`, `@ts-ignore`, or `/** @type {string} */` assertions introduced in the changed files.

## Risks and Assumptions
- **Risk:** The `setup.repo` guard in `bootstrapReviewSurface` already returns early when `repo` is missing, so extracting a typed local variable is safe. If a caller passes `repo: undefined` through a different code path, the early guard still catches it.
- **Assumption:** The inline JSDoc types on `bootstrapReviewSurface` (line 893) and the context type on `integrate.ts` (line 684) are the authoritative type definitions — no separate `.d.ts` files override them.
- **Assumption:** `npm run typecheck` (`tsc --noEmit`) with `strict: true` in `tsconfig.json` is the canonical type check and covers the `src/` files.
- **Assumption:** The `@ts-ignore` directives were introduced by TASK-2224 and no other mission has modified these lines since.

## Checkpoints
- CP 1: Implement type narrowing for `context.task.matches` in `integrate.ts` — add `if (context.task.matches)` guard and remove the `@ts-ignore` at line 1348.
- CP 2: Implement type narrowing for `setup.repo` in `setup-review.ts` — update JSDoc `repo` to `repo?: string` in `bootstrapReviewSurface`, extract typed local `const repo = /** @type {string} */ (setup.repo)` after the early-return guard, and remove all 5 `@ts-ignore` directives.
- CP 3: Run `npm run typecheck` and `./scripts/verify-local.sh static-analysis` to verify the final tree.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `lib/commands/handoff.ts:292` (must point to an existing file and line)
  2. **Test names** — e.g., `"real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/e2e-real-agent-smoke.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0048` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `npm test -- test/repair-handoff.test.ts` ``, `` `px review <slug> --verify` ``, or `` `./scripts/verify-local.sh all` ``
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| @ts-ignore removed from integrate.ts | `src/platform/runtime/lib/commands/integrate.ts:1348` — `if (context.task.matches)` guard added, `// @ts-ignore` line removed | PASS |
| setup.repo typed properly | `src/platform/runtime/lib/tools/setup-review.ts:893` — JSDoc updated to `repo?: string`; `src/platform/runtime/lib/tools/setup-review.ts:912` — typed local extracted | PASS |
| Verification gate ran | `` `./scripts/verify-local.sh static-analysis` `` — all 4 stages passed | PASS |

## Gates
- [ ] `./scripts/verify-local.sh all`

## Restricted Areas
- Do not modify `tsconfig.json`, `tsconfig.test.json`, or any `strict`/`checkJs` settings.
- Do not add new files (no new interfaces, no new test files).
- Do not modify files outside `src/platform/runtime/lib/commands/integrate.ts` and `src/platform/runtime/lib/tools/setup-review.ts`.
- Do not change function signatures or return types — only type narrowing within existing functions.

## Stop Rules
- Stop if `npm run typecheck` produces more than 0 errors after the fix — the type narrowing is incorrect.
- Stop if `./scripts/verify-local.sh static-analysis` fails on any stage — do not proceed to `npm test`.
- Stop if the fix requires modifying more than 2 source files — re-scope the mission.
- Stop if the fix introduces any behavioral change (e.g., new early returns not already implied by existing guards) — revert and re-evaluate.
