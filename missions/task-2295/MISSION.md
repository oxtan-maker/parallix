# Mission: Re-home bounded SQLite operator state onto the canonical domain model (task-2295)

## Goal

Implement the ADR 0044 bounded SQLite adapter for operator-local state, conforming to the canonical domain model, entity-level authority map, and materialized-snapshot sync/async seam established by TASK-2294. This replaces the dead-ended TASK-2280 and must not repeat its async-cascade failure.

## Why Now

TASK-2280 reached MAX_ATTEMPTS after 5 review rounds (~4,525 insertions across 48 files) because it wired the ADR 0044 async-port contract directly into `readAgentConfig()` with no modeled seam, causing `await` to cascade through synchronous agent-eligibility/selection/review consumers. TASK-2294 has now established the canonical domain model, authority map, and composition-root snapshot pattern — the architectural fix that lets an async SQLite port sit at the boundary without forcing async into hot consumer algorithms. The unmerged `mission/task-2280` branch provides a reference spike (adapter-factory, migration-runner, importer, ports, ~2,000 lines of SQLite tests) to salvage conforming pieces from.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate after TASK-2294 merges; the domain model and snapshot seam are prerequisites
- Main drivers: TASK-2280 reference spike provides reusable adapter-factory, migration-runner, importer, ports, blocklist/usage repositories, and migrations (`0001-initial-schema.sql` / `0002-import-history.sql`); TASK-2294 supplies domain types and composition-root snapshot; ADR 0044 constrains SQLite boundary and authority rules

## Scope

- SQLite adapter confined to `src/adapters/sqlite/` (only module importing `node:sqlite`)
- Schema and forward-only migrations for operator-local domains: agent blocklist, usage statistics, known repositories, UI preferences, local operational history, migration metadata
- Entity-level authority map: each stored field owned by exactly one authority (SQLite for operator-local, Git/repo for everything else)
- Application repository ports that remain asynchronous and live behind the TASK-2294 model boundary
- Composition-root materialized snapshot: consumers (agent eligibility/selection, review) read operator-local state from an in-memory snapshot; no `await` in hot paths
- Ordered forward-only migration runner with immutable IDs, checksums, transaction boundaries, and migration ledger
- Connection rules: foreign keys, bounded busy timeout, WAL where supported, parameterized SQL, explicit transactions for multi-statement changes
- Transactional, idempotent importers for CSV/JSON sources (`stats.csv`, `agents.local.json`) with digest recording, error reporting, and original-file preservation
- Database path: `<PARALLIX_HOME>/parallix.db` (platform-specific, never beneath a target repo, worktree, package, or executable directory)
- Tests: clean-install, previous-schema upgrade, backup, interrupted migration, checksum mismatch, malformed import, concurrent access, recovery, no-async-cascade proof, repository-state-wins proof, rollback-to-file-readers

## Out of Scope

- Mission identity, lifecycle, assignment, labels, and closure (scheduled for later cutover per ADR 0044 migration sequence)
- Checkpoints, review conversations, findings, resolutions, approvals (later cutover)
- NEL measurements and resumable session metadata (later cutover)
- Any change to repository authority: Git, task Markdown, mission/review/NEL documents, `.workflow/sessions/` markers
- Secrets and raw agent credentials (never stored in SQLite)
- Dual-write steady state (ADR 0044 cutover rule: one unit switch)
- Broad async conversion of command/agent/review modules
- Ink TUI or web board integration
- Bundle executable targets (separate migration phase)

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: All six operator-local domains (blocklist, usage statistics, known repositories, UI preferences, local operational history, migration metadata) are persisted in SQLite with each stored field mapped to exactly one authority in the TASK-2294 entity-level authority map
- SC2: Exactly one module under `src/adapters/sqlite/` imports `node:sqlite`; zero modules under `src/platform/runtime/lib/` (the application layer) import `node:sqlite`
- SC3: A test proves that adding the async SQLite port introduces zero new `async`/`await` declarations in the agent-eligibility, agent-selection, and review modules; the total diff does not convert any function in `lib/agents/agent-config.ts` consumer paths from sync to async
- SC4: The database path resolves to `<PARALLIX_HOME>/parallix.db` on all four platforms (Linux, macOS, Windows, WSL/fallback) and is never created under a target repository, mission worktree, executable directory, or package directory
- SC5: Migrations have immutable string IDs, SHA-256 checksums, are applied within a single transaction, and a migration ledger table records applied version, checksum, and timestamp; clean-install and previous-schema upgrade tests both pass
- SC6: Database connections enforce `PRAGMA foreign_keys = ON`, busy timeout bounded to 5000ms, WAL mode where supported, use parameterized SQL for all dynamic values, and wrap multi-statement changes in explicit `BEGIN`/`COMMIT` transactions
- SC7: Importers for `stats.csv` and `agents.local.json` are transactional (all rows or none), idempotent (re-running produces identical state), record source file path and SHA-256 digest in the migration ledger, report malformed records without aborting the entire import, and leave original source files untouched (no deletions)
- SC8: Test suite includes passing tests for: backup before migration, interrupted migration recovery, checksum mismatch detection, malformed import handling, concurrent access (two processes), and adapter recovery after corruption
- SC9: No column in the SQLite schema stores secrets or raw agent credentials; schema definition and all migration SQL files are verified to contain no fields matching `secret`, `credential`, `password`, `token`, or `api_key`
- SC10: A test proves that when repository/Git state conflicts with a cached database projection, repository state wins; a rollback test disables the SQLite adapter and verifies agent-config consumers fall back to the untouched file-based `readJson`/`fs.readFileSync` readers
- SC11: `./scripts/verify-local.sh all` passes; `./scripts/verify-local.sh static-analysis` passes for all files under `src/adapters/sqlite/` and any new files under `src/platform/runtime/lib/`

## Risks and Assumptions

- **Risk: Repeating TASK-2280 async cascade.** If any diff converts `readAgentConfig()` or its callers from sync to async, the mission is off-plan. Mitigation: the composition-root snapshot pattern from TASK-2294 must be the only async boundary; hot-path consumers receive a plain snapshot object
- **Risk: Over-scoping from TASK-2280 reference spike.** The `mission/task-2280` branch contains ~4,525 insertions across 48 files; importing all of it would reproduce the failure. Mitigation: only salvage pieces that conform to TASK-2294 model; reject anything that couples async into consumer algorithms
- **Risk: TASK-2294 domain model changes.** If TASK-2294's authority map or snapshot pattern changes before this mission starts, the adapter must be re-scoped. Mitigation: TASK-2294 is a hard dependency and must merge first
- **Assumption: `node:sqlite` stability.** The Node.js built-in SQLite module (`node:sqlite`) provides `DatabaseSync` with WAL, foreign keys, and parameterized statements on all target platforms
- **Assumption: `PARALLIX_HOME` resolution works.** The existing `resolveParallixHome()` in `src/platform/runtime/lib/core/storage.ts` correctly resolves platform-specific paths and the database is placed as `parallix.db` beneath it
- **Assumption: TASK-2280 branch remains available.** The operator keeps the `mission/task-2280` worktree live until this mission and TASK-2294 land

## Checkpoints

- CP 1: Define SQLite schema and migration runner. Create `src/adapters/sqlite/` with schema SQL (`0001-initial-schema.sql`, `0002-import-history.sql`), migration runner with immutable IDs, checksums, transaction boundaries, and migration ledger. Add clean-install and previous-schema upgrade tests. Verify connection rules (foreign keys, busy timeout, WAL, parameterized SQL).
- CP 2: Implement application repository ports and operator-local domain mappings. Map all six operator-local domains (blocklist, usage statistics, known repositories, UI preferences, local operational history, migration metadata) onto TASK-2294 domain entities with entity-level authority ownership. Ports remain asynchronous and live behind the model boundary.
- CP 3: Wire composition-root materialized snapshot and prove no async cascade. Consumers (agent eligibility/selection, review) read from the in-memory snapshot. Add test proving zero new `async`/`await` in hot-path modules. Verify `readAgentConfig()` consumer paths remain synchronous.
- CP 4: Implement transactional idempotent importers for `stats.csv` and `agents.local.json`. Digest recording, error reporting, original-file preservation. Add tests for malformed imports and idempotency.
- CP 5: Add recovery, backup, concurrency, and rollback tests. Cover backup-before-migration, interrupted-migration recovery, checksum mismatch, concurrent access, and rollback-to-file-readers. Verify repository-state-wins test. Confirm secrets exclusion.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `src/adapters/sqlite/adapter.ts:42` (must point to an existing file and line)
  2. **Test names** — e.g., `"SQLite adapter enforces foreign keys and WAL mode"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/sqlite-adapter.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0044` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `./scripts/verify-local.sh static-analysis` ``, `` `npm test -- test/sqlite-adapter.test.ts` ``, or `` `node --import tsx test/sqlite-migration.test.ts` ``
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Schema maps blocklist to authority | `src/adapters/sqlite/schema/0001-initial-schema.sql:15`, authority map in `src/platform/runtime/lib/domain/authority-map.ts:28` | PASS |
| No async in agent-config consumers | `src/platform/runtime/lib/agents/agent-config.ts:48-52` remains `function` not `async function`; test `"adding SQLite port introduces no async cascade in agent selection"` in `test/sqlite-async-cascade.test.ts` | PASS |
| Static analysis passes | `./scripts/verify-local.sh static-analysis` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh all`
- [ ] `./scripts/verify-local.sh static-analysis`

## Restricted Areas

- `src/platform/runtime/lib/agents/agent-config.ts` consumer paths (eligibility/selection/review) must not be converted from sync to async
- `src/platform/runtime/lib/core/storage.ts` — only read; do not modify `resolveParallixHome()` or `resolveStatsPath()` signatures
- All files under `lib/commands/` that consume agent config (`lib/commands/active.ts`, `lib/commands/claude.ts`, etc.) must not have their function signatures changed from sync to async
- `test/` — no `.only` or bare `.skip` on new or modified tests
- `docs/adr/` — do not modify ADR 0044 or ADR 0051
- `config/` and `scripts/` — do not modify unless adding migration-specific verification

## Stop Rules

- Stop and re-scope if any diff converts a function in `lib/agents/agent-config.ts` or its consumer modules from synchronous to async (async-cascade re-introduction)
- Stop if TASK-2294 has not merged and its domain types / authority map / snapshot pattern are not available
- Stop if `node:sqlite` does not support WAL mode or foreign keys on a target platform
- Stop if the total insertion count exceeds 2,500 lines (half of TASK-2280's ~4,525) — this signals over-scoping
- Stop if `./scripts/verify-local.sh all` fails for more than 2 iterations on the same root cause

## Re-scope / Takeover Note

The mission reached MAX_ATTEMPTS on round 5 and was taken over. The takeover corrected the
architecture rather than patching symptoms:
- **CP-3 rewired to the real consumer.** The blocklist is materialized once (async) at the
  composition root and overlaid — synchronously, as the sole authority for the `config.blocklist`
  field — onto the existing `launcher-selection.ts`/`agent-config.ts` selector. The earlier parallel
  `SqliteAgentSelectionSnapshotPort` → `ActiveService._agentSelection` selector, which never
  influenced production selection, was deleted; `ActiveService` was restored to its `main` shape.
- **CP-4 corrected `usage_statistics` types** from all-`TEXT` to `INTEGER`/`REAL` to conform to the
  TASK-2294 domain model (`src/domain/usage.ts`); NULL = unavailable.
- **CP-5 made SC8/SC10 genuine.** Real adapter recovery (`checkIntegrity`/`backup`/
  `recoverFromBackup`), real rollback-to-file-readers, and real repository-authority-wins proofs.

The migration engine remains the hand-rolled forward-only `node:sqlite` runner (honoring ADR 0044's
driver mandate); whether to adopt a library-backed engine is deferred to TASK-2301 as an explicit
ADR-level decision. Line count is not treated as a gating constraint for this mission; correctness
and domain-model conformance are.
