# Mission: Fix backlog classification control to accept optional bug label (task-2200)

## Goal
Update the backlog classification control to accept tasks labeled with both a primary classification (`ai_sdlc` or `user_value`) and the optional `bug` label, and ensure classification resolution uses the correct worktree context instead of defaulting to the primary branch.

## Why Now
The classification control was not updated when the optional `bug` label was introduced (per draft policy in backlog task-1431). This causes the control to reject valid label combinations such as `[ai_sdlc, bug]` or `[user_value, bug]` even though `bug` is a permitted secondary label. Additionally, classification resolution in some workflow paths defaults to `process.cwd()` or the primary branch instead of the mission's base worktree, causing false classification failures when the backlog task exists in a different worktree context.

## Refinement Signals
- Predicted NEL bucket: Small (0-80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: classification validation logic in lib/tools/backlog.ts and lib/commands/stats.ts; workflow context resolution in lib/commands/mission-start.ts

## Scope
- Update classification validation in `lib/tools/backlog.ts` to accept tasks with a primary classification (`ai_sdlc` or `user_value`) plus the optional `bug` label, ensuring `getTaskClassification` and `CLASSIFICATION_LABELS` logic correctly handles the `bug` label as a non-classification secondary label.
- Update classification resolution calls in `lib/commands/mission-start.ts` to use the resolved base worktree context instead of `process.cwd()` when available, ensuring consistency with the integration preflight path already fixed in task-1431.
- Ensure `resolveMissionClassification` and `getTaskClassification` functions correctly identify the primary classification label when `bug` is also present in the task's labels array.
- Update or add test coverage in `test/mission-start.test.js` to verify classification resolution with `bug` label combinations.

## Out of Scope
- Changing the meaning or semantics of the `bug` label itself.
- Modifying the integration preflight path in `lib/commands/integrate.ts` (already addressed by task-1431).
- Adding new classification label values beyond `ai_sdlc`, `user_value`, `unknown`, and `bug`.
- Redesigning the backlog task label schema or frontmatter structure.
- Modifying review, draft, or closeout workflow behavior.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- Tasks with labels `[ai_sdlc, bug]` return `ai_sdlc` as classification from `getTaskClassification()` at lib/tools/backlog.ts:644-652.
- Tasks with labels `[user_value, bug]` return `user_value` as classification from `getTaskClassification()`.
- Tasks with labels `[ai_sdlc]` continue to return `ai_sdlc` as classification (regression protection).
- Tasks with labels `[user_value]` continue to return `user_value` as classification (regression protection).
- Tasks with labels `[bug]` alone return `null` as classification (bug is not a valid primary classification).
- Tasks with labels `[ai_sdlc, user_value]` return `null` as classification (exactly one primary classification required).
- `mission-start` resolves classification from the correct worktree context: classification resolution calls at lib/commands/mission-start.ts:148 and lib/commands/mission-start.ts:161 pass the resolved base worktree or mission context instead of relying on `process.cwd()` when a worktree can be determined.
- Existing tests in `test/mission-start.test.js` pass without modification for classification scenarios that do not involve the `bug` label.

## Risks and Assumptions
- The classification logic in `getTaskClassification` already filters labels through `CLASSIFICATION_LABELS` which excludes `bug`, so the fix may be limited to ensuring worktree context is passed correctly in all call sites.
- The primary risk is that other code paths may depend on the current behavior of defaulting to `process.cwd()`; changing this may require updates to callers or tests.
- Assumes that `bug` is strictly a secondary label and never a valid primary classification on its own.
- Assumes that no existing tasks rely on having multiple primary classification labels (e.g., `[ai_sdlc, user_value]`).

## Checkpoints
- CP 1: Author a failing reproduction test that locks the bug, demonstrating that tasks with `[ai_sdlc, bug]` or `[user_value, bug]` labels fail classification validation when they should pass, or that classification resolution uses the wrong root directory. The test file is at `test/task-2200-classification-bug-label.test.js` and the failing assertion must match the classification error or wrong-root symptom at the mission parent commit.
- CP 2: Update classification validation logic in `lib/tools/backlog.ts` and ensure worktree context is passed correctly in `lib/commands/mission-start.ts` so the reproduction test goes green.
- CP 3: Verify regression protection: tasks with single primary classifications and tasks without `bug` label continue to work correctly.
- CP 4: Run static analysis gate and confirm all classification-related tests pass.

Reproduction-Test: test/task-2200-classification-bug-label.test.js

## Gates
- [ ] ./scripts/verify-local.sh static-analysis

## Restricted Areas
- Do not change the set of valid primary classification labels (`ai_sdlc`, `user_value`, `unknown`) in `CLASSIFICATION_LABELS` or `VALID_CLASSIFICATIONS`.
- Do not modify the semantics of the `bug` label in the review or integration workflows.
- Do not add new frontmatter fields for mission type classification.
- Do not weaken validation for ambiguous slug or missing task scenarios.
- Do not modify `lib/commands/integrate.ts` classification resolution (already correct per task-1431).

## Stop Rules
- Stop if any existing classification test in `test/mission-start.test.js` or `test/integrate.test.js` fails after the changes.
- Stop if tasks with only a primary classification label (no `bug`) stop working correctly.
- Stop if the change requires adding `bug` to `CLASSIFICATION_LABELS` or `VALID_CLASSIFICATIONS` sets (bug is a secondary label, not a primary classification).
- Stop if the fix broadens scope beyond classification validation and worktree context resolution.
