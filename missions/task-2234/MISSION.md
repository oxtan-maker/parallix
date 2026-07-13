# Mission: Auto-bounce failed reviewer pushes for invalid gates (task-2234)

## Goal
When a push-to-reviewer attempt fails because a declared verification gate is invalid, automatically return the mission to the workflow state where the gate can be corrected and surface the rejection reason, instead of leaving the push provider as a terminal failure.

## Why Now
The current reviewer-push flow reports a verification-gate failure for a gate entry with explanatory suffix text (for example, `true — some description`), but does not auto-bounce the mission for repair. This strands a workflow run even though the defect is actionable and the gate-format rule is already covered by a failing handoff test.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is; the observed failure identifies the invalid gate form and the missing transition.
- Main drivers: reviewer-push failure handling, declared-gate validation, and a regression test for the bounce transition.

## Scope
- Add a regression test at `test/task-2234-push-to-reviewer-autobounce.test.js` that reproduces a reviewer-push attempt with an invalid explanatory-suffix gate.
- Update the reviewer-push failure path so an invalid declared gate that blocks verification auto-bounces the mission into the repairable workflow state and preserves a clear rejection reason.
- Keep declared-gate validation strict: gate checklist entries must be exact runnable repository commands, with no explanatory dash suffix.
- Add focused test coverage for both the strict rejection and the resulting auto-bounce behavior.
- ensure ADR 0048 review bounces are not left uninmplemented
- Fix `resolveMaxConcurrentCustom` default from `Infinity` to `1` (`lib/core/product-config.ts:505`) to repair the red baseline test `test/agents.test.js:64` ("custom capacity saturation selects an eligible non-custom agent") and make the custom-agent concurrency limit meaningful by default.

## Out of Scope
- Changing which repository commands are valid verification gates beyond rejecting explanatory suffixes.
- Altering successful reviewer-push behavior, reviewer assignment, or review-content generation.
- Retrying failed verification commands, changing integration-gate policy, or repairing unrelated workflow state transitions.
- Reformatting existing mission contracts or backlog tasks unrelated to TASK-2234.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- A gate checklist entry containing an explanatory suffix such as `true — some description` is rejected as a declared-gate validation error; the existing `runDeclaredGates rejects explanatory dash suffixes` coverage remains green.
- A reviewer-push attempt blocked by that invalid gate automatically moves the mission from the failed push path to the defined repairable state, with the validation failure available to the next workflow action.
- A regression test at `test/task-2234-push-to-reviewer-autobounce.test.js` is red against the mission parent commit for the invalid-gate reviewer-push scenario and green after the implementation.
- The normal repository verification gate completes successfully without introducing focused tests or unannotated skipped tests.

## Risks and Assumptions
- Assumption: invalid gate declarations are user-correctable workflow input and therefore should bounce rather than be treated as an infrastructure failure.
- Risk: broad failure matching could bounce legitimate provider or infrastructure errors; limit the transition to the declared-gate validation failure classification.
- Risk: changing the bounce target can disrupt downstream workflow invariants; confirm the chosen state and its allowed next action through existing handoff transition tests.
- Risk: the rejection reason may be lost when state is changed; test that the follow-up workflow action can identify the invalid gate and correct it.

## Checkpoints
- CP 1: Author the failing reproduction test before any production change. Create `test/task-2234-push-to-reviewer-autobounce.test.js` to set up a reviewer-push attempt whose mission gate is `true — some description`; assert that, at the mission parent commit, the attempt fails to auto-bounce into the repairable state (red), and after the fix the same attempt reaches that state with the invalid-gate rejection reason retained (green).
- CP 2: Trace the declared-gate validation error through the reviewer-push failure handler and implement the narrow auto-bounce transition only for this validation classification.
- CP 3: Add or extend focused handoff coverage for strict explanatory-suffix rejection and the repairable-state transition, then run the mission gate and record the final Goal Check evidence.

Reproduction-Test: test/task-2234-push-to-reviewer-autobounce.test.js

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- Start with a concise summary of the checkpoint work.
- Use the exact heading `## Goal Check`.
- Under that heading, include the exact three-column table header `| Criterion | Evidence | Status |` and one evidence row for every Success Criterion.
- Use evidence Parallix recognizes today: file:line references, exact test names, ADR references, test file paths, and recognized repository commands or paths such as backticked `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`.
- For this mission, cite `test/task-2234-push-to-reviewer-autobounce.test.js`, the exact test name(s), the changed workflow file:line reference(s), and the executed `./scripts/verify-local.sh all` command where applicable.
- Raw `stat`/`ls` output or generic prose alone is not enough. It may be supplemental, but pair every such claim with an accepted reference above; this prevents weak-agent evidence from being mistaken for verification.
- End with a concrete `Next action:` line naming the next implementation, verification, or handoff action.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md:28` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.js`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not alter unrelated workflow transitions, reviewer assignment rules, integration-pipeline configuration, or verification commands.
- Do not weaken declared-gate syntax to accept prose-bearing checklist items.
- Do not modify backlog ownership (`assignee`) or task status as part of implementation.

## Stop Rules
- Stop and request direction if the invalid-gate failure cannot be distinguished from provider, network, or repository-command execution failures without changing their behavior.
- Stop and request direction if the existing state machine has no repairable transition target for a rejected reviewer push.
- Stop and request direction if preserving the rejection reason requires a schema migration or changes to persisted workflow data outside the reviewer-push path.
- Do not proceed to review or integration until the reproduction test has demonstrated the red-to-green behavior and the required gate has passed.
