---
id: TASK-2316
title: Cut over task catalog authority to SQLite and retire Markdown write paths
status: refined
assignee: [codex]
created_date: '2026-07-27 12:00'
labels:
  - sqlite
  - migration
  - backlog
  - adr
  - ai_sdlc
dependencies:
  - TASK-2284
  - TASK-2315
references:
  - docs/adr/0052-task-catalog-authority-and-board-authorship.md
  - docs/adr/0044-workflow-distribution-model.md
  - src/platform/runtime/lib/tools/backlog.ts
  - src/application/controller/board-command.ts
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Perform the single gated cutover decided by ADR 0052: SQLite becomes the sole
write authority for task records after draft/import materialization. All reads
and writes for the task catalog switch as one unit — no bidirectional
synchronization survives this mission, and the shadow-import path added by
TASK-2315 is deleted here.

The reconciliation machinery that exists only because files are the authority is
retired with it: the field-aware task merge and mission-rebase reconciliation in
`src/platform/runtime/lib/tools/backlog.ts`, and the duplicate-completed
integrity gate and pruner, whose job passes to a uniqueness constraint. This is
a removal of code, not an addition.

Cutover is blocked until all three ADR 0052 cutover gates pass: lossless import
verified by byte identity-backed evidence, demonstrated backup/restore, and
preserved draft-ingress coverage for task-file, directory, and free-text input.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All three ADR 0052 cutover gates pass on a populated repository and each has captured proof: lossless forward import verified by byte-identity-backed evidence, backup and restore, and preserved draft-ingress coverage for existing task-file, directory, and free-text input
- [ ] #2 Every task mutation goes through the supported post-materialization application command path, subject to the capability and stale-status rules; no command path issues SQL directly as a public contract and no command path writes a task file as authoritative state
- [ ] #3 Compatibility check: every documented `px` task command and its `--json` output produces the same observable result before and after cutover for an identical starting catalog, asserted by a test over the recorded outputs rather than by inspection
- [ ] #4 Existing task Markdown is no longer mutated as authoritative workflow state after cutover, and a test proves that editing a legacy task file no longer changes task state
- [ ] #5 The shadow-import path from TASK-2315 is deleted in the same change that performs the cutover, and no bidirectional synchronization between Markdown and SQLite remains anywhere in the tree
- [ ] #6 Task records remain readable offline with no network through `px` and the supported local SQLite-backed read path
- [ ] #7 The cutover does not remove the existing draft-ingress modes: repositories with task-file input still work, and synthetic directory/free-text draft input still materializes canonical records
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Run and capture the three cutover gates.
2. Switch reads and writes for the task catalog to SQLite in one change.
3. Route every mutation through the supported post-materialization command path.
4. Delete the shadow path and the file-authority reconciliation machinery.
5. Document the forward-only operating model and verify the legacy file path is no longer authoritative.
<!-- SECTION:PLAN:END -->

## Definition of Done

<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof
- [ ] #2 All three cutover gates have captured evidence, not asserted claims
- [ ] #3 The forward-only cutover model is explicit; downgrade/export are not hidden acceptance requirements
- [ ] #4 No dual-write or synchronization path remains after the change
<!-- DOD:END -->
