# Mission: Improve resource usage (task-2326)

## Goal
Reduce local Parallix development resource consumption by removing temporary artifacts reliably, separating slow or non-hermetic tests from the unit suite, and enforcing a bounded, parallel-safe unit-test workflow.

## Why Now
The current SDLC workflow has become slow while leaving temporary artifacts behind. Without an inventory, cleanup ownership, concurrency controls, and a unit-test time budget, repeated local runs can consume disk space and allow integration-style tests to make the fast feedback loop progressively slower.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: Medium
- Selection note: inspect current temporary-artifact producers and the test runner configuration before selecting the smallest compatible cleanup and timing mechanism.
- Main drivers: temporary-directory artifact inventory and lifecycle ownership; classification and relocation of slow/non-unit tests; parallel execution and an enforceable unit-test timing bound.

## Scope
- Inventory temporary artifacts left by recent Parallix runs, identify the command or workflow that creates each artifact, and document the cleanup owner.
- Implement cleanup for mission-scoped temporary artifacts so normal completion, failure handling, and applicable cancellation paths do not leave the identified artifacts behind.
- Review unit tests added or materially changed during the previous week; identify tests whose recorded duration exceeds the classification threshold selected in CP 1, access external services, launch expensive CLI/agent workflows, or otherwise are not hermetic unit tests.
- Move identified non-unit tests to the repository’s integration/workflow test layer and retain their behavioral coverage there.
- Configure hermetic unit tests to run in parallel where test isolation permits it.
- Add an enforceable timing limit or timing check for the unit-test suite so a slow or integration-style test is detected in future changes.
- Update tests and workflow documentation/configuration that directly support the cleanup, test classification, parallelization, and timing-bound behavior.

## Out of Scope
- Redesigning the entire Parallix execution architecture or replacing its test framework.
- Changing production behavior unrelated to temporary-artifact lifecycle management.
- Optimizing integration or workflow suites beyond relocating tests that do not qualify as unit tests.
- Deleting user-owned files or broad system temporary directories outside artifacts positively attributable to Parallix.
- Reclassifying tests older than the requested one-week review window unless they must move with a directly affected test group.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- Each temporary-artifact class identified from recent Parallix runs has a documented producer and cleanup owner, and the implementation removes that class on the applicable normal and failure paths.
- A review of unit tests from the prior seven days produces a recorded classification for every reviewed test; every test whose recorded duration exceeds the CP 1 classification threshold, is externally dependent, or is non-hermetic is relocated to an existing integration/workflow suite with equivalent coverage.
- The unit-test command runs hermetic tests concurrently only where their tests do not share mutable filesystem, process, environment, network, or Forgejo state; affected tests prove isolation through mocks or isolated temporary paths.
- The repository enforces a numeric unit-test time budget or timeout through a checked-in command, script, or test-runner configuration, and a targeted test proves that exceeding the configured bound fails the unit-test verification path.
- Existing unit-test coverage remains executable through the unit-test command; relocated tests are executable through the designated integration/workflow command; no focused (`.only`) or unannotated skipped tests are introduced.
- `./scripts/verify-local.sh all` exits successfully on the completed worktree.

## Risks and Assumptions
- Assumption: repository-local temporary artifacts can be distinguished from user- or operating-system-owned files before cleanup is enabled.
- Risk: cleanup on failure or cancellation may mask the original error; preserve the original failure signal and make cleanup errors observable without replacing it.
- Risk: parallel execution can expose shared-state races; parallelize only tests proven hermetic and retain serial execution for tests with unavoidable shared state.
- Risk: a global timeout can create flaky failures on constrained CI; choose a measured numeric bound and validate it with deterministic mocked tests rather than real Forgejo or agent execution.
- Assumption: the existing integration/workflow layer has a recognized command and location suitable for relocated tests.

## Checkpoints
- CP 1: Inventory temporary artifacts from recent runs and the prior-week unit tests. Record each artifact’s producer, lifecycle path, and safe cleanup boundary; record a measured classification threshold and classify every reviewed test as hermetic unit or integration/workflow. Do not move tests or change cleanup behavior until this inventory identifies the exact targets.
- CP 2: Implement and test the temporary-artifact cleanup lifecycle, including normal completion and failure handling. Move the inventory’s non-hermetic or slow tests to the established integration/workflow layer and verify their replacement command.
- CP 3: Configure safe unit-test parallelism and the numeric unit-test timing guard. Add deterministic tests for the timing guard and test isolation, update directly affected documentation/configuration, and run the required repository gate.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A concise summary of the artifact/test inventory, implementation, or verification completed in that checkpoint.
- The exact heading `## Goal Check`.
- The exact 3-column pipe-delimited table header `| Criterion | Evidence | Status |`, with one row for every Success Criterion.
- Evidence must use Parallix-recognized forms: existing file:line references; exact repository test names; existing test file paths; ADR references; and recognized repository commands or paths such as backticked `npm ...`, `node ...`, `git ...`, `px ...`, or `./...` commands/paths.
- For cleanup criteria, cite the producer/cleanup implementation as file:line references and the test that covers normal or failure cleanup. For classification and timing criteria, cite the inventory/test path, exact test name, and runnable repository command.
- Raw `stat`/`ls` output or generic prose alone is not enough. It may be supplemental only and must be paired with an accepted reference above.
- A specific `Next action:` line at the bottom that names the next artifact class, test group, configuration change, or verification command.

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not delete or clean paths outside the repository-controlled temporary artifacts identified in CP 1.
- Do not access real Forgejo, network services, or expensive agents from unit tests; use mocks and isolated test fixtures.
- Do not alter backlog ownership (`assignee`) or mission workflow state during implementation.
- Do not broaden test relocation beyond the prior-week inventory except for directly coupled test fixtures or helpers.

## Stop Rules
- Stop before enabling cleanup if artifact ownership or a safe path boundary cannot be established; report the unresolved producer and preserve existing files.
- Stop before parallelizing any test that shares mutable state or requires real external services until it is isolated or moved to the integration/workflow layer.
- Stop before setting the timing budget if measured hermetic test duration cannot support a deterministic numeric threshold across the supported local environment.
- Stop and request direction if satisfying cleanup requires deleting user-owned files, global temporary directories, or artifacts whose producer cannot be attributed to Parallix.
