# CP-4 — Compatibility and final proof

## Summary

Compatibility assertions now compare the session marker's unchanged
`.workflow/sessions/<slug>-<role>.json` path and exact three-field JSON fixture, and verify the
NEL record retains its unchanged mission path, six fields, and single final newline. No schema,
filename, or location migration was introduced.

The implementation-only diff under `lib/` and `test/` is 410 additions plus 24 deletions,
434 lines total. This is within the mission's 250–500 target, so no writer migration was deferred
and no follow-up backlog task is required. Inventory rows outside the bounded tranche remain
explicitly classified exceptions, not silently deferred scope.

`graphify update .` rebuilt the code graph to 15,636 nodes and 16,203 edges. The mission's
static-analysis gate passed ESLint, TypeScript, and test hygiene. The full verifier completed
with 2,169 passing tests, 0 failures, and 25 existing annotated skips.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 exactly-one-class inventory includes all required path families | `lib/core/durable-state-inventory.ts:1`; `test/durable-state-policy.test.js`, "durable-state inventory assigns every required path exactly one recognized class" | PASS |
| SC2 one durable API provides parent creation, UTF-8, newline, atomic rename, cleanup, and error propagation | `lib/core/storage.ts:160`; `lib/core/storage.ts:172`; `test/storage.test.js`, "writeJson creates parents and serializes UTF-8 with exactly one final newline" | PASS |
| SC3 replacement modes and sensitive-file guarantees are preserved | `lib/core/storage.ts:179`; `test/storage.test.js`, "writeFileAtomic successfully replaces content and preserves permission mode"; `test/setup-review.test.js`, "bootstrapReviewSurface writes token files and configures the review remote" | PASS |
| SC4 session and NEL writers use the approved API while generated/cache writers remain exceptions | `lib/tools/sessions.ts:50`; `lib/commands/handoff.ts:1088`; `lib/core/durable-state-inventory.ts:54`; `lib/core/durable-state-inventory.ts:61` | PASS |
| SC5 persistence failure is caller-visible and prevents dependent success/state advancement | `lib/agents/agents.ts:501`; `lib/commands/handoff.ts:390`; `test/agents.test.js`, "startAgent rejects instead of reporting launch success when session persistence fails"; `test/handoff.test.js`, "performHandoff stops before review transitions when NEL persistence fails" | PASS |
| SC6 write failure, rename failure, stale-temp cleanup, replacement, and prior-file preservation are covered | `test/storage.test.js`, "writeFileAtomic propagates write failure and removes its stale temporary file"; "writeFileAtomic propagates rename failure and preserves the previous valid file"; "writeFileAtomic successfully replaces content and preserves permission mode" | PASS |
| SC7 policy guard accepts exact documented exceptions and rejects a new direct writer | `test/durable-state-policy.test.js:42`; "direct durable JSON write guard passes only inventory-documented exceptions"; "direct durable JSON write guard rejects a new non-inventoried writer" | PASS |
| SC8 session and NEL paths and schemas are unchanged | `test/sessions.test.js:34`, "writeSession preserves the legacy path and exact JSON field structure"; `test/handoff.test.js:1083`, "captureNelAtHandoff writes nel-record.json with predicted bucket, actual NEL, actual bucket, review rounds" | PASS |
| SC9 implementation diff is within 250–500 lines | `git diff --numstat main -- lib test` records 410 additions + 24 deletions = 434 implementation lines | PASS |
| SC10 all focused and declared gates pass | `node --test test/storage.test.js test/sessions.test.js test/sessions-coverage.test.js test/agents.test.js test/handoff.test.js test/durable-state-policy.test.js`; `./scripts/verify-local.sh static-analysis`; `./scripts/verify-local.sh all` (2,169 passed, 0 failed) | PASS |

Next action: Parallix may hand TASK-2222 to review with the committed CP-1 through CP-4 evidence; the reviewer should begin with the storage fault matrix and the two caller-level fail-closed tests named above.
