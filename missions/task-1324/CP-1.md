# CP-1: Trace the retry path and the durable review transition

The active-path control flow now makes the relaunch branch obey the same contract as the normal repair-success branch. In `runHandoffAndReview()`, the initial `performHandoff()` failure is followed by repair handling; if repair cannot fix the issue but the error is relaunchable, the code calls `attemptAgentRelaunch()`, then re-runs `performHandoff()` with `force: true` before returning success. The durable `active` -> `review` state transition still lives in `performHandoff()`, where gatekeeper pushback can intentionally keep the task in `active` and the normal success path transitions the backlog exactly once to `review`.

## Goal Check

| Goal Check | Evidence | Status |
|-----------|----------|--------|
| Normal handoff-to-review transition is owned by handoff machinery, not by logging in `active` | [lib/commands/handoff.js](/home/magnus/code/parallix-task-1324/lib/commands/handoff.js:299) performs Step 3 & 4 and calls `backlog.transitionTask(slug, 'review', ...)` at [lib/commands/handoff.js](/home/magnus/code/parallix-task-1324/lib/commands/handoff.js:303) | PASS |
| Gatekeeper pushback remains the existing exception that intentionally keeps the task in `active` | [lib/commands/handoff.js](/home/magnus/code/parallix-task-1324/lib/commands/handoff.js:294) returns `{ ok: true, gatekeeperPushedBack: true }` before any review transition | PASS |
| Relaunch success path in `runHandoffAndReview()` no longer escapes on a bare success log | [lib/commands/active.js](/home/magnus/code/parallix-task-1324/lib/commands/active.js:427) enters the relaunchable branch and [lib/commands/active.js](/home/magnus/code/parallix-task-1324/lib/commands/active.js:438) re-invokes `_performHandoff(..., force: true)` after a successful relaunch | PASS |
| Original bug statement is preserved in the backlog task for the mission record | [backlog/tasks/task-1324 - transition-to-review-after-active-also-on-the-retry-path-assuming-successful.md](/home/magnus/code/parallix-task-1324/backlog/tasks/task-1324%20-%20transition-to-review-after-active-also-on-the-retry-path-assuming-successful.md:14) describes the retry path returning to console without guaranteed continuation | PASS |

Next action: Validate the behavior with regression tests that prove relaunch success only reports success after a concrete post-relaunch handoff.
