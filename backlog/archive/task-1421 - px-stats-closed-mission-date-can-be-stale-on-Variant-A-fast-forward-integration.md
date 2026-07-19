---
id: TASK-1421
title: >-
  px stats: closed-mission date can be stale on Variant A fast-forward
  integration
status: done
assignee: []
created_date: '2026-07-04 12:40'
updated_date: '2026-07-04 13:51'
labels:
  - ai_sdlc
  - bug
  - stats
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

task-1415 investigated why `px stats` weekly mission counts don't update immediately when a mission is closed (rows increase, e.g. 703 -> 708, but `# missions` for the current/previous week stays identical).

Full investigation confirmed `lib/commands/stats.ts` is already correct on `main`:
- `summarizeMissionWindow` filters to `closed: 'yes'` rows (task-1380, still intact).
- `summarizeAgentWindow` intentionally does NOT filter by `closed` (task-1409); its per-mission dedup (`byMission`, keyed only on `statsMissionKey`) already collapses all of a mission's stage rows to a single winner, so multiple stage rows can't inflate agent counts either.
- `rowInWindow` is inclusive on both boundaries; `buildWeeklyWindows` has no gap or overlap.
- `upsertStatsRow`'s dedup key includes `stage`, so an integration row (`stage: 'default'`, `closed: 'yes'`) never collides with an earlier stage row.

## Root cause (out of scope for task-1415)

`recordPostIntegrationStats` (`lib/commands/integrate.ts`, ~line 1462) derives the closed row's `date` from `git log -1 --format=%cs` on the base worktree **after** integration finishes.

In "Variant A" (PR already merged on Forgejo before `px integrate` runs — `useVariantA = context.pr.merged`), `finalizeVariantACloseout` only creates a new commit when there is a staged diff after `git add -A`. When there is no staged diff (e.g. the task file was already marked complete, or there's nothing left to reconcile), it returns `{ ok: true, changed: false }` **without committing**. In that case `git log -1` on the base worktree returns whatever committer date the branch tip already carried from the (possibly days-old) mission commit that was fast-forwarded in — not the day the mission was actually closed.

The resulting `closed: 'yes'` row is written with that stale date, so it can land outside both the current and previous week's windows even though closure just happened today — exactly matching the reported symptom (row count increases, weekly mission counts don't move).

## Suggested fix

In `recordPostIntegrationStats`, don't trust `git log -1 --format=%cs` on the base worktree unconditionally. Either:
- Use the system "today" date (`new Date()`) for the closed row's date instead of a git commit's committer date, since the row is meant to record *when the mission was closed*, not when its last commit happened to be authored; or
- Only fall back to `git log -1` when a new closeout commit was actually created in this run (i.e. distinguish the Variant A `changed: false` no-commit path from the Variant B squash-commit path, which does always create a fresh commit with a fresh timestamp).

## Reproduction

See `test/task-1415-closed-mission-counts.test.js` — it exercises `stats.recordIntegrationStats` directly with a stale date to demonstrate that a closed row falls out of both weekly windows when its date predates the actual closure day. A full end-to-end repro would additionally need to mock `finalizeVariantACloseout`'s `changed: false` path and `gitRunner` in `lib/commands/integrate.ts`.

## Restriction note

task-1415's mission explicitly restricted changes to `lib/commands/stats.ts` and `test/` and forbade modifying `lib/commands/integrate.ts` ("the integration path is verified by the existing task-1380 test"). Since the real fix requires editing `integrate.ts`, task-1415 parked this as a follow-up per its own Stop Rule rather than fixing it out of scope.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Superseded — the fix described here landed directly in task-1415 (mission/task-1415, commit cbb05b08) instead of as a separate follow-up. `recordPostIntegrationStats` in `lib/commands/integrate.ts` no longer derives the closed row's `date` from `git log -1 --format=%cs`; it omits `date` entirely and lets `stats.recordIntegrationStats` fall back to its own "today" default, matching every other stats writer. Round 1 of task-1415 parked this as out-of-scope per its Restricted Areas; the round-2 reviewer explicitly required the production fix, which is the scope-decision escalation this task existed to capture. No further action needed.
<!-- SECTION:FINAL_SUMMARY:END -->
