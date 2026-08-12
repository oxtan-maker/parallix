# CP-1: SQLite-only launcher divergence reproduction

## Summary

Added a focused reproduction that writes a future runtime block through
`updateAgentBlockChecked` and asks the launcher seam for the same family. On
the parent implementation the assertion is red: the launcher returns `false`
because it reads only the local configuration file.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SQLite runtime block is written through the checked write seam | `test/task-2345-repro.test.ts`, `"block persisted via updateAgentBlockChecked makes defaultIsAgentBlockedNow return true"` | PASS |
| Reproduction exposes the pre-fix launcher disagreement | `npx tsx --test test/task-2345-repro.test.ts` (observed `false !== true` before CP-2) | PASS (red baseline) |
| Reproduction is runnable against the committed checkpoint | `test/task-2345-repro.test.ts` | PASS |

Next action: Implement the shared authority and route both launcher and board reads through it so the reproduction turns green.
