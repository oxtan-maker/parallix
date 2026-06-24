---
event_type: reviewer_outcome
timestamp: 2026-06-24T06:14:47.000Z
round: 3
phase: reviewing
actor: claude
slug: task-1341
verdict: request-changes
---

# Review Outcome — task-1341 — Round 3

**Outcome: request-changes** (overturns the round-2 approval)

## Summary

The round-2 approval (commit `c84a03ee`) is overturned because post-approval,
uncommitted changes altered synthetic-draft behavior — free-text/directory
drafts now produce `adhoc-` slugs (and `ADHOC-…` ids) instead of `task-`,
reserving `task-*` for real Backlog.md task files. The change is technically
sound, consistent across `draft.js` / `mission-utils.js` / tests, addresses the
collision risk in `MISSION.md:96`, and keeps `npm test` green (1640 tests, 0
fail). But it postdates the approved state and was never reviewed through the
workflow, so it cannot ride the prior approval into integration.

The verdict is **request-changes** for an evidence-freshness gap, not broken
functionality:

- **F2 (blocking):** `SMOKE.md:7-8` still shows the free-text draft producing
  `task-hello-world` / `backlog/tasks/task-hello-world - hello-world.md`. The
  new code yields `adhoc-hello-world`. Refresh the smoke artifact to match.

Non-blocking:

- **F3:** `lib/tools/forgejo.js` slug extraction (`^mission\/(task-\d+)`, ~12
  sites) won't match `adhoc-*` slugs. Pre-existing limitation, not a regression;
  Forgejo is the optional/out-of-scope review surface. Track separately.

## Required changes
- Refresh `SMOKE.md` so the recorded free-text/directory draft evidence reflects
  the `adhoc-` slug and `ADHOC-…` id (F2).

## Recommended (non-blocking)
- Open a follow-up to make Forgejo slug extraction tolerate `adhoc-*` slugs, or
  document the limitation (F3).

Commit the `adhoc-` delta and re-run the review harness so the new behavior is
reviewed from a clean, committed state.

---
`[workflow-round:3, workflow-phase:reviewing]`
