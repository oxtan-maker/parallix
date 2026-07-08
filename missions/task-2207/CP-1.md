# CP-1: Audit the weak-agent handoff failure path

## Summary

Traced the contract from the backlog task through draft, execute, review, handoff validation, repair-handoff messaging, and the real-agent smoke assertion. The main ambiguity is a split evidence contract: weak agents were producing raw `stat`/`ls` evidence rows, while the runtime validator only accepts verifiable references such as file:line, ADR, test references, or recognized repo commands/paths. That mismatch is enough to make a checkpoint look plausible to the agent while still failing the handoff boundary.

Additional ambiguity remained in the mission authoring path itself: the scaffold did not pin one canonical Goal Check heading or explicitly teach the accepted evidence forms in one place, so drafted missions could still underspecify the exact checkpoint format unless the draft agent inferred the runtime rules correctly.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Failure path from backlog through execute, validator, and repair was traced with concrete sources | `backlog/tasks/task-2207 - parallix-is-to-unclear-for-agents.md:14`, `prompts/draft.md:28`, `prompts/execute.md:13`, `lib/commands/handoff.ts:315`, `lib/commands/repair-handoff.ts:227` | PASS |
| Root ambiguity in Goal Check evidence rules was identified | `prompts/draft.md:31`, `prompts/execute.md:17`, `lib/commands/repair-handoff.ts:246`, `lib/commands/handoff.ts:315` | PASS |
| Audit captured that the smoke failure is specifically about weak-agent handoff evidence rejection | `test/e2e-real-agent-smoke.test.js:605`, `"real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` | PASS |
| Audit captured that mission drafting requirements are not yet guaranteed by a matching scaffolded section contract | `prompts/draft.md:28`, `lib/commands/draft.ts:556` | PASS |

Next action: Rewrite the draft-time mission contract so generated `MISSION.md` files state one canonical checkpoint heading, the table shape, and the accepted evidence forms in one explicit, runtime-aligned format.
