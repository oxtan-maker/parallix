# Mission: Re-review agent-rebutted changes before human escalation (task-2239)

## Goal
Change the automated review lifecycle so that, after an implementer addresses or rebuts all `REQUEST_CHANGES` findings, the designated reviewer agent makes the next formal approval/request-changes decision. Escalate to a human only when that reviewer declines to approve or the configured review-attempt budget is exhausted.

## Why Now
The current review loop can treat an implementer’s response as the terminal decision and invoke a human prematurely. That bypasses the reviewer that raised the findings, weakens automated review coverage, and makes human escalation happen before the configured retry policy has been exercised.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: The backlog description, pre-draft scope, and definition of done define the lifecycle change and required decision cases without a product decision still open.
- Main drivers: review-state transition routing, durable finding/round history, reviewer relaunch selection, retry-budget enforcement, and deterministic lifecycle tests.

## Scope
- Map and change the review-loop transition reached after an implementer responds to every outstanding `REQUEST_CHANGES` finding.
- Route that transition to the reviewer agent associated with the active review round, preserving the review findings and round history supplied to that reviewer.
- Persist the next review-round state before launching or selecting the reviewer, so a subsequent decision has the correct attempt count and context.
- Enforce the configured maximum review-attempt boundary: a reviewer approval completes the automated review; another `REQUEST_CHANGES`, reviewer non-approval/failure, or exhausted budget follows the defined human-escalation path.
- Add deterministic automated coverage for: reviewer approval after the implementer response, repeated reviewer `REQUEST_CHANGES`, reviewer failure/non-approval, and retry-budget exhaustion.
- Update workflow documentation if the changed routing or escalation behavior is documented for users or operators.

## Out of Scope
- Changing the review finding schema or deleting historical findings and review-round records.
- Treating an implementer response or rebuttal as an approval decision.
- Changing the reviewer’s evaluation criteria, agent prompt content unrelated to re-review routing, or the configured retry-budget value.
- Replacing the human-review workflow, modifying unrelated mission lifecycle transitions, or changing external provider integrations.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- After every outstanding `REQUEST_CHANGES` finding has an implementer response, the lifecycle launches or selects the active reviewer agent for the next formal decision rather than completing review or escalating directly to a human.
- The re-review decision receives the prior findings and review-round history, and the persisted round/attempt data advances exactly once for the re-review.
- A reviewer `APPROVE` after an implementer response reaches the normal automated-review completion state without human-review escalation.
- A reviewer `REQUEST_CHANGES` after an implementer response keeps the review loop active with the new reviewer decision recorded; it does not auto-approve the implementer response.
- Reviewer failure or non-approval, and the first decision that would exceed the configured maximum review attempts, each take the explicit human-escalation path with the triggering reason retained in lifecycle state.
- Deterministic tests cover the approval-after-fix, repeated-request-changes, reviewer-failure/non-approval, and exhaustion scenarios, and the repository verification gate passes without focused or unannotated skipped tests.
- Any existing operator or workflow documentation that describes the affected review-loop routing or escalation behavior matches the implemented behavior.

## Risks and Assumptions
- Risk: incrementing the round counter both when the implementer responds and when the reviewer is relaunched could exhaust the budget one attempt early. Assumption: the existing persisted review-round state has one authoritative write point that can be tested across relaunches.
- Risk: a re-review launch that omits earlier findings allows a reviewer to approve without evaluating the original requests. Assumption: review context can be reconstructed from durable finding and round records.
- Risk: reviewer launch failures may be conflated with an implementer’s rebuttal. Assumption: lifecycle state can record a reviewer-specific failure reason before human escalation.
- Risk: existing tests may encode the premature direct-human route. Assumption: those expectations can be updated only where they cover the affected post-response transition.

## Checkpoints
- CP 1: Add deterministic red-state lifecycle tests for the four decision paths: reviewer approves after all findings receive responses; reviewer requests changes again; reviewer fails or returns no approving decision; and the maximum-attempt boundary is reached. Name the state transition and expected reviewer/human destination in each assertion.
- CP 2: Implement the post-response transition, durable round update, reviewer relaunch/selection, and context preservation needed to make CP 1 green. Keep human escalation limited to reviewer non-approval/failure or retry-budget exhaustion.
- CP 3: Verify the persisted lifecycle evidence and all four paths, update affected workflow/operator documentation, and record final goal-check evidence.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary identifying the lifecycle transition changed or verified in that checkpoint.
- The exact heading `## Goal Check`.
- The exact 3-column pipe-delimited table header `| Criterion | Evidence | Status |`, with at least one row for every Success Criterion.
- Verifiable evidence using Parallix-recognized forms: existing file:line references; exact repository test names; existing test file paths; ADR references; and recognized repository commands or paths such as backticked `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`.
- For the decision-path tests, cite both the test file path and exact test name; for lifecycle routing, cite the changed file:line reference; for any policy rationale, cite the applicable ADR reference.
- Raw `stat`/`ls` output or generic prose alone is not enough. If shell output is included, pair it with an accepted file:line reference, exact test name, ADR reference, test file path, or recognized command/path.
- A non-generic `Next action:` line that names the next transition, test case, documentation change, or gate to run.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md:28` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.js`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify backlog ownership (`assignee`) or transition this backlog task’s status during the mission.
- Do not remove, overwrite, or silently reinterpret existing review findings or review-round history.
- Do not alter the configured maximum-attempt value, reviewer evaluation standards, or unrelated lifecycle states without a separate mission.
- Do not push the mission branch to the `origin` remote; only the review remote is permitted for mission-branch review.

## Stop Rules
- Stop and request direction if the required reviewer identity cannot be determined from persisted review state, because choosing a different reviewer changes the review policy.
- Stop and request direction if preserving findings and round history requires a schema migration or data repair beyond the affected lifecycle transition.
- Stop and request direction if the retry-budget semantics are contradictory between the implementation, tests, and documented policy.
- Never auto-approve an implementer rebuttal, discard prior findings, or invoke human review before a reviewer has made the required re-review decision, except at the configured maximum-attempt boundary or upon reviewer non-approval/failure.
