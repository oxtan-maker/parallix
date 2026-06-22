---
event_type: reviewer_findings
timestamp: 2026-06-22T22:45:46.209Z
round: 1
phase: reviewing
actor: claude
slug: task-1327
---

# Review Findings — task-1327

Mission: Make backlog review state and review artifacts reconcile cleanly.
Branch: `mission/task-1327` · PR #17 (open) · Reviewer pass: codex (round 1).

## Verdict: request-changes

The code/test work is **correct and complete** — all six Success Criteria are met by
real, passing regression tests. The request-changes is driven by an inconsistency in
the mission's own final checkpoint document plus a non-deterministic gate, both of which
the loop contract requires me to surface rather than fix.

---

## What the diff does (verified)

Two bounded fixes in `lib/review/review-commands.js`:

1. **Stale `active` task after provider-backed approval.**
   `submitReviewRound` previously transitioned the backlog task only on the
   `provider=none` path; the provider-backed branch posted the review and rewrote
   `review-state.json` but left the task file `active`. New helper
   `repairStaleActiveTaskAfterReview` (`lib/review/review-commands.js:91-115`) runs
   after a successful provider POST and after the self-author skip path
   (`:950-959`, `:980-988`). It is correctly gated: only fires when
   `toVirtual(currentStatus) === 'active'`, and only on the success path (it sits
   after `if (!result.ok) { exit(1); return; }`), so truly-active missions are not
   promoted on error and already-`review`/`approved` tasks are untouched. This
   satisfies the "do not silently promote" criterion.

2. **Dirty `review-events` after consume.**
   `consumeArtifacts` now calls `commitPersistedReviewOutputs`
   (`lib/review/review-commands.js:117-124`, invoked at `:837-845`), which reuses
   `commitSafeMissionArtifacts` from the review loop. That helper only commits
   workflow/mission-safe paths and refuses on unsafe/conflicted files, so the
   worktree is left clean after a successful consume.

### Success-criteria evidence (all PASS)
- Stale-state repro + fix: `test/review.test.js` "submitReviewRound promotes an active backlog task to review after provider-backed approval"; YAML+rendered alignment in "...keeps YAML and rendered task status aligned...".
- Integration preflight no longer fails on stale active: `test/integrate.test.js` "provider-backed approval repair leaves integration preflight with review instead of stale active".
- Dirty-artifact repro + fix: `test/task-1209-consume-artifacts.test.js` "consumeArtifacts leaves no untracked review-events files after a successful transition" (asserts `git status --short` empty).
- `review + APPROVED` integration acceptance preserved (diff does not touch `evaluateTaskStatusForIntegration`); existing test "evaluateTaskStatusForIntegration accepts review when the latest formal review is approved" still passes.
- Label: `backlog/tasks/task-1327 - ...md:8` → `labels: [ai_sdlc]` (exactly one).

---

## Findings

### F1 (medium) — Final checkpoint contradicts the actual workflow state
`missions/task-1327/CP-4.md` marks the `npm test` gate **BLOCKED** ("the full suite did
not terminate cleanly during this run window") and states **"this mission is not being
handed off yet"**, with Next action "get one clean terminating `npm test` run ... then
hand off." Yet the task was transitioned to `review` and PR #17 was opened (commits
`66a0e05b`, `6be849e4`). The mission Gates require `npm test`, but the final checkpoint's
Goal Check does **not** certify that gate as passing — it certifies it as BLOCKED.

I independently re-ran the gate: `npm test` exits 0 with `pass 1599, fail 0, skipped 22`
in 4 of 5 runs (see F2). So the gate does pass; the checkpoint's BLOCKED/"not handed off"
conclusion is stale and self-contradictory. CP-4 should be updated to reflect the
passing gate and remove the "not being handed off yet" contradiction.

### F2 (low) — `npm test` gate is non-deterministic
In 5 full-suite runs I saw 1 failure: `integrate passes the pre-resolved Forgejo token
into syncMerged` (`test/task-1109.test.js:186`) — `readTokenCalls` was 1, expected 2.
The test passes 5/5 in isolation and 4/5 in the full suite. It is **not** in the
mission's changed files, and the new tests in this diff add no global `mock.method`
hooks (they use option-injected fakes + temp git repos with restored env), so this is
most plausibly **pre-existing cross-file suite flakiness, not introduced by this diff**.
Flagged because a Gate depends on the suite and CP-4 itself stumbled on suite stability.

### F3 (low / observation) — consume now couples success to whole-worktree cleanliness
`commitPersistedReviewOutputs` → `commitSafeMissionArtifacts` returns `ok:false` if the
worktree contains **any** non-mission dirty path, and `consumeArtifacts` now returns
`{ ok:false }` in that case (`lib/review/review-commands.js:842-845`). This is broader
than "review-events only," but it is consistent with the pre-existing
`rebaseBeforeReviewRound` behavior and aligns with the mission's worktree-cleanliness
intent. No change required; noting for awareness.

---

## Requested change
Update `missions/task-1327/CP-4.md` so the final Goal Check reflects the now-passing
`npm test` gate (with evidence) and resolves the "not being handed off yet" /
Next-action contradiction. Optionally record the F2 intermittent flake as a known,
pre-existing suite issue rather than a blocker.

---
`[workflow-round:1, workflow-phase:reviewing]`