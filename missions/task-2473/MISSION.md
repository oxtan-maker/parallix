# Mission: Wire resumeReview into a CLI command so stopped reviews can recover (task-2473)

## Goal
Make an operator-invoked review CLI path recover a review stopped in `human-intervention` by applying the existing domain `resumeReview` transition, persisting that transition, and allowing the normal next review handoff to proceed without direct database edits.

## Why Now
`task-2465` is blocked after an implementer retry-budget stop: the reviewer has returned `REQUEST_CHANGES`, the findings are repaired, but the review cannot be resubmitted while its intervention flag remains set. The existing domain transition is dead code outside tests, leaving every stopped review unrecoverable through supported operator controls.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is; the domain recovery transition already exists and the missing work is the authorized CLI/application/persistence path.
- Main drivers: one recovery branch on the existing `px review --continue` operation and its authority check; persistence across both the review-state file and the mission store so the cleared intervention survives a reload; the red→green reproduction test plus focused command/mapping coverage. The domain transition itself needs no new code, which is what keeps this out of the Large bucket.

## Scope
- Add one supported `px review` recovery invocation that targets an existing mission review in `human-intervention` and routes it through `resumeReview`. Prefer extending the operation `--continue` already maps to in `src/application/review-command-use-case.ts`; introduce a new flag only if `--continue`'s existing resume semantics genuinely conflict, and then register it in both allow-lists (`src/adapters/review/review-cli-flags.ts` and `src/interfaces/cli/review.ts`).
- Enforce the repository’s existing operator/actor authority conventions for that recovery invocation, reusing the `--actor` identity resolution the other review handlers already perform.
- Persist the cleared intervention across every surface that can resurrect it: the persisted review-state metadata that `applyReviewStateToReview` reads back (`humanEscalationReason` / `humanEscalatedAt`) and the mission store’s intervention columns. Regenerate that state from the recovered domain review via `reviewStateDataFrom` rather than merging over the escalated state.
- Continue through the existing review submission/next-round flow after recovery, without bypassing its normal guards.
- Cover the stopped-review recovery end to end with a regression test and focused command/application tests where the repository’s existing patterns require them.

## Out of Scope
- Changing how review intervention is requested, how implementer artifact retry budgets are calculated, or how reviewer findings are adjudicated.
- Editing review data directly in SQLite or adding a manual database-repair workflow.
- Creating a second recovery state machine, a new retry-budget policy, or an unrelated CLI command family.
- Changing unrelated review-loop behaviour for reviews that are not in `human-intervention`.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- A regression test in `test/task-2473-resume-review-repro.test.ts` creates a review stopped in `human-intervention` after `IMPLEMENTER_ARTIFACT_RETRY_EXHAUSTED`; it fails at the mission parent commit because no supported CLI recovery path clears the intervention, and passes after the mission change.
- The supported `px review` recovery invocation loads the named mission’s persisted review, rejects a review that is not in `human-intervention` according to the existing command error conventions, and applies `resumeReview` only to an intervened review.
- After a successful recovery invocation, `review.intervention` is `null` and `reviewStatus(review)` is no longer `human-intervention` but the status the domain derives from the surviving round state: `ready-for-next-round` when the current round already holds an implementer response, `awaiting-implementation` when it holds a `changes-requested` decision with no response, `awaiting-review` when the round is still undecided. The mission must not hard-code `awaiting-review` as the recovery outcome — the `task-2465` shape (reviewer decided `changes-requested`, then the implementer stopped on budget exhaustion) recovers to `awaiting-implementation` or `ready-for-next-round`.
- For whichever status recovery derives, the handoff that status legally permits runs without a `MissionRuleViolation`: implementer resolution from `awaiting-implementation`, `beginNextReviewRound` from `ready-for-next-round`, and `submit-for-review` from `awaiting-review` (which is the only one guarded by `A submitted review must be awaiting a reviewer decision` in `src/domain/mission-workflow.ts`).
- Reloading the recovered mission from persisted state does not resurrect the intervention: `applyReviewStateToReview` over the state written by recovery yields `review.intervention === null`, so `metadata.humanEscalationReason` and `metadata.humanEscalatedAt` are absent from the persisted review state and the mission store’s intervention columns are cleared.
- The recovery invocation follows the existing operator/actor authorization boundary and does not grant an unauthorized actor the ability to alter review state.
- Existing review commands and non-intervened review lifecycle behaviour retain their current outcomes, as demonstrated by the affected review command and workflow tests.
- `./scripts/verify-local.sh all` exits zero on the final tree.

## Risks and Assumptions
- Assumption: `resumeReview` in `src/domain/review.ts` is deliberately narrow — it throws `Review is not waiting for human intervention` when no intervention is present and otherwise only sets `intervention` to `null`. It does **not** restore `awaiting-review` itself; the post-recovery status is whatever `reviewStatus` derives from the surviving round. The existing `parked and blocked legacy dispositions collapse to human intervention` test in `test/domain-mission.test.ts` already pins both outcomes (`awaiting-implementation` after an implementer-requested intervention on a `changes-requested` round, `awaiting-review` after a pre-decision escalation). Preserve that invariant rather than duplicate or reinterpret it.
- Risk (highest): the intervention is re-derived on load. `applyReviewStateToReview` in `src/adapters/review/review-state-mapping.ts` rebuilds `intervention` from persisted `metadata.humanEscalationReason` / `humanEscalatedAt`, which `escalateToHumanReview` in `src/adapters/review/review-loop.ts` writes with a spread-merge. Clearing only the in-memory domain review, or merging over the escalated state, leaves those keys behind and the intervention silently returns on the next load. Recovery must regenerate state from the recovered review (`reviewStateDataFrom` / `metadataFromReview`, which omit the escalation keys when `intervention` is null) and must agree with the mission store’s `intervention_requested_by` column.
- Risk: recovering through the wrong CLI layer could mutate an in-memory review without recording the transition; route through the existing review command use case and its persistence boundary rather than a new ad-hoc writer.
- Risk: the implementer retry budget may be intentionally retained or reset by existing policy; do not change it unless current authority and tests establish a required reset behaviour.
- Risk: a broad `--continue` interpretation could alter active or already-decided reviews. `reviewStatus` reports `approved` ahead of any stale intervention, so an approved review is never a recovery candidate; accept recovery only for `human-intervention` and retain existing validation for every other status.

## Checkpoints
Reproduction-Test: test/task-2473-resume-review-repro.test.ts

- CP 1: Before any production fix, author `test/task-2473-resume-review-repro.test.ts`. It must arrange a persisted mission review stopped by `IMPLEMENTER_ARTIFACT_RETRY_EXHAUSTED` (reviewer `changes-requested` decision, escalation metadata written the way `escalateToHumanReview` writes it), invoke the supported review-recovery CLI path, and assert that at the mission parent commit no supported invocation clears the intervention (red). The green assertions, added only with the fix, are: `review.intervention === null`; `reviewStatus` returns the status derived from the surviving round rather than `human-intervention`; reloading the persisted state through `applyReviewStateToReview` still yields `intervention === null`; and the handoff legal for that derived status proceeds without `MissionRuleViolation`. Do not assert a hard-coded `awaiting-review`.
- CP 2: Trace the existing review command, application use case, `--actor` authority resolution, both persistence surfaces, and next-round handoff paths; make the smallest wiring change that invokes `resumeReview` only for an authorized `human-intervention` recovery and writes the recovered review back through the path that regenerates state from the domain review.
- CP 3: Add or adjust focused command/workflow coverage for a non-intervened review, an approved review carrying a stale intervention, an unauthorized actor, the reload-does-not-resurrect round trip, and ordinary review-command compatibility; run the required repository gate and record final evidence.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include durable evidence first: exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. File:line references are accepted when necessary but discouraged because line numbers rot.

Every checkpoint document (CP-N.md) MUST include:
- A summary of work done.
- An exact `## Goal Check` heading.
- The exact 3-column table header `| Criterion | Evidence | Status |` with one evidence row for every Success Criterion.
- Evidence that names the relevant test or test file, ADR, or recognized repository command/path; raw `stat`/`ls` output or generic prose alone is not enough and must be paired with one of those accepted references.
- For CP 1, the red parent-commit result and the planned green assertion for `test/task-2473-resume-review-repro.test.ts`.
- A non-generic `Next action:` line at the bottom.

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not change review retry-budget policy, reviewer decision semantics, or unrelated review-loop transitions unless the recovery path cannot preserve existing invariants without a separately approved scope change.
- Do not bypass the established operator/actor authorization checks or mutate SQLite state directly.
- Do not alter backlog ownership (`assignee`) or transition this task’s workflow status during implementation.
- Do not add a second command surface if the existing `px review` command syntax can express the recovery action.

## Stop Rules
- Stop and seek direction if the existing domain transition cannot be persisted through an authorized CLI/application path without changing retry-budget policy or review-state semantics.
- Stop and seek direction if a recovery invocation would need to resume an active, approved, rejected, or otherwise non-intervened review.
- Stop and seek direction if the red reproduction cannot be made deterministic with mocked external boundaries under `test/`.
- Stop and seek direction if clearing the persisted escalation metadata (`humanEscalationReason` / `humanEscalatedAt`) would require changing `applyReviewStateToReview`’s mapping contract or writing SQLite directly, instead of regenerating state from the recovered review.
- Stop and seek direction if the required gate exposes unrelated pre-existing failures that cannot be distinguished from this mission’s changes.
