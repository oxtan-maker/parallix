---
id: TASK-1275
title: >-
  Guard transitionTask/commitTaskFileUpdate against slug/task-id mismatch to
  prevent stray commits
status: done
assignee: [qwen]
created_date: '2026-06-10 05:14'
updated_date: '2026-06-13 18:13'
labels:
  - ai_sdlc
dependencies:
  - TASK-1265
priority: low
ordinal: 12000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

`transitionTask()` resolves a task file via `resolveTaskFile(slug, rootDir)`, whose base-ID hardening will map a suffixed slug to a different task's file (e.g. `task-1048-regress` -> the real `TASK-1048`). When a caller (notably a test invoking the real `transitionTask` against `process.cwd()`) passes a slug that doesn't correspond to a real task, `transitionTask` can silently flip the status of an unrelated real task and create a `backlog(<wrong-slug>): transition to ...` commit on the checked-out branch.

This was the mechanism behind TASK-1265 (test-isolation leak in `parallix/test/task-1048-regression.test.js` polluting `mission/task-1264`). TASK-1265 fixes the test; this follow-up adds a defensive guard so a future mistyped slug cannot silently commit.

## Desired behavior

`transitionTask()` / `commitTaskFileUpdate()` should refuse to write/commit when the requested `slug` does not match the resolved task file's actual `id` frontmatter (modulo the intended exact-match / canonical-id rules). Mismatch should be a no-op with a warning, never a commit.

## Acceptance criteria seeds
- `transitionTask('task-1048-regress', ...)` resolving to a file whose `id` is `TASK-1048` does NOT commit; it warns and returns false (or no-op).
- Legitimate transitions (slug matches the resolved task's id, including intended canonical-id mappings) are unaffected.
- Add a unit test in `parallix/test/backlog.test.js` covering the mismatch no-op.
- `./scripts/verify-local.sh workflow` passes.

## Pointers
- `parallix/lib/backlog.js`: `resolveTaskFile` (base-ID hardening), `transitionTask`, `commitTaskFileUpdate`.
- Follow-up to TASK-1265 (test-isolation leak).
<!-- SECTION:DESCRIPTION:END -->
