---
event_type: reviewer_findings
timestamp: 2026-06-24T06:14:47.000Z
round: 3
phase: reviewing
actor: claude
slug: task-1341
---

# Review Findings — task-1341 (Make backlog.md optional) — Round 3

Mode: review (re-opened after round-2 approval). Reviewer state: round=3, reviewer=claude, implementer=codex.

## Why this round exists

Round 2 approved commit `c84a03ee`. Post-approval, uncommitted working-tree
changes were introduced that change synthetic-draft behavior: free-text and
directory drafts now mint an `adhoc-` slug prefix (and `ADHOC-…` synthetic id)
instead of `task-`, with `task-*` reserved for real Backlog.md task files. This
directly addresses the synthetic/real slug collision risk in `MISSION.md:96` and
is a sound improvement. Touched: `lib/commands/draft.js`,
`lib/core/mission-utils.js` (new `isMissionSlugCandidate`, `inferSlug`),
`README.md`, and tests (`draft-command.test.js`, `draft.test.js`,
`mission-utils.test.js`). `npm test` is green (1640 tests, 0 fail, 22 skipped)
with these changes applied.

This delta postdates the round-2 approval and has had no recorded review round,
so the approval is overturned pending re-review of the new behavior.

## Verification

- `npm test`: **1640 tests, 1618 pass, 0 fail, 22 skipped** (with the `adhoc-`
  delta applied). The `adhoc-` handling is consistent across the touched paths
  and is test-backed.

## Findings

### F2 (Low) — BLOCKING — stale smoke evidence
`SMOKE.md:7-8` still records the free-text draft producing slug
`task-hello-world` and task file `backlog/tasks/task-hello-world - hello-world.md`.
Under the new code that same run yields `adhoc-hello-world`. The smoke evidence
no longer matches current behavior and must be refreshed so the recorded
artifact reflects the `adhoc-` slug.

### F3 (Low) — non-blocking, pre-existing — Forgejo adhoc slug extraction
`lib/tools/forgejo.js` extracts the slug from the branch with
`branch.match(/^mission\/(task-\d+)/)` in ~12 sites. These do not match
`adhoc-*` (or any non-numeric) slugs, so adhoc missions cannot derive a slug
from the branch in the Forgejo review surface. This is **not a regression** —
free-text drafts already produced non-numeric slugs that failed the same match,
and Forgejo is the optional/out-of-scope review surface — but it is a real
ceiling on adhoc missions that use Forgejo review. Track it; do not block on it.

## Criteria status

All 10 round-2 falsifiable criteria still hold under the `adhoc-` delta (suite
green, behavior equivalent modulo the slug prefix). The only blocking item is the
stale smoke artifact (F2).

---
`[workflow-round:3, workflow-phase:reviewing]`
