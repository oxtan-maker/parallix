---
id: TASK-2244
title: backlog.md check reading from wrong place
status: ready-for-integration
assignee: [vibe]
created_date: '2026-07-13 08:08'
labels: [ai_sdlc]
dependencies: []
ordinal: 44000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
we seem to have one check that is still reading from the wrong place, probably worktree 

magnus@debian:~/code/parallix-task-2237$ px integrate
[INFO] Integration preflight for task-2237
[PASS] Mission branch: mission/task-2237
[PASS] Mission doc: /home/magnus/code/parallix-task-2237/missions/task-2237/MISSION.md
[PASS] Backlog task: task-2237 - make-parallix-local-only-development.md (active)
[PASS] Backlog classification: user_value
[FAIL] Backlog status: expected approved, or review with an approved Forgejo PR; found active
[PASS] Forgejo PR: PR #139 open
[PASS] Forgejo approval: latest formal review state is APPROVED
[PASS] Forgejo token: resolved for codex (/home/magnus/code/parallix/.forgejo-local/tokens/codex)
[PASS] Integration checkout branch: /home/magnus/code/parallix is on main
[PASS] Integration checkout conflicts: no unresolved merge entries in the git index
[PASS] Integration checkout dirty state: clean
[WARN] Backlog context: does not resolve to /home/magnus/code/parallix. (Ignore if running from worktree to test dry-run; post-squash closeout still requires the local integration checkout).
[INFO] Forgejo configuration: allow_manual_merge assumed enabled
[WARN] Integration warnings: backlog-context
[INFO] Variant B automation: Backlog task closeout, worktree-path rewrite, squash commit with hook-enforced validation, Forgejo sync-merged, and mission worktree cleanup.
[FAIL] 
[FAIL] Integration preflight failed. Resolve the blockers above before running integrate.

some time ago we had a mission to change backlog.md changes to primarybranch since backlog.md is very bad at picking up worktree changes
<!-- SECTION:DESCRIPTION:END -->

## Codex Pre-Draft

**Goal:** make integration preflight read authoritative mission-task status from the correct worktree before squash, while retaining the base checkout as the closeout authority after landing.

**Scope and proof:** reproduce the quoted `active`-versus-approved mismatch with divergent mission/base backlog copies; classify every preflight read by phase; resolve status/classification from the mission worktree until the squash succeeds; add regression tests for the worktree invocation and post-squash closeout.

**Checkpoints:** (1) red two-worktree fixture; (2) phase-correct task resolution implementation; (3) preflight, retry, and closeout regression verification.

**Stop rule:** do not globally switch all integration reads to the mission worktree; after landing, canonical backlog writes and closeout must still target the base checkout.

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
