---
id: TASK-2345
title: Reconcile launcher block seam with the SQLite blocklist
status: backlog
assignee: [custom]
created_date: '2026-08-08 00:00'
labels:
  - user_value
  - bug
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Blocks are written and read through two different stores, and only one of them
drives launcher selection.

- Write path: `updateAgentBlockChecked` (`src/adapters/agents/agents.ts:228`)
  persists a usage-limit block through `AgentBlockService` into the operator
  SQLite blocklist.
- Read path used by the launcher: `defaultIsAgentBlockedNow`
  (`src/adapters/agents/agents.ts:216`) reads `readAgentConfig(CONFIG_PATH, {})`
  — the `agents.local.json` blocklist file — and never consults SQLite.
- Read path used by the board: `ConcreteAgentReadAdapter.loadAgentAvailability`
  (`src/adapters/backlog/concrete-agent-read-adapter.ts:72`) queries the SQLite
  blocklist, which is what `task-2336` made visible in the `px` agent strip.

Consequence: after `task-2336`, the board can show a family as blocked with a
countdown and reason from SQLite while `defaultIsAgentBlockedNow` still reports
it as selectable, so the launcher may pick a family the board says is blocked
(or the reverse, when only the config file holds the block). The operator sees
one truth on the board and the harness acts on another.

This divergence was recorded as explicitly out of scope for `task-2336`, which
only fixed board visibility (`missions/task-2336/MISSION.md`, Out of Scope).

### Required fix

Decide on a single authority for "is this family blocked right now" and route
both the launcher seam and the board read path through it, keeping the
synchronous launcher call site workable (the SQLite read is async). Preserve the
existing operator-facing `agents.local.json` override semantics documented in
`docs/agents.md` (`## Local blocklist overrides`), whichever store becomes
authoritative.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A red-to-green test asserts that a block persisted via `updateAgentBlockChecked` makes the same family non-selectable through the launcher's block seam
- [ ] #2 A test asserts that a block declared only in `agents.local.json` and a block held only in the SQLite blocklist produce the same selectability answer
- [ ] #3 The board's `agentAvailability` rows and the launcher's block decision agree for the same family at the same instant, asserted in a test
- [ ] #4 `docs/agents.md` states which store is authoritative and how `agents.local.json` overrides interact with it
- [ ] #5 `./scripts/verify-local.sh all` passes on the final tree
<!-- AC:END -->

## Out of Scope

- The blocklist table schema and `SqliteBlocklistRepository`
- Limit detection and block TTL policy (`shouldPersistLaunchFailureBlock`, block rounding)
- The board agent strip rendering delivered by `task-2336`
- Adding a CLI command for listing or clearing blocks

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
