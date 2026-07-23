# Mission: Repair execution-root-aware rebase test fixtures (task-2299)

## Goal
Restore hermetic rebase unit-test coverage after Git commands gained the `-C <executionRoot>` prefix, by updating affected test fakes to explicitly normalize command arguments while retaining all existing retry and diagnostics assertions.

## Why Now
Commit `6f401e34a` correctly made production Git invocation execution-root-aware, but stale rebase test fakes read the Git subcommand at fixed argument positions. The mismatch masks the intended retry and failed-continue diagnostic paths, leaving the affected unit tests regressed.

## Refinement Signals
- Predicted NEL bucket: Small (0–80) / Medium (81–235) / Large (235+)
- Confidence: High
- Selection note: activate as-is
- Main drivers: root-prefixed Git invocation changed mock input shape; retry-cap and failed-continue diagnostic coverage must remain reliable; nearby rebase fakes require a bounded stale-index audit.

## Scope
- Update rebase test fixtures and mocks to identify Git subcommands after an explicit normalization of the optional `-C <executionRoot>` prefix.
- Preserve the test assertions for exactly three `git rebase --continue` attempts when rebase remains active.
- Preserve assertions that failed `git rebase --continue` stderr/output and hook diagnostics are reported.
- Audit the nearby rebase test fakes for fixed `args[0]` or `args[1]` Git-subcommand assumptions and update each affected fake in the rebase test suite.
- Keep all affected tests hermetic by mocking Git and external dependencies.

## Out of Scope
- Changing production execution-root handling or removing the `-C <executionRoot>` Git prefix.
- Altering rebase retry policy, retry count, hook behavior, or user-facing diagnostics beyond restoring existing tests.
- Running real Git workflows, contacting Forgejo, or changing integration/E2E infrastructure.
- Broad test-suite cleanup outside the nearby rebase fixtures identified by the stale-index audit.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- The affected rebase test fakes explicitly normalize the `-C <executionRoot>` prefix before checking the Git subcommand, without loose matching that would accept malformed command arguments.
- The test named `rebase caps failed continue retries when rebase remains active` records and asserts exactly three `git rebase --continue` attempts.
- The test named `rebase reports git output on failed continue attempt` asserts the failed-continue Git output/stderr and hook diagnostic are retained.
- Every nearby rebase fake that still assumes the Git subcommand is at `args[0]` or `args[1]` is either updated to normalized arguments or demonstrated not to handle root-prefixed Git invocations.
- `node test/run-default-tests.js test/rebase.test.ts test/rebase_diagnostics.test.ts` completes successfully with mocked external dependencies only.
- `./scripts/verify-local.sh all` completes successfully on the completed mission tree.

## Risks and Assumptions
- Risk: an overly permissive mock matcher could make tests pass while accepting an incorrect Git command shape. Assumption: a small test-local normalization helper can expose the command tail without weakening assertions about the prefix and subcommand.
- Risk: another nearby fake may share the stale positional assumption. Assumption: the rebase test files named in the focused command contain the bounded audit surface.
- Risk: accidentally unmocked dependencies could invoke a real CLI or Forgejo. Assumption: existing test harness conventions support complete mocking for the touched paths.

## Checkpoints
- CP 1: Inspect `test/rebase.test.ts` and `test/rebase_diagnostics.test.ts` for rebase Git fakes that assume fixed command indexes; document the exact affected fixture locations and the intended normalization contract before editing.
- CP 2: Add a small explicit test-side argument-normalization helper and update each affected rebase fake; retain strict assertions for the `-C <executionRoot>` prefix and relevant Git subcommands.
- CP 3: Confirm the retry-cap and failed-continue diagnostics tests retain their named assertions, run the focused rebase test command, and record evidence for every success criterion.
- CP 4: Run the repository verification gate and complete the final checkpoint with a criterion-by-criterion Goal Check table.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include a concise work summary, then the exact heading `## Goal Check` followed by this exact 3-column header: `| Criterion | Evidence | Status |`.

Each success criterion needs at least one evidence row. Accepted evidence forms are existing file:line references, exact repository test names, test file paths, ADR references, and recognized repository commands or paths such as backticked `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. For this mission, cite the changed fixture/helper file:line locations, the exact two named rebase tests, `test/rebase.test.ts` or `test/rebase_diagnostics.test.ts`, and the focused or verification command as applicable.

Raw `stat`/`ls` output or generic prose alone is insufficient evidence—a weak agent must pair any shell output with at least one accepted reference above. End every checkpoint document with a concrete `Next action:` line naming the next inspection, edit, command, or handoff.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md:28` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Production Git execution-root logic and its `-C <executionRoot>` invocation contract.
- Rebase retry semantics, including the three-attempt cap, and failed-continue hook diagnostics.
- External integration boundaries: tests must not run real Git workflows or access real Forgejo.
- Files outside the nearby rebase test fixtures unless a direct stale fixed-index dependency is established.

## Stop Rules
- Stop and request direction if restoring the tests requires changing production execution-root behavior, retry semantics, or diagnostics rather than test fixtures.
- Stop and request direction if the stale-index audit expands beyond the rebase test files named in the focused test command.
- Stop and request direction if hermetic mocks cannot cover an affected path without executing real Git or contacting Forgejo.
- Stop and request direction if the focused tests reveal a behavioral regression unrelated to command-argument indexing.
