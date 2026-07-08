# CP-4: Verify the autobounce path gives actionable repair guidance

## Summary

Investigated the incomplete-evidence autobounce path and confirmed the retry mechanism already relaunches the implementer from `active` when handoff returns a relaunchable content error. The gap was the content of the repair prompt: it needed to tell the agent exactly what was rejected and what replacement evidence forms to use on retry.

Added focused regression coverage at the repair-prompt seam. The new test locks the behavior that matters for this failure class: when handoff rejects a shell-only Goal Check row and includes an offending row in the error, the relaunch prompt must surface that row, forbid retrying with shell output alone, and direct the agent toward file:line, test, ADR, or recognized repo command/path evidence instead.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Autobounce path still relaunches relaunchable handoff failures from `active` | `lib/commands/active.ts:475` | PASS |
| Repair prompt now gives targeted replacement guidance when an offending row is present | `lib/commands/repair-handoff.ts:261` | PASS |
| Regression test locks the incomplete-evidence retry guidance for shell-only rows | `test/repair-handoff.test.js:346`, `node --test test/repair-handoff.test.js` | PASS |
| Targeted repair-handoff regression suite passes after the prompt fix | `node --test test/repair-handoff.test.js` | PASS |

Next action: Keep the existing runtime evidence acceptance intact and make the runtime error text and authoring prompts describe that acceptance accurately.
