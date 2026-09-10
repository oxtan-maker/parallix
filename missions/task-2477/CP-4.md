# CP 4 — Real replay closure

## Work done
Re-recorded `docs/assets/first-value-demo.cast` with real agents via
`scripts/record-first-value-demo.sh`, re-rendered `docs/assets/first-value-demo.gif`
via `scripts/render-first-value-demo.mjs`, inspected both, and fixed every
in-scope defect found. Ran the focused review tests directly by file path, then
the full mission gate.

Defects found in the replay and action taken:

| # | Observed defect in replay | Source call site | Action taken |
|---|---------------------------|------------------|--------------|
| R1 | Duplicate `Selected reviewer` announcement | `review-agent-fallback.ts:460` (+ former `review-loop.ts` site) | Removed at source; one site. Asserted once by test. |
| R2 | `Focus … | Max attempts` and `Poll interval … | Poll timeout` given review priority | `review-loop.ts` review-start header | Demoted to verbose (`if (verbose)`). |
| R3 | `Forgejo validation skipped (review provider is not forgejo)…` chatter | `review-loop.ts:403` | Demoted to verbose (this checkpoint). |
| R4 | `Round N: review provider disabled; using workflow-owned review state.` chatter | `review-loop.ts:554` | Demoted to verbose (this checkpoint). |
| R5 | `Round N: review provider disabled; using workflow-owned disposition state.` chatter | `review-loop.ts:995` | Demoted to verbose (this checkpoint). |
| R6 | `Review provider disabled; committed worktree state and skipping pre-review rebase…` chatter | `rebase.ts` `rebaseBeforeReviewRound` | Demoted to verbose; threaded `verbose` from both `review-loop.ts` rebase call sites (506, 577). |
| R7 | Duplicate `Pre-review gate passed` announcement | `review-gate-handling.ts:117` (+ former `review-loop.ts` site) | Removed at source; one site per round. Asserted once by test. |
| R8 | No independence label in review phase | — | `reviewIndependence` derives from agent-family identity (`review-loop.ts`). Header prints `Independence: <label>`. |
| R9 | Verdict buried as `Round N: reviewer outcome = …` | `review-loop.ts` round-body outcome log | Replaced by prominent `renderReviewVerdict` (`========== APPROVED ==========` / `====== CHANGES REQUESTED ======`), emitted before task-transition/persistence. |
| R10 | `Persisted reviewer artifacts to repo store` dominates output | `review-artifacts.ts:476` | Already verbose-gated; confirmed absent at default. |
| R11 | Review phase did not identify implementer/reviewer/independence/verdict alone | `docs/assets/first-value-demo.cast` | Re-recorded; clean phase (verbatim below). |

## Demo Replay Findings
Re-recorded cast `docs/assets/first-value-demo.cast` (asciinema v2, real agents,
`review.provider: "none"`) reviewed alone. Review phase, quoted verbatim:

```
[INFO] REVIEW — parallix-adhoc-0001
[INFO] Implementer: claude
[INFO] Reviewer: codex
[INFO] Independence: different-family review
[INFO] ========== Round 1 / 5 ==========
[INFO] Pre-review gate for area "workflow": ./scripts/verify-local.sh workflow
[PASS] Pre-review gate passed for area "workflow".
[INFO] Round 1: launching reviewer (codex)...
...
[PASS] ========== APPROVED ==========
```

Read alone, this phase identifies: implementer (`claude`), reviewer (`codex`),
independence level (`different-family review`), and verdict (`APPROVED`). Counts in
the re-recorded cast: `Selected reviewer` = 1, `Pre-review gate passed` = 1,
`========== APPROVED ==========` = 1; `Poll interval`/`Poll timeout`/`Max attempts`/
`Focus: all`/`Forgejo validation skipped`/`review provider disabled`/`Persisted
reviewer artifacts` = 0 at default verbosity. The re-rendered GIF
(`docs/assets/first-value-demo.gif`, 960×520, ImageMagick) was inspected and is
consistent with the cast.

## Round 1 review findings — fixes

Round 1 verdict: REQUEST_CHANGES (4 findings, all introduced by the mission diff).
All four fixed; no pushback, no parking.

| Finding | Resolution | Evidence |
|---|---|---|
| F1 CHANGES REQUESTED renders zero findings on the reviewer-artifact recovery path | Assign `blockingFindings = recoveredReviewerArtifacts.findingSummaries || []` in the recovery branch alongside `reviewState` | `src/adapters/review/review-loop.ts` recovery branch; `test/task-2351-review-loop-selection.test.ts` asserts findings render on the request-changes path |
| F2 reviewer outcome invisible for non-APPROVED/REQUEST_CHANGES states | `renderReviewVerdict` gained a `verbose` param; unrecognised states log `Reviewer outcome = <state>` at verbose instead of being deleted | `review-loop.ts` `renderReviewVerdict`; `test/task-2351-review-loop-selection.test.ts` "review verdict presentation is authoritative…" still passes (COMMENT with no verbose → no output) |
| F3 handoff lost the provider-disabled rebase line | `rebaseBeforeReviewRound` default `verbose` `false` → `true`; review loop passes `verbose` explicitly at both sites so the happy path stays demoted, handoff/standalone restore prior visibility | `src/adapters/review/rebase.ts`; `test/task-1272-standalone-rebase.test.ts` "rebaseBeforeReviewRound commits safe artifacts and skips rebase when Forgejo is disabled" (was failing, now passes) |
| F4 single gate-pass test could not detect a reintroduced duplicate | Gate stub now emits the real `Pre-review gate passed for area` line; test asserts emission count === 1; added `Max attempts` verbose assertion | `test/task-2477-review-presentation.test.ts` "single pre-review gate pass emission on the happy path"; `test/task-1209-review-loop.test.ts` asserts `Max attempts`/`Persisted reviewer artifacts` absent at default |
| Pre-existing test typecheck (11 errors in committed baseline) | `happyPathDeps` factory return annotated `: any`; removed 5 ineffective `@ts-expect-error` directives | `npx tsc --noEmit --project tsconfig.test.json` clean |

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `Selected reviewer` appears exactly once on happy path; duplicate removed at source | `src/adapters/review/review-agent-fallback.ts:460`; `test/task-1209-review-loop.test.ts` "startReviewLoop skips reviewer and implementer launches for autonomous fallback in provider=none mode" asserts `Selected reviewer:` count === 1 | PASS |
| Pre-review gate success announced exactly once per round; duplicate removed at source | `src/adapters/review/review-gate-handling.ts:117`; `test/task-2477-review-presentation.test.ts` "single pre-review gate pass emission on the happy path" asserts one happy-path gate call | PASS |
| Review-start header names slug, implementer, reviewer, independence before first launch | `review-loop.ts` review-start block; re-recorded `docs/assets/first-value-demo.cast` verbatim `REVIEW — parallix-adhoc-0001` / `Implementer: claude` / `Reviewer: codex` / `Independence: different-family review` | PASS |
| Independence from family identity; same-family never emits different-family wording | `reviewIndependence` `review-loop.ts`; `test/task-2351-review-loop-selection.test.ts` "review presentation classifies different-family and same-family fallback from agent-family identity" asserts `different-family` absent for same-agent case | PASS |
| Poll/timeout/max-attempts/provider/persistence absent at default, present under verbose | `review-loop.ts:403/554/995`, `rebase.ts` verbose-gated; `review-artifacts.ts:476` verbose-gated; `test/task-2477-review-presentation.test.ts` "verbose review start exposes poll/provider lines that default hides" | PASS |
| Infrastructure failures still surface at default verbosity | `review-loop.ts` incomplete-artifact branch; `test/task-2477-review-presentation.test.ts` "incomplete reviewer-artifact infrastructure failure survives at default verbosity" asserts `Reviewer artifact infrastructure failure` | PASS |
| Verdict first-class, prominent, emitted before task-transition/persistence | `renderReviewVerdict` `review-loop.ts`; `test/task-2477-review-presentation.test.ts` "verdict prominence: APPROVED emitted before the review-stopped transition line" asserts verdict index < stop index | PASS |
| Verdict derived from persisted state; no approval when not APPROVED | `renderReviewVerdict` guards on `reviewState === 'APPROVED'`; `test/task-2477-review-presentation.test.ts` "non-APPROVED persisted state emits no APPROVED presentation"; `test/task-2351-review-loop-selection.test.ts` "review verdict presentation is authoritative…" asserts a `COMMENT` state logs nothing | PASS |
| `CHANGES REQUESTED` renders parsed blocking findings before relaunch | `parseReviewFindings` `review-round.ts`; `findingSummaries` `review-artifacts.ts:559`; `test/task-2351-review-loop-selection.test.ts` "review verdict presentation is authoritative and renders blocking findings before follow-up work" | PASS |
| Reviewer live output streamed at default verbosity | `startAgentFn('review', …)` launched in `review-loop.ts` round body; re-recorded `docs/assets/first-value-demo.cast` review phase shows `Round 1: launching reviewer (codex)…` and the reviewer's live stream | PASS |
| Cast + GIF regenerated from a real run and inspected; defects recorded | `scripts/record-first-value-demo.sh` + `scripts/render-first-value-demo.mjs`; `docs/assets/first-value-demo.cast`, `docs/assets/first-value-demo.gif`; `## Demo Replay Findings` in this document | PASS |
| Re-recorded cast review phase identifies implementer, reviewer, independence, verdict | `docs/assets/first-value-demo.cast` verbatim block above | PASS |
| Focused review tests run directly by file path and pass | `npm test -- test/task-2477-review-presentation.test.ts` (5 pass), `npm test -- test/task-1209-review-loop.test.ts test/task-2351-review-loop-selection.test.ts` (9 pass) | PASS |
| Full repository gate passes | `./scripts/verify-local.sh all` → `tests 2462 / pass 2462 / fail 0`, exit 0 | PASS |

## Next action
Mission complete: all four checkpoints committed, all success criteria evidenced,
and `./scripts/verify-local.sh all` green (2462/2462). No further in-scope work;
TASK-2478 (implementer response) and TASK-2479 (integration output) build on this
presentation.
