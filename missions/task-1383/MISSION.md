# Mission: Make `px active` relaunch with a state-aware fix prompt for verification test failures (task-1383)

## Goal

When the post-`px active` handoff fails because the verification gate reports failing tests, the workflow must relaunch the implementer with a prompt that tells the agent to fix the failing verification/tests and cites the captured failure output, instead of reusing the generic Goal Check / checkpoint-repair prompt. The existing retry cap, post-relaunch handoff retry, and non-gate repair paths must remain intact.

## Why Now

`lib/commands/active.ts` already detects genuine gate failures and relaunches the implementer, but `lib/commands/repair-handoff.ts` still builds one generic prompt aimed at incomplete checkpoint evidence. The backlog transcript shows a representative failure shape: the final verification gate reports failing tests in `test/mission-start.test.js`, `test/forgejo-independence.test.js`, `test/rebase_diagnostics.test.js`, and `test/task-1039-integrate-v3.test.js` caused by `Could not detect primary branch`. In that scenario the operator needs the agent restarted with a code-fix prompt, not instructions to edit the Goal Check table. As long as the prompt is misclassified, the automatic send-back loop wastes retries and strands `px active` on exactly the class of failures it is supposed to recover from.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: existing relaunch seam in `lib/commands/active.ts`, prompt/classification gap isolated to active handoff recovery, regression can be locked with focused unit coverage

## Scope
- Inventory the current post-execute failure paths and automatic fixes across the active handoff flow:
  - genuine gate failure relaunch in `lib/commands/active.ts`
  - relaunch/error classification and prompt construction in `lib/commands/repair-handoff.ts`
  - the existing draft-only restart precedent in `lib/commands/draft.ts`
- Add regression coverage for the verification-gate case where captured output contains failing test names and stack traces.
- Change the relaunch prompt path so gate-failure/test-failure send-back instructions are distinct from incomplete-evidence / Goal Check repair instructions.
- Preserve the current 2-attempt relaunch cap and the existing post-relaunch `performHandoff(..., force: true)` retry contract in `runHandoffAndReview()`.
- Preserve the current dirty-artifact / behind-branch auto-repair flow in `repairHandoff()`.

## Out of Scope
- Fixing the underlying product regressions shown in the sample output (`getPrimaryBranch`, `missionStart`, `printIntegrationPreflight`, Forgejo-independence behavior). Those failing tests are reproduction input for the workflow prompt gap, not the target of this mission.
- Changing verification gate definitions, `scripts/verify-local.sh`, or the declared integration gate plan.
- Changing mission-start or integrate preflight semantics outside what is required to construct the relaunch prompt.
- Reworking the broader review-loop classifier/dispatch architecture beyond the active-path send-back behavior needed here.
- Adding new human-facing CLI flags or changing backlog state names.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- **SC1:** A new regression test at `test/task-1383-active-gate-failure-prompt.test.js` fails on the parent commit and passes after the mission. The red assertion must prove that a verification-gate failure currently relaunches with the wrong prompt shape by asserting the relaunched prompt still contains Goal Check / checkpoint-repair instructions for a failing-test payload.
- **SC2:** For a verification-gate failure payload that includes failing test names such as `missionStart fails if the backlog task is missing classification` and `printIntegrationPreflight branch failure`, the relaunch prompt passed to `startAgent('active', ...)` contains those failing test identifiers or the captured failure excerpt and includes an explicit instruction to fix the verification/test failure before retrying handoff.
- **SC3:** The same verification-gate relaunch prompt described in SC2 does not contain the Goal Check / `CP-N.md` checkpoint-editing instructions currently emitted by `buildRelaunchPrompt()` for incomplete-evidence errors.
- **SC4:** Incomplete-evidence failures remain on the existing path: a handoff error containing `has a "## Goal Check" section but no evidence rows` still produces a prompt that instructs the agent to update the final checkpoint Goal Check table, verified by an existing or updated unit test in `test/repair-handoff.test.js` or `test/active.test.js`.
- **SC5:** Dirty-artifact and behind-branch blockers remain auto-repairable without an agent relaunch. Existing repair-handoff tests for dirty/behind handling continue to pass unchanged.
- **SC6:** `runHandoffAndReview()` still enforces a maximum of 2 relaunch attempts for gate failures and still re-runs `performHandoff(slug, { forgejoUser: agent, worktree, force: true })` after each successful relaunch. Existing task-1387 coverage in `test/active.test.js` remains green.
- **SC7:** `./scripts/verify-local.sh static-analysis` passes on the final execution tree, satisfying the required `lib/` integration gate.

## Risks and Assumptions
- **Risk:** `buildRelaunchPrompt()` is currently shared by incomplete-evidence and gate-failure callers. A narrow change for gate failures could accidentally regress the older Goal Check repair flow. Mitigation: preserve or extend the existing tests that pin incomplete-evidence behavior.
- **Risk:** The captured gate output may be large or noisy. Assumption: the current truncation path in `buildRelaunchPrompt()` or its replacement remains sufficient for test output while still surfacing the failing test names.
- **Assumption:** `runHandoffAndReview()` in `lib/commands/active.ts` remains the single orchestration point for post-execute gate-failure relaunches, so the mission can stay localized to `active.ts`, `repair-handoff.ts`, and tests.
- **Risk:** Overfitting to the exact `Could not detect primary branch` sample could make the prompt builder too brittle. The implementation should key off failure class and captured verification output, not one specific stack trace.

## Checkpoints
- CP 1: Author the failing reproduction test in `test/task-1383-active-gate-failure-prompt.test.js`. Reproduction scenario: simulate `runHandoffAndReview()` or `attemptAgentRelaunch()` receiving a verification-gate failure whose `gateOutput` includes failing tests from the backlog transcript (`test/mission-start.test.js`, `test/forgejo-independence.test.js`, `test/task-1039-integrate-v3.test.js`). Red assertion on the parent commit: the prompt sent to the relaunched implementer still includes Goal Check / checkpoint-repair instructions instead of a state-aware fix prompt for the failing tests. Green assertion after the fix: the prompt cites the failing tests/output and instructs the agent to repair the verification/test failure.
- CP 2: Separate prompt behavior by failure class. Keep incomplete-evidence relaunch prompts checkpoint-focused, and make gate-failure relaunch prompts verification/test-failure-focused using the captured gate output.
- CP 3: Re-run the active-path regression suite and confirm the existing gate-failure retry limit plus dirty/behind auto-repair behavior still hold.
- CP 4: Run `./scripts/verify-local.sh static-analysis` and `./scripts/verify-local.sh all`, capture the results, and prepare handoff evidence.

Reproduction-Test: test/task-1383-active-gate-failure-prompt.test.js

## Gates
- [x] ./scripts/verify-local.sh static-analysis
- [x] ./scripts/verify-local.sh all

## Restricted Areas
- Do not fix `lib/core/mission-utils.ts`, `lib/commands/mission-start.ts`, or `lib/commands/integrate.ts` as part of this mission unless a minimal prompt-classification change requires reading data from them; the failing tests in the backlog transcript are not the target bug.
- Do not modify `scripts/verify-local.sh`, `config/integration-pipelines.json`, or gate definitions. This mission consumes gate output; it does not redefine gates.
- Do not remove or relax the 2-attempt relaunch limit added for genuine gate failures.
- Do not change backlog task ownership semantics, assignee handling, or unrelated review-loop state transitions.

## Stop Rules
- Stop if the reproduction test cannot be made deterministic with injected `performHandoff` / `startAgent` dependencies and would require live end-to-end gate execution to prove the bug.
- Stop if fixing the prompt mismatch requires changing the semantics of verification-gate detection, backlog state transitions, or `missionStart` / `integrate` product behavior rather than the send-back prompt path itself.
- Stop if preserving incomplete-evidence relaunch behavior and gate-failure relaunch behavior simultaneously is not possible without a broader classifier redesign; document that architectural blocker instead of shipping a partial regression.
- Stop if `./scripts/verify-local.sh static-analysis` fails for reasons unrelated to the mission diff on the final execution tree; capture the blocker and do not force the mission through the required gate.
