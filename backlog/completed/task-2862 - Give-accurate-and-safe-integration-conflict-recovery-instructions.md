---
id: TASK-2862
title: Give accurate and safe integration conflict recovery instructions
status: done
assignee: [codex]
created_date: '2026-11-17 14:53'
labels:
  - bug
dependencies: []
references:
  - src/adapters/git/git.ts
  - src/application/integrate/preflight-checkout.ts
  - src/application/integrate/base-worktree-repair.ts
  - src/application/ports/integrate-workflow.ts
  - docs/adr/0047-per-mission-change-size-budget.md
  - docs/adr/0057-verification-tiers-and-trust-model.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Improve the operator-facing integration preflight diagnosis and recovery instructions for a receiving checkout with unresolved index entries, particularly after restoring a temporary integration stash. Keep this a bounded diagnostic/recovery-guidance fix; do not implement automatic conflict resolution or change integration authority.

Observed on 2026-11-17: running npm run dev -- integrate from task-2859.11 failed against /mnt/data/code/parallix. The receiving main checkout had one UU backlog document after task-2859.01 landed (365d9ee4c) and restoration of its temporary integration stash conflicted. No rebase-merge/rebase-apply directory or REBASE_HEAD existed; no conflict markers had been committed. The surviving stash was labelled integrate:task-2859.01: temporary integration checkout stash. The document was subsequently reconciled, preserving the stashed operator requirements and landed solver guidance, and committed on main as 03f8da159; only the recovered stash was removed.

The current detector sets inProgress for either actual rebase metadata or any unmerged index entries. Preflight therefore calls a stash conflict a rebase in progress and suggests rebase --continue/--abort/--skip when no rebase exists. It then prints git rm and git add for the same file, followed by an unqualified git stash drop, which may delete the wrong stash. It also warns that the already-unmerged checkout will be stashed, and the workflow failure summary labels the cause unknown despite the known preflight blocker.

Required outcome: identify the receiving checkout and branch, distinguish actual rebase metadata from unresolved index entries, and present instructions appropriate to the observed state. State whether landing already occurred only when verified. Explain that unresolved working/index content does not itself prove committed conflict markers. Attribute a conflict to stash restoration only when supported by retained operation/stash evidence; otherwise report an unresolved index conflict and offer read-only inspection steps without guessing its origin.

Guide the operator through inspecting the affected paths and both sides, reconciling desired content, staging only reviewed resolutions, and preserving recovered edits with a commit when appropriate. Keep file deletion an explicit intentional alternative, never an unconditional command beside git add. For a genuine rebase, provide valid continuation/abort choices with their consequences; skip must be described as dropping the current patch, not a routine recovery step. Quote paths safely, including spaces and shell metacharacters. Any stash-cleanup guidance must identify and revalidate the specific integration stash (reference plus object identity/marker), require checking that its contents are recovered, preserve unrelated stashes, and never recommend a bare stash drop or indiscriminate reset/clean. If the responsible stash cannot be identified, retain it and explain how to inspect it.

Suppress contradictory will-be-stashed advice while the checkout is blocked by unmerged entries. The failure summary must retain a concrete known preflight cause and a useful next action rather than unknown. Preserve fail-closed preflight behavior and keep diagnosis read-only. Do not auto-resolve, abort a real rebase, delete files, drop stashes, retry integration or re-land a completed squash.

Reuse the existing Git state, integration preflight, stash and workflow failure-presentation owners. Inspect callers before changing shared detector semantics: preserving existing blocking and genuine-rebase behavior is part of the contract. Extend the existing owning suites with focused red-to-green reproductions before broader verification. Cover a stash-restore conflict without rebase metadata, a genuine paused rebase, an unresolved index with unknown origin, and an unrelated stash at the top of the stack. Use doubles for in-process presentation/state-policy tests and existing isolated Git fixtures where real Git is necessary. Follow ADR 0057; do not add or change verification gates or retune CPU budgets. New or modified integration cases/suites must remain within 3.5 seconds and unit cases must meet the repository headroom requirement.

Manually exercise the operator flow end to end in a disposable repository and disposable PARALLIX_HOME: reproduce a landed commit followed by a conflicting stash restore, inspect the diagnostic, perform its instructed recovery while preserving both edits and an unrelated stash, and verify that retry clears these checkout blockers. Do not modify live mission/database state for reproduction. Update the existing operator troubleshooting documentation if needed, following docs/doc-standards.md; keep test evidence in checkpoints. Keep the mission within a Small/Medium ADR 0047 boundary; split through the draft lifecycle if the honest estimate exceeds it. No architectural-principle change is authorized.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An owning-suite reproduction is red on the current misleading stash-conflict instructions and green with the fix; it is retained without creating a task-numbered suite.
- [ ] #2 Preflight distinguishes a genuine paused rebase from unmerged index entries with no rebase metadata, preserves existing blockers, identifies the receiving checkout/branch, and does not guess stash provenance or claim committed conflict markers from UU alone.
- [ ] #3 Recovery instructions preserve both desired content and unrelated changes, safely quote paths, present file deletion only as an intentional alternative, and give valid rebase continuation/abort/skip consequences only for a real rebase.
- [ ] #4 Stash cleanup advice identifies and revalidates the responsible integration stash and requires verified recovery of its contents; unknown ownership retains the stash, and no bare stash drop or cleanup of unrelated stashes is suggested.
- [ ] #5 Blocked unmerged checkouts receive no contradictory will-be-stashed warning, and the workflow failure summary exposes the known preflight cause and an actionable next step rather than unknown.
- [ ] #6 A disposable end-to-end exercise verifies landed-commit plus stash-conflict diagnosis, content-preserving operator recovery, unrelated-stash preservation and removal of these checkout blockers on retry; live mission/database state is untouched.
- [ ] #7 Existing owning suites retain genuine-rebase and fail-closed assertions, focused checks meet repository isolation/runtime budgets, operator-owned gates remain unchanged, and affected operator documentation describes the delivered recovery behavior.
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
