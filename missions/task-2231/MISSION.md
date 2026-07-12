# Mission: Prevent draft agent-launch unit-test hangs (task-2231)

## Goal
Make the draft-stage agent-launch unit tests deterministic: the test path that exercises a failed `startAgent` launch and retry must finish without starting an unmocked expensive child process or leaving active asynchronous work behind.

## Why Now
The current unit-test run can stall around the draft launch/watchdog coverage. A hanging test blocks the local verification loop and obscures whether workflow changes are safe to ship; the failure must be locked by a regression test before the launcher test harness is corrected.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: draft-specific custom-agent launch coverage, signal-retry behavior, child-process mocking and cleanup in unit tests

## Scope
- Add a focused regression test under `test/` that reproduces the draft custom-agent launch retry path and proves the parent commit hangs or exceeds its bounded completion time before the fix.
- Inspect the draft agent-launch unit-test setup, including mocks for the child CLI/process launch and any no-output watchdog handles created by the scenario.
- Correct only the test harness or workflow code needed so the reproduction completes, the retry semantics remain covered, and no real expensive CLI launch is attempted during the unit test.
- Retain coverage for the existing draft-specific watchdog message, mission-worktree `cwd`/`PWD` propagation, and non-draft generic watchdog behavior.

## Out of Scope
- Changing the production agent-selection policy, retry count, watchdog timeout values, or custom-agent command format unless the regression test demonstrates that one is directly responsible for the hang.
- Reworking unrelated agent-launch tests or converting the full test suite to a different runner.
- Adding new external-process integration tests, changing CI infrastructure, or modifying documentation unrelated to behavior that changes as part of this fix.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- A regression test at `test/task-2231-unit-tests-hang-repro.test.js` reproduces a draft custom-agent launch failure followed by retry and is red at the mission parent commit because the scenario does not complete within its explicit test bound; it is green after the fix.
- The fixed test path never invokes the real configured custom-agent CLI; the test double records the attempted launch command and provides the failure/retry result required by the scenario.
- The focused draft-launch tests complete under the repository test command without open handles, forced process termination, `.only`, or bare `.skip` annotations.
- Existing assertions continue to verify all three behaviors: draft watchdog messages identify the agent stage, child CLIs receive the mission worktree in both `cwd` and `PWD`, and non-draft launches retain the generic watchdog message.
- `./scripts/verify-local.sh all` passes on the completed mission tree.

## Risks and Assumptions
- Risk: a timeout-based reproduction can be flaky on slow CI. Assumption: the test can use a short but explicit bound around a controlled fake launch rather than wall-clock timing of a real process.
- Risk: changing mocks may mask production launch behavior. Assumption: command construction and retry assertions can remain explicit while the external process itself is isolated.
- Risk: watchdog timers or child-process streams may be the actual open handle. Assumption: the implementation checkpoint will inspect and clean up every handle created by the reproduction path.

## Checkpoints
- CP 1: Author the failing regression test first. Create `test/task-2231-unit-tests-hang-repro.test.js` for a draft-stage custom-agent launch whose first `startAgent` attempt fails with a signal and triggers retry. Assert that the controlled scenario fails to settle within its explicit completion bound on the mission parent commit (red), then settles and verifies the retry after the fix (green). Do not write the fix before recording the red result.
- CP 2: Trace the reproduction through the draft launcher, process/CLI mock boundary, and watchdog cleanup. Make the smallest implementation change that prevents an unmocked expensive launch or retained async handle while preserving the existing draft and non-draft assertions.
- CP 3: Run the focused affected test file and `./scripts/verify-local.sh all`; record the final Goal Check with the exact test names, source references, and verification command.

Reproduction-Test: test/task-2231-unit-tests-hang-repro.test.js

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary that names the completed checkpoint and identifies the draft launch/retry or watchdog behavior examined.
- The exact heading `## Goal Check`.
- The exact 3-column pipe-delimited table header `| Criterion | Evidence | Status |`, with one evidence row for every success criterion.
- Evidence using Parallix-recognized forms: existing file:line references; exact repository test names; ADR references; existing test file paths; and recognized commands or paths such as backticked `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`.
- For CP 1, the path `test/task-2231-unit-tests-hang-repro.test.js`, the red parent-commit result, and the explicit bounded-completion assertion; for CP 3, the exact focused-test command and `./scripts/verify-local.sh all` result.
- Raw `stat`/`ls` output or generic prose alone is not acceptable evidence. If shell output is included, pair it with an accepted file:line reference, exact test name, ADR reference, test path, or recognized repository command/path.
- A specific `Next action:` line at the bottom, such as implementing the isolated mock boundary after the red test is captured or running the final verification gate after cleanup.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md:28` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.js`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [x] `./scripts/verify-local.sh all`

## Restricted Areas
- Do not modify backlog ownership (`assignee`) or transition the task status during execution.
- Do not change `config/integration-pipelines.json`, CI definitions, external agent configuration, or unrelated test files.
- Do not invoke a real custom-agent executable from a unit test; all process-launch behavior in the reproduction must be controlled by test doubles.

## Stop Rules
- Stop and request direction if reproducing the hang requires a real external CLI, network access, or changing the production retry/watchdog contract.
- Stop and request direction if the hang originates outside the draft agent-launch path or fixing it requires changes to CI/integration configuration.
- Stop and request direction if the proposed fix would broaden production behavior beyond isolating the test launch or cleaning up the leaked handle.
