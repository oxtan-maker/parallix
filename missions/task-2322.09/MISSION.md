# Mission: Cut over SessionMarker persistence and retire worktree session files (task-2322.09)

## Goal

Make the SQLite-backed `SessionMarkerRepository` the sole live authority for resumable agent-session markers. Move all create, lookup, resume, replace, and clear operations behind a checked application port, provide a dry-run and atomic idempotent import from legacy `.workflow/sessions/` files, and remove routine reads and writes under `.workflow/sessions` from every production path. Session identity must survive worktree cleanup and must not be confused with an inferred Attempt aggregate.

## Why Now

ADR 0053 classifies `SessionMarker` as `database-owned-domain-state` and mandates cutover. TASK-2322.02 established the checked domain model, consumer-requirements mapping, and persistence-domain map that name `SessionMarker` as one of nine domain concepts. The current file-backed markers in `.workflow/sessions/<slug>-<role>.json` are a compatibility path (`session-read-sessions` / `session-write-sessions` in `ADR0053_PERSISTENCE_INVENTORY`) with `cutoverTask: 'TASK-2322.03'` — but the consumer evidence shows these are the only durable per-launch values and must not depend on worktree presence. Launching agents from `src/platform/runtime/lib/agents/agents.ts:302`, `agents.ts:502`, and five launcher files (`claude.ts`, `pi.ts`, `codex.ts`, `opencode.ts`) directly import `sessions.ts`, creating a runtime-only boundary with no checked repository contract.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: New `SessionMarkerRepository` interface + SQLite adapter + migrations (`0004-session-markers.sql` and additive repository-scope upgrade `0005-repository-scoped-session-markers.sql`); application port wiring; migrate 5+ launcher callers; idempotent import with conflict detection; comprehensive test suite covering resume, failover, duplicate, stale, restart, and database-unavailable scenarios

## Scope

- Define `SessionMarkerRepository` interface in `src/adapters/sqlite/ports.ts` with methods: `findByMissionAndRole`, `save` (upsert by missionId+role), `deleteByMissionAndRole`, `findAll`, `clear`.
- Implement `SqliteSessionMarkerRepository` class in `src/adapters/sqlite/session-marker-repository.ts` following the pattern of `SqliteBlocklistRepository`.
- Keep migration `src/adapters/sqlite/migrations/0004-session-markers.sql` immutable and add `0005-repository-scoped-session-markers.sql` to produce columns `repository_id`, `mission_id`, `role`, `agent`, `last_launched`, `session_id`, `updated_at`; unique constraint on `(repository_id, mission_id, role)`.
- Wire a `SessionMarkerPort` application port in `src/application/ports.ts` (or `src/application/domain-ports.ts`) that exposes `find`, `save`, `delete`, `shouldResume` to callers.
- Migrate all callers in `src/platform/runtime/lib/agents/` (`agents.ts`, `claude.ts`, `pi.ts`, `codex.ts`, `opencode.ts`) from direct `sessions.ts` imports to the checked application port.
- Implement dry-run and atomic idempotent import from `.workflow/sessions/` files that: reports conflicts (database has newer marker for same mission+role) without overwriting either side, and leaves source files untouched.
- Update `ADR0053_PERSISTENCE_INVENTORY` entries `session-read-sessions` and `session-write-sessions` to reflect the cutover (pathType or cutoverTask update).
- Add fast unit tests with mocked provider dependencies and isolated database fixtures covering: resume, failover, duplicate marker, stale update, restart, and database-unavailable behavior (AC #6).
- Verify `test/domain-attempt-guard.test.ts` still passes — no Attempt table or adapter record is introduced.

## Out of Scope

- Attempt domain entity, table, or adapter record (ADR 0053 explicitly excludes Attempt; see `test/domain-attempt-guard.test.ts`).
- Provider session availability checks or live-provider resume negotiation (SessionMarker records the last marker; the provider decides if the session can resume).
- `.workflow/sessions/` directory deletion or cleanup commands (source files remain untouched after import; removal is a later housekeeping task).
- Cross-operator or multi-user session synchronization.
- SessionMarker migration for AgentRunMeasurement or AgentBlock (those are TASK-2322.03).

## Success Criteria

- SC1: A `SessionMarkerRepository` interface exists in `src/adapters/sqlite/ports.ts` with exactly five methods: `findByMissionAndRole`, `save`, `deleteByMissionAndRole`, `findAll`, `clear`.
- SC2: `SqliteSessionMarkerRepository` in `src/adapters/sqlite/session-marker-repository.ts` implements the full interface using parameterized SQL with `ON CONFLICT(repository_id, mission_id, role) DO UPDATE` for upsert.
- SC3: Immutable migration `0004-session-markers.sql` creates the initial table and additive migration `0005-repository-scoped-session-markers.sql` upgrades it to a strict table with columns `repository_id TEXT NOT NULL`, `mission_id TEXT NOT NULL`, `role TEXT NOT NULL CHECK(role IN ('execute','draft','review'))`, `agent TEXT NOT NULL`, `last_launched TEXT NOT NULL`, `session_id TEXT`, `updated_at TEXT NOT NULL`, and `UNIQUE(repository_id, mission_id, role)`.
- SC4: All five launcher files (`agents.ts`, `claude.ts`, `pi.ts`, `codex.ts`, `opencode.ts`) import session behavior through the checked application port — zero direct imports of `../tools/sessions.js` remain in production agent-launch paths.
- SC5: The import function supports `--dry-run` mode (returns conflict report without writing) and atomic commit (all-or-nothing transaction); on conflict it reports both sides and overwrites neither; source `.workflow/sessions/` files are never deleted.
- SC6: After cutover, no production code path probes, reads, writes, deletes, or falls back to `.workflow/sessions/`; a database failure produces an explicit operation failure (not a silent file fallback).
- SC7: `SessionMarker` identity fields (`missionId`, `role`, `agent`, `lastLaunched`, `sessionId`) and the `shouldResume` invariant (mission + role + agent must all match) round-trip through the SQLite adapter without data loss.
- SC8: Worktree cleanup or movement does not erase or change the authoritative session marker; explicit `clear` behavior is observable and tested.
- SC9: Fast unit tests with mocked dependencies cover: resume (same family matches, different family rejects), failover (marker replaced on new launch), duplicate marker (upsert replaces), stale update (concurrent write handling), restart (marker survives process exit), and database-unavailable (explicit error, no file fallback).
- SC10: `test/domain-attempt-guard.test.ts` passes — no Attempt-shaped type, table, or record is introduced by this mission.

## Risks and Assumptions

- **Risk:** Multiple agent launchers (`agents.ts`, `claude.ts`, `pi.ts`, `codex.ts`, `opencode.ts`) each cast `sessions` through `(sessionsModule as any)` — the migration must preserve exact method signatures or all cast sites break at once. Mitigation: keep the old `sessions.ts` exports as thin shims during CP 3 migration, remove them only after all callers are updated in CP 4.
- **Risk:** The `role` field in existing `.workflow/sessions/` files uses the file-suffix convention (`<slug>-<role>.json`) which may include non-standard role names. Mitigation: the import maps known roles (`execute`, `draft`, `review`) and reports unknown roles as conflicts without importing them.
- **Assumption:** TASK-2322.02 completed the domain model (`src/domain/session.ts`), the persistence-domain map, and the consumer-requirements mapping that this mission depends on.
- **Assumption:** SQLite `node:sqlite` is available and the database adapter (`SqliteDatabaseAdapter`) is already wired for other repositories (confirmed by `blocklist-repository.ts`, `usage-repository.ts`, etc.).
- **Assumption:** The `SessionMarker` domain type in `src/domain/session.ts` is stable and its `shouldResume` function is the canonical invariant.

## Checkpoints

- CP 1: Define `SessionMarkerRepository` interface in `src/adapters/sqlite/ports.ts` and implement `SqliteSessionMarkerRepository` in `src/adapters/sqlite/session-marker-repository.ts`. Add migration `0004-session-markers.sql`. Verify migration applies cleanly against the existing schema.
- CP 2: Wire `SessionMarkerPort` application port and connect it to `SqliteSessionMarkerRepository` through the adapter factory. Verify `findByMissionAndRole`, `save` (upsert), `deleteByMissionAndRole`, `findAll`, and `clear` all round-trip with domain `SessionMarker` types.
- CP 3: Implement dry-run and atomic idempotent import from `.workflow/sessions/` files. Verify conflict detection reports both sides without overwriting, dry-run produces a report without writes, and atomic commit is all-or-nothing.
- CP 4: Migrate all callers in `src/platform/runtime/lib/agents/` (`agents.ts`, `claude.ts`, `pi.ts`, `codex.ts`, `opencode.ts`) from `sessions.ts` to the application port. Remove direct `sessions.ts` imports from production launch paths. Update `ADR0053_PERSISTENCE_INVENTORY` entries.
- CP 5: Write fast unit tests covering resume, failover, duplicate marker, stale update, restart, and database-unavailable scenarios. Verify `test/domain-attempt-guard.test.ts` still passes. Run `./scripts/verify-local.sh static-analysis`.

### Checkpoint Documentation Requirements

Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `src/adapters/sqlite/session-marker-repository.ts:42` (must point to an existing file and line)
  2. **Test names** — e.g., `"resume returns true only when mission, role, and agent family all match"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/session-marker-repository.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0053` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `./scripts/verify-local.sh static-analysis` ``, `` `node --test test/session-marker-repository.test.ts` ``, or `` `git diff --stat` ``
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| SessionMarkerRepository interface defined with 5 methods | `src/adapters/sqlite/ports.ts:180-200` | PASS |
| SqliteSessionMarkerRepository implements upsert with ON CONFLICT | `src/adapters/sqlite/session-marker-repository.ts:45` | PASS |
| Migration 0004 creates session_markers table | `src/adapters/sqlite/migrations/0004-session-markers.sql`, `node --test test/session-marker-repository.test.ts` | PASS |
| Verification gate ran | `./scripts/verify-local.sh static-analysis` | PASS |

## Gates

- [ ] `./scripts/verify-local.sh static-analysis`
- [ ] `./scripts/verify-local.sh all`

## Restricted Areas

- `src/domain/session.ts` — the domain type and `shouldResume` function are stable; this mission consumes them but does not modify their contract.
- `src/domain/mission.ts` — Mission identity is authoritative but this mission does not change its lifecycle.
- `src/domain/agents.ts` — AgentBlock domain is out of scope (its own cutover task).
- `src/platform/runtime/lib/agents/agent-config.ts` — blocklist writes are out of scope.
- `test/domain-attempt-guard.test.ts` — must not be modified; it asserts no Attempt entity exists. If this mission inadvertently introduces one, the test fails and the mission must correct.
- `src/adapters/sqlite/migration-runner.ts` — migration orchestration is existing; this mission adds one new migration file but does not change the runner.
- `src/application/consumer-domain-requirements.ts` — consumer mapping is stable; this mission does not add or remove traced consumers.

## Stop Rules

- Stop if `test/domain-attempt-guard.test.ts` fails after any change — do not modify the guard test to accommodate the mission; correct the mission code instead.
- Stop if the migration `0004-session-markers.sql` cannot apply cleanly on top of the existing three migrations (`0001` through `0003`) — resolve schema conflicts before proceeding.
- Stop if a caller migration in CP 4 reveals a `sessions.ts` usage outside the five launcher files (e.g., a command or TUI path) — scope that caller into the mission or record it as a follow-up task with an explicit `cutoverTask` in the inventory.
- Stop if the import conflict detection cannot determine "newer" between a database marker and a worktree file without arbitrary heuristics — defer conflict resolution to a later task and implement strict "no-overwrite" for the first pass.
- Stop if static analysis (`./scripts/verify-local.sh static-analysis`) fails on any changed file under `lib/` — resolve before proceeding to the next checkpoint.
