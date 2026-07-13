---
id: TASK-2222
title: Standardize durable state persistence across the repository
status: review
assignee:
  - codex
created_date: '2026-07-11 00:00'
updated_date: '2026-07-13 16:26'
labels:
  - refactor
  - reliability
  - persistence
  - maintainability
dependencies:
  - TASK-2220
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Parallix has an atomic persistence primitive in `lib/core/storage.ts`, but durable workflow state is still written through a mixture of direct `writeFileSync`, ad hoc temp-file handling, and subsystem-specific conventions. This makes crash behavior, error propagation, permissions, and testing inconsistent.

After TASK-2220 establishes the fail-closed review-state contract, inventory the remaining write paths and standardize durable machine-readable state on one explicit persistence contract. Distinguish durable state from generated, cached, temporary, and user-authored files before migrating anything; this mission must not mechanically route every write through the same API.

Target change size: 250-500 total added plus deleted lines where feasible. Prefer a bounded first tranche of high-value durable JSON state over a repository-wide mechanical rewrite that exceeds the mission budget.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Add a code-adjacent inventory or test fixture classifying machine-written files as durable state, user-authored content, generated output, cache/scratch data, or secrets/configuration
- [ ] #2 Define one shared durable-write contract covering atomic replacement, parent creation, encoding, final newline, filesystem error propagation, and cleanup of temporary files
- [ ] #3 Preserve existing file permissions and strengthen them where the file may contain credentials or operator-local sensitive data; do not weaken token-file mode guarantees
- [ ] #4 Migrate a bounded high-value tranche of remaining durable JSON writers, including session metadata and NEL records if the inventory confirms they are durable, while leaving generated mutation configuration and other scratch artifacts out of scope
- [ ] #5 Ensure callers can observe write failures and do not log success or advance durable workflow state after a failed write
- [ ] #6 Add focused fault-injection tests for write failure, rename failure, stale temporary-file cleanup, successful replacement, and preservation of the prior valid file when replacement fails
- [ ] #7 Add a guard test or lintable policy that prevents new direct durable JSON state writes outside the approved storage module or an explicitly documented exception
- [ ] #8 Preserve on-disk schemas and backwards compatibility; this mission changes write mechanics, not file formats or locations
- [ ] #9 Keep the final diff within 250-500 added plus deleted lines where feasible; if the inventory proves the safe tranche cannot fit, narrow migrations and leave explicit follow-up tasks
- [ ] #10 Run `./scripts/verify-local.sh static-analysis`, focused storage/session/handoff tests, and the default verification suite successfully
<!-- AC:END -->

## Out of Scope

- Review-state behavior already owned by TASK-2220
- Changing persistent file schemas or locations
- Adding a database, journaling service, or cross-process locking
- Migrating user-authored Markdown or generated scratch configuration
- Broad asynchronous filesystem conversion

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
