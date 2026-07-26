# CP-1 — Type narrowing for `context.task.matches` in `integrate.ts`

## Summary

Removed the single `@ts-ignore` directive in `src/platform/runtime/lib/commands/integrate.ts` (previously at line 1348) and replaced it with real typing:

- Added the mission-specified `if (context.task.matches)` guard around the `.forEach()` call.
- Annotated the callback parameter as `(match: string)`.

The suppressed error was in fact `TS7006: Parameter 'match' implicitly has an 'any' type` — the enclosing `printIntegrationPreflight` declares `context: any` (`src/platform/runtime/lib/commands/integrate.ts:1256`), so the leading `/** @type{string} */` JSDoc cast on the callback parameter was inert in a `.ts` file. Replacing it with a real TS parameter annotation resolves the error without suppression. Verified by removing the JSDoc cast and re-running `npm run typecheck`, which still reported TS7006 until the `: string` annotation was added.

No behavioral change: `resolveTaskFile` only ever returns `reason: 'ambiguous'` together with a populated `matches` array (`src/platform/runtime/lib/tools/backlog.ts:102`, `:126`, `:131`), so the new guard is always true on the reachable path.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 (partial): no `@ts-ignore` remains in `integrate.ts` | `src/platform/runtime/lib/commands/integrate.ts:1348` now reads `if (context.task.matches) {`; `grep -rn "@ts-ignore" src/platform/runtime/lib/commands/integrate.ts` returns no matches | PASS |
| AC#2: `context.task.matches` typed/guarded | `src/platform/runtime/lib/commands/integrate.ts:1348-1350` — runtime guard plus `(match: string)` annotation; JSDoc contract already declares `matches?: string[]` at `src/platform/runtime/lib/commands/integrate.ts:1253` | PASS |
| SC2: `npm run typecheck` clean | `` `npm run typecheck` `` (`tsc --noEmit`) exits 0 with no diagnostics on the current tree | PASS |
| SC5: no behavioral change | `src/platform/runtime/lib/tools/backlog.ts:102`, `:126`, `:131` — every `reason: 'ambiguous'` return carries a `matches` array, so the guard never suppresses previously-emitted output | PASS |
| SC6: no new suppressions in changed file | `src/platform/runtime/lib/commands/integrate.ts:1348-1350` contains no `@ts-ignore` / `@ts-expect-error` / `/** @type {string} */` cast | PASS |

Next action: CP-2 — remove the 5 `@ts-ignore` directives in `src/platform/runtime/lib/tools/setup-review.ts` (lines 934, 938, 1013, 1017, 1024) by marking `repo` optional in the `bootstrapReviewSurface` JSDoc and extracting a typed local after the existing early-return guard.
