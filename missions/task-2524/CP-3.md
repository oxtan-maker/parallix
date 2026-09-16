# CP-3: Slug-prefix integrity regression

Added coverage proving the committed backlog integrity gate rejects an open
file and a differently named completed file with the same exact task slug.
The existing exact-ID check is deliberately reused, avoiding false positives
for distinct dotted task IDs.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Renamed slug-prefix twins fail integrity | "TASK-2524: backlog integrity rejects renamed slug-prefix twins" in `test/task-2524-slug-duplicate-closeout-repro.test.ts` | Complete |
| Integrity is consumed by the drafting/status path | `src/adapters/cli/commands/draft-stats.ts`; `src/adapters/backlog/task-file-io.ts` | Complete |
| Distinct dotted task IDs remain valid | "checkBacklogIntegrity accepts dotted subtask ids when filename and frontmatter match" in `test/backlog.test.ts` | Complete |

Next action: remove the three stale open task copies while retaining their completed canonical records.
