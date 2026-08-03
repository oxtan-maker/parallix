# Mission: Move contracts to their owning layer (task-2332.03)

## Goal
Relocate use-case contracts from the SQLite adapter into technology-neutral, capability-oriented application ports, while retaining SQLite records and migration/import mechanics inside the SQLite adapter and preserving existing behavior.

## Why Now
The current boundary makes application services depend on names and identities of the SQLite implementation, despite ADR 0051's UI-neutral application boundary. Completing this refactor after TASK-2332.02 prevents new application code from extending the mixed adapter/application contract surface.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: extracting use-case ports from `src/adapters/sqlite/ports.ts`; splitting contracts into six capability files under `src/application/ports/`; updating application consumers and SQLite implementations without changing behavior.

## Scope
- Create application-owned capability contracts under `src/application/ports/`: `mission-store.ts`, `mission-measurements.ts`, `operator-preferences.ts`, `repository-catalog.ts`, `agent-blocklist.ts`, and `operation-history.ts`.
- Move actual application use-case ports currently in `src/adapters/sqlite/ports.ts` to the capability that owns each use case.
- Update application services to import and compile against the new technology-neutral application contracts.
- Update SQLite adapters to implement the moved application contracts.
- Replace application-facing implementation identity values such as `'sqlite' | 'compatibility'` with semantic results where an application use case needs that information.
- Preserve behavioral equivalence with characterization coverage for the moved contract flows.

## Out of Scope
- Changing SQLite schema, SQL queries, persistence formats, migration ledger format, or import-row format.
- Moving SQL records, migration ledgers, import rows, or other database mechanics into the application layer.
- Altering product behavior, command-line behavior, workflow behavior, or public APIs beyond the contract naming and ownership needed to remove persistence leakage.
- Broad reorganization of adapters other than the imports and implementations required by the moved ports.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- `src/application/ports/` contains exactly the six capability contract files named in Scope, and application use-case contracts reside in the capability file that owns them.
- `src/adapters/sqlite/ports.ts` no longer declares application use-case port interfaces; any contracts retained there are SQLite-private database, migration, import, or record mechanics.
- Application port definitions contain none of the terms `sqlite`, `table`, `row`, or `legacy-storage`, and expose no SQLite-specific types.
- All application services that previously consumed the moved contracts import technology-neutral contracts from `src/application/ports/` and compile without adapter-specific type dependencies.
- SQLite adapter implementations satisfy the corresponding application port contracts without moving SQL records, migration ledgers, or import rows into `src/application/ports/`.
- Characterization tests cover the pre-existing behavior of each affected mission storage, measurements, operator preferences, repository catalog, agent blocklist, and operation history flow, and pass after the relocation.
- `./scripts/verify-local.sh static-analysis` and `./scripts/verify-local.sh all` pass on the completed implementation.

## Risks and Assumptions
- Risk: a port can appear adapter-specific while encoding a real application use case; classify it by who needs the capability, not by its current file location.
- Risk: replacing persistence identity strings can change branching behavior. Preserve observable outcomes and add characterization coverage before removing identities.
- Risk: migration and import contracts may be accidentally exported from the application layer. Keep them SQLite-private unless a named application use case demonstrably requires them.
- Assumption: TASK-2332.02 established the boundary prerequisites referenced by this task.
- Assumption: ADR 0051 remains the governing architecture decision for the application boundary.

## Checkpoints
- CP 1: Inventory every declaration and consumer in `src/adapters/sqlite/ports.ts`; map each actual use-case port to one of the six application capabilities and explicitly mark database records, migration ledgers, and import rows as adapter-private.
- CP 2: Introduce the six application port files, move the mapped use-case contracts, and update application-service imports and semantic result types while retaining equivalent behavior.
- CP 3: Update SQLite implementations and adapter-private contracts; add or adjust characterization tests for each affected capability flow.
- CP 4: Run static analysis and the full local verification gate; record final goal-check evidence and resolve any boundary leakage reported by the checks.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A concise summary of the ports classified, moved, or verified in that checkpoint.
- The exact heading `## Goal Check`.
- The exact 3-column pipe-delimited table header `| Criterion | Evidence | Status |`, with one row for every Success Criterion addressed by the checkpoint.
- Verifiable evidence using one or more of: file:line references (for example `src/application/ports/mission-store.ts:24`), exact test names, ADR references (including `ADR 0051`), existing test file paths, or recognized repository commands/paths such as backticked `npm ...`, `node ...`, `git ...`, `px ...`, or `./...` commands.
- For behavior preservation, name the affected test file path and exact test name; for contract ownership, cite the moved contract's file:line and the corresponding SQLite implementation file:line.
- Raw `stat`/`ls` output or generic prose alone is not enough. If shell output is included, pair it with an accepted file:line reference, exact test name, ADR reference, test path, or recognized command/path.
- A concrete `Next action:` line at the bottom, such as identifying the next capability file or verification command.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Application contracts are technology-neutral | `src/application/ports/mission-store.ts:24`, ADR 0051 | PASS |
| SQLite implementation satisfies a moved port | `src/adapters/sqlite/mission-store.ts:48`, `test/mission-store.test.ts` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh static-analysis
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not change SQLite schemas, database files, migration ledger formats, import-row formats, or SQL query semantics.
- Do not introduce SQLite types or the terms `sqlite`, `table`, `row`, or `legacy-storage` into application port definitions.
- Do not move adapter-private persistence records or migration/import mechanics into `src/application/ports/`.
- Do not alter unrelated adapter organization, product behavior, command-line behavior, or workflow behavior.

## Stop Rules
- Stop and request architectural direction if a contract cannot be classified as either an actual application use case or an adapter-private SQLite mechanic using ADR 0051 and its consumers.
- Stop and request direction before exposing a migration ledger, import row, SQL record, schema detail, or SQLite-specific type through an application port.
- Stop if characterization tests reveal behavior differences after an identity value is replaced; do not mask the difference by weakening assertions.
- Stop before making any schema, SQL semantic, migration-format, import-format, public API, or unrelated adapter reorganization change.
