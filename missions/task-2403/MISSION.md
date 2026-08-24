# Mission: Make unit tests fast and enforce a one-second per-test budget (task-2403)

## Goal
Make every test in Parallix's unit suite complete within 1,000 ms by enforcing a hard per-test timeout of at most 1,000 ms and correcting test architecture or suite classification at the underlying boundary. Keep review automation moving when a pre-review verification gate fails by rebouncing that failure to the implementer and re-verifying before reviewer launch.

## Why Now
The existing 30-second unit-test timeout hides slow, non-hermetic test design, and tests have been moved to integration because of runtime alone. That erodes the unit suite's feedback value and leaves the root causes in place.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: The invariant, classification rule, and verification boundary are explicit; implementation should first inventory the current runner and slow-test exceptions.
- Main drivers: unit-runner timeout configuration; slow hermetic tests; integration-classification rules; deterministic fixtures, timers, and seams.

## Scope
- Set the normal unit-test runner's per-test timeout to no more than 1,000 ms.
- Inventory integration tests whose classification was justified by exceeding one second and classify each by its actual boundary.
- Return hermetic tests from the integration suite to the unit suite, then remove their real source of latency while retaining their behavioral assertions.
- Keep tests that intentionally cross a real child-process, Git/worktree, package-manager, network/server, or persisted-database boundary in integration, with boundary-based classification.
- Record uncontended before/after default unit-suite duration in checkpoint evidence.
- Add or update focused, hermetic tests for any runner or classification logic changed by the mission.
- Route pre-review rebase/push verification-gate failures through the existing rebound kernel, with automatic re-verification before reviewer launch.

## Out of Scope
- Replacing the test framework or rewriting the entire test suite.
- Moving a test to integration solely because it exceeds one second.
- Relaxing assertions, adding `.skip` or `.only`, shortening arbitrary sleeps, mocking the unit under test, or forcing global process exit to meet the budget.
- Applying the one-second per-test timeout to integration tests.
- Optimizing total suite runtime beyond fixes needed to remove unit-test latency and avoid regression from the uncontended baseline.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- The normal unit-test runner configures a hard timeout of 1,000 ms or less for each unit test.
- Every test selected by the normal unit-test runner completes within that timeout; a timeout failure identifies the offending test instead of being absorbed by a 30-second allowance.
- Every reviewed integration test previously classified for runtime has a recorded non-hermetic boundary, or is restored to the unit suite and completes within 1,000 ms.
- No test is classified as integration solely because of measured runtime.
- Changed tests retain behavioral assertions; the final tree introduces no `.only` and no unannotated `.skip`.
- The default unit-suite duration measured after the change does not exceed the uncontended baseline, and checkpoint evidence records both measurements using the same runner command.
- Integration tests remain exempt from the one-second unit-test timeout and continue to use their integration-level timeout policy.
- A pre-review rebase/push gate failure launches the implementer through the rebound kernel, and reviewer launch occurs only after the gate passes or the mission is explicitly stranded.

## Risks and Assumptions
- Assumption: the repository can distinguish unit and integration selections through existing runner configuration, file placement, or classification metadata.
- Risk: a one-second timeout can expose leaked handles or accidental real-system work rather than mere slow assertions; fix the test seam or lifecycle cause instead of masking it.
- Risk: CI contention can distort total-suite timing; compare uncontended local measurements using the same command and treat the per-test limit as the hard correctness requirement.
- Risk: existing integration labels may lack rationale; inspect each candidate's actual dependencies before moving it.

## Checkpoints
- CP 1: Establish the uncontended default unit-suite baseline; inspect unit-runner timeout and integration-selection rules; inventory every integration test explicitly associated with exceeding one second and record each actual boundary or proposed unit return.
- CP 2: Enforce the at-most-1,000-ms unit timeout and make returned or existing unit tests hermetic and fast through deterministic timing, focused fixtures, or direct seams while preserving behavioral assertions.
- CP 3: Verify the final unit and integration classification, record the comparable post-change duration, run the required gate, and document the result against every success criterion.

### Checkpoint Documentation Requirements
Every checkpoint document (`CP-N.md`) MUST lead its evidence with durable references Parallix verifies today: exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. File:line references are accepted when needed but discouraged because line numbers rot.

Every checkpoint document MUST include a summary of work done and the exact heading `## Goal Check`, followed by this 3-column table:

| Criterion | Evidence | Status |
|---|---|---|
| Unit timeout is at most 1,000 ms | Exact runner command and changed test path | PASS or FAIL |

Include at least one evidence row for every success criterion. Raw `stat`/`ls` output or generic prose alone is not enough: if used as supplemental context, pair it with an accepted command, exact test name, ADR reference, or test file path. End each checkpoint with a concrete `Next action:` line.

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify unrelated production behavior; the pre-review gate rebounce is the explicit behavior change in this mission.
- Do not change integration timeouts to satisfy the unit-test budget.
- Do not add dependencies, replace the test framework, or broadly reclassify tests without a documented real boundary.
- Do not edit mission workflow state, start review/execution/integration phases, or push the mission branch.

## Stop Rules
- Stop and request direction if a candidate test cannot be made hermetic without changing supported production behavior or requires an external service that cannot be represented by an existing unit seam.
- Stop and report the evidence if the one-second timeout exposes a product defect rather than a test-architecture defect; do not weaken the test to proceed.
- Stop before any broad test-framework migration or dependency addition; present the smallest boundary-specific alternative first.
