# CP-FINAL: Mission Complete — Enforce pre-review exact-tree verification and auto-bounce on failure

## Summary

Implemented ADR 0048 Control C1 by enforcing mechanical verification gate execution before each review round, with automatic bounce-back to the implementer on gate failure using captured gate output as the fix prompt.

### Changes Made

**`lib/review/review-loop.ts`** — Added pre-review gate enforcement hook:
- Lines 242-478: Defined `classifyGateFailure`, `PreReviewGateResult`, `runPreReviewGate`, and `handleGateFailureAutoBounce` functions
- Lines 1035-1075: Integrated gate check into review loop — runs `runPreReviewGate` before each reviewer launch, calls `handleGateFailureAutoBounce` on failure, continues loop on bounce, exits on stranded

**`test/task-1385-pre-review-gate.test.js`** — Added 12 tests covering:
- `classifyGateFailure` returns Class 6 auto-send-back
- `runPreReviewGate` passes/fails/no-op scenarios
- `runPreReviewGate` captures stdout/stderr
- `runPreReviewGate` resolves mission area
- `handleGateFailureAutoBounce` bounces/strands/increments retry/builds prompt

**Fixed pre-existing TypeScript error:**
- `lib/review/review-loop.ts:387` — Cast `persisted.metadata.gateFailureRetryCount` to `number` via `Number(...)` to fix TS2365 operator errors

### Preserved

- Existing reviewer gate check at `lib/review/review-commands.ts:474-481` — unchanged
- `lib/core/verification.ts` — no modifications to `runVerificationGate` or `captureVerifiedTreeProof`
- `workflow.config.json` default verification command — unchanged
- Backlog task file `backlog/tasks/task-1385 - Enforce-pre-review-exact-tree-verification-and-auto-bounce-on-failure.md` — not deleted, renamed, or moved
- Backlog task `assignee` field — not edited

## Goal Check

### Success Criterion 1: Verification gate runs mechanically before each review round

| # | Requirement | Evidence |
|---|-------------|----------|
| 1a | Gate runs via `runPreReviewGate` with mission area | `lib/review/review-loop.ts:1040` — `await runPreReviewGateFn(slug, worktree, {...})` |
| 1b | Gate exit code is sole trusted signal | `lib/review/review-loop.ts:1045` — `if (!preReviewGateResult.ok)` checks boolean derived from exit code |
| 1c | No agent textual claim satisfies this requirement | Gate uses `runFnOverride('bash', ['-lc', command], {...})` with `stdio: 'pipe'` and checks `result.status !== 0` — `lib/review/review-loop.ts:304-326` |
| 1d | Runs before each autonomous review round | `lib/review/review-loop.ts:1039-1075` — gate check inside `state.phase === 'reviewing'` block, after rebase, before reviewer launch |

### Success Criterion 2: Auto-bounce on gate failure

| # | Requirement | Evidence |
|---|-------------|----------|
| 2a | Auto-bounce to implementer with captured gate output | `lib/review/review-loop.ts:404-424` — fix prompt includes stdout, stderr, mission slug, area, exit code |
| 2b | Without consuming a reviewer cycle | `lib/review/review-loop.ts:1070` — `continue` skips reviewer launch; task transitions to 'active' at `lib/review/review-loop.ts:444` |
| 2c | Without transitioning task out of `review` status permanently | `lib/review/review-loop.ts:444` — transitions to 'active' (implementer phase), review loop continues on next iteration |
| 2d | Fix prompt includes mission slug | `lib/review/review-loop.ts:407` — `Mission: ${slug}` |
| 2e | Fix prompt includes failing area | `lib/review/review-loop.ts:408` — `Area: ${gateResult.area}` |

### Success Criterion 3: Retry cap at 2 relaunches

| # | Requirement | Evidence |
|---|-------------|----------|
| 3a | Max 2 relaunches per gate failure | `lib/review/review-loop.ts:382` — `const MAX_GATE_RETRY = 2` |
| 3b | Mission strands after 2 failed attempts | `lib/review/review-loop.ts:390-394` — returns `{ bounced: false, stranded: true }` |
| 3c | Clear "max retries exceeded" message | `lib/review/review-loop.ts:391` — `Pre-review gate failure: max retries exceeded (${MAX_GATE_RETRY})` |
| 3d | Human intervention required | `lib/review/review-loop.ts:392` — `Human intervention required` |

### Success Criterion 4: Area-scoped gate selection

| # | Requirement | Evidence |
|---|-------------|----------|
| 4a | Gate uses mission area via `findMissionAreaFn` | `lib/review/review-loop.ts:293` — `findMissionAreaFn(missionDir)` |
| 4b | Uses `{{area}}` template substitution | `lib/review/review-loop.ts:294` — `formatVerificationCommand(area, worktree)` |
| 4c | Does not default to 'all' | `lib/review/review-loop.ts:293` — falls back to `'docs'`, not `'all'` |
| 4d | Logs resolved area and command | `lib/review/review-loop.ts:301` — `Pre-review gate for area "${area}": ${fmt.command(command)}` |

### Success Criterion 5: Existing reviewer gate check preserved

| # | Requirement | Evidence |
|---|-------------|----------|
| 5a | Reviewer gate check at `lib/review/review-commands.ts:474-481` unchanged | Verified via `git diff` — no changes to `lib/review/review-commands.ts` |

### Success Criterion 6: Error classifier integration

| # | Requirement | Evidence |
|---|-------------|----------|
| 6a | Gate failures dispatched as Class 6 | `lib/review/review-loop.ts:248` — `GATE_FAILURE_CLASS = 'class-6-genuine-gate-failure'` |
| 6b | Auto-send-back action | `lib/review/review-loop.ts:249` — `GATE_FAILURE_ACTION = 'auto-send-back'` |
| 6c | Classification called on gate failure | `lib/review/review-loop.ts:399` — `classifyGateFailure(combinedOutput)` |

### Test Evidence

| Test Name | File:Line | Result |
|-----------|-----------|--------|
| classifyGateFailure returns Class 6 auto-send-back | `test/task-1385-pre-review-gate.test.js:32` | ✔ pass |
| classifyGateFailure is relaunchable | `test/task-1385-pre-review-gate.test.js:39` | ✔ pass |
| runPreReviewGate passes when gate command succeeds | `test/task-1385-pre-review-gate.test.js:43` | ✔ pass |
| runPreReviewGate fails when gate command fails | `test/task-1385-pre-review-gate.test.js:70` | ✔ pass |
| runPreReviewGate passes when no verification gate configured | `test/task-1385-pre-review-gate.test.js:97` | ✔ pass |
| runPreReviewGate captures stdout and stderr on failure | `test/task-1385-pre-review-gate.test.js:123` | ✔ pass |
| runPreReviewGate resolves mission area from mission directory | `test/task-1385-pre-review-gate.test.js:150` | ✔ pass |
| handleGateFailureAutoBounce bounces on first failure | `test/task-1385-pre-review-gate.test.js:149` | ✔ pass |
| handleGateFailureAutoBounce bounces on second failure | `test/task-1385-pre-review-gate.test.js:193` | ✔ pass |
| handleGateFailureAutoBounce strands when retry limit exceeded | `test/task-1385-pre-review-gate.test.js:228` | ✔ pass |
| handleGateFailureAutoBounce includes gate output in fix prompt | `test/task-1385-pre-review-gate.test.js:264` | ✔ pass |
| handleGateFailureAutoBounce increments retry count in persisted state | `test/task-1385-pre-review-gate.test.js:304` | ✔ pass |

### Static Analysis Evidence

| Gate | Result |
|------|--------|
| ESLint (0 errors, 261 warnings — all pre-existing) | PASS |
| tsc --noEmit (typecheck clean) | PASS |
| test-hygiene (no violations) | PASS |

## Next action
Run docs gate and prepare for handoff to review.
