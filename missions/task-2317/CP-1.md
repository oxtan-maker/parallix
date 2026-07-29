# CP-1: Workflow-boundary inspection

Inspected the execute, act-on-review, and review prompt contracts together with the review-loop launch paths. The execute prompt requires mission gates before handoff but does not yet direct compaction after a successful declared gate. The act-on-review and review templates likewise have no explicit compaction/reload instruction. The review loop runs a pre-review gate before reviewer launch, re-captures the baseline after a successful rebase, and has separate failure-bounce and recovery launch paths that need the same durable-state contract.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Located mission-declared gate instruction and current missing post-success boundary | `prompts/execute.md:12`, `prompts/execute.md:26` | PASS |
| Located implementation-to-act-on-review prompt and launch path, independent of gate parsing | `prompts/act-on-review.md:10`, `src/platform/runtime/lib/review/review-loop.ts:1466` | PASS |
| Located reviewer round launch after rebase/baseline capture and pre-review gate | `src/platform/runtime/lib/review/review-loop.ts:1147`, `src/platform/runtime/lib/review/review-loop.ts:1166`, `src/platform/runtime/lib/review/review-loop.ts:1214` | PASS |
| Located repairable gate-failure bounce and recovery relaunch paths | `src/platform/runtime/lib/review/review-loop.ts:429`, `src/platform/runtime/lib/review/review-loop.ts:475`, `src/platform/runtime/lib/review/review-loop.ts:1537` | PASS |

Next action: Add compact-and-reload instructions to each boundary prompt, including the independent no-gates transition and diagnostic/retry recovery state.
