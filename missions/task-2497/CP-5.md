# CP-5 — Final verification

The focused TASK-2492 recovery regression and the repository’s declared final
verification gate pass. The landed branch is refused, cannot resume review
work, and uses one guarded cleanup attempt with an actionable failure result.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Active mission payload already contained in main is detected and refused | `test/task-2492-already-merged-detection.test.ts`, `"TASK-2492: squash-landed mission payload is detected as already merged"` | PASS |
| Refusal does not resume duplicate handoff or review | `test/task-2446-repro.test.ts`, `"TASK-2492: recover command does not resume a landed active mission"` | PASS |
| Cleanup is attempted once through the guarded existing seam | `test/task-2492-already-merged-detection.test.ts`, `"TASK-2492: recover command refuses a squash-landed mission and cleans up exactly once"` | PASS |
| Cleanup failure remains actionable and non-completing | `test/task-2446-repro.test.ts`, `"TASK-2492: cleanup failure leaves recovery actionable"` | PASS |
| Normal recovery regression remains intact | `test/task-2446-repro.test.ts`, `"TASK-2438-shaped active task and closed aggregate reports supported recovery and resumes active"` | PASS |
| Declared final verification gate passes | `./scripts/verify-local.sh all` | PASS |

Next action: Parallix may hand this committed mission to review.
