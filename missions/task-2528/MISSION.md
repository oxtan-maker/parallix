# Mission: Require re-review after integration-error fixes (task-2528)

## Goal
Ensure a mission cannot land code changed after an integration-error recovery under the approval for an earlier PR revision: invalidate that approval and return the mission to review before another integration attempt, while preserving direct landing for an unchanged retry.

## Why Now
The current recovery path can treat a post-gate-failure edit as part of an already approved PR. That permits final code to land without review of its final revision, breaking the review boundary that protects repository trust.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: The failure scenario, required recovery behavior, and unchanged-retry constraint are explicit in the backlog task.
- Main drivers: revision-aware approval invalidation, review-state routing after gate recovery, regression coverage for changed and unchanged retries

## Scope
- Add a regression test that reproduces a previously approved mission receiving an integration error, being changed to repair it, and then attempting integration again.
- Change integration-error recovery so a mission revision changed after the approved PR has its prior approval invalidated and is returned to the review path before it can be landed.
- Preserve the existing integration-error evidence capture and bounded gate-rebound retry behavior.
- Cover the unchanged post-error retry path so it continues to land using its still-current approval.

## Out of Scope
- Changing integration gate selection, gate execution, or the pre-landing integration guard.
- Changing how an initial PR approval is obtained or changing reviewer eligibility policy.
- Altering main-branch mutation safeguards or creating backlog state during integration failures.
- Retrospectively repairing already landed missions or changing unrelated review workflows.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- A regression test fails at the mission parent commit because a repair that changes the approved mission diff can proceed to integration under the prior approval, and passes after the implementation prevents that landing path.
- When an integration error is followed by a mission-diff change, the approved PR is invalidated before any subsequent integration can land the changed revision.
- The changed-revision recovery routes the mission to review and requires a fresh approval of that revision before integration may land it.
- When an integration-error retry leaves the mission diff unchanged from the approved revision, the retry remains eligible to land without a new review round.
- Targeted coverage exercises both changed and unchanged post-error retry paths without weakening integration gate execution, evidence capture, bounded rebound retries, or the pre-landing guard.
- `./scripts/verify-local.sh all` succeeds on the completed mission tree.

## Risks and Assumptions
- Assumption: the recovery path can determine whether the mission revision differs from the revision represented by the approved PR; if it cannot, stop and establish a truthful revision comparison rather than infer approval validity.
- Risk: invalidating too broadly would impose re-review on unchanged retries; guard this with the unchanged-retry regression case.
- Risk: recovery can accidentally bypass review while retaining gate-error evidence or retry behavior; preserve those established paths and cover the relevant transition boundary.
- Risk: workflow state may be represented across domain and adapter boundaries; avoid synthesizing review or backlog state and retain TASK-2507's no-main-mutation constraint.

## Checkpoints
- CP 1: Author `test/task-2528-repro.test.ts` before any fix. Model an approved PR whose integration attempt reports an integration error, then a repair changes the mission diff and a second integrate is attempted. Assert at the mission parent commit that this second attempt is allowed to use the prior approval or land without a new review, making the test red; after the fix, assert the prior approval is invalidated and the mission must re-enter review before landing, making it green.
Reproduction-Test: test/task-2528-repro.test.ts
- CP 2: Implement the smallest revision-aware recovery transition that invalidates the stale approval and routes changed revisions through review, without altering gate selection, gate execution, evidence capture, bounded retries, or main-branch safeguards.
- CP 3: Extend coverage for an unchanged retry after the same integration-error recovery so it remains eligible to land under its existing approval; run the repository verification gate and record final evidence.

### Checkpoint Documentation Requirements
Every checkpoint document (`CP-N.md`) MUST include:
- A summary of work done.
- A `## Goal Check` heading followed by this exact 3-column table header: `| Criterion | Evidence | Status |`.
- At least one evidence row for every success criterion. Lead with durable evidence Parallix verifies today: exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. File:line references are accepted when needed but discouraged because line numbers rot.
- For CP 1, cite `test/task-2528-repro.test.ts`, the exact failing test name, and the command demonstrating the red parent-commit result. For later checkpoints, cite the same test's green result plus the exact unchanged-retry test name and relevant existing ADR reference if one governs the review invariant.
- Raw `stat`/`ls` output or generic prose alone is not enough; pair any shell output with one of the accepted references above.
- A non-generic `Next action:` line at the bottom that names the next mission action or verification command.

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not weaken integration-gate selection, integration-gate execution, or the pre-landing integration guard.
- Do not remove integration-error evidence capture or bounded gate-rebound retries.
- Do not mutate `main`, fabricate backlog IDs or state, or synthesize review approval while handling an integration failure.
- Do not force re-review when the mission diff is unchanged from the approved revision.

## Stop Rules
- Stop if the proposed change would alter gate selection, gate behavior, evidence capture, bounded retries, pre-landing safeguards, or main-branch mutation guarantees; report the dependency instead of broadening scope.
- Stop if approval freshness cannot be established from existing truthful revision state; do not guess that an approval covers a changed diff.
- Stop if reproducing the defect requires real Forgejo, network access, or an unmocked external boundary; redesign the regression test as a unit-level mocked workflow scenario.
- Stop before changing reviewer policy, PR creation semantics, or any unrelated workflow transition; request a follow-up mission if such a change is necessary.
