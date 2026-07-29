---
id: TASK-2301
title: >-
  Evaluate library-backed SQLite migrations and revisit the node:sqlite driver
  mandate (ADR 0044)
status: backlog
assignee: []
created_date: '2026-07-23 12:46'
updated_date: '2026-07-29 03:52'
labels:
  - sqlite
  - persistence
  - migration
  - adr
  - tech-debt
dependencies: []
references:
  - docs/adr/0044-workflow-distribution-model.md
  - src/adapters/sqlite/migration-runner.ts
  - src/adapters/sqlite/database-adapter.ts
  - >-
    backlog/tasks/task-2295 -
    Re-home-bounded-SQLite-operator-state-onto-the-canonical-domain-model-supersedes-task-2280.md
priority: medium
ordinal: 53000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Context

TASK-2295 ships a hand-rolled forward-only SQLite migration runner (`src/adapters/sqlite/migration-runner.ts`, ~170 lines: ordered SQL files, `schema_migrations` ledger, SHA-256 checksums, transaction boundaries, pre-migration backup). During that mission the operator asked whether we should instead use a proven migration engine to reduce the risk of hand-rolled infrastructure bugs (agent hallucination surface).

Custom migration handling was kept for TASK-2295 because ADR 0044 mandates that **only** the adapter may import `node:sqlite` (Node's built-in `DatabaseSync`), and essentially no mature migration library targets `node:sqlite` — knex/drizzle/better-sqlite3-based tools bring their own SQLite driver, which the ADR forbids; `umzug` is driver-agnostic but only manages ordering/ledger and removes little of the hand-written apply/transaction/checksum surface. Swapping the driver or engine is an ADR-level decision that was explicitly out of TASK-2295's scope.

This task is to make that decision deliberately, at senior-review altitude, rather than by default.

## Investigate / decide
- Whether to amend ADR 0044's `node:sqlite`-only mandate to permit a vetted driver (e.g. `better-sqlite3`) paired with a maintained migration library (e.g. `umzug`, `knex`), OR keep `node:sqlite` + the hand-rolled runner.
- Trade-offs: dependency weight & supply-chain surface vs. bug/hallucination surface of custom infra; packaging/bundle implications (native `better-sqlite3` binaries vs. zero-dep `node:sqlite`); parity of features actually used (ordering, ledger, checksums, transactions, backup/restore).
- If keeping `node:sqlite`: confirm the existing test matrix (clean-install, previous-schema upgrade, checksum-mismatch, interrupted-migration, recovery) is the accepted mitigation and record that rationale in ADR 0044.

## Acceptance criteria
- A written decision recorded in ADR 0044 (amended in place per the ADR "current active decisions only" convention) selecting the migration/driver approach with explicit trade-off rationale.
- If a library/driver switch is chosen, a follow-up implementation task is filed that scopes replacing `database-adapter.ts` + `migration-runner.ts` and re-homing CP1/CP2 tests; if not, the hand-rolled runner is explicitly ratified.
- No code changes required by this task itself beyond the ADR (decision-only task).
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: codex
created: 2026-07-29 03:52
---
Superseded because ADR 0044 now decides distribution only. Persistence migration mechanics and their recovery test matrix are governed by ADR 0053 and TASK-2322.03; this task must not reopen driver policy in the distribution ADR.
---
<!-- COMMENTS:END -->
