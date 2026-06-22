# Mission: transition active relaunch retry into a real review handoff (task-1324)

## Goal
Fix the `active` command's relaunch retry path so that when a repairable handoff failure triggers `attemptAgentRelaunch()` and the relaunch ultimately succeeds, the workflow reaches the same durable outcome as the normal happy path: the backlog task transitions from `active` to `review`, the handoff is actually completed, and the command does not report success while silently returning to the console with the task still left in `active`.

## Why Now
TASK-1322 exposed a control-flow gap in `lib/commands/active.js`. The mission emitted `Handoff succeeded`, `Relaunch successful`, and `Agent relaunched. It will fix the checkpoint and retry handoff.`, then returned to the console without any visible failure but also without guaranteeing the backlog transition to `review`. That is a workflow-integrity bug: operators and downstream automation can be told the mission succeeded while the authoritative task state remains incorrect. This is `ai_sdlc` work because it fixes the autonomous workflow contract rather than product behavior.

## Refinement Signals
- Estimated agent % usage limit: 25-50%
- Confidence: High
- Selection note: activate as-is
- Main drivers: `lib/commands/active.js` currently returns `true` immediately after a successful relaunch, but the state transition to `review` is owned by `performHandoff()` in `lib/commands/handoff.js`; the retry path therefore needs an explicit end-to-end contract instead of a log-only success path.

## Scope
- Trace the current control flow in `runHandoffAndReview()` from initial `performHandoff()` failure, through `repairHandoff()`, through `attemptAgentRelaunch()`, to the final return path.
- Identify the exact workflow contract for "successful relaunch" in the active phase: whether the original process must wait for a re-run handoff result, consume an artifact/state signal from the relaunched agent, or perform the follow-up handoff itself.
- Implement the smallest safe fix in the active/handoff workflow code so the retry path cannot report success unless the backlog transition to `review` has actually happened or the task is intentionally kept in `active` by an existing gatekeeper/pushback rule.
- Add or update automated tests around `runHandoffAndReview()` and any touched collaborators to cover the relaunch success path, including task-state expectations.
- Update the backlog task description only as needed to preserve the failure evidence and reflect the refined bug statement.

## Out of Scope
- Changing checkpoint-document content rules, gatekeeper policy, or the CP Goal Check table format introduced by TASK-1322.
- Broad redesign of the `active`, `handoff`, or `review` commands beyond what is required to make the relaunch retry path state-correct.
- Fixes for unrelated backlog-state bugs such as review-loop phase mismatches, integrate/rebase recovery, or other tasks already tracked separately.
- Altering backlog `assignee` workflow behavior except where existing transition code already owns it.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

1. A regression test in `test/active.test.js` or an equivalent active-path test file reproduces the current bug shape: the initial handoff attempt fails with a relaunchable error, the relaunch path is taken, and the test asserts the workflow must not finish in a success state unless a concrete handoff/review-state completion condition is met.
2. After the fix, the relaunch success path in `lib/commands/active.js` no longer returns a bare success immediately after logging `Agent relaunched...`; it either completes a verifiable handoff-to-review flow itself or blocks on a concrete signal that the relaunch completed that handoff.
3. When the relaunch-assisted handoff succeeds, the backlog task state is transitioned to `review` exactly once via the normal transition machinery, with no duplicate or contradictory `active`/`review` writes in the same path. This is verified by automated tests that observe the transition call sequence or resulting task content.
4. Existing guarded exceptions remain intact: if gatekeeper pushback intentionally keeps the task in `active`, or if the handoff still fails after the retry logic, the command must not falsely report review handoff success. This is verified by updated or existing tests continuing to pass.
5. `npm test` passes with 0 failures after the change.

## Risks and Assumptions
- Assumption: the observable failure is a control-flow bug in the parent `active` process, not merely confusing logging from a fully asynchronous but correct child flow. The implementation work must validate that assumption before changing semantics.
- Risk: waiting for or re-invoking handoff from the retry path can create duplicate PR creation, duplicate backlog transitions, or duplicate review-loop starts if the relaunch already performs those actions independently.
- Risk: the relaunch path crosses process boundaries and may depend on persisted artifacts or side effects that are not obvious from the local function return values; tests need to pin the intended contract explicitly.
- Assumption: the correct durable signal for success is backlog task state and/or handoff result, not the presence of a console message from the relaunched agent.

## Checkpoints
- CP 1: Document the current failure path with specific references in `lib/commands/active.js` and `lib/commands/handoff.js`, including where the normal `review` transition happens and where the relaunch path currently escapes that contract.
- CP 2: Add a failing regression test that captures the relaunch-success-but-no-review-transition bug and defines the intended post-fix behavior.
- CP 3: Implement the active/handoff retry-path fix and update tests until the new contract passes without breaking existing gatekeeper/manual-failure behavior.
- CP 4: Run full verification with `npm test` and record the evidence needed for handoff.

## Gates
- [ ] Relaunch-path regression coverage exists and passes, proving the task cannot remain silently in `active` after a reported successful retry handoff.
- [ ] `npm test` passes with 0 failures.

## Restricted Areas
- Do not edit mission history or review artifacts under `missions/task-1322/`; use them only as evidence for the bug statement.
- Do not change backlog task file naming, move the backlog task, or edit the backlog `assignee` field manually.
- Do not weaken existing gatekeeper protections or bypass `performHandoff()` transition logic just to force a green path.
- Do not introduce a fix that depends on fragile log-text scraping when a stronger state-based contract is available.

## Stop Rules
- Stop if the investigation shows the relaunch path already performs a correct `review` transition and the only bug is missing or misleading operator output; in that case, rewrite the mission scope around observability only before implementing.
- Stop if making the parent process wait for relaunch completion requires a new inter-process protocol or durable artifact contract that is larger than this mission's narrow bug fix; document the missing contract and split follow-up work instead of shipping an unsafe partial fix.
- Stop if the only feasible implementation duplicates PR creation or review-loop startup in ways that cannot be made idempotent with the current code structure.
