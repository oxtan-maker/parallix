# CP-3: Align execute and repair prompts

## Summary

Aligned the implementer prompt and incomplete-evidence relaunch prompt to the same Goal Check contract introduced in CP-2. Both now teach one canonical heading (`## Goal Check`), the same table shape, and the same accepted evidence forms that Parallix already verifies at runtime.

The repair prompt now gives a materially better retry instruction than before. Instead of leaving the agent to guess, it surfaces the offending row and tells the agent to replace raw `stat`/`ls` output with a file:line, test, ADR, or recognized repo command/path reference.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Execute prompt now teaches the same accepted evidence forms as the draft-time contract | `prompts/execute.md:17` | PASS |
| Incomplete-evidence repair prompt now teaches the same accepted evidence set and retry strategy | `lib/commands/repair-handoff.ts:246`, `lib/commands/repair-handoff.js:247` | PASS |
| Repair prompt surfaces the offending row for actionable retries | `lib/commands/repair-handoff.ts:261`, `test/repair-handoff.test.js:348` | PASS |
| Repair prompt example table now demonstrates accepted repo-verifiable evidence | `lib/commands/repair-handoff.ts:282`, `lib/commands/repair-handoff.js:280` | PASS |

Next action: Exercise the autobounce path and handoff validator with focused regression tests and confirm the runtime error text matches the accepted evidence forms.
