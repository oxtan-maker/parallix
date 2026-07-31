# Mission: Cut over statistics to MissionOutcome and AgentRunMeasurement persistence (task-2322.08)

## Goal
Make checked `MissionOutcome` and `AgentRunMeasurement` persistence, accessed through application ports and SQLite adapters, the sole live authority for runtime statistics. Retire `stats.csv` from default runtime reads and writes while providing an explicit, read-only, safely repeatable legacy CSV import path and preserving the current statistics command, board, and TUI metric semantics.

## Why Now
TASK-2322.01 recorded the persistence authority boundary and TASK-2322.02 decided the valid per-launch identity; this task depends on TASK-2322.07 and can now complete the cut-over without adapters inventing an `Attempt` or another run identity. Leaving `stats.csv` as a live fallback permits two authorities to diverge, makes restarts and concurrent measurement updates unreliable, and prevents the checked persistence model from being the source used by CLI and UI reporting.

## Refinement Signals
- Predicted NEL bucket: Large (235+)
- Confidence: High
- Selection note: activate as-is
- Main drivers: cross-layer migration from file authority to application ports and SQLite; explicit historical-data import; removal of legacy runtime writers and fallback resolution; characterization and regression coverage for reporting, restart, duplicate import, concurrency, and database failure.

## Scope
- Define or complete the application-port contracts needed to persist and query checked `MissionOutcome` and `AgentRunMeasurement` data, using the identity decisions supplied by TASK-2322.02.
- Route active, stage, review, handoff, integration, and completion measurement producers through those ports and the SQLite usage repository.
- Replace default statistics reads in `src/platform/runtime/lib/commands/stats.ts` and all shared board/TUI metric consumers with SQLite-backed queries that retain the currently characterized filtering, totals, grouping, formatting, and missing-data behavior.
- Implement an explicit legacy CSV import/analysis input that is read-only with respect to its source file, supports dry-run plus atomic idempotent apply, and reports malformed or ambiguous rows without partial database writes.
- Remove production default CSV writers and resolution helpers, including save, upsert, and `resolve-stats-path` behavior; update command help and relevant documentation to state that the database is authoritative.
- Add fast isolated tests proving no unclassified `stats.csv` runtime read/write remains and covering restart behavior, duplicate import, concurrent measurement updates, and database failure.

## Out of Scope
- Changing the `MissionOutcome` or `AgentRunMeasurement` identity model decided and checked by TASK-2322.02, including inventing an `Attempt` or another per-run entity in adapter code.
- Reformatting historical CSV data, editing the source CSV during import, or retaining CSV as a generated export/output target.
- Redesigning the statistics command, board, or TUI presentation beyond preserving their existing characterized metrics against the new authority.
- Migrating unrelated persistence domains or replacing SQLite with another database technology.
- Backfilling data implicitly during normal command execution; legacy migration must remain an explicit user-invoked import or analysis action.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1 — Every active, stage, review, handoff, integration, and completion measurement producer persists only checked `AgentRunMeasurement` or `MissionOutcome` data through application ports; no adapter infers an `Attempt` or any other per-run identity.
- SC2 — The default statistics command plus every shared board or TUI metric reader obtains data from SQLite through the relevant application ports and matches the characterized filtering, totals, grouping, formatting, and missing-data behavior.
- SC3 — The legacy CSV workflow accepts an explicit read-only input path, offers dry-run and atomic idempotent apply modes, leaves the source CSV byte-for-byte unchanged, and reports malformed or ambiguous rows while committing no partial import.
- SC4 — Default runtime execution neither resolves nor reads `stats.csv`, no production path writes CSV, and SQLite unavailability produces the defined database failure rather than a silent CSV fallback; command help identifies the database as the authority.
- SC5 — Production legacy default-file helpers for save, upsert, and stats-path resolution are removed or made unreachable from production runtime paths, with any remaining CSV code limited to the explicitly named import/analysis boundary.
- SC6 — Fast isolated regression coverage proves: a measurement remains available after restart; repeated application of the same CSV creates no duplicate records; concurrent measurement updates retain the required records; and database failure does not access CSV.
- SC7 — Architecture and documentation remain consistent with ADR 0053 and the TASK-2322.02 identity decision, and `./scripts/verify-local.sh static-analysis` plus `./scripts/verify-local.sh all` pass on the completed tree.

## Risks and Assumptions
- CSV rows may lack sufficient identity or contain ambiguous values; the importer must classify and report them instead of guessing or partially applying a batch.
- Existing CLI/TUI semantics may be encoded outside the named statistics command; implementation must inventory all metric readers before removing file helpers.
- Concurrent updates and restart behavior can expose transaction or uniqueness defects that single-process unit tests miss; tests must use fast isolated SQLite fixtures and deliberately exercise these paths.
- The mission assumes TASK-2322.07 is integrated and TASK-2322.02 provides a checked, usable identity boundary; if either does not, stop rather than creating a substitute entity or persistence rule.
- Historical input may be large; atomicity and idempotency take precedence over streaming partial success.

## Checkpoints
- CP 1: Confirm the TASK-2322.02/TASK-2322.07 dependency contracts; inventory every runtime measurement producer, statistics reader, CSV writer, CSV reader, and path-resolution helper; record the intended port and SQLite mapping before changing behavior.
- CP 2: Implement and test the port and SQLite persistence/query cut-over for all enumerated measurement producers and all default statistics/board/TUI readers, preserving characterized report semantics.
- CP 3: Implement and test the explicit legacy CSV import/analysis boundary, including dry-run, atomic idempotent apply, immutable source input, and malformed/ambiguous-row reporting.
- CP 4: Remove default CSV production paths and fallback behavior; add the required restart, duplicate-import, concurrent-update, database-failure, and zero-unclassified-CSV-access regression coverage; update help and ADR-aligned documentation.
- CP 5: Run the required verification gates, update graph context after code changes, and produce the final evidence-backed Goal Check against SC1–SC7.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A concise summary of the completed checkpoint work.
- The exact heading `## Goal Check`.
- The exact three-column pipe-delimited table header `| Criterion | Evidence | Status |`, with at least one row for every applicable SC1–SC7 criterion.
- Verifiable evidence in every row using one or more accepted forms: an existing file:line reference; an exact repository test name; an existing test file path; an ADR reference such as ADR 0053; or a recognized repository command/path such as backticked `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`.
- For this mission, cite the relevant port, SQLite adapter, command/help, importer, and test references rather than asserting that the cut-over happened; include exact test names for the restart, duplicate-import, concurrent-update, and database-failure coverage.
- Raw `stat`/`ls` output or generic prose alone is not acceptable evidence. It may supplement a Goal Check row only when paired with an accepted reference above.
- A concrete `Next action:` line at the bottom that names the next inventory, implementation, test, documentation, or gate action.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| SC1 — producers use checked persistence | Cite the changed `src/application/ports.ts` declaration by file:line and an exact producer test name | Required |
| SC3 — explicit CSV import is safe | Cite the importer test file path and its exact atomic/idempotent test name | Required |
| SC7 — required verification | Cite `./scripts/verify-local.sh static-analysis` after it has run | Required |

## Gates
- [ ] ./scripts/verify-local.sh all
- [ ] ./scripts/verify-local.sh static-analysis

## Restricted Areas
- Do not alter the identity or authority decisions established by TASK-2322.02 or ADR 0053; escalate any gap rather than inferring an `Attempt` in an adapter.
- Do not retain `stats.csv` as a default authority, fallback, output target, or auto-discovered runtime input.
- Do not mutate a legacy CSV supplied for import or analysis, even after a successful apply.
- Keep regression tests isolated from real Forgejo and expensive CLI/agent execution; use fixtures, mocks, and temporary SQLite databases only.
- Limit persistence changes to the statistics migration boundary identified by the backlog references; do not combine unrelated database or reporting redesign work.

## Stop Rules
- Stop and request direction if TASK-2322.02 or TASK-2322.07 is unavailable, contradictory, or does not provide the identity/persistence contract required to store a measurement without adapter inference.
- Stop before applying historical data if a CSV row is malformed or ambiguous and no documented classification rule exists; report it without partial writes.
- Stop and investigate if an inventory discovers a default CSV reader, writer, resolver, board metric, or TUI metric that cannot be mapped to an application port and SQLite query while retaining its characterized behavior.
- Stop and investigate if duplicate import, concurrent updates, restart, or database-failure tests require access to real Forgejo, an expensive agent, or a non-isolated external dependency.
- Stop before closing the mission if any SC1–SC7 row lacks accepted evidence in the final `## Goal Check` table or either required gate fails.
