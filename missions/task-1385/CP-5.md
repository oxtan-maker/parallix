# CP-5: Area-scoped gate selection working

## Summary

Implemented area-scoped gate selection in `runPreReviewGate` (`lib/review/review-loop.ts:275-331`). The gate resolves the mission area from the mission directory using `findMissionAreaFn`, which parses the MISSION.md for verification command patterns (via `detectMissionAreaFromContent`). The area is then substituted into the verification command via `formatVerificationCommand(area, worktree)`.

When no mission directory is found, the gate falls back to 'docs' area. When no verification command is configured, the gate passes as a no-op.

## Goal Check

| Goal Check | Evidence | Status |
|---|---|---|
| Gate uses mission area (diff-scoped) via `findMissionAreaFn` | `lib/review/review-loop.ts:293` — `const area = missionDir ? findMissionAreaFn(missionDir) : 'docs'` | PASS |
| Area substituted into verification command | `lib/review/review-loop.ts:294` — `formatVerificationCommand(area, worktree)` | PASS |
| Logs resolved area and command before execution | `lib/review/review-loop.ts:301` — `Pre-review gate for area "${area}": ${fmt.command(command)}` | PASS |
| Falls back to 'docs' when no mission dir found (not 'all') | `lib/review/review-loop.ts:293` — `: 'docs'` fallback | PASS |
| No-gate configured = no-op pass | `lib/review/review-loop.ts:296-298` — returns `{ ok: true, ... }` for `NO_GATE_NOTICE_ALIAS` | PASS |
| Auto-bounce retry capped at 2 relaunches | `lib/review/review-loop.ts:382` — `const MAX_GATE_RETRY = 2` | PASS |
| Gate failure classified as Class 6 auto-send-back | `lib/review/review-loop.ts:248-249` — `GATE_FAILURE_CLASS = 'class-6-genuine-gate-failure'`, `GATE_FAILURE_ACTION = 'auto-send-back'` | PASS |
| Reviewer gate check at review-commands.ts preserved | `git diff main -- lib/review/review-commands.ts` — no changes; check at `lib/review/review-commands.ts:474-481` intact | PASS |
| Test: gate passes with configured command | `test/task-1385-pre-review-gate.test.js:43` — `runPreReviewGate passes when gate command succeeds` | PASS |
| Test: gate fails when command fails | `test/task-1385-pre-review-gate.test.js:70` — `runPreReviewGate fails when gate command fails` | PASS |
| Test: gate resolves mission area from MISSION.md | `test/task-1385-pre-review-gate.test.js:150` — `runPreReviewGate resolves mission area from mission directory` (asserts area = 'task-1385') | PASS |
| Test: no gate configured = no-op pass | `test/task-1385-pre-review-gate.test.js:97` — `runPreReviewGate passes when no verification gate is configured` | PASS |
| Test: auto-bounce strands after retry limit | `test/task-1385-pre-review-gate.test.js:228` — `handleGateFailureAutoBounce strands when retry limit exceeded` | PASS |
| Gate: docs verification | `./scripts/verify-local.sh docs` → `PASS: all required documentation present` | PASS |

## Next action
Mission complete; ready for handoff to review (`node parallix review task-1385 --submit`).
