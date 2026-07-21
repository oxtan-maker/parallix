---
id: TASK-2280
title: Add bounded SQLite operator state and migrations
status: review
assignee: [custom]
created_date: '2026-07-19 00:00'
labels:
  - sqlite
  - persistence
  - migration
dependencies:
  - TASK-2279
references:
  - docs/adr/0044-workflow-distribution-model.md
  - lib/core/storage.ts
  - lib/core/durable-state-inventory.ts
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the ADR 0044 SQLite adapter for explicitly operator-local state under `<PARALLIX_HOME>/parallix.db`. Initial authority is limited to selected operator-local domains such as agent blocklists, usage statistics, known repositories, UI preferences, and local operational history. Git, task Markdown, mission/review documents, NEL records, and repository-local `.workflow/sessions/` markers remain repository authority.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 Only the SQLite adapter imports `node:sqlite`; application repository ports remain asynchronous
- [ ] #2 The database resolves beneath the existing platform-specific `PARALLIX_HOME`, never beneath a target repo, worktree, package, or executable directory
- [ ] #3 Ordered forward-only migrations have immutable IDs, checksums, transactions, a migration ledger, clean-install tests, and previous-schema upgrade tests
- [ ] #4 Connections enforce foreign keys, bounded busy timeout, WAL where supported, parameterized SQL, and explicit transactions for multi-statement changes
- [ ] #5 Importers for selected CSV/JSON sources are transactional, idempotent, digest-recorded, error-reporting, and leave originals untouched
- [ ] #6 Backup, interrupted migration, checksum mismatch, malformed import, concurrent access, and recovery tests pass
- [ ] #7 Secrets and raw agent credentials are absent from the schema and migration inputs
- [ ] #8 Tests prove repository state wins over any cached database projection
- [ ] #9 Bundle runtime, source tests, static analysis, and migration gates pass
- [ ] #10 Rollback disables the adapter and returns to untouched file readers
<!-- AC:END -->

## Implementation Plan

1. Select the first operator-local domains and record why each is eligible.
2. Add asynchronous ports and the isolated SQLite adapter.
3. Add schema, ledger, backup, import, and recovery behavior.
4. Prove bundle and multi-process behavior against temporary databases.

## Definition of Done

<!-- DOD:BEGIN -->
- [ ] #1 Migration evidence includes clean, upgrade, interruption, and rollback cases
- [ ] #2 Static analysis passes for all persistence code
- [ ] #3 Tests use temporary databases and no operator or repository data
- [ ] #4 No old file is deleted in the first import release
<!-- DOD:END -->
