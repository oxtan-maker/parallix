# Mission: Shift integration tests right from the unit suite (task-2275)

## Goal
Make `npm test` a hermetic default unit-test feedback loop by identifying every default-suite test whose uncontended runtime exceeds one second, making genuine unit coverage fast and hermetic, and moving boundary-dependent coverage to explicit integration or E2E execution without deleting behavior coverage.

## Why Now
`npm test` delegates to `test/run-default-tests.js`, which currently runs every root-level `*.test.js` except the lifecycle and real-agent E2E files. That broad selection can repeatedly run tests that create real repositories, invoke command-line tools, exercise package installation, or otherwise cross non-hermetic boundaries during draft, checkpoint, and review feedback. The backlog priority is high because slow feedback affects every mission, while the repository already has integration-gate routing in `config/integration-pipelines.json` for later verification.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: per-test timing instrumentation or capture, audit of every default-suite test over one second, test-runner suite selection, explicit integration/E2E invocation, and gate-routing regression coverage

## Scope
- Capture a repeatable, uncontended baseline of per-test runtime for the default command `npm test`, recording the command, environment conditions, total duration, and each test over one second.
- Inventory every over-one-second default-suite test by its test name and file path, then classify it from its actual dependencies as hermetic unit, command-line integration, or E2E.
- For each inventoried test, either remove the external dependency through dependency injection/fakes and retain it in the default suite, move the existing boundary coverage to a clearly named integration or E2E entry point, or retain it with a written, test-specific unit justification and a named follow-up owner where practical.
- Update `test/run-default-tests.js`, test organization/selection, package scripts, and integration-pipeline configuration only as needed to keep the default suite separate from explicit later suites.
- Preserve tests of real Git, worktree, process, packaging, network, and agent behavior by running them from a named non-default suite with disposable artifacts and cleanup assertions.
- Add or update regression tests proving default-suite exclusion and explicit integration/E2E inclusion for every moved test group.
- Record before-and-after timing evidence and the final classification inventory in the mission checkpoints; update repository documentation if commands or suite ownership change.

## Out of Scope
- Removing tests or assertions merely to reduce runtime.
- Replacing coverage of real Git, worktree, process, packaging, network, or agent behavior with mocks instead of retaining it in a later suite.
- Changing production workflow semantics unrelated to test execution and suite routing.
- Requiring external network credentials or live hosted services in the default unit suite.
- Optimizing a test that is already below one second unless needed to support the suite split.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- A checkpoint records one uncontended `npm test` baseline with per-test durations, total duration, test command, and the machine/load conditions used to make the one-second classification reproducible.
- Every default-suite test measured above 1,000 ms in that baseline appears in a classification inventory containing its exact test name, test-file path, observed duration, external dependencies, disposition, and—when retained in the default suite—a test-specific justification plus a named runtime-reduction owner where applicable.
- On the final tree, every default-suite test that executes a real command-line tool, Git repository/worktree operation, package build/install/archive operation, network service, or agent binary is excluded from `npm test` and is included in a clearly named integration or E2E command.
- Each moved test group has regression coverage that proves both its exclusion from `test/run-default-tests.js` default selection and its inclusion in the designated integration/E2E invocation.
- Every retained default-suite test has no real process, repository/worktree, package manager, network, or agent-binary dependency; its behavior remains covered through injected dependencies, fakes, fixtures, or in-process APIs.
- The final checkpoint records a second uncontended `npm test` run with per-test and total timing, and identifies any remaining test above 1,000 ms with its accepted justification; no behavior coverage identified in the baseline inventory is deleted.
- The final tree passes the declared general, static-analysis, and integration verification commands.

## Risks and Assumptions
- Risk: a filename-based split could misclassify tests; classification must use measured runtime and the test's actual process, filesystem, repository, packaging, network, and agent dependencies.
- Risk: moving tests can silently stop them running. Assumption: `config/integration-pipelines.json` and explicit Node test commands can provide durable, testable invocation paths for each moved group.
- Risk: timing varies by workstation and load. Assumption: the one-second threshold is evaluated from a documented uncontended local run; follow-up comparisons use the same command and conditions.
- Risk: tests using disposable real Git repositories or package archives protect boundary behavior that mocks cannot replace. Assumption: those tests will remain intact and be moved, not weakened or removed.
- Risk: changing test selection may affect mission workflow gates. Assumption: `./scripts/verify-local.sh integrate` will select the workflow/build/static-analysis gates for changes in `test/`, `scripts/`, and `config/` as configured by the repository.

## Checkpoints
- CP 1: Establish the uncontended `npm test` baseline; produce the complete over-one-second inventory with exact test names, file paths, measured durations, observed dependencies, and the initial unit/integration/E2E classification. Document the selected destination command for every test that crosses a boundary before changing selection logic.
- CP 2: Hermeticize genuine unit tests and move boundary-dependent test groups out of the default selection into named integration/E2E entry points. Add regression tests for exclusion, inclusion, disposable artifact cleanup, and preserved behavior coverage; do not delete or mock away real boundary coverage.
- CP 3: Re-run the documented timing capture under the same uncontended conditions; reconcile every baseline inventory row, document justified remaining over-one-second unit tests and owners, update command/suite documentation where changed, and run all declared gates.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A concise summary of the work completed in that checkpoint.
- The exact heading `## Goal Check`.
- The exact three-column table header `| Criterion | Evidence | Status |`, with at least one row for every Success Criterion.
- Evidence must use verifiable Parallix forms: file:line references, exact test names, ADR references, existing test file paths, and recognized repository commands or paths such as backticked `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`.
- For CP 1 and CP 3, pair timing output with the exact test-file path and test name for each over-one-second row, and cite the exact timing command used; include the uncontended machine/load conditions and total duration.
- For moves and retained tests, cite the source/destination test file paths, exact test names, and the command that invokes the destination suite; for retained tests, cite the dependency seam/fake at a file:line reference and its named owner where required.
- Raw `stat`/`ls` output or generic prose alone is not enough. It may be supplemental, but must be paired with an accepted reference above.
- A concrete `Next action:` line at the bottom naming the next inventory, suite-routing, timing, or verification action.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md:28` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.js`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all
- [ ] ./scripts/verify-local.sh static-analysis
- [ ] ./scripts/verify-local.sh integrate

## Restricted Areas
- Do not modify production behavior in `lib/` except where an existing testability seam is indispensable to replace a real boundary with an injected dependency or fake; document that necessity in CP-2 before editing it.
- Do not alter `backlog/tasks/task-2275 - Shift-integration-tests-right-from-the-unit-suite.md` ownership fields or transition its status during implementation.
- Do not remove, weaken, skip, or mark `.only`/bare `.skip` on tests to meet timing goals.
- Do not make default-suite execution depend on live network services, user credentials, a non-disposable repository, or an operator's agent configuration.
- Consult `docs/doc-standards.md` before editing root Markdown or files under `docs/`.

## Stop Rules
- Stop and escalate if any proposed speedup requires deleting coverage, weakening a real-boundary assertion, or replacing real Git, worktree, process, packaging, network, or agent behavior coverage with a mock rather than moving it to a later suite.
- Stop and escalate if a candidate test cannot be classified from a repeatable uncontended timing result and its actual dependencies.
- Stop and escalate if no explicit integration/E2E command and gate can invoke a moved test group after the default suite excludes it.
- Stop and escalate if a change would require credentials, a live external network service, or a non-disposable user repository to run the default suite.
- Stop and escalate if the same documented timing command shows a remaining default-suite test above 1,000 ms without a test-specific justification and, where practical, a named follow-up owner.
