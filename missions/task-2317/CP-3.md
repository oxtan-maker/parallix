# CP-3: Verify compaction boundaries

Added focused hermetic coverage for successful declared-gate compaction, the no-declared-gates implementation-to-act-on-review path, reviewer round 2 with a post-rebase baseline, repairable gate-error bounce, reviewer and implementer recovery relaunches, and review-launch ordering after baseline recapture. Updated the workflow authority reference to document the matching boundary behavior. Repaired the consumer-requirement citation that shifted when the review-loop instructions were added, then reran the targeted citation test and the final verification gate.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Successful declared gate compacts after success but not after failure | `prompts/execute.md:27`, "task-2317: successful declared-gate instruction compacts only after success and retains failed-gate diagnostics" | PASS |
| No-gates implementation-to-act-on-review path compacts and reloads durable state | `prompts/act-on-review.md:11`, "task-2317: no-declared-gates implementation-to-act-on-review prompt compacts and reloads durable state" | PASS |
| Reviewer round 2 compacts with the post-rebase revision and baseline | `prompts/review.md:13`, "task-2317: reviewer round-2 prompt compacts after rebase and reloads the rewritten baseline", "task-2317: reviewer compaction follows successful rebase and baseline recapture before launch" | PASS |
| Repair bounce and recovery relaunches compact while retaining diagnostics and retry state | `src/platform/runtime/lib/review/review-loop.ts:448`, `src/platform/runtime/lib/review/review-loop.ts:1291`, `src/platform/runtime/lib/review/review-loop.ts:1534`, "task-2317: repairable gate-error bounce compacts before repair and retains diagnostic plus retry state" | PASS |
| Documentation and focused tests cover the workflow behavior | `docs/authority-reference.md:116`, `test/task-2317-context-compaction.test.ts`, `npm test -- test/task-2317-context-compaction.test.ts` | PASS |
| Consumer requirement citation follows the moved review-loop declaration | `src/application/consumer-domain-requirements.ts:310`, "SC3: every consumer citation points at a line containing its anchor" | PASS |
| Required verification gate passed | `./scripts/verify-local.sh all` | PASS |

Next action: Parallix may evaluate the committed CP-1 through CP-3 evidence and advance the mission lifecycle.
