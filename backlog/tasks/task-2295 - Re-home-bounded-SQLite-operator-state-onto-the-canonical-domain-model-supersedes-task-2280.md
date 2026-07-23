---
id: TASK-2295
title: >-
  Re-home bounded SQLite operator state onto the canonical domain model
  (supersedes task-2280)
status: active
assignee: [claude]
created_date: '2026-07-22 04:50'
labels:
  - sqlite
  - persistence
  - migration
  - domain-model
dependencies:
  - TASK-2294
references:
  - docs/adr/0044-workflow-distribution-model.md
  - docs/adr/0051-ui-neutral-application-boundary.md
  - >-
    backlog/tasks/task-2280 -
    Add-bounded-SQLite-operator-state-and-migrations.md
  - >-
    backlog/tasks/task-2294 -
    Establish-canonical-Parallix-domain-model-and-settle-the-persistence-sync-async-seam.md
  - src/platform/runtime/lib/core/storage.ts
  - src/platform/runtime/lib/agents/agent-config.ts
priority: high
ordinal: 49000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the ADR 0044 bounded SQLite adapter for operator-local state, this time conforming to the canonical domain model, entity-level authority map, and materialized-snapshot sync/async seam established by TASK-2294. This is the re-homed replacement for the dead-ended TASK-2280.

WHAT TASK-2280 TAUGHT US (this mission must not repeat it): TASK-2280 scoped a bounded adapter but reached MAX_ATTEMPTS after 5 review rounds because it grew to ~4,525 insertions across 48 files. Root cause: the ADR 0044 async-port contract was wired into `readAgentConfig()` with no modeled seam, so `await` cascaded through the synchronous agent-eligibility/selection/review consumers. The fix is architectural, not effort: consumers read operator-local state from an in-memory snapshot materialized at the composition root (per TASK-2294), so introducing an async SQLite port at the boundary does NOT force async through the hot consumer algorithms. Any diff that re-introduces a broad async cascade across command/agent/review modules is off-plan and must be re-scoped.

The unmerged `mission/task-2280` branch is a reference spike (existing adapter-factory, database-adapter, migration-runner, importer, ports, blocklist/usage repositories, migrations `0001-initial-schema.sql` / `0002-import-history.sql`, and ~2,000 lines of SQLite tests). Salvage what conforms to the TASK-2294 model; do not import its async-cascade coupling. The operator will keep that worktree live until this mission and TASK-2294 land, then remove it as a failed path — do not depend on it remaining after that.

Authority stays bounded per ADR 0044/0051: SQLite is authoritative only for explicitly operator-local domains (agent blocklists, usage statistics, known repositories, UI preferences, local operational history, migration metadata) under `<PARALLIX_HOME>/parallix.db`. Git, task Markdown, mission/review/NEL documents, and repository-local `.workflow/sessions/` markers remain repository authority; if SQLite conflicts with repository state, repository state wins. No dual-write. Secrets and raw agent credentials are never stored.

Depends on TASK-2294 for the domain types, authority map, and the composition-root snapshot pattern the ports and consumers must use.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Operator-local domains persisted in SQLite (blocklist, usage statistics, known repositories, UI preferences, local operational history, migration metadata) map onto the TASK-2294 domain entities and entity-level authority map, with each stored field owned by exactly one authority
- [ ] #2 Only the SQLite adapter imports `node:sqlite`; application repository ports remain asynchronous and live behind the TASK-2294 model boundary
- [ ] #3 Consumers (agent eligibility/selection and other hot paths) read operator-local state from the composition-root materialized snapshot established by TASK-2294; a test proves adding the async SQLite port introduces no async cascade into those consumers, and the total diff does not broadly convert command/agent/review modules to async
- [ ] #4 The database resolves beneath the existing platform-specific PARALLIX_HOME and never beneath a target repo, worktree, package, or executable directory
- [ ] #5 Ordered forward-only migrations have immutable IDs, checksums, transaction boundaries, a migration ledger, clean-install tests, and previous-schema upgrade tests
- [ ] #6 Connections enforce foreign keys, a bounded busy timeout, WAL where supported, parameterized SQL, and explicit transactions for multi-statement changes
- [ ] #7 Importers for the selected CSV/JSON sources (e.g. stats.csv, agents.local.json) are transactional, idempotent, digest-recorded, error-reporting, and leave originals untouched; no old file is deleted in the first import release
- [ ] #8 Backup, interrupted-migration, checksum-mismatch, malformed-import, concurrent-access, and recovery tests pass
- [ ] #9 Secrets and raw agent credentials are absent from the schema and migration inputs
- [ ] #10 Tests prove repository/Git state wins over any cached database projection, and rollback disables the adapter and returns to the untouched file readers
- [ ] #11 `./scripts/verify-local.sh all` passes plus the ADR 0044 bundle-runtime and migration gates, and `./scripts/verify-local.sh static-analysis` passes for the persistence code
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
