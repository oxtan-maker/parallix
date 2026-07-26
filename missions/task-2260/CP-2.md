# CP-2 — Type narrowing for `bootstrapReviewSurface` in `setup-review.ts`

## Summary

Removed all 5 `@ts-ignore` directives from `src/platform/runtime/lib/tools/setup-review.ts` (previously at lines 934, 938, 1013, 1017, 1024) with real narrowing rather than suppression.

**Divergence from the mission's prescribed fix, and why.** The mission (and the `@ts-ignore` comment text) attributed these to `setup.repo` being possibly undefined. That diagnosis is wrong: `bootstrapReviewSurface` declares `setup: any` (`src/platform/runtime/lib/tools/setup-review.ts:900`), so `setup.repo` is `any` and never errors. Removing the 5 directives and running `npm run typecheck` reported the actual diagnostic five times — `TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string'` — pointing at the **`baseUrl`** argument, because `normalizeBaseUrl` returns `string | undefined` (`src/platform/runtime/lib/tools/setup-review.ts:35-37`) while `ensureRepo` / `ensureRepoCollaborators` / `tokenCreateViaOwnerToken` take `baseUrl: string`.

Fix applied:

- Moved `const baseUrl = normalizeBaseUrl(setup.baseUrl)` above the existing early-return guard and changed that guard's first clause from `!setup.baseUrl` to `!baseUrl` (`src/platform/runtime/lib/tools/setup-review.ts:907-914`). This reuses the guard that was already there — no new early return — and narrows `baseUrl` to `string` for all five downstream call sites.
- Updated the JSDoc contract on `bootstrapReviewSurface` so the optional fields are honest: `baseUrl?: string, repo?: string` (`src/platform/runtime/lib/tools/setup-review.ts:893`), matching the runtime guard that already tolerates both being absent (AC#3).

Behavior equivalence: `normalizeBaseUrl` returns non-string inputs unchanged and only strips trailing slashes from strings, so `!baseUrl` is falsy exactly when `!setup.baseUrl` is — the sole divergence is a degenerate all-slashes string (`"///"`), which previously passed the guard and produced an empty base URL and now returns the same config error. No new `@ts-ignore`, `@ts-expect-error`, or `/** @type {string} */` assertion was added (SC6); the pre-existing inert casts at lines 922/931/960 were left untouched as out of scope.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 / AC#1: zero `@ts-ignore` in both files | `grep -rn "@ts-ignore" src/platform/runtime/lib/tools/setup-review.ts src/platform/runtime/lib/commands/integrate.ts` returns no matches; former sites now `src/platform/runtime/lib/tools/setup-review.ts:934`, `:937`, `:1011`, `:1014`, `:1020` | PASS |
| AC#3: `setup.repo` typed properly (optional + guarded) | `src/platform/runtime/lib/tools/setup-review.ts:893` — JSDoc now `baseUrl?: string, repo?: string`; guarded via `parseRepoSlug` at `src/platform/runtime/lib/tools/setup-review.ts:907` and the `!repoInfo` early return at `:912` | PASS |
| SC2 / AC#4: `npm run typecheck` passes | `` `npm run typecheck` `` (`tsc --noEmit`) exits 0 with no diagnostics | PASS |
| SC3 / AC#5: static-analysis gate green | `` `./scripts/verify-local.sh static-analysis` `` — "ALL STAGES PASSED" across ESLint, typecheck, test-hygiene, test typecheck | PASS |
| SC5 / AC#7: no behavioral change | `test/setup-review.test.ts` — 31/31 pass, including `"bootstrapReviewSurface writes token files and configures the review remote"` and `"bootstrapReviewSurface non-interactive mode creates agent token via owner token"`; guard reuses existing early return at `src/platform/runtime/lib/tools/setup-review.ts:912` | PASS |
| SC6: no new suppressions/assertions | `src/platform/runtime/lib/tools/setup-review.ts:907-914` — narrowing is a plain truthiness guard, no cast | PASS |

Next action: CP-3 — run the full mission gate `./scripts/verify-local.sh all` (ESLint, typecheck, test-hygiene, test typecheck, full `npm test` suite) against the final tree and record the pass counts.
