# CP-2 — Wire `resumeReview` through an authorized `px review --resume` recovery

## Summary of work done

Wired the smallest supported path that routes a `human-intervention` review
through the existing domain `resumeReview` transition, enforces the operator/actor
authority boundary, and persists the cleared intervention across both surfaces
that could resurrect it. No new flag family: `--resume` is registered in both
existing review flag allow-lists.

Production changes:
- `src/adapters/review/review-cli-flags.ts` and `src/interfaces/cli/review.ts`:
  register `--resume` in `REVIEW_FLAGS` (boolean, not a value flag). `--continue`
  re-runs the loop and hits the same `submit-for-review` guard, so a dedicated
  flag was required rather than overloading `--continue`.
- `src/application/ports/review-workflow.ts`: add `resume` to `ReviewWorkflowPort`.
- `src/application/review-command-use-case.ts`: dispatch `--resume` → `resume`
  (published phase omitted: the recovery finishes in milliseconds, so it must not
  claim board current work).
- `src/adapters/review/review-workflow-adapter.ts`: `resume` → `resumeIntervenedReview`.
- `src/adapters/review/review-commands.ts`: `resumeIntervenedReview(slug, args, options)`:
  - requires an explicit `--actor` operator identity (mirrors the mirrored-event
    `--actor` boundary; the stuck implementer cannot resume the review itself);
  - loads the named mission from the bound `MissionStore`;
  - accepts recovery only when `reviewStatus(review) === 'human-intervention'`
    (`reviewStatus` reports `approved` ahead of a stale intervention, so an
    approved review is never a candidate);
  - applies `resumeReview`, which clears `intervention` and derives the surviving
    round status (`awaiting-implementation` for the task-2465 shape);
  - persists the recovered **domain review directly** via `store.save` — the
    Review aggregate is the sole write authority (ADR 0053), so this clears the
    mission store `intervention_requested_at/by/reason` columns and regenerates
    state from the recovered review (`metadataFromReview` omits the escalation
    keys when `intervention` is null) instead of merging over the escalated state.
- Test doubles in `test/current-work-publication.test.ts`,
  `test/task-2332.14-review-use-case.test.ts`, `test/task-2373-current-work-workflow.test.ts`,
  `test/task-2373-repro.test.ts`, `test/task-2428-review-board-characterization.test.ts`
  gained the new `resume` port member.

## Persistence invariant preserved

`applyReviewStateToReview` re-derives `intervention` from
`metadata.humanEscalationReason` + `humanEscalatedAt`. Writing the recovered
domain review directly (not a `ReviewState` spread-merge over the escalated
state) means the persisted aggregate carries `intervention: null`, so both the
SQLite columns and `reviewStateDataFrom(review).metadata` are free of the
escalation keys. The reload assertion in the repro confirms
`applyReviewStateToReview(review, reviewStateDataFrom(review)).intervention === null`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `resumeReview` invoked only for authorized `human-intervention` recovery | `resumeIntervenedReview` guard `reviewStatus(review) !== 'human-intervention'` in `src/adapters/review/review-commands.ts` | Pass |
| `--actor` authority boundary enforced | `!actor || !actor.trim()` reject in `resumeIntervenedReview`; `requires an authorized --actor` test | Pass |
| Intervention cleared across both surfaces | direct `store.save(recovered)` clears SQLite `intervention_*` columns; `reviewStateDataFrom` omits escalation keys; `does not resurrect the intervention on reload` test | Pass |
| Derived status not hard-coded | `resumeReview` clears only; `clears a human-intervention stop and derives the surviving-round status` asserts `outcome !== 'human-intervention'` | Pass |
| Non-intervened review rejected | guard rejects; `rejects a review that is not in human-intervention` + `leaves an approved review that carries a stale intervention untouched` tests | Pass |
| Existing review commands/behavior retained | `test/review-commands.test.ts` (30 pass), `test/domain-mission.test.ts`, `test/task-2322.12-review-recovery.integration.test.ts` all green | Pass |
| Production typecheck clean | `npm run typecheck` (tsc --noEmit) reports no `error TS` | Pass |

## Next action

CP-3: add focused command/workflow coverage for the unauthorized actor, the
reload round trip, and ordinary review-command compatibility; run the required
repository gate (`./scripts/verify-local.sh all`) and record final evidence.
