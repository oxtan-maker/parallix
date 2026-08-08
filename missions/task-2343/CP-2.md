# CP-2: Checkpoint, gate and pull-request sources reconnected

## Summary

Three adapters now read the source the lifecycle already owns. Each repair uses
an existing type or an existing artifact path; no parser, port, table or
projection field was added.

**`ConcreteMissionReadAdapter`** (SC2) — checkpoint records are materialised
through `parseCheckpointDocument()` in
`src/adapters/backlog/checkpoint-document.ts`, the compatibility translator that
already existed in this adapter package and that the checkpoint render path is
written against. It was unreferenced before this change, which is why
`goalCheck` and `nextActionText` were hardcoded to `[]` and `''`. Reading the
document through it means the board and the application boundary agree on what
a Goal Check row is. One seam (`readCheckpointFile`) was added, matching the
eleven the adapter already exposes; an unreadable or non-`CP-N` document
degrades to the empty contract instead of dropping the checkpoint.

**`recordGateResult` + `ConcreteGateReadAdapter`** (SC3) — the gate adapter
already looked for `<mission>/.workflow/gate-result.json`; nothing wrote it.
`px checkpoint` runs `runVerificationGate()` and holds a real exit code, so
`recordGateResult()` in `src/adapters/verification/verification.ts` — the module
that owns gate execution — writes that exit code beside the mission, for a
passing and a failing run alike. `parseGateStatus` now reads the recorded
`exitCode` in preference to its text heuristic, so a recorded failure wins over
any surrounding prose. ADR 0048 classifies an agent's own account of a gate as
failure class 1, which is why the status is derived from the exit code and never
from a checkpoint's Goal Check row. `.workflow/` is gitignored
(`.gitignore:6`), so the artifact stays an operator-local observation.

**Pull-request reference** (SC1) — `PullRequestReference` is an existing domain
value and `SqliteMissionStore` already persists it in dedicated round columns
(`src/adapters/sqlite/mission-store.ts:514`). The gap was that nothing set it and
the flattened loop-state view dropped it. `ReviewStateData` gained a typed
`pullRequest` field rather than another untyped `metadata` key;
`review-state-mapping.ts` writes it onto the round subject and flattens it back
out; `review-loop.ts` records the reference once it has confirmed an open PR for
the branch. `ConcreteReviewReadAdapter` builds the reviewed change through one
`reviewedChangeFrom()` helper shared by `loadReview` and `loadReviewApproval`, so
`sameReviewedRevision` still matches and `reviewApproved` keeps working. An
invalid reference is refused by `assertReviewedChange` rather than written.

All four previously red reproduction assertions are green:
`npx tsx --test test/task-2343-board-projection-repro.test.ts` → 7 pass, 0 fail.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: a review with a Forgejo PR reference projects a non-null card `pullRequest` | `src/adapters/backlog/concrete-review-read-adapter.ts:47`, test `"task-2343 repro: card projects the Forgejo PR number from the review round"` | PASS |
| SC1: the reference survives the Review aggregate round trip | `src/adapters/review/review-state-mapping.ts:41`, tests `"a confirmed PR reference is written onto the round and flattened back out"` and `"an invalid PR reference is refused rather than written onto the round"` | PASS |
| SC1: `loadReview` and `loadReviewApproval` agree on the reviewed change | `test/task-2343-lifecycle-persistence.test.ts`, test `"loadReview and loadReviewApproval agree on the reviewed change"` | PASS |
| SC1: `test/domain-projections.test.ts` still covers the projection policy | `test/domain-projections.test.ts`, `./scripts/verify-local.sh all` | PASS |
| SC2: `nextActionText` and `goalCheck` come from the latest checkpoint document | `src/adapters/backlog/concrete-mission-read-adapter.ts:312`, `src/adapters/backlog/checkpoint-document.ts:36`, test `"task-2343 repro: mission adapter parses the checkpoint Goal Check table"` | PASS |
| SC2: no second checkpoint parser was introduced | `src/adapters/backlog/checkpoint-document.ts` is the only `## Goal Check` parser; `npx tsc --noEmit` clean | PASS |
| SC3: gate status is derived from the verifier exit code, not from prose | `src/adapters/verification/verification.ts:211`, `src/adapters/backlog/concrete-gate-read-adapter.ts:101`, test `"ConcreteGateReadAdapter reads the recorded exit code in preference to prose"` | PASS |
| SC3: the existing gate-status union and artifact precedence are retained | `src/adapters/backlog/concrete-gate-read-adapter.ts:56`, `test/adapters/concrete-adapters-cp2.test.ts` unchanged and passing | PASS |
| SC3: a null exit code is recorded as `failed`, never `passed` | `test/task-2343-lifecycle-persistence.test.ts`, test `"a null gate exit code is recorded as failed, never as passed"` | PASS |
| SC7: no `BoardProjection`, `MissionCard` or read-adapter interface change | `src/application/projections/board-readers.ts:22`, `src/application/projections/mission-board.ts:47` unchanged; `npx tsc --noEmit` clean | PASS |
| Reproduction test is green after the fix | `npx tsx --test test/task-2343-board-projection-repro.test.ts` → 7 pass, 0 fail | PASS |

Next action: Append each lifecycle operation to `operational_history` in the same transaction as its `board_lane_events` row, then rerun `npx tsx --test test/task-2343-lifecycle-persistence.test.ts`.
