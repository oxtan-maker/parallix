# CP-5: An agent family may no longer review its own work

## Summary

Round 1 of this mission was recorded with `reviewer = claude` and `implementer = claude`. That is
not a corner case on this workstation: `codex`, `claude`, `custom` and `vibe` are all configured for
the `review` step and all four report a working launcher, so a cross-family reviewer was available.
Two defects had to line up for the round to look legitimate.

**Fails open.** `resolveHandoffReviewAssignment` wrapped reviewer selection in a bare `catch {}` and
set `reviewer = implementer` for any thrown error — genuine pool exhaustion, an unreadable agent
policy, a failed launcher probe, custom-capacity contention — while logging nothing. A transient
condition produced a permanent, silent self-review.

**Accepted silently.** `startReview` and `beginNextReviewRound` enforced reviewer *eligibility* but
never reviewer *separation*, and the round kept the full four-family eligibility, so nothing in the
recorded aggregate distinguished this from a normal cross-family review.

Fixes:

1. `requireSeparateReviewer` (`src/domain/review.ts:416`), applied by `startReview`
   (`src/domain/review.ts:440`) and `beginNextReviewRound` (`src/domain/review.ts:679`): `reviewer
   === implementer` is rejected unless the eligibility recorded on the round is exactly that one
   family. The single-family workstation keeps working; the four-family one cannot self-review.
2. `resolveHandoffReviewAssignment` (`src/adapters/cli/commands/handoff.ts:44`) now catches only
   pool exhaustion (`isReviewerPoolExhausted`, `src/adapters/cli/commands/handoff.ts:36`), logs a
   WARN when it falls back, and narrows the recorded eligibility to the implementer's own family so
   the round states plainly that it was self-reviewed. Every other selection failure propagates:
   silently reviewing your own work is not the right answer to a misconfigured machine.

The escape hatch is intact — `"handoff uses same-family reviewer only when cross-family selection is
exhausted"` still passes untouched.

One stale citation was refreshed: `src/application/persistence-domain-map.ts:69` pinned
`export function applyReviewerCommand` at `src/domain/review.ts:437`, which the new domain function
moved to 463. Line number only; no invariant, anchor or behaviour changed.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC11: reviewer separation enforced by the domain | `src/domain/review.ts:416`, `src/domain/review.ts:440`, `src/domain/review.ts:679`; `"startReview rejects a reviewer who is the implementer while other families are eligible"`; `"beginNextReviewRound rejects a self-reviewing round the same way"` | PASS |
| SC11: single-family workstation may still self-review | `"startReview allows self-review only when the implementer is the sole eligible family"` | PASS |
| SC12: fallback only on exhaustion, logged, with narrowed eligibility | `src/adapters/cli/commands/handoff.ts:36`, `src/adapters/cli/commands/handoff.ts:71`; `"handoff falls back to self-review only on an exhausted pool, and records that eligibility"` asserts `reviewers` is `['claude']` and a `falling back to self-review` WARN | PASS |
| SC12: every other selection failure propagates | `"handoff propagates a misconfigured selector instead of reviewing its own work"`; `"handoff propagates an unreadable agent policy instead of reviewing its own work"` | PASS |
| SC12: normal path unchanged | `"handoff assigns a reviewer from another family when one is available"` keeps the full four-family eligibility; `"handoff persists a configured cross-family reviewer instead of the PR author"` and `"handoff uses same-family reviewer only when cross-family selection is exhausted"` pass untouched | PASS |
| SC13: reproduction test red before the fix, green after | `test/task-2339-self-review-forbidden.test.ts` — with `src/domain/review.ts` and `src/adapters/cli/commands/handoff.ts` at the parent state the suite reports `fail 5`; on this tree all pass | PASS |
| SC5: verification gate passes clean on the final tree | `` `./scripts/verify-local.sh all` `` — exit 0, `tests 1707 / pass 1707 / fail 0` | PASS |
| SC6: no `.only` and no bare `.skip` introduced | `test/task-2339-self-review-forbidden.test.ts` uses only bare `test(...)`; gate reports `skipped 0` / `todo 0` | PASS |
| Stop rule "single-family workstation can still hand off" holds | `"handoff uses same-family reviewer only when cross-family selection is exhausted"` in the existing handoff suite | PASS |
| Citation refresh is disclosed, not silent | `src/application/persistence-domain-map.ts:69` (line number only); `"SC1: every invariant citation points at a line containing its anchor"` in `test/persistence-domain-mapping.test.ts` | PASS |

Next action: re-handoff this mission so round 1 is assigned to a family other than the implementer,
since the recorded round-1 reviewer was produced by the defect this checkpoint fixes.
