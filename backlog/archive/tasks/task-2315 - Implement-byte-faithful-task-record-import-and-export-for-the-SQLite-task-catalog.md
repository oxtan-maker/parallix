---
id: TASK-2315
title: Implement forward-only task record import into the SQLite task catalog
status: backlog
assignee: []
created_date: '2026-07-27 12:00'
updated_date: '2026-07-29 03:52'
labels:
  - sqlite
  - migration
  - backlog
  - adr
  - ai_sdlc
dependencies:
  - TASK-2284
references:
  - docs/adr/0052-task-catalog-authority-and-board-authorship.md
  - docs/adr/0044-workflow-distribution-model.md
  - test/helpers/task-2284-catalog-round-trip.ts
  - test/task-2284-catalog-round-trip.test.ts
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
ADR 0052 selects SQLite as the task-catalog write authority after a gated
cutover, with draft intake and legacy task material feeding a forward-only
import boundary. This mission builds that import path and validates it against
the real catalog without changing authority yet. Markdown remains authoritative
for the whole of this mission.

TASK-2284 measured that 240 of 240 well-formed stored records re-serialize byte
for byte, and that field-level comparison alone silently passed while dropping
YAML folded block scalars. The production import must therefore be gated on byte
identity of the imported source material, not on comparison of known fields. Two stored records are
corrupt at rest and must be repaired here, because they will otherwise fail the
cutover gate for the entire repository.

Shadow writes into SQLite are permitted during this mission under ADR 0052's
four compatibility-write conditions: Markdown wins unconditionally, every shadow
write emits a match/divergent/import-failed signal, the shadow path is deleted by
the cutover mission, and its lifetime is bounded to this mission plus TASK-2316.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An importer parses every record in `backlog/tasks/`, `backlog/completed/`, and `backlog/archive/tasks/` into typed SQLite-backed records, preserving unknown frontmatter keys, YAML folded block scalars, list spelling, the `SECTION:DESCRIPTION` body, and every `AC:` and `DOD:` item with its checked state and `#n` index
- [ ] #2 A verification test proves every well-formed stored task can be imported with no semantic loss, using byte-faithful source assertions rather than a known-field list
- [ ] #3 Compatibility check: a test asserts that after import, `getTaskStatus`, `getTaskAssignee`, `getTaskImplementer`, `getTaskLabels`, `getAcceptanceCriteria`, and `resolveTaskFile` in `src/platform/runtime/lib/tools/backlog.ts` still return identical results for the Markdown authority tree used as migration input
- [ ] #4 Intake check: tests cover import from all draft-ingress shapes ADR 0052 preserves for cutover readiness — existing task-file input, synthetic directory input, and synthetic free-text input
- [ ] #5 The two corrupt stored records pinned by TASK-2284 are repaired: `backlog/completed/task-1373 - TASK-1374-Mission-10-...-setup-review.md` (unresolved Git conflict markers inside its frontmatter) and `backlog/completed/task-1385 - Enforce-pre-review-...-auto-bounce-on-failure.md` (`updated_date` indented under `created_date`), and the known-corrupt pin in `test/task-2284-catalog-round-trip.test.ts` is removed in the same change
- [ ] #6 Every shadow write emits a `match`, `divergent`, or `import-failed` outcome carrying the task id and differing field names; a non-`match` outcome fails the gate rather than logging a warning
- [ ] #7 No read or write path switches authority in this mission: `transitionTask`, `transitionTaskOnIntegrationBranch`, and `completeTask` still read and write Markdown, and `backlog/config.yml` is unchanged
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Promote the TASK-2284 record model into a production import module.
2. Add the SQLite schema for task records behind the existing adapter boundary.
3. Add the byte-identity-backed import gate over all three stores.
4. Repair the two corrupt records and remove their pin.
5. Add shadow-write telemetry with the three named outcomes.
<!-- SECTION:PLAN:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: codex
created: 2026-07-29 03:52
---
Superseded by ADR 0053 and TASK-2322.01 through TASK-2322.12. The replacement wave imports checked Mission and operator-state concepts rather than a byte-faithful task catalog, never repairs source task files, and forbids shadow writes.
---
<!-- COMMENTS:END -->

## Definition of Done

<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof
- [ ] #2 Byte-identity-backed source preservation is the assertion of record, not known-field comparison
- [ ] #3 Markdown remains the authority on the final tree
- [ ] #4 No export or downgrade path is introduced as a hidden requirement of the import mission
<!-- DOD:END -->
