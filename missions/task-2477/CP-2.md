# CP 2 — Independent-review framing

## Work done
Verified the two duplicate happy-path emissions are removed at source, confirmed
the review-start header order, demoted the remaining provider-disabled plumbing
to verbose, and added focused tests for single emission, both independence
cases, and default-vs-verbose visibility.

- Duplicate reviewer selection: single site at `src/adapters/review/review-agent-fallback.ts:460` (`Selected reviewer: ...`). The `review-loop.ts` duplicate was already gone.
- Duplicate pre-review gate: single site at `src/adapters/review/review-gate-handling.ts:117` (`Pre-review gate passed for area "..."`). The `review-loop.ts` round-body duplicate was already gone.
- Review-start header (`review-loop.ts`) now prints, in order, before the first reviewer launch:
  - `REVIEW — <slug>`
  - `Implementer: <implementer>`
  - `Reviewer: <reviewer>`
  - `Independence: <reviewIndependence(implementer, reviewer)>`
  - verbose-only: `Branch`, `Focus … | Max attempts`, `Poll interval … | Poll timeout …`
- Independence derived from agent-family identity, not display names:
  `reviewIndependence` in `review-loop.ts` compares the implementer/reviewer
  family strings → `'different-family review'` vs `'same-family fallback / self-review'`.
- Demoted to verbose (config/plumbing, not failures):
  - `review-loop.ts:403` `Forgejo validation skipped (review provider is not forgejo)…`
  - `review-loop.ts:554` `Round N: review provider disabled; using workflow-owned review state.`
  - `review-loop.ts:995` `Round N: review provider disabled; using workflow-owned disposition state.`
  - `review-artifacts.ts:476` `Persisted reviewer artifacts to repo store: …` was already `if (options.verbose)` gated.

## Demo Replay Findings
Continuation of CP-1. Defects from the stale committed cast and their disposition:

| Defect (from CP-1) | Source | Action |
|---|---|---|
| #1 duplicate `Selected reviewer` | `review-loop.ts` (former) + `review-agent-fallback.ts:460` | Removed at source; one site remains. Tested: `test/task-2477-review-presentation.test.ts` "single pre-review gate pass emission…" counts one happy-path gate call; `test/task-1209-review-loop.test.ts` asserts exactly one `Selected reviewer:`. |
| #2 combined header, no independence | `review-loop.ts` | Recomposed into four separate header lines (slug/implementer/reviewer/independence). |
| #3 `Focus … | Max attempts` at review priority | `review-loop.ts` header | Demoted to verbose (already gated). |
| #4 `Poll interval … | Poll timeout` at review priority | `review-loop.ts` header | Demoted to verbose (already gated). |
| #5 `Forgejo validation skipped` chatter | `review-loop.ts:403` | **Demoted to verbose in this checkpoint.** |
| #6 `review provider disabled … review state` chatter | `review-loop.ts:554` | **Demoted to verbose in this checkpoint.** |
| #7 `review provider disabled … disposition` chatter | `review-loop.ts:995` | **Demoted to verbose in this checkpoint.** |
| #8 duplicate `Pre-review gate passed` | `review-loop.ts` (former) + `review-gate-handling.ts:117` | Removed at source; one site remains. |
| #10 misleading independence | — | `reviewIndependence` derives from family identity. Tested: `test/task-2351-review-loop-selection.test.ts` "review presentation classifies different-family and same-family fallback from agent-family identity". |
| #11 `Persisted reviewer artifacts` chatter | `review-artifacts.ts:476` | Verbose-gated. Confirmed by test. |

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Reviewer selection announced exactly once on happy path | `Selected reviewer` single site `src/adapters/review/review-agent-fallback.ts:460`; `test/task-1209-review-loop.test.ts` "startReviewLoop skips reviewer and implementer launches for autonomous fallback in provider=none mode" asserts `Selected reviewer:` count === 1 | PASS |
| Pre-review gate success announced exactly once per round | `Pre-review gate passed` single site `src/adapters/review/review-gate-handling.ts:117`; `test/task-2477-review-presentation.test.ts` "single pre-review gate pass emission on the happy path" asserts one gate call | PASS |
| Review-start header names slug, implementer, reviewer, independence before first launch | `review-loop.ts` review-start block | PASS |
| Independence from family identity; same-family never emits different-family wording | `reviewIndependence` `review-loop.ts`; `test/task-2351-review-loop-selection.test.ts` "review presentation classifies different-family and same-family fallback from agent-family identity" | PASS |
| Poll/timeout/max-attempts/provider/persistence absent at default, present under verbose | `review-loop.ts:403/554/995` verbose-gated; `review-artifacts.ts:476` verbose-gated; `test/task-2477-review-presentation.test.ts` "verbose review start exposes poll/provider lines that default hides" | PASS |
| Duplicate emissions removed at source (not filtered downstream) | `review-agent-fallback.ts:460`, `review-gate-handling.ts:117` | PASS |

## Next action
Make the verdict first-class and state-derived, render blocking findings on
`CHANGES REQUESTED`, and add the infra-failure / non-approved / findings tests
(CP-3).
