# CP-6: Stop on ambiguous historical repair candidates

The nullable measurement path is already verified against real SQLite writes. Before applying the irreversible telemetry-column migration to the operator DB, the required local inspection found lifecycle `integration` candidates `task-2002`, `task-2322.07`, `task-2324`, and `task-2329`. Historical `closed=yes` telemetry is present but does not establish a landed squash/integration commit for each candidate, so no Mission, event, repository alias, or review-fix value was changed.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Nullable review-fix rounds survive SQLite round trips | `test/task-2357.c-unknown-review-fix-rounds.test.ts`, `stores an unknown count as SQL NULL and excludes it from cohort aggregates`; `test/measurement-store-cutover.test.ts`, `measurement store preserves unavailable numeric measurements as undefined, not zero` | PASS |
| Historical repair changes only obvious landed cases | `node --import tsx` inspection of `usage_statistics` and `missions`; `missions/task-2367/CP-6.md` | STOPPED — landed integration is ambiguous for `task-2002`, `task-2322.07`, `task-2324`, `task-2329` |
| No duplicate lifecycle completion was introduced | `src/application/mission-integration-service.ts`; `test/task-2367-integration-completion-repro.test.ts`, `TASK-2367: a landed retry does not duplicate an already-completed Mission` | PASS |

Next action: Obtain durable landed-integration evidence for the listed Mission IDs before authorizing the local-DB repair and removal of the live database telemetry column.
