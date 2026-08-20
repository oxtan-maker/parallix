---
id: TASK-2383
title: Review sandbox denies every agent its state home
status: active
assignee: [custom]
created_date: '2026-08-20 19:10'
labels:
  - bug
  - ai_sdlc
dependencies: []
references:
  - src/adapters/process/bubblewrap.ts
  - src/adapters/agents/codex.ts
  - src/adapters/agents/qwen.ts
  - src/adapters/agents/vibe.ts
  - src/adapters/agents/claude.ts
  - test/bubblewrap-guard.test.ts
  - backlog/completed/task-2374 - bubblewrap-guard.md
priority: high
ordinal: 100917
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Under the task-2374 bubblewrap guard, no agent can be launched as a reviewer: the review profile binds the mission worktree read-only, but every agent CLI keeps its state directory inside that worktree.

`resolveSandboxProfile('review', ...)` in `src/adapters/process/bubblewrap.ts` returns `{ worktreeWritable: false, writable: [artifactDir], optionalWritable: ['/tmp'] }`. The agent homes it therefore denies:

- `src/adapters/agents/codex.ts:162` — `<worktree>/.workflow/codex-home` (`CODEX_HOME`)
- `src/adapters/agents/qwen.ts:32` — `<worktree>/.workflow/qwen-home` (`QWEN_HOME`)
- `src/adapters/agents/vibe.ts:32` — `<worktree>/.workflow/vibe-home` (`VIBE_HOME`)

Observed on mission task-2377.05, review round 2 (operator log, 2026-08-20T18:4xZ) — all three failed before reading the prompt:

- codex: `Error: failed to initialize in-process app-server client: Read-only file system (os error 30)`
- qwen: `Error: EROFS: read-only file system, chmod '/home/magnus/code/parallix-task-2377.05/.workflow/qwen-home/extension-store'`
- vibe: `OSError: [Errno 30] Read-only file system: '/home/magnus/code/parallix-task-2377.05/.workflow/vibe-home/logs/vibe.log'`

Second symptom, same root cause: the guard binds the whole host root read-only (`--ro-bind / /`), so claude cannot persist its transcript under `~/.claude/projects/<worktree-slug>/` either. Round 1 of task-2377.05 was reviewed by claude and its session id was captured from the `stream-json` result event and stored as a session marker, but no transcript exists on disk for it. Round 2's `--resume 0d181851-da9f-49c6-a6b2-206840e760aa` then failed with `No conversation found with session ID: ...` (blocklist consequence of that failure is TASK-2380, not this task).

Net effect: with `bwrap` present, the reviewer step falls through the entire agent pool and lands on the mission's own implementer family, producing a review that cannot be posted (see TASK-2384).

The task-2374 permission spec (`backlog/completed/task-2374 - bubblewrap-guard.md:20`) enumerated worktree + artifact dir + `/tmp` and simply did not account for agent state homes living inside the worktree. The read-only worktree is still correct: the reviewer must not be able to edit the tree under review. Agent state directories are launcher scratch, not reviewed source, and belong on the writable list.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The review sandbox profile grants read/write to each launcher's own state home while the rest of the mission worktree stays read-only
- [ ] #2 Each agent family able to run as reviewer (codex, qwen, vibe, claude, custom) starts successfully under `bwrap` at the review step and reaches its prompt
- [ ] #3 Claude's per-worktree session transcript directory is writable during review, so a session recorded in round N is resumable in round N+1
- [ ] #4 A reviewer still cannot write any reviewed source, config, test, doc, or mission file in the worktree; the writable set is limited to agent state homes, the resolved artifact directory, and `/tmp`
- [ ] #5 `backlog/completed/task-2374 - bubblewrap-guard.md`'s permission table is superseded by updated documentation of the review profile in `docs/agents.md`
- [ ] #6 Tests cover the review profile's writable set explicitly, including a negative assertion that the worktree source tree remains read-only
- [ ] #7 `./scripts/verify-local.sh static-analysis` and the affected unit suites pass
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
