# CP-2 — Shared primitive and fault model

## Summary

The existing `writeJson`/`writeFileAtomic` pair is now the explicit durable-write contract.
It creates parent directories, serializes JSON as UTF-8 with exactly one final newline, writes a
same-directory temporary file, atomically renames it, and removes that temporary file in a
`finally` block. Replacements preserve the destination mode; new sensitive state can request a
restrictive mode. Filesystem and temp-path seams make write and rename failures deterministic
without swallowing their errors.

Focused tests cover write failure, rename failure, cleanup of a stale/failed temp path,
successful replacement, preservation of the previous valid destination after rename failure,
mode preservation, restrictive new-file mode, parent creation, UTF-8, and newline shape. The
existing Forgejo bootstrap test now also proves both token files remain mode `0600`.

Focused final-gate commands selected here are `node --test test/storage.test.js`,
`node --test test/sessions.test.js test/sessions-coverage.test.js`, and
`node --test test/handoff.test.js` after `npm run build:cjs`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC2 approved JSON and atomic APIs | `lib/core/storage.ts:160`; `lib/core/storage.ts:172` | PASS |
| Parent creation and UTF-8 same-directory replacement | `lib/core/storage.ts:178`; `lib/core/storage.ts:182`; `lib/core/storage.ts:187` | PASS |
| Exactly one serialized JSON newline | `lib/core/storage.ts:168`; `test/storage.test.js`, "writeJson creates parents and serializes UTF-8 with exactly one final newline" | PASS |
| Write errors propagate and failed/stale temp is cleaned | `lib/core/storage.ts:186`; `lib/core/storage.ts:190`; `test/storage.test.js`, "writeFileAtomic propagates write failure and removes its stale temporary file" | PASS |
| Rename errors propagate and prior valid file survives | `lib/core/storage.ts:189`; `test/storage.test.js`, "writeFileAtomic propagates rename failure and preserves the previous valid file" | PASS |
| Successful replacement preserves mode | `lib/core/storage.ts:179`; `lib/core/storage.ts:188`; `test/storage.test.js`, "writeFileAtomic successfully replaces content and preserves permission mode" | PASS |
| Restrictive sensitive mode supported | `lib/core/storage.ts:25`; `test/storage.test.js`, "writeFileAtomic applies a restrictive requested mode to new sensitive state" | PASS |
| Token-file mode guarantee remains 0600 | `lib/tools/setup-review.ts:818`; `test/setup-review.test.js`, "bootstrapReviewSurface writes token files and configures the review remote" | PASS |
| CP-2 focused tests pass | `node --test test/storage.test.js test/setup-review.test.js` (58 passed) | PASS |

Next action: migrate `writeSession` and `captureNelAtHandoff` to `writeJson`, then prove caller-visible failures and add the inventory-backed direct durable JSON write guard.
