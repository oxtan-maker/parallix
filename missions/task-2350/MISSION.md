# Mission: Reconcile interrupted handoffs before review-loop writes (task-2350)

Reproduction-Test: test/task-2350-reconcile-interrupted-handoff.test.ts

## Goal

Provide a supported, idempotent recovery path for a task whose Backlog status is `review` but whose authoritative SQLite Mission has no Review aggregate, so `px review <slug>` does not write review-loop state before the aggregate exists. Recovery must rebuild round-one Review data only from canonical handoff inputs and retain fail-closed handling for missing or ambiguous inputs.

## Why Now

TASK-2347.04 exposed a legacy/interrupted-handoff state that blocks review with `has no review to update; px handoff starts the review`. Current handoffs create the aggregate before moving Backlog, but stranded records remain possible after an interruption or pre-cutover workflow. Review-loop writes need a safe recovery boundary before future review attempts encounter the same failure.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: The observed TASK-2347.04 failure has a bounded state mismatch, named code references, and five executable acceptance behaviors.
- Main drivers: test-first legacy-state reproduction; canonical-input validation; idempotent aggregate creation; CLI review-loop guard; hermetic unit coverage.

## Scope
- Add `test/task-2350-reconcile-interrupted-handoff.test.ts` first, covering a hermetic Mission without a Review aggregate whose Backlog task is already `review`.
- Implement a supported reconciliation command or review-entry path for the stranded state using the canonical handoff inputs: branch, target, reviewer identity, implementer identity, revision, and eligibility.
- Create only a valid round-one Review aggregate when all canonical inputs are present and unambiguous.
- Make the supported path idempotent: a second reconciliation leaves the existing valid Review aggregate and Mission payload unchanged.
- Guard `px review <slug>` so it either reconciles only when all required inputs are available or stops before reviewer launch with actionable recovery guidance.
- Preserve `px status <slug>` reporting of a started review after a successful reconciliation.
- Add focused tests that mock Forgejo and agent processes for success, repeat invocation, and fail-closed error paths.

## Out of Scope
- Changing normal handoff behavior for newly created, consistent Mission and Backlog records.
- Repairing or inferring data from review-loop round state, reviewer output, or agent transcripts.
- Automatically resolving an ambiguous reviewer or implementer identity, a missing Mission, or malformed legacy review data.
- Moving a Backlog task out of `review`, changing its mission payload, or adding live Forgejo/agent integration coverage.
- Migrating all historical Mission records outside the explicitly invoked reconciliation path.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- A test named `reconciles an interrupted handoff before review-loop state is saved` in `test/task-2350-reconcile-interrupted-handoff.test.ts` fails at the mission parent commit after it seeds a Mission with no `review` aggregate and a Backlog task in `review`, then invokes the review persistence path; its assertion expects the existing missing-review error before the fix and successful reconciliation after the fix.
- The supported reconciliation path creates a round-one Review aggregate from branch, target, reviewer identity, implementer identity, revision, and eligibility; the test asserts the aggregate fields match those inputs and asserts that the Mission payload and Backlog status remain unchanged.
- Invoking reconciliation twice for the same valid stranded record produces one valid Review aggregate and no changed aggregate fields on the second invocation.
- Following successful reconciliation, a hermetic test proves `px status <slug>` reports a started review and `px review <slug>` reaches its reviewer-launch boundary without emitting `has no review to update; px handoff starts the review`.
- Hermetic tests prove ambiguous identity, missing Mission, and malformed legacy state each stop before review-loop persistence or reviewer launch and return actionable guidance; all Forgejo and agent dependencies are mocked.
- `./scripts/verify-local.sh all` exits successfully on the completed mission tree.

## Risks and Assumptions
- Legacy records may lack one or more canonical handoff inputs; the implementation must reject them instead of deriving values from review-loop state.
- The canonical source of truth is the Mission/handoff data, while Backlog `review` is only the state to reconcile against; recovery must not mutate the Backlog status.
- Reconstructing an aggregate may interact with existing review-state invariants in `src/adapters/review/review-state.ts`; tests must establish that the aggregate is valid before any save.
- `px review` may not possess every canonical input at its entry point. In that case it must provide a deterministic recovery instruction rather than invoke a reviewer or fabricate data.
- Unit tests can model Forgejo and agents without contacting real services or running a real CLI.

## Checkpoints
- CP 1: Author `test/task-2350-reconcile-interrupted-handoff.test.ts` before any production fix. Seed a hermetic Mission with no `review` aggregate and its Backlog task in `review`; exercise the review persistence path and assert the parent commit fails with `has no review to update; px handoff starts the review`. Keep the test red until the supported reconciliation behavior makes the same scenario green.
- CP 2: Trace the canonical handoff inputs through `src/adapters/cli/commands/handoff.ts` and `src/adapters/review/review-state.ts`, then implement the explicit reconciliation boundary that creates only a valid round-one aggregate and is idempotent.
- CP 3: Wire the guarded behavior into `src/adapters/review/review-loop.ts` or its review-command entry point. Add hermetic success coverage for status and reviewer-launch progression and fail-closed coverage for ambiguous identity, missing Mission, and malformed legacy data.
- CP 4: Run the required repository verifier, record the final Goal Check with file references and exact test names, and leave the worktree ready for review without starting review or integration.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done.
- The exact heading `## Goal Check`.
- The exact 3-column pipe-delimited table header `| Criterion | Evidence | Status |`, with at least one row for every Success Criterion.
- Evidence in an accepted form that Parallix verifies today: existing `file:line` references; exact repository test names; ADR references such as `ADR 0039`; test file paths; or recognized repository commands and paths such as backticked `npm ...`, `node ...`, `git ...`, `px ...`, and `./...` commands or paths.
- Raw `stat`/`ls` output or generic prose alone is insufficient evidence. If shell output is included, pair it with at least one accepted file:line reference, exact test name, ADR reference, test file path, or recognized repository command/path above.
- A concrete `Next action:` line at the bottom that names the next implementation, test, or verification action.

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not alter the normal handoff sequence for records that already have a valid Review aggregate unless a focused regression test demonstrates the change is required for reconciliation.
- Do not create Review data from review-loop writes, reviewer output, agent transcripts, or guessed identities.
- Do not change Backlog ownership, move a task out of `review`, or bulk-migrate historical tasks.
- Do not allow focused tests to contact Forgejo, launch real agents, or execute performance-heavy CLI subprocesses.

## Stop Rules
- Stop and return a fail-closed, actionable error when the Mission is missing, reviewer or implementer identity is ambiguous, a required canonical handoff input is absent, or legacy Review data is malformed.
- Stop before any review-loop persistence or reviewer launch if reconciliation cannot validate all canonical inputs.
- Stop and escalate if the only way to repair a record would require inventing aggregate values from loop state or mutating the Mission payload or Backlog status.
- Stop before review or integration phases; this mission contract authorizes implementation and verification only after the draft phase is accepted.
