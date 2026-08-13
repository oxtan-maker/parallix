# CP-4: Operator rail and exact attention actions

## Summary

The operator rail now has separate WORKING and NEEDS YOU sections. WORKING
shows a mission's phase and active family from projected `currentWork`; it is
not counted as attention. Attention rows render the projection-owned action
display, and the confirmation path uses that same action's typed command.

TASK-2368 is already closed at
`backlog/completed/task-2368 - agent-running-review-is-not-detected.md`. Its
reported review-lane false attention is covered by the authoritative
current-work path and by the retained focused regression test; no lifecycle
metadata was changed.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC8: WORKING is separate from NEEDS YOU | `test/tui-wave-4-attention.test.ts`, `"working work is separate from NEEDS YOU"` | PASS |
| SC8: displayed attention command and typed confirmation command are identical | `test/tui-wave-4-attention.test.ts`, `"attention action display and its typed confirmation command stay aligned"` | PASS |
| SC9: active, review, and integration publication remains covered | `test/current-work-publication.test.ts`, `"an execute run publishes execute work, then handoff work, then clears it"`, `"px review --start brackets the review loop with review-phase current work"`, `"px integrate brackets the run with integrate-phase current work"` | PASS |
| SC10: TASK-2368 overlap review | `backlog/completed/task-2368 - agent-running-review-is-not-detected.md`, `test/task-2368-agent-running-review-detection.test.ts` | PASS |
| CP-4 focused verification | `npx tsx --test test/tui-wave-4-attention.test.ts test/task-2368-agent-running-review-detection.test.ts test/current-work-publication.test.ts` → 37 pass / 0 fail | PASS |
| SC11: final mission gate | `./scripts/verify-local.sh all` was attempted twice; both runs were interrupted mid-default-suite while other worktrees continuously ran the same gate, so no terminal verifier result is available. | BLOCKED |

Next action: rerun `./scripts/verify-local.sh all` after concurrent worktree verification clears, then record its terminal result before handoff.
