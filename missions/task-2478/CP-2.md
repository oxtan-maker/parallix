# CP 2 — Finding-first presentation

## Summary of work done

Made the concrete reviewer finding the visible cause of `act-on-review`, so the
operator sees exactly which finding the implementer is launched to address,
without opening any internal artifact.

### Changes

1. **Findings now carry their id to the verdict.** `consumeReviewerArtifacts`
   (`src/adapters/review/review-artifacts.ts`) returns structured
   `{ id, summary }[]` (`reviewFindings`) instead of summary-only strings, so the
   verdict can name the finding. `renderReviewVerdict`
   (`src/adapters/review/review-loop.ts`) now renders
   `Blocking finding: F1 — <summary>` for each finding on the `REQUEST_CHANGES`
   path — the `====== CHANGES REQUESTED ======` banner and the `Blocking finding:`
   line are preserved (criterion 2), and the finding id is named (criterion 5).
   The plain-summary projection (mission board / status) reads the aggregate's
   findings, not this return, so that path is unchanged.

2. **`ACTING ON REVIEW` findings header before the implementer launch.** After
   `renderReviewVerdict` on the fixing branch, the loop now restates each finding
   as `Finding F1: <summary>` before `startAgentFn('act-on-review', …)` is
   launched, so the finding is presented before the implementer's live stream
   (criterion 4 + 5).

### Evidence (runnable)

- `renderReviewVerdict` renders blocking findings with ids:
  `test/task-2351-review-loop-selection.test.ts`
  "review verdict presentation is authoritative and renders blocking findings
  before follow-up work" now asserts `/Blocking finding: F1 — missing validation/`.
- Correction chain presented before the implementer launch:
  `test/task-2478-correction-presentation.test.ts`
  "ACTING ON REVIEW restates the concrete findings before the implementer launch"
  asserts the `ACTING ON REVIEW` block and both `Finding F<n>:` lines appear
  before `launching implementer … act-on-review`.
- Existing presentation contract preserved (APPROVED-before-stop ordering,
  REQUEST_CHANGES emits no APPROVED line, verbose poll/timeout lines):
  `test/task-2477-review-presentation.test.ts` — all 5 tests still pass.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `renderReviewVerdict` emits `====== CHANGES REQUESTED ======` + `Blocking finding:` before implementer launch | `src/adapters/review/review-loop.ts` `renderReviewVerdict`; `test/task-2351-review-loop-selection.test.ts` | PASS |
| Finding is concrete and named (id + summary) before `act-on-review` starts | `src/adapters/review/review-artifacts.ts` `reviewFindings`; `test/task-2478-correction-presentation.test.ts` "ACTING ON REVIEW restates the concrete findings" | PASS |
| Finding originates from real reviewer path, not injected state | `consumeReviewerArtifacts` `src/adapters/review/review-artifacts.ts`; `recordRequestedChanges` `src/adapters/review/review-round.ts` | PASS |
| Implementer live `act-on-review` response not mocked/swallowed in the demo path | `startAgentFn('act-on-review', …)` launched in `src/adapters/review/review-loop.ts`; asserted by `test/task-2478-correction-presentation.test.ts` | PASS |
| Existing review-presentation contract not regressed | `test/task-2477-review-presentation.test.ts` (5 pass) | PASS |
| Static-analysis gate green after edits | `./scripts/verify-local.sh static-analysis` (run before this commit) | PASS |

## Next action
Commit CP-2. Then CP 3: the correction + revised-verification presentation is
already wired in the loop (new-revision line after CHANGES_MADE,
"✓ verification passed against the revised tree" on the round-2 pre-review gate,
"APPROVED · round N" on re-round approval); add a focused test asserting the
round-2 verification line and commit CP-3.
