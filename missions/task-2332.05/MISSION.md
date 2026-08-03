# Mission: Consolidate inbound command surfaces (task-2332.05)

## Goal
Establish one canonical inbound command path—parser to registry to dispatcher to application capability—for `px` CLI commands, while making the TUI invoke application capabilities directly and removing platform-to-interface command dependencies.

## Why Now
The repository is carrying transitional command re-exports and split dispatch ownership while implementing the UI-neutral application boundary in ADR 0051. Leaving those paths in place makes command behavior, stale-command safety, and ownership ambiguous, and risks expanding the deprecated architecture as new commands are added.

## Refinement Signals
- Predicted NEL bucket: Large (235+)
- Confidence: High
- Selection note: The acceptance criteria identify the required architectural end state and observable compatibility constraints; execution should map the current surfaces before moving modules.
- Main drivers: cross-package dependency inversion, consolidation of parser/registry/dispatcher ownership, mandatory stale-command validation, removal of CLI compatibility re-exports, and CLI output compatibility coverage.

## Scope
- Inventory every current `px` inbound command parser, registry, dispatcher, transitional re-export, and TUI command-module import.
- Consolidate the CLI inbound flow into one parser → registry → dispatcher → application-capability path.
- Reduce `src/entry/px.ts` to outer-boundary bootstrap, process-exit handling, and delegation to the canonical path.
- Change CLI and TUI callers to invoke application capabilities rather than platform command implementation modules.
- Make concurrency/stale-command validation mandatory in normal command dispatch, including every registered command path.
- Remove transitional `src/interfaces/cli/` re-exports once consumers use their canonical replacement.
- Resolve and document in code/ADR evidence whether `src/platform/runtime/` remains a meaningful package after the migration or is removed as migration residue.
- Add or update focused tests that prove command routing, stale-command validation, CLI text/JSON output, and exit-code compatibility for the affected commands.

## Out of Scope
- Changing command names, flags, argument parsing semantics, text output, JSON schemas, or exit codes as a product change.
- Redesigning TUI interaction, layout, rendering, or user-facing workflows beyond replacing its command implementation dependencies.
- Moving unrelated application or platform modules that are not required to establish the single inbound command path.
- Introducing a second compatibility dispatcher, optional stale-validation API, or new public command surface.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- The final repository has one canonical CLI dispatch sequence from parser through registry and dispatcher to an application capability; no alternate command parser, registry, or dispatcher remains reachable from `src/entry/px.ts` or a CLI command entry point.
- `src/interfaces/tui/` contains no import of a command implementation module, and its command-triggering paths call application capabilities through the application-facing boundary.
- No source module under `src/platform/` imports a module under `src/interfaces/`; dependency checks and changed-source inspection show this direction has been eliminated.
- Every command handled by the canonical dispatcher performs concurrency/stale-command validation as part of ordinary dispatch; there is no registered route that bypasses validation or relies on an optional alternate validation API.
- Process exit creation and handling occur only at the outer `px` entry boundary; parser, registry, dispatcher, application, CLI-interface, and TUI modules return or surface results without terminating the process.
- Transitional re-export files under `src/interfaces/cli/` are removed, and all former consumers import the canonical application or interface boundary directly.
- A command-coverage test matrix for all supported CLI commands demonstrates unchanged text output, JSON output, and exit codes against the pre-migration contract; no intentional compatibility exception is left undocumented.
- `./scripts/verify-local.sh static-analysis` and `./scripts/verify-local.sh all` complete successfully on the final tree, with no focused or unannotated skipped tests added.

## Risks and Assumptions
- Risk: command behavior is distributed through re-exports and runtime modules, so removal can silently change output formatting or exit-code translation. Mitigation: identify the current command matrix before relocation and preserve or expand focused compatibility tests.
- Risk: stale-command protection may currently be available only at selected call sites. Mitigation: put validation at the canonical dispatcher contract and test both accepted and stale execution paths.
- Risk: `platform/runtime` may have non-command responsibilities that make a blanket deletion unsafe. Assumption: execution will retain it only when concrete, non-migration runtime ownership remains, and will record that decision with file:line and ADR evidence.
- Assumption: ADR 0051 remains the governing architectural boundary; if the desired dependency direction conflicts with it or another ADR, stop for an ADR decision rather than introduce a local exception.

## Checkpoints
- CP 1: Map the current inbound topology: enumerate parser, registry, dispatcher, entry, re-export, stale-validation, TUI-import, and process-exit sites; write the command compatibility matrix and identify the canonical target boundary.
- CP 2: Establish the canonical parser → registry → dispatcher → application-capability path and mandatory stale-command validation, with focused tests for normal and stale dispatch behavior.
- CP 3: Migrate CLI and TUI callers, minimize `src/entry/px.ts`, remove `src/interfaces/cli/` transitional re-exports, and resolve the remaining purpose or removal of `src/platform/runtime/`.
- CP 4: Complete compatibility and architecture verification: run the full CLI command matrix, prove text/JSON/exit-code preservation, confirm dependency-direction and process-exit criteria, and run all required gates.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A concise summary of the topology mapped or code migrated in that checkpoint.
- The exact heading `## Goal Check`.
- The exact 3-column pipe-delimited table header `| Criterion | Evidence | Status |`, with at least one row for every Success Criterion.
- Verifiable evidence in each row using one or more accepted forms: an existing file:line reference; an exact test name; an ADR reference such as `ADR 0051`; an existing test file path; or a recognized repository command/path such as `npm test -- test/<file>`, `node <script>`, `git diff --check`, `px <command>`, or `./scripts/verify-local.sh all`.
- For this mission, connect canonical-path, TUI dependency, platform-to-interface dependency, stale-validation, process-exit, removed-re-export, and CLI-compatibility claims to the relevant file:line references and exact tests; cite both `./scripts/verify-local.sh static-analysis` and `./scripts/verify-local.sh all` when those gates have run.
- Raw `stat`/`ls` output or generic prose alone is insufficient evidence. If shell output is useful, pair it with an accepted file:line reference, exact test name, ADR reference, test file path, or recognized repository command/path.
- A concrete `Next action:` line at the bottom that names the next command surface, test, dependency check, or gate to perform.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md:28` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh static-analysis
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not alter public CLI names, flag spellings, argument semantics, text output, JSON output, or exit-code values without an approved follow-up mission and explicit compatibility documentation.
- Do not add a `src/platform/` → `src/interfaces/` import, a new transitional re-export, or a second command dispatch route as a migration shortcut.
- Do not terminate the process below the outer `src/entry/px.ts` boundary.
- Do not remove `src/platform/runtime/` until its remaining imports and responsibility have been inventoried and the ADR 0051 boundary decision is evidenced.

## Stop Rules
- Stop and request an architectural decision if satisfying the single dispatch path requires changing a documented CLI text, JSON, flag, or exit-code contract.
- Stop and request an ADR decision if a required caller cannot reach an application capability without creating a platform-to-interface dependency or a TUI-to-command-implementation dependency.
- Stop and report the blocking ownership/dependency if `src/platform/runtime/` has responsibilities outside command migration that cannot be retained or relocated within this mission scope.
- Stop before merging if any supported command lacks compatibility evidence for text output, JSON output, and exit code, or if either required gate fails.
