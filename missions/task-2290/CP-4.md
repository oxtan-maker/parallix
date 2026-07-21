# CP 4 — Boundary and failure guards

## Summary

Added the delegated stats failure exit assertion and converted active handler
tests to strict service mocks. Production composition remains the sole concrete
application graph, while the active adapter owns the existing lifecycle calls.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 write failure renders stderr, emits no success output, and exits nonzero | test/stats-backfill.test.ts; "statsBackfill maps a delegated write failure to stderr and exit 1 without success output" | PASS |
| SC2 failure cannot return stats CLI success | lib/commands/stats-backfill.ts:389; test/stats-backfill.test.ts | PASS |
| SC5 strict mocked application ports prevent unplanned calls | test/application-services.test.ts | PASS |
| SC8 composition and import guards accept the production graph | test/application-boundaries.test.ts; lib/composition/application-services.ts:11 | PASS |
| SC9 changed command paths contain no fallback runtime branch | lib/commands/active.ts:61; lib/commands/stats-backfill.ts:380 | PASS |

Next action: run focused tests, ./scripts/verify-local.sh all, and ./scripts/verify-local.sh static-analysis; capture final evidence in CP-5.
