# CP-8 — Request-changes round-loop closure and round 1 findings F1–F5

## Summary

CP-7 declared the mission complete. Two things happened after it:

1. Commit `48aceda15` ("feat(review): close the request-changes half of the
   review round loop") landed 633 lines, including an edit to
   `src/domain/mission-workflow.ts` — a file MISSION.md Restricted Areas lists
   as "expected unchanged". CP-7's SC11 row and its Restricted-areas paragraph
   were written before that commit and asserted the opposite.
2. Round 1 review returned five findings (F1–F5) against the resulting tree.

This checkpoint documents the post-CP-7 work, states why the domain rule had to
change, and records the F1–F5 resolutions. CP-7 has been corrected in place; it
is no longer the mission's final evidence document — this one is.

## Why the round-loop work belongs to this mission

The mission's own invariant is **one review authority**: current review metadata
comes from the Mission Review aggregate only. CP-3 made the *approval* half of
the boundary authoritative — an approved review persists a `ReviewerDecision`
and fires `review → integration` at `decidedAt`.

The *request-changes* half was not authoritative. A reviewer's request-changes
verdict reached the review-event trail only: the round kept `decision: null`,
the Mission never moved `review → active` through the `request-changes` command,
no implementer resolution was recorded, and `beginNextReviewRound` had nothing
to advance. The next handoff therefore resubmitted round 1 against a recorded
round 1 and the workflow rejected it with "A new review round must advance the
same pull request or local branch".

That is the same defect class the mission exists to close, on the other half of
the same boundary, and it blocks this mission's own review loop from running a
second round. It is nevertheless **scope growth beyond MISSION.md as locked**:
Scope never names the request-changes loop, and the fix required a Restricted
Area edit. It is disclosed here and in the MISSION.md scope addendum rather than
presented as in-scope work.

## The domain edit, and why Stop rule 4 does not apply

`src/domain/mission-workflow.ts` — `decideMission`, `submit-for-review` branch:

```
const resubmission = submittedRound.number === recordedRound.number && !recordedRound.decision;
```

Restricted Areas says to stop "if CP2 proves a domain rule still permits a
shortcut". This is the opposite case: the rule **forbade a legitimate
transition**, not permitted a shortcut. Resubmitting the recorded round while
the reviewer has not yet decided it is a relaunch of the same handoff — nothing
is rewritten, no decision is discarded, and the reviewed change identity is
still checked by `sameReviewedChange`. The rule is narrowed by
`!recordedRound.decision`: once the reviewer has decided, a resubmission at the
same round number is still rejected exactly as before.

No new command types, no `Review` / `ReviewerDecision` shape changes, no new
lifecycle operations. `src/domain/mission.ts` and `src/domain/review.ts` remain
untouched.

## Round 1 findings

| Finding | Verdict | Resolution |
|---|---|---|
| F1 (blocking): CP-7 evidence is broken on the final tree | Fixed | This document, plus CP-7 SC11 / Restricted-areas / Next-action corrected in place; MISSION.md scope addendum added |
| F2 (correctness): request-changes `decidedAt` skew | Fixed | `src/adapters/review/review-state-mapping.ts` — the `fixing` branch keeps `previous.decidedAt` instead of rewriting it to the round `startedAt` |
| F3 (note): SC03 wording overstated | Fixed (comment) | `src/adapters/cli/commands/stats.ts` — comment records that no `px stats` render path calls `deriveImplementerAndFixRounds`, so nobody "fixes" the render path to derive per row |
| F4 (note): `headRevision` fabricates a revision on failure | Fixed | `src/adapters/review/review-artifacts.ts` — `headRevision` throws instead of returning `round-${Date.now()}`; the caller surfaces it as a persist failure. Test-side impact completed this round: the 10 `consume*Artifacts` call sites asserting success on bare temp worktrees now supply the existing `headRevisionFn` / `recordImplementerResolutionFn` / `recordRequestedChangesFn` seams (`test/review-artifacts.test.ts` ×7, `test/review.test.ts` ×2, `test/forgejo-independence.test.ts` ×1) — round recording itself stays covered by `test/review-round-loop.test.ts` |
| F5 (note): the resubmission relaxation is broader than the handoff needs | Pushed back | See below |

### F5 pushback

The relaxation is already narrowed to the only case it exists for: the recorded
round must be **undecided** (`!recordedRound.decision`). Within that window the
reviewer has not acted, so there is no decision to rewrite and no round to
advance. Tightening further — requiring revision identity, not just change
identity — would reject the case the relaxation was written for: a relaunch
after the branch tip moved, which is exactly when a handoff is retried. The
reviewer's own note records that the handoff reuses `priorReview` as-is so the
main flow stays consistent, and classes the stale-`subject.revision` behavior as
an acceptable documented choice. Narrowing it would trade a real supported flow
for a hypothetical direct-lifecycle caller that does not exist in this tree.

## Verification

- `test/review-round-loop.test.ts` — 5/5 pass, including the new F2 regression
  `"keeps the request-changes decidedAt when a flat writer re-persists the round"`
  (verified red against the pre-fix line: actual `2026-08-16T13:20:32.869Z`
  (round start) vs expected `2026-08-16T13:51:30.650Z` (decision time)).
- `test/task-2378-authoritative-stats.test.ts` + `test/task-2376-lifecycle-timing.test.ts` — 14/14 pass.
- F4 test-side impact re-run green: `test/review-artifacts.test.ts` 62/62,
  `test/review.test.ts` 118/118, `test/forgejo-independence.test.ts` 14/14,
  `test/task-2339-review-store-bindings.test.ts` 5/5.
- `./scripts/verify-local.sh all` — see the Goal Check table below.
- `npm run test:integration` — the always-run `integration-suite` gate in
  `config/integration-pipelines.json`, re-run for round 1 F1's fix and again
  here: 0 fail. (One run showed a single `test/agents.test.ts` async-leak
  failure — `"custom capacity releases after clean completion, launch
  failure, signal cancellation, and rejected runtime result"` passes 100/100
  alone and on suite re-run; pre-existing load flake, not touched by this
  diff.)

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Post-CP-7 domain edit documented with its justification (F1) | `src/domain/mission-workflow.ts:114`, `test/review-round-loop.test.ts`, "accepts a resubmission of the round the reviewer has not decided yet", MISSION.md "Scope Addendum" | PASS |
| CP-7's false SC11 / Restricted-areas claims corrected in place (F1) | `missions/task-2378/CP-7.md:82`, `missions/task-2378/CP-8.md:40` | PASS |
| request-changes `decidedAt` survives a flat re-persist (F2) | `test/review-round-loop.test.ts`, `"keeps the request-changes decidedAt when a flat writer re-persists the round"` | PASS |
| Stats port derivation has no render-path caller, recorded so it stays that way (F3) | `src/adapters/cli/commands/stats.ts:290` | PASS |
| No fabricated revision reaches the aggregate (F4) | `src/adapters/review/review-artifacts.ts:102`, `test/task-2339-review-store-bindings.test.ts` | PASS |
| Round-loop closure keeps the approval-boundary regressions green (SC05/SC07/SC09) | `test/task-2378-authoritative-stats.test.ts`, `test/task-2376-lifecycle-timing.test.ts` | PASS |
| No new domain types, commands, or dependencies (SC11) | `git diff --name-only 8180bf0ce..HEAD -- src/domain/ package.json` → only `src/domain/mission-workflow.ts` (documented above); `src/domain/mission.ts`, `src/domain/review.ts`, `package.json` absent from the diff | PASS |
| Mission gate passes on the final tree (SC13) | `./scripts/verify-local.sh all` | PASS |
| Always-run integration gate passes (round 1 F1 + this round) | `npm run test:integration`, `test/package-persistent-data.test.ts` | PASS |

Next action: hand back to the round 1 reviewer with F1–F4 fixed and F5 pushed
back; the mission's final evidence document is CP-8, not CP-7.
