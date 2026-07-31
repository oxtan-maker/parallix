---
id: TASK-2330
title: Harden e2e test coverage for SQLite persistence paths
status: backlog
assignee: []
created_date: '2026-07-31 07:00'
updated_date: '2026-07-31 07:00'
labels:
  - ai_sdlc
dependencies: []
references:
  - missions/task-2322.11/ (discovery mission — "database is locked" REVIEWER_LAUNCH_FAILURE)
  - src/adapters/sqlite/adapter-factory.ts (initOperatorState singleton cache fix)
  - src/platform/runtime/lib/review/review-loop.ts (review loop agent launch)
  - src/platform/runtime/lib/agents/agents.ts (defaultSessionMarkerPort, updateAgentBlockChecked)
  - test/e2e-mission-lifecycle.test.ts (Tier 1 lifecycle — stub agents, provider=none)
  - test/e2e-real-agent-smoke.test.ts (Tier 2 smoke — real agent, provider=none)
  - config/integration-pipelines.json (integration gate definition)
parent_task_id: null
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The e2e integration gates (`e2e-mission-lifecycle`, `e2e-real-agent-smoke`) did not detect the `"database is locked"` SQLite contention bug discovered in TASK-2322.11. The root cause: both tests configure `review.provider: 'none'`, which causes the review loop to resolve the reviewer as `'autonomous'` and **skip the agent launch entirely** when no different-family agent is available. The session marker SQLite persistence path — where the contention occurs — was therefore never exercised.

The immediate fix (singleton cache in `initOperatorState`) resolved the runtime contention, but the **defense gap remains**: the e2e suite does not verify that the SQLite persistence path works correctly under realistic review-loop conditions (real agent reviewer, concurrent `initOperatorState` callers).

This task investigates and documents the full set of persistence paths the e2e suite should cover, identifies which are currently missing, and proposes concrete test additions or configuration changes to close the gaps.
<!-- SECTION:DESCRIPTION:END -->

## Investigation Scope

### 1. Map all SQLite persistence paths in the workflow

Identify every code path that writes to the operator SQLite database during a mission lifecycle:

| Path | Trigger | Called from | Cached? |
|------|---------|-------------|---------|
| Session marker save | Agent launch (slug + role) | `startAgent` → `defaultSessionMarkerPort` → `initOperatorState` | Yes (TASK-2322.11 fix) |
| Session marker find/resume | Agent launch (slug + role) | `startAgent` → `defaultSessionMarkerPort` → `initOperatorState` | Yes |
| Agent blocklist write | Limit hit / launch failure | `startAgent` → `updateAgentBlockChecked` → `initOperatorState` | Yes |
| Agent blocklist read (materialized) | Composition root startup | `materializeOperatorState` → `initOperatorState` | Yes |
| Agent blocklist read (live) | Blocklist overlay refresh | `SqliteBlocklistRepository.findAll` | N/A (uses shared db) |
| Mission store (intake/lifecycle/integration) | draft/active/integrate | `createMissionApplicationServices` → `initOperatorState` | Yes |
| Known repositories | TUI / status / web-board | `createProductionApplicationServices` → `materializeOperatorState` | Yes |
| UI preferences | TUI / status | `createProductionApplicationServices` → `materializeOperatorState` | Yes |
| Operational history | TUI / status | `createProductionApplicationServices` → `materializeOperatorState` | Yes |
| Board lane events | TUI board | `createProductionApplicationServices` → `materializeOperatorState` | Yes |
| Usage statistics | Stats command | `createProductionApplicationServices` → `materializeOperatorState` | Yes |

### 2. Map which paths the current e2e tests exercise

| Path | `e2e-mission-lifecycle` (stub) | `e2e-real-agent-smoke` (real) |
|------|-------------------------------|-------------------------------|
| Session marker (review loop) | **NO** — reviewer=autonomous, launch skipped | **NO** — reviewer=autonomous or single-family, launch skipped |
| Session marker (active command) | Yes — `active` command launches implementer | Yes — `active` command launches implementer |
| Agent blocklist write | **Unknown** — depends on limit-hit behavior of stub | **Unknown** — depends on limit-hit behavior of real agent |
| Agent blocklist read | Yes — composition root materializes snapshot | Yes — composition root materializes snapshot |
| Mission store (intake) | Yes — `draft` command | Yes — `draft` command |
| Mission store (lifecycle) | Yes — `active` command transitions | Yes — `active` command transitions |
| Mission store (integration) | Yes — `integrate` command | No — smoke test stops after `active` |
| Operator services (known repos, prefs, history) | **NO** — not wired in e2e composition | **NO** — not wired in e2e composition |

### 3. Identify the gaps

**Gap 1: Review loop session marker persistence** — Neither e2e test exercises the review loop's `startAgent` session marker path because `review.provider: 'none'` + single agent family → `reviewer = 'autonomous'` → launch skipped.

**Gap 2: Concurrent initOperatorState callers** — The "database is locked" bug manifests when multiple `initOperatorState()` callers run within the same process (e.g., review loop launching reviewer, then `updateAgentBlockChecked` during the same launch). The stub-based e2e test does not produce enough concurrent callers to trigger contention; the real-agent smoke test uses `provider: 'none'` which avoids the review loop path entirely.

**Gap 3: Agent blocklist persistence during launch failures** — Unclear whether either e2e test exercises the blocklist write path during a launch failure (limit hit or transient crash). The stub agents always exit cleanly.

### 4. Propose fixes

#### Option A: Add a dedicated `provider: 'none'` + multi-agent e2e scenario
Create a third e2e scenario (or extend the existing smoke test) that:
- Uses `review.provider: 'none'`
- Configures at least two agent families (e.g., `custom` as implementer, `codex` or `opencode` as reviewer)
- Runs the `px review` command (not just `px active`) to exercise the review loop's agent launch path
- Verifies session marker persistence in the database after the review completes

#### Option B: Add a unit/integration test for initOperatorState concurrency
Add a test that:
- Spawns multiple concurrent `initOperatorState()` calls (simulating review loop + blocklist update)
- Verifies they resolve to the same cached adapter (regression test for the singleton cache)
- Verifies that session marker save + blocklist write on the same connection do not produce "database is locked"

#### Option C: Add a review-loop-specific integration test
Add a test under `test/task-*.test.ts` that:
- Mocks `startAgent` to verify it receives `sessionMarkerPort` (or that `defaultSessionMarkerPort` returns the cached adapter)
- Exercises the review loop with a non-autonomous reviewer and `provider: 'none'`
- Verifies the session marker is persisted after the agent completes

### 5. Decision criteria

- **Option A** provides the broadest coverage (real agents, real CLI, real persistence) but requires a workstation with multiple agent launchers. Best as a Tier 2 gate (like `e2e-real-agent-smoke`).
- **Option B** is the fastest to implement and provides a direct regression test for the caching fix. Best as a unit/integration test.
- **Option C** provides targeted coverage of the review loop path without requiring real agents. Best as a fast integration test.

**Recommendation:** Implement Options B + C together. Option B catches the caching regression directly, and Option C catches review-loop-specific path gaps. Option A can be added later if a real-agent multi-family workstation becomes available for CI.

## Success Criteria

<!-- AC:BEGIN -->
- [ ] #1 All SQLite persistence paths are documented in a table (scope item 1 above)
- [ ] #2 Current e2e test coverage for each path is documented (scope item 2 above)
- [ ] #3 Gaps are identified and prioritized (scope item 3 above)
- [ ] #4 At least one concrete test is added that exercises the review loop session marker persistence path (Option B or C)
- [ ] #5 The integration gate configuration (`config/integration-pipelines.json`) is updated if a new test is added as a gate
- [ ] #6 Static analysis and test hygiene pass on all changed files
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: magnus
created: 2026-07-31 07:00
---
Discovered during TASK-2322.11 when the review loop failed with `REVIEWER_LAUNCH_FAILURE: Could not persist session marker for task-2322.11 (reviewer): database is locked`. The immediate fix (singleton cache in `initOperatorState`) resolved the runtime issue, but the fact that neither e2e gate caught it indicates a coverage gap worth investigating before the next SQLite-related change.
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
