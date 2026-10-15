---
id: TASK-2766
title: Restore review restart by reverting isolated repair-continuation mistakes
status: backlog
assignee: []
created_date: '2026-10-15 14:44'
updated_date: '2026-10-15 14:49'
labels:
  - bug
  - ai_sdlc
dependencies: []
priority: high
ordinal: 253008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Restore automatic review-loop restart after a successful retained verification repair by reverting isolated harmful changes from TASK-2738 and TASK-2757. Preserve the value both missions delivered. Do not revert either mission wholesale.

Required behavior: an interrupted repair can launch its implementer before completed repair-checkpoint evidence exists (TASK-2738). The implementer receives the original failure diagnostics, and the exact authorized failed check must rerun and pass; agent exit 0 alone never completes recovery (TASK-2757). After verification succeeds, restart the existing review loop automatically, reread authoritative mission/round state, perform the required handoff, and reach the reviewer decision without another operator resume. Failed or interrupted repairs remain blocked or resumable. Human integration approval remains required.

Observed incident: task-2765 transcript /run/user/1000/parallix-terminal/233bbddb32ac/task-2765.sock.log shows implementer exit 0, exact integration check passing in 63.5s, PRE-REVIEW GATE FAILURE repaired, RECOVERY_TELEMETRY outcome=rescue, then Review of the repaired mission task-2765 stopped. Read-only px status showed active mission, pending review round 2, and CP-7 evidenceRecorded=true, verified=true.

Code/history evidence: TASK-2738 original commit 26cf97c9ecc77b6eef15b5a5fe8dc5cada70f0d6 (landed in squash e9158207b) inserted a repair-only shortcut in runOwnedReviewLoop that launched an implementer and unconditionally returned. TASK-2757 commit 0ec0a0047 replaced the ordinary launch with retained failure recovery and exact-check verification but retained the early return. Current resumePendingRepair returns true after repair succeeds, so runOwnedReviewLoop returns before prepareStart, handoff and reviewer execution. The composition reReviewRepairedRevision then sees active/pending and returns false; integration reports the observed stop.

Historical restoration reference: inspect TASK-2738 parent 83bde670642b51ded01ea7af8fa6270a2cab0daa and receiving-base e9158207b^. The older path reached prepareStart, reran handoff for active missions awaiting review, reloaded authoritative round state, and entered reviewer execution. HandoffGateRecovery retried the complete handoff after repair and returned its result to the caller. Pre-review repair returned the mission to review and proceeded to reviewer execution. Use these existing paths to identify precisely what can be restored. Historical comparison establishes the control-flow difference; an isolated runtime regression is still required to prove the final restoration.

Implementation priority, explicitly directed by the operator: first undo only the isolated mistakes and restore/reuse the old continuation behavior. Keep checkpoint escape, retained diagnostics, exact-check verification, locked repair contracts and finite retry budgets. A whole-mission revert is unacceptable because it restores earlier bugs. New code is a last resort only if isolated reverts/restoration cannot satisfy the combined behavior; demonstrate that limitation and keep any necessary change minimal within the existing workflow owner. No new recovery controller, framework, unrelated refactor, task-2765 special case or architecture change. Preserve all operator gate removals; do not introduce or restore gates.

Terminal observation: the operator associates breakage with [mission terminal command exit code: 0]. This is emitted by tmux-host.ts after a hosted command returns and predates these missions (0fcbe39715). Do not hide the marker to mask the issue; verify that agent/check completion returns control to the owning workflow and that the hosted workflow reaches its intended decision. This finding explains the supplied incident, not every possible exit.

Validation: extend existing owning review/recovery suites. Reproduce green exact-check repair stranding active/pending review on the broken tree, then prove automatic restart through handoff and reviewer decision after the targeted restoration. Also prove an unfinished checkpoint does not prevent repair launch, agent exit 0 cannot bypass the failed check, and failed verification does not advance review. Manually exercise public CLI plus hosted terminal in an isolated repository and PARALLIX_HOME with controlled runners; do not mutate real missions or call models to manufacture evidence. Use npm test containment and ADR 0057; no integration case over 3.5s. Run focused checks, not new/full verification gates.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Preserve TASK-2738 repair launch before checkpoint completion and TASK-2757 retained diagnostics plus exact-check verification
- [ ] #2 Restore automatic review-loop restart through handoff and reviewer decision after successful repair by isolated reversions/restoration; new code only as a demonstrated last resort
- [ ] #3 Focused regression and isolated hosted-terminal CLI reproduction prove restored restart and preserved failed-repair behavior; no whole-mission revert or new recovery layer
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
