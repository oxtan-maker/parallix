# Mission: TS migration phase T6 (optional): TypeScript test authoring (task-2229)

## Goal
Enable the repository test toolchain to author and execute TypeScript test files, demonstrated by at least one committed TypeScript-authored test, while retaining the existing JavaScript test suite and its established commands.

## Why Now
ADR 0044 permits this optional T6 phase after its prerequisite migration work (TASK-2224 and TASK-2227). Completing it removes the remaining test-authoring constraint from the TypeScript model, but it is intentionally isolated so the project can still defer broad test conversion.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: extend the test TypeScript configuration and runner resolution; add one representative TypeScript test; prove the mixed JavaScript/TypeScript test tree works through existing verification commands.

## Scope
- Update `tsconfig.test.json` and only the test-runner configuration or invocation required for `.ts` test discovery, transpilation/type-checking, and execution.
- Add at least one repository test authored as a `.ts` file, using the project’s existing test framework and mock-only unit-test conventions.
- Preserve execution of the existing checked-JavaScript test files through the normal `npm test` command.
- Make the smallest documentation change needed if the resulting test-authoring workflow is user- or contributor-facing.

## Out of Scope
- Converting the existing JavaScript test suite wholesale to TypeScript.
- Converting production `lib/` code, changing runtime distribution behavior, or expanding the TypeScript migration beyond T6.
- Changing test semantics merely to make TypeScript compilation pass.
- Adding real Forgejo access, network-dependent tests, slow integration tests, focused tests, or unannotated skipped tests.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- `tsconfig.test.json` includes the TypeScript test sources required by the selected `.ts` test and does not exclude existing JavaScript test sources from the configured test workflow.
- The normal `npm test` command discovers and passes both the selected TypeScript-authored test and the pre-existing JavaScript tests.
- `./scripts/verify-local.sh static-analysis` passes after the test-toolchain and test-file changes.
- At least one committed test under `test/` has a `.ts` extension, contains a named assertion using the repository’s test framework, and is executed by `npm test`.
- No new `.only` or bare `.skip` test declarations are introduced.
- Reverting the mission’s implementation commit removes the new TypeScript test-support configuration and the added `.ts` test, restoring a JavaScript-only test tree without requiring unrelated code changes.

## Risks and Assumptions
- Assumes TASK-2224 and TASK-2227 have landed with the TypeScript compiler and baseline test configuration they establish; stop if either dependency is absent or incompatible in the mission parent commit.
- Test runner support for TypeScript may require a narrowly scoped loader, transform, or runner setting; avoid replacing the runner or changing unrelated test discovery behavior.
- TypeScript compiler settings can surface pre-existing test typing issues. Limit remediation to configuration and the selected test unless a pre-existing error blocks all supported test execution, then stop for scope review.
- The rollback criterion assumes all T6 changes are contained in the phase commit and no generated artifacts are committed.

## Checkpoints
- CP 1: Inspect the prerequisite TypeScript and test-runner setup, then record the exact configuration boundary that must change and select one existing mock-only unit-test scenario suitable for TypeScript authoring. Do not broaden the mission to a bulk conversion.
- CP 2: Add the minimal TypeScript test configuration/runner support and author the selected `.ts` test. Confirm JavaScript test discovery remains enabled and record every changed configuration and test path.
- CP 3: Run the required test and analysis commands, check that no focused or bare skipped tests were introduced, assess rollback by identifying the phase-owned changes, and complete the final Goal Check evidence.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done.
- The exact heading `## Goal Check`.
- The exact 3-column pipe-delimited table header `| Criterion | Evidence | Status |`.
- At least one evidence row per success criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `lib/commands/handoff.ts:292` (must point to an existing file and line)
  2. **Test names** — e.g., `"real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/e2e-real-agent-smoke.test.js` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0048` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `npm test` ``, `` `node --test test/example.test.ts` ``, `` `git diff --check` ``, `` `px checkpoint task-2229` ``, or `` `./scripts/verify-local.sh static-analysis` ``
- Raw `stat`/`ls` output or generic prose alone is not enough evidence. If shell output is cited, pair it with an accepted file:line reference, exact test name, ADR reference, test-file path, or recognized command/path above.
- A non-generic `Next action:` line at the bottom.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md:28` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.js`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] npm test
- [ ] ./scripts/verify-local.sh static-analysis
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify production behavior under `lib/` except where a test-runner integration point is unavoidably located there; any such change requires explicit scope review before editing.
- Do not alter `docs/adr/0044-workflow-distribution-model.md`; it defines the accepted model rather than this phase’s implementation record.
- Do not modify mission orchestration, `px` workflow behavior, remote configuration, or unrelated backlog tasks.
- Keep tests isolated from real Forgejo, network services, and expensive CLI/agent execution; mock dependencies in unit tests.

## Stop Rules
- Stop and request scope direction if TASK-2224 or TASK-2227 is missing, incomplete, or requires implementation changes outside this T6 contract.
- Stop if enabling TypeScript tests requires replacing the test runner, converting more than the selected representative test, or changing production runtime/distribution code.
- Stop if the selected TypeScript test cannot remain mock-only and fast, or if the test toolchain needs real Forgejo, network access, or expensive agent/CLI execution.
- Stop if static analysis exposes pre-existing errors whose correction would require unrelated test-suite or production-code migration.
