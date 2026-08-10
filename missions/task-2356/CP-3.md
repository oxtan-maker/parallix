# CP-3 — Repository identity and completion semantics

## Work summary

Certified the existing canonical repository and lifecycle-completion path. The production adapter scopes lane events and usage rows to its repository ID, while the shared CLI/board regression demonstrates the same scoped population and mission-completion result. No identity or writer correction was required.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Board metrics exclude records from another repository with overlapping mission IDs | `src/application/projections/metrics-read-adapter.ts:107`, "metrics built for alpha exclude lane events recorded for beta" | PASS |
| Repository identity survives persisted lane-event round trip | "entryToEvent(eventToEntry(event)).repositoryId equals original for non-null from" | PASS |
| Primary checkout and worktree resolve to one repository identity | "repository id from mission worktree path equals id from primary checkout" | PASS |
| Repository scoping is retained rather than broadened | `src/application/projections/metrics-read-adapter.ts:108`, "metrics for named repository exclude legacy-unscoped rows" | PASS |
| CLI and board share lifecycle-completion semantics | "task-2347.08 repro: CLI and board agree on identity, completions, and cycle time" | PASS |
| Identity and completion regression suite passes | `npm test -- test/task-2347-01-repository-identity-repro.test.ts test/task-2347.08-own-statistics-semantics-repro.test.ts` | PASS |

Next action: repair per-metric observation coverage and keep lifecycle review bounce distinct from review-fix telemetry.
