# CP-1: Red-to-green reproduction test

## Summary

Authored reproduction test and implemented fix in `deriveImplementerAndFixRounds`.

**Bug:** `deriveImplementerAndFixRounds` counted `rounds[].decision?.kind === 'changes-requested'` but the live review loop never writes that decision field. The live loop writes `reviewer_outcome` events with `verdict: 'request-changes'` to `review.reviewEvents` via `persistEventInStore`.

**Fix:** `deriveImplementerAndFixRounds` now counts from `review.reviewEvents` first (the live-written source), falls back to `rounds[].decision` for pre-cutover missions, and returns `null` when count cannot be determined.

**Changes:**
- `src/adapters/cli/commands/stats.ts:1430-1460` — rewrote fix-round counting to use `reviewEvents` as primary source
- `test/task-2347.10-repro.test.ts` — 4 reproduction tests (1 red-to-green, 2 multi-round, 1 unknown)

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Red-to-green test: 1 change-request round records pr_fix_rounds=1 | `test/task-2347.10-repro.test.ts:111`, `"deriveImplementerAndFixRounds counts fix rounds from reviewEvents (task-2347.10 repro)"` — was 0, now 1 | PASS |
| Two change-request rounds record 2 | `test/task-2347.10-repro.test.ts:179`, `"deriveImplementerAndFixRounds counts two fix rounds from reviewEvents (task-2347.10)"` | PASS |
| Approved-first-time mission records 0 | `test/task-2347.10-repro.test.ts:247`, `"deriveImplementerAndFixRounds returns 0 for approved-first-time mission (task-2347.10)"` | PASS |
| Unknown count returns null (not confident 0) | `test/task-2347.10-repro.test.ts:290`, `"deriveImplementerAndFixRounds returns unknown when no reviewEvents and no decision (task-2347.10)"` | PASS |
| Existing deriveImplementerAndFixRounds tests still pass | `test/stats.test.ts` — 62 tests pass, including `"deriveImplementerAndFixRounds counts the rounds the reviewer sent back to the final implementer (task-1318)"` | PASS |

Next action: CP-2 — rename metric to `review_change_request_rounds`, update `summarizeAgentWindow` to exclude null/unknown from averages, and update all references.
