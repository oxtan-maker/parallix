---
id: TASK-2331
title: Audit and harden SQLite connection strategy
status: done
assignee: []
created_date: '2026-07-31 07:30'
updated_date: '2026-08-04 15:25'
labels:
  - ai_sdlc
dependencies: []
references:
  - src/adapters/sqlite/adapter-factory.ts (initOperatorState singleton cache)
  - >-
    src/adapters/sqlite/database-adapter.ts (SqliteDatabaseAdapter, busy timeout
    clamp)
  - >-
    src/platform/runtime/lib/composition/application-services.ts
    (materializeOperatorState, createMissionApplicationServices)
  - >-
    src/platform/runtime/lib/agents/agents.ts (defaultSessionMarkerPort,
    startAgent retry)
  - src/platform/runtime/lib/agents/pi.ts (SDK session spawning)
  - >-
    backlog/tasks/task-2330 -
    Harden-e2e-test-coverage-for-SQLite-persistence-paths.md (coverage gap)
priority: medium
ordinal: 72900
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The `"database is locked"` regression (TASK-2322.11) was patched with two tactical fixes:
1. **Singleton cache** in `initOperatorState()` so in-process callers share one `DatabaseSync` handle
2. **Retry with backoff** on `sessionMarkerPort.save()` in `startAgent` (3 attempts, 100–300 ms)

These unblock the mission but are bandaids on a deeper architectural problem: the repo has no cohesive strategy for SQLite connection lifecycle, cross-process contention, or fail-closed behavior.

This task audits every SQLite connection path, documents the current tactics, and proposes a unified connection strategy that eliminates ad-hoc retries and contention.
<!-- SECTION:DESCRIPTION:END -->

## Investigation Scope

### 1. Current connection topology

Every code path that opens a `DatabaseSync` connection to `parallix.db`:

| Caller | How opened | Cached? | Lifetime | Busy timeout |
|--------|-----------|---------|----------|-------------|
| `materializeOperatorState()` | `initOperatorState()` | Yes (singleton) | Process-wide | 5000 ms |
| `createMissionApplicationServices()` | `initOperatorState()` | Yes (singleton) | Process-wide | 5000 ms |
| `defaultSessionMarkerPort()` | `initOperatorState()` | Yes (singleton) | Process-wide | 5000 ms |
| `updateAgentBlockChecked()` | `initOperatorState()` | Yes (singleton) | Process-wide | 5000 ms |
| `SqliteBlocklistRepository.findAll()` | Composition root `db` | N/A (uses shared) | N/A | N/A |
| Child `pi` agent (SDK-spawned) | Unknown — SDK SessionManager | Unknown | Child process | Unknown |
| `px` CLI entry point | No direct access | N/A | N/A | N/A |
| TUI / web-board | `createProductionApplicationServices` | Yes (singleton) | Process-wide | 5000 ms |
| E2e test fixtures | `initOperatorState()` or direct | Varies | Test-scoped | Varies |

### 2. Known problems

**P1: Cross-process contention is handled by retry, not design**
The retry in `startAgent.save()` masks the real issue: the child `pi` agent process (spawned by the SDK) may access the same `parallix.db` file. When the parent calls `save()` immediately after the child exits, the child's SQLite file handle may not yet be released by the OS. This is a timing race, not a correctness bug, but retrying is the wrong layer to handle it.

**P2: Busy timeout is clamped to 5 s regardless of caller**
`SqliteDatabaseAdapter.open()` clamps `busyTimeoutMs` to `Math.min(5000, ...)`. This was intentional (ADR 0053: "local command failure remains bounded") but means long-running operations (migration, import gate) get the same timeout as quick reads. A caller that needs a higher timeout (e.g. import gate on a large legacy dataset) cannot request one.

**P3: No explicit connection close in long-lived processes**
The singleton cache comment says "Callers must not close the returned adapter; the connection lives for the duration of the process." For CLI commands this is fine (process exits → OS closes handles). For the TUI or a future daemon this means the connection is never closed, and there is no graceful shutdown path.

**P4: Child process database access is unobserved**
The SDK (`@earendil-works/pi-coding-agent`) spawns a child `pi` process. It is unknown whether this child accesses `parallix.db` (for session storage, usage tracking, or workspace metadata). If it does, the parent and child are two independent `DatabaseSync` handles on the same file, and WAL mode alone does not prevent write-write contention.

**P5: Test fixtures create direct connections that bypass the cache**
Some test fixtures create `new SqliteDatabaseAdapter()` directly (bypassing `initOperatorState`) and manage their own connection lifecycle. This is fine for isolation but means tests do not exercise the singleton cache path, reducing confidence in the caching behavior.

### 3. Proposed strategy

#### A. Connection ownership model
Define a clear ownership model:

- **Process-scoped singleton**: One `DatabaseSync` per process per `parallix.db` path. All callers use `initOperatorState()`.
- **Child processes**: Child `pi` agents should NOT access `parallix.db` directly. If they need persistence, use a separate child-specific database (e.g. `$PARALLIX_HOME/.parallix/sessions/<child-pid>.db`) or in-memory storage.
- **Explicit close**: Long-lived processes (TUI, future daemon) must call a shutdown hook that closes the singleton connection. CLI commands rely on OS cleanup.

#### B. Busy timeout tiers
Replace the single 5 s clamp with caller-configurable tiers:

| Tier | Timeout | Use case |
|------|---------|----------|
| Fast | 1000 ms | Reads, session marker find/save |
| Default | 5000 ms | General writes (blocklist, mission store) |
| Long | 15000 ms | Migration, import gate, stats backfill |

Callers specify tier via `initOperatorState({ busyTimeoutMs: 15000 })`. The clamp is removed or raised to 30 s.

#### C. Cross-process contention: eliminate, don't retry
If the child `pi` agent accesses `parallix.db`, the contention is architectural, not transient. Options:

1. **Child uses separate database**: SDK configures child to use a PID-scoped database file.
2. **Parent defers save**: `startAgent` defers `save()` until after the child process is confirmed closed (e.g. via a small `setTimeout` or file-handle check).
3. **WAL + higher timeout**: Increase busy timeout to 30 s and rely on WAL mode. Accept the latency cost.

#### D. Test coverage
- Unit test: concurrent `initOperatorState()` callers return same cached connection (exists)
- Unit test: cache eviction on failure (exists)
- Integration test: parent `save()` immediately after child process exit (missing — TASK-2330)
- E2e test: review loop with real agent exercises session marker persistence (missing — TASK-2330)

### 4. Out of scope
- Database schema design (migrations, table structure)
- Query performance (indexes, N+1)
- Backup / recovery strategy
- Multi-user / multi-machine scenarios

## Success Criteria

<!-- AC:BEGIN -->
- [ ] #1 All SQLite connection paths are documented in a single architecture decision (e.g. ADR 0054)
- [ ] #2 Child `pi` agent's database access behavior is identified (does it use parallix.db?)
- [ ] #3 Connection ownership model is defined: singleton per process, explicit close for long-lived processes
- [ ] #4 Busy timeout strategy is defined (tiers or single configurable value) and documented
- [ ] #5 Cross-process contention strategy is decided (separate child db, defer save, or higher timeout)
- [ ] #6 Ad-hoc retry in `startAgent.save()` is either justified by the ADR or replaced by the architectural fix
- [ ] #7 Test coverage gaps (TASK-2330) are tracked as dependencies or sub-tasks
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: magnus
created: 2026-07-31 07:30
---
Discovered during TASK-2322.11. The singleton cache and retry fix unblocked the mission but are tactical patches. The repo needs a coherent SQLite connection strategy before the next SQLite-related change (e.g. TUI persistence, usage statistics, or multi-agent workflows).
---
<!-- COMMENTS:END -->

## Definition of Done

<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
