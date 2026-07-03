# CP-1: Split the relaunch prompt by failure class

## Summary

`buildRelaunchPrompt()` in `lib/commands/repair-handoff.ts` previously built a single
Goal Check / checkpoint-repair prompt for every relaunchable error, and only appended
captured gate output (`gateOutput`) to that same checkpoint-editing prompt. That meant
a genuine verification-gate failure (failing product tests) relaunched the implementer
with instructions to edit the final checkpoint's Goal Check table instead of instructions
to fix the failing tests — exactly the gap described in the backlog transcript
(`test/mission-start.test.js`, `test/forgejo-independence.test.js`,
`test/task-1039-integrate-v3.test.js`, `test/rebase_diagnostics.test.js` failing with
`Could not detect primary branch`).

`buildRelaunchPrompt()` now classifies the error via the existing `classifyError()`
(ADR 0048) and dispatches to one of two prompt builders:

- `buildGateFailurePrompt()` — used when `classifyError(errorMsg).failureClass === FailureClass.GateFailure`.
  Cites the captured failing-test excerpt from `gateOutput` and instructs the agent to
  fix the failing verification/tests (not the checkpoint), then re-run the gate and
  resubmit. Explicitly does not mention "Goal Check table" or "CP-N.md".
- `buildGoalCheckRepairPrompt()` — the original prompt content, used for
  `FailureClass.IncompleteEvidence` (and any other non-gate relaunchable error),
  unchanged from the prior behavior: instructs the agent to add a Goal Check table
  with real evidence to the final checkpoint document.

No caller-facing signature changed: `attemptAgentRelaunch()` in `lib/commands/active.ts`
still calls `buildRelaunchPromptFn(errorMsg, slug, worktree, gateOutput)` exactly as
before; the classification and branching happen inside `buildRelaunchPrompt()`. The
2-attempt relaunch cap and the `performHandoff(..., force: true)` post-relaunch retry
in `runHandoffAndReview()` (`lib/commands/active.ts:461-486`) were not touched. The
dirty-artifact / behind-branch auto-repair flow in `repairHandoff()`
(`lib/commands/repair-handoff.ts:228-358`) was not touched.

## Goal Check

| Goal | Evidence | Status |
|---|---|---|
| New regression test proves the prompt-shape bug and the fix | `test/task-1383-active-gate-failure-prompt.test.js:23` (`task-1383: buildRelaunchPrompt for a verification-gate failure...`) — asserts the gate-failure prompt cites failing test names and omits Goal Check/CP-N instructions | PASS |
| Gate-failure prompt cites failing test identifiers from captured gate output (SC2) | `lib/commands/repair-handoff.ts:189-211` (`buildGateFailurePrompt`) appends `gateOutput.stdout`/`stderr` under `--- Captured Gate Output ---`; verified by `test/task-1383-active-gate-failure-prompt.test.js:39-45` asserting `missionStart fails if the backlog task is missing classification` and `printIntegrationPreflight branch failure` appear in the prompt | PASS |
| Gate-failure prompt excludes Goal Check / CP-N checkpoint-editing instructions (SC3) | `lib/commands/repair-handoff.ts:166-171` branches to `buildGateFailurePrompt` for `FailureClass.GateFailure`, which contains no `Goal Check table` / `CP-N.md` text; verified by `test/task-1383-active-gate-failure-prompt.test.js:47-49` | PASS |
| Incomplete-evidence relaunch prompts remain checkpoint-focused (SC4) | `lib/commands/repair-handoff.ts:223-274` (`buildGoalCheckRepairPrompt`), unchanged content; verified by `test/repair-handoff.test.js:325-344` (`buildRelaunchPrompt returns string containing Goal Check table and mission slug`, `buildRelaunchPrompt includes example table`) and `test/task-1383-active-gate-failure-prompt.test.js:51-58` | PASS |
| Dirty-artifact / behind-branch auto-repair unaffected (SC5) | `lib/commands/repair-handoff.ts:228-358` (`repairHandoff()`) untouched by this diff; `test/repair-handoff.test.js` git-blocker tests pass unchanged | PASS |
| 2-attempt relaunch cap and post-relaunch `performHandoff(..., force: true)` retry preserved (SC6) | `lib/commands/active.ts:461-486` untouched; `test/active.test.js:1619-1651` (`runHandoffAndReview limits gate-failure relaunches to 2 attempts (SC4)`) still passes | PASS |
| Full test suite green | `npm test` → `tests 1870, pass 1848, fail 0, skipped 22` | PASS |
| Static analysis gate green (SC7) | `./scripts/verify-local.sh static-analysis` → `=== Static Analysis Gate: ALL STAGES PASSED ===` (ESLint, tsc typecheck, test-hygiene) | PASS |

Next action: Commit the diff (`lib/commands/repair-handoff.ts`, `lib/commands/repair-handoff.js`, `test/task-1383-active-gate-failure-prompt.test.js`, this checkpoint) and hand off via `px review task-1383 --submit`.
