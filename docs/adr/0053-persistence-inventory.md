# ADR 0053 Persistence Inventory

The certification fixture at `test/fixtures/durable-state-inventory.ts`
records every production reader and writer for the 15 durable-state concepts named in
ADR 0053. It is the contract that the ADR 0053 cutover tasks (TASK-2322.02, TASK-2322.03)
consume when migrating file-backed persistence to SQLite.

## Relationship to ADR 0053

ADR 0053 (`docs/adr/0053-operational-persistence-and-authority-boundaries.md`) decides that
one SQLite database at `<PARALLIX_HOME>/parallix.db` is the sole write authority for
Parallix-owned operational state after each domain completes its explicit cutover. The
inventory records the **current** (pre-cutover) readers and writers so that the migration
knows exactly what paths must be redirected.

Each inventory entry names a durable boundary in production code. The
`fileLocation` field is the TypeScript source file containing the reader or writer. The
`operation` field is `read` or `write`. The `concept` field names the ADR 0053 domain
concept (e.g. `Mission`, `Review`, `AgentRunMeasurement`).

Some entries record *logical* boundaries (port call sites where a domain object is
read or written through an injected adapter) rather than *physical* IO sites
(filesystem calls). For example, `outcome-derive-completed` points at
`src/domain/usage.ts` which has no direct `fs` calls — it derives
`CompletedMissionStatistics` from `Mission` and `MissionOutcome` objects passed
through application ports. `lane-event-recorder` at
`src/application/recording/board-event-recorder.ts` similarly writes through an
injected port. These are valid inventory entries because the cutover tasks need to
know which logical boundaries produce durable state, even if the physical IO lives
in an adapter.

## Relationship to ADR 0051

ADR 0051 (`docs/adr/0051-ui-neutral-application-boundary.md`) defines the Hexagonal
Architecture boundary between application use cases and adapters. The inventory respects
this boundary:

- **Application/UI code** (`src/application/`, `src/interfaces/`) may not import
  `node:sqlite` directly (SC2 guard). Durable file operations in these directories must
  be registered in the inventory (SC7 guard).
- **SQLite adapters** (`src/adapters/sqlite/`) are the sole location for `node:sqlite`
  imports. They implement persistence ports owned by the application layer.
- **Domain code** (`src/domain/`) contains no persistence calls — it is pure policy.

The inventory's `database-owned-domain-state` classification marks boundaries that will
migrate to SQLite through the ADR 0051 adapter ports.

## Classification Rules

Each entry is classified as exactly one of:

| Classification | Meaning | Cutover behavior |
|---|---|---|
| `database-owned-domain-state` | Parallix-owned operational fact; target for SQLite migration | Migrated by named cutover task |
| `explicit-one-way-legacy-input` | Legacy input path; data flows into Parallix once | Migrated to adapter import |
| `external-fact-or-intake` | Owned by another system (Git, task catalog, OS) | Not migrated; remains external |
| `configuration-or-secret` | Operator-authored policy or credentials | Not migrated; stays in files/env |
| `generated-artifact` | Rebuildable output (reports, verdicts, NEL) | Not migrated; regenerated on demand |
| `forbidden-persistence` | Should not persist here | Must be removed or reclassified |

The `ADR0053Classification` type in `durable-state-inventory.ts` enforces this as a
compile-time union — no entry can have an unlisted classification.

## How Cutover Tasks Consume the Inventory

A cutover task (e.g. TASK-2322.02 for Mission/Review) reads the inventory entries with
its cutover task ID and:

1. **Redirects reads** — replaces file-based reads with SQLite adapter queries for
   entries matching its scope.
2. **Redirects writes** — replaces file-based writes with SQLite adapter mutations.
3. **Removes compatibility paths** — deletes `pathType: 'compatibility'` entries that
   are no longer needed after migration.
4. **Verifies completeness** — the reverse completeness check
   (`SC1 reverse: all durable-IO files under src/ are present in the inventory`) ensures
   no durable IO site was missed.

The `cutoverTask` field on each entry names the specific task responsible for its
migration. Entries with `cutoverTask: null` are permanent (SQLite adapters, external
facts, configuration) and do not migrate.

## Enforcement

The inventory is enforced by architecture tests in `test/persistence-inventory-guardrail.test.ts`:

- **SC1** — All 15 ADR 0053 concepts covered; every entry has valid classification,
  pathType, operation, unique ID, and existing file location.
- **SC1 reverse** — Every durable-IO site under `src/` is present in the inventory
  (or excluded as infrastructure).
- **SC2** — No `node:sqlite` or `sqlite3` imports in `src/application/` or `src/interfaces/`.
- **SC7** — No unclassified durable file operations in application/UI code.
- **SC4** — Every compatibility path in application/UI code names a cutover task.

## Infrastructure Exclusions

The following files perform durable IO but are excluded from the concept inventory
because they are infrastructure, not domain-boundary readers or writers
(13 files, maintained in the `infrastructureExclusions` set in
`test/persistence-inventory-guardrail.test.ts`):

- `src/adapters/storage/storage.ts` — defines the persistence API itself
- `src/adapters/architecture/boundary-guards.ts` — internal guard helper
- `src/adapters/filesystem/package-root.ts` — reads `package.json` for name resolution
- `src/adapters/sqlite/database-adapter.ts` — SQLite infrastructure
- `src/adapters/agents/codex.ts`, `vibe.ts` — write agent runtime config
- `src/adapters/agents/opencode-export.ts` — writes temporary scratch files
- `src/adapters/filesystem/mission-paths.ts`, `src/adapters/git/worktree.ts` — read mission files for path resolution
- `src/adapters/verification/verification.ts` — reads/writes verification proofs (infrastructure metadata)
- `src/adapters/verification/redgreen.ts` — reads mission docs for reproduction-test markers
- `test/fixtures/durable-state-inventory.ts` — certification-only inventory data

## Cross-reference: MACHINE_WRITTEN_PATH_INVENTORY

The same file also contains `MACHINE_WRITTEN_PATH_INVENTORY` (TASK-2222 bounded
migration plan) with a different taxonomy. Both inventories describe overlapping
boundaries. The ADR 0053 inventory is the authoritative source for the six-class
ADR 0053 classification; the MACHINE_WRITTEN_PATH_INVENTORY remains the TASK-2222
migration plan. See the inline comment in `durable-state-inventory.ts` for the
cross-reference mapping.
