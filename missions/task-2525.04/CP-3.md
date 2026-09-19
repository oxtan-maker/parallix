# CP-3: Continue fixes — `parseCheckpointDocument` Goal-Check table parser

## Summary

Resolved the next testable-by-path slice at its code site.
`parseCheckpointDocument` (`src/adapters/backlog/checkpoint-document.ts:36`,
cx 16) ran a Goal-Check table state machine inline inside the public parser,
mixing name-validation, first-line extraction, goal-check scanning, and
next-action extraction into one function. Extracted the goal-check scanning
loop into a dedicated `parseGoalCheckTable(lines)` helper that returns the
criterion/evidence rows; `parseCheckpointDocument` now composes it. Behavior
is identical — the loop body moved verbatim, and name/first-line/next-action
logic is unchanged.

Added focused regression tests in `test/checkpoint-document.test.ts` covering
each newly reachable branch: table stops at the next `##` heading, rows with
<2 cells end the table, the alternate `## Goal Check Table` heading is
accepted, non-`CP-n` names throw, multiple `Next action:` lines keep the last,
and `renderCheckpointDocument` round-trips through `parseCheckpointDocument`.

No rule disabled/suppressed/downgraded; `sonar-project.properties` untouched.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: this finding accounted for (fixed at site) | S3776 finding `src/adapters/backlog/checkpoint-document.ts:36` resolved by `parseGoalCheckTable` extraction; remains in `missions/task-2525.02/s3776-findings.tsv` with updated disposition | PASS |
| SC2: changed control flow has focused regression tests | `test/checkpoint-document.test.ts` — 7 tests incl. `"parseCheckpointDocument stops scanning at the next ## heading after the Goal Check table"`, `"parseCheckpointDocument ignores rows with fewer than two cells by ending the table"` | PASS |
| SC2: affected test file passes | `npm test -- test/checkpoint-document.test.ts` → 7 pass, 0 fail | PASS |
| SC3: no suppression | `sonar-project.properties` not edited; no rule disabled/suppressed/downgraded | PASS |
| SC4: no relocation / metric-only close | behavior preserved; table-parsing branches verified by passing tests | PASS |
| SC5: static-analysis green after fix | `./scripts/verify-local.sh static-analysis` → ALL STAGES PASSED | PASS |

## Next action

Continue with the next testable-by-path slice from the inventory (e.g.
`src/application/rebase-workflow.ts:30 parseConflictFilesFromRebaseOutput`),
or advance to CP-4 final triage once the assigned slice budget is consumed.
