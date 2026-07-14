# Mission: Eliminate the intermittent unit-test-suite stall (task-2258)

## Goal
Make the repository's unit-test run terminate cleanly after the review-state and task-2213 reporting tests, rather than intermittently remaining stuck after those tests have reported passing results. Also time the unittests and fix any unittest that takes unreasonably long time.

## Why Now
The test runner has been observed to stop making progress immediately after a known block of successful tests. This makes local verification and automated delivery unreliable, and it obscures whether later tests and the overall process exit completed.

## Refinement Signals
- Predicted NEL bucket: Small (0–80) / Medium (81–235) / Large (235+)
- Confidence: High
- Selection note: activate as-is
- Main drivers: intermittent test-runner non-termination, review-state filesystem tests, task-2213 reporting tests, and reliable verification feedback

## Scope
- Diagnose the asynchronous resources, filesystem state, process state, or test-runner lifecycle that can keep the unit-test process alive after the observed test block.
- Change the owning test helpers, test setup/teardown, or production lifecycle code only where required to ensure resources created by the affected tests are deterministically released.
- Cover the previously stalling execution path with automated test coverage or test-runner configuration that demonstrates the complete test process reaches a successful exit.
- Preserve the assertions and reporting semantics of these observed tests: `readReviewState reads from the provided rootDir, not process.cwd()`, `resetReviewState returns unchanged when no state exists`, `resetReviewState removes the state file`, and the task-2213 agent-performance/weekly-report test group.

## Out of Scope
- Changing review-state or task-2213 reporting business rules unrelated to test-process termination.
- Broad test-suite speed optimisation, parallelism redesign, or changing global timeout values merely to mask a leaked resource.
- Refactoring unrelated tests or production modules.
- Adding unannotated skipped tests, focused tests, or a retry-only workaround.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- A full repository verification run invoked with `./scripts/verify-local.sh all` completes with exit status 0 and does not remain running after the affected review-state/task-2213 test block has emitted its results.
- The cause of the non-termination is addressed by deterministic cleanup or lifecycle handling; no global timeout increase, bare `.skip`, `.only`, or retry-only workaround is used to make the run appear successful.
- The affected review-state tests retain their current root-directory and state-file assertions, and the task-2213 reporting tests retain their completed-mission attribution, model-row separation, and weekly-report assertions.
- Automated coverage identifies the cleanup or lifecycle path that previously left the runner alive, with evidence recorded as an exact test name and test file path.
- The final checkpoint contains `## Goal Check` with `| Criterion | Evidence | Status |`, citing file:line references plus the relevant test name(s), test file path(s), and the successful `./scripts/verify-local.sh all` invocation.

## Risks and Assumptions
- The visible last test is not necessarily the source of the stall; diagnosis must distinguish a leaked handle from a later test that never starts.
- The failure is intermittent, so implementation evidence must include the concrete resource/lifecycle path and a clean full verification exit, not timing observations alone.
- Cleanup changes can accidentally alter temporary-directory ownership or review-state persistence behaviour; preserve the named assertions in Scope.
- Assumption: the reported output is from the repository's normal unit-test execution path and the stall is reproducible or diagnosable from that path.

## Checkpoints
- CP 1: Reproduce and localize the stalled process. Run the repository unit-test path, identify the test file(s) and outstanding resource or lifecycle responsible for non-termination, and record the exact test names and evidence in the checkpoint.
- CP 2: Implement deterministic ownership and cleanup for the localized cause. Add or adjust focused automated coverage for the previously unreleased lifecycle path while preserving the named review-state and task-2213 assertions.
- CP 3: Verify the final tree with the required repository gate and publish a Goal Check that maps every success criterion to file:line references, exact test names, test file paths, and the gate command.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done.
- The exact heading `## Goal Check`.
- The exact 3-column pipe-delimited table header `| Criterion | Evidence | Status |`.
- At least one evidence row for every success criterion. Accepted evidence forms already verified by Parallix are existing file:line references, exact repository test names, existing test file paths, ADR references, and recognized repository commands or paths such as backticked `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`.
- For this mission, identify the exact test file and test name that cover the released lifecycle, the file:line location of the cleanup or lifecycle change, and the `./scripts/verify-local.sh all` result.
- Raw `stat`/`ls` output or generic prose alone is not acceptable evidence. If included, pair it with at least one accepted reference above.
- A non-generic `Next action:` line at the bottom that names the next diagnostic, implementation, or verification action.

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not change mission orchestration, backlog ownership, or review workflow behaviour as part of this repair.
- Do not modify unrelated report calculations, task metadata semantics, or global test timeout policy.
- Do not use `.only`, bare `.skip`, global timeout increases, process-force-exit settings, or retries to conceal an unresolved test lifecycle leak.

## Stop Rules
- Stop and request direction if diagnosis shows the stall originates in external infrastructure, a third-party service, or an environment-level process outside this repository.
- Stop before broadening scope if resolving the issue requires changing user-visible review-state or task-2213 reporting semantics; document the proposed behavioural change and its affected tests.
- Stop and report the blocker if the full gate cannot complete after deterministic cleanup has been implemented and the remaining live handle cannot be attributed using repository evidence.
