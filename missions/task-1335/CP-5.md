# CP-5: Provenance note and implementation evidence wrap-up

## Summary

The backlog record and mission both start from the same problem: standalone parallix `main`
already advanced with a broken tree, and later squash publication destroyed the normal
mission-by-mission evidence chain. Once that history is collapsed, git alone cannot reconstruct
which pre-squash checkout actually passed or failed verification.

This branch restores a forward-looking audit boundary in repo-owned code:

- the publish path must run the configured verification gate on the exact checkout being
  published;
- the proof records the checkout root, verification area/command, commit SHA, tree SHA, and
  capture time;
- each publish-side mutation re-checks that proof immediately before pushing or syncing.

That does **not** resurrect the already-lost provenance for the historical broken squash commit.
It does make future standalone publishes fail closed when the proof is missing, borrowed from a
different checkout, or stale relative to the current tree.

## Evidence

- Historical provenance-loss problem statement:
  `backlog/tasks/task-1335 - Harden-parallix-self-hosting-publish-path-so-broken-trees-cannot-reach-main.md:21-33`
  and `missions/task-1335/MISSION.md:3-17`.
- Exact-tree proof payload:
  `lib/core/verification.js:103-112`.
- Exact-tree mismatch rejection:
  `lib/core/verification.js:124-129`.
- Publish-path fail-closed enforcement:
  `lib/commands/integrate.js:685-699`, `:1275-1299`, `lib/tools/forgejo.js:429-441`, `:739-753`.

## Goal Check

| Mission item | Status | Evidence |
|---|---|---|
| Explain why squashed publication obscured the original failure's provenance | Done | backlog task `:21-33`; `missions/task-1335/MISSION.md:3-17` |
| Explain how the new proof restores a repo-owned audit boundary going forward | Done | `lib/core/verification.js:103-129`; `finalizeVariantACloseout rejects a stale verification proof before pushing main closeout`; `createPr rejects a verification proof from a different checkout before syncing primary baseline` |
| Regression proves a broken standalone tree is blocked from reaching publish/update paths | Done | `standalone createPr refuses to publish when the configured verification gate fails`; `createPr rejects a verification proof from a different checkout before syncing primary baseline` |
| Checkpoint documents exist with implementation evidence for review | Done | `missions/task-1335/CP-1.md` through `CP-5.md` |

## Next action

No further checkpoint authoring is needed for this review finding. Commit the checkpoint set so
static review can discover the implementation evidence.
