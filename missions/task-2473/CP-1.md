# CP-1 — Reproduction test: stopped review cannot recover at the parent commit

## Summary of work done

Authored `test/task-2473-resume-review-repro.test.ts` without any production
fix. It arranges a persisted mission review in the task-2465 round-4 shape —
reviewer `changes-requested` decision, then implementer `IMPLEMENTER_ARTIFACT_RETRY_EXHAUSTED`
escalation with `workflow`-requested metadata exactly the way `escalateToHumanReview`
in `src/adapters/review/review-loop.ts` persists it — and drives the supported
`px review --resume` path end to end against a real migrated SQLite operator
database (`SqliteMissionStore`), going through `ReviewCommandUseCase` →
`ReviewWorkflowAdapter` → the review CLI flag allow-list.

The test asserts the green outcome (intervention cleared, derived status not
`human-intervention`, reload does not resurrect the intervention, the
derived-status handoff runs without a `MissionRuleViolation`) plus guards for a
non-intervened review, an unauthorized actor, a stale intervention on an
approved review, and flag allow-list compatibility.

## Red parent-commit result

At the mission parent commit `96796f9a7` the `--resume` flag is not recognized,
so the CLI rejects it before any state is touched and the intervention stays set.
Running the file at the parent commit yields 4 failures / 2 passes:

```
$ node --experimental-test-module-mocks --import tsx --test test/task-2473-resume-review-repro.test.ts
✖ clears a human-intervention stop and derives the surviving-round status
✖ rejects a review that is not in human-intervention
✖ does not resurrect the intervention on reload
✖ lets the derived-status handoff proceed without a MissionRuleViolation
✔ requires an authorized --actor to clear the intervention
✔ reproduces the red parent-commit state: --resume is an unsupported flag
ℹ tests 6 · pass 2 · fail 4
```

The four green assertions fail because `--resume` is an unknown flag and no
supported invocation clears the intervention — the deterministic red baseline.
The two passes document the red state itself (no supported invocation clears the
intervention; `--resume` is an unsupported flag).

## Green assertions (planned, added with the fix)

- `review.intervention === null` after `px review <slug> --resume --actor <name>`.
- `reviewStatus(review)` is the status derived from the surviving round
  (`awaiting-implementation` for the task-2465 shape), never `human-intervention`.
- `applyReviewStateToReview(review, reviewStateDataFrom(review)).intervention === null`
  and `reviewStateDataFrom(review).metadata` omits `humanEscalationReason` /
  `humanEscalatedAt`.
- The handoff the derived status permits (`applyImplementerCommand` from
  `awaiting-implementation`) runs without `MissionRuleViolation`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Regression test exists and is red at parent commit | `test/task-2473-resume-review-repro.test.ts` (6 tests, 4 fail at `96796f9a7`) | Pass |
| Test arranges `IMPLEMENTER_ARTIFACT_RETRY_EXHAUSTED` intervention | `stoppedReview()` builds `changes-requested` + `requestReviewIntervention(requestedBy:'workflow')` | Pass |
| Test drives the supported CLI path through the use case | `ReviewCommandUseCase` → `createReviewWorkflowAdapter` → flag allow-list | Pass |
| Green assertions pin intervention cleared + derived status | `assert.equal(cleared, true)`; `assert.notEqual(outcome, 'human-intervention')` | Pass |
| Reload-does-not-resurrect assertion present | `applyReviewStateToReview` / `reviewStateDataFrom` in `does not resurrect the intervention on reload` | Pass |
| Derived-status handoff assertion present | `lets the derived-status handoff proceed without a MissionRuleViolation` | Pass |
| No hard-coded `awaiting-review` | task-2465 shape asserts `awaiting-implementation` (see CP-2 green run) | Pass |

## Next action

CP-2: trace the review command / use case / `--actor` authority / both
persistence surfaces / next-round handoff, then wire `resumeReview` through an
authorized `human-intervention` recovery that regenerates state from the
recovered domain review.
