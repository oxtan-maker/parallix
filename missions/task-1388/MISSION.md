# Mission: Auto-send-back missing mandatory artifacts when gatekeeper blocks handoff (task-1388)

## Goal

When the gatekeeper posts pushback on a handoff due to missing mandatory artifacts (Control C5 from ADR 0048), the handoff flow in `lib/commands/handoff.ts` detects the pushback condition, generates an explicit artifact-creation prompt listing exactly which files are missing, and attempts an automated agent relaunch with that prompt — bounded by a configurable retry limit (default 2) to prevent infinite loops when artifacts genuinely cannot be created.

## Why Now

ADR 0048 classifies this as Control C5 and schedules it as the fourth control in the implementation sequence (C3 → C2 → C1 → C5), after the error classifier (task-1389), gate-failure auto-send-back (task-1387), and pre-review gate enforcement (task-1385). The auto-checkpoint generation at `handoff.ts:104-128` already handles the most common missing-artifact case (no CP-*.md), but the remaining gatekeeper-detected cases — missing MISSION.md at the mission level, missing backlog task file — still strand the task in `active` with only a Forgejo request-changes comment. This leaves a gap where the implementer agent never receives an automated relaunch with explicit instructions, forcing human intervention.

## Refinement Signals

- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: ADR 0048 C5 explicitly schedules this as backlog-tracked implementation; the gatekeeper pushback path (`handoff.ts:329-344`) is a known gap with a clear fix target; C3/C2/C1 upstream controls are already merged or near-merge.

## Scope

- Modify `lib/commands/handoff.ts` to handle the `gatekeeperPushedBack: true` return case by generating an artifact-creation prompt and attempting agent relaunch (same `attemptAgentRelaunch` pattern used for genuine gate failures at `handoff.ts:460-486` and `active.ts:460-486`).
- Extend `lib/tools/gatekeeper.ts` `buildPushbackBody()` to include explicit artifact-creation instructions (e.g., "create MISSION.md with the standard mission contract template" and "create a backlog task file at `backlog/tasks/<slug> - <title>.md` with frontmatter and description").
- Add a bounded retry mechanism to the gatekeeper-pushback relaunch path, defaulting to 2 attempts, configurable via an option parameter.
- Update `lib/commands/active.ts` `runHandoffAndReview()` to route gatekeeper-pushback failures through the relaunch path alongside the existing genuine-gate-failure relaunch.
- Add or extend tests in `test/handoff.test.js` and `test/gatekeeper.test.js` to cover the new relaunch behaviors.

## Out of Scope

- Modifying `lib/tools/gatekeeper.ts` `checkMandatoryFiles()` — the artifact detection logic is correct and in scope for this mission.
- Modifying `lib/commands/repair-handoff.ts` — the error classifier (task-1389, C3) is a separate mission.
- Modifying the Forgejo `postReview` call or the pushback comment format beyond adding artifact-creation instructions.
- Changes to `lib/tools/forgejo.ts` or `lib/tools/setup-review.ts`.
- Pre-review-round gate enforcement (task-1385, C1) — upstream dependency.
- Gate-failure auto-send-back (task-1387, C2) — upstream dependency.

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

- SC1: When `performHandoff()` receives `{ ok: true, gatekeeperPushedBack: true }`, it invokes `attemptAgentRelaunch()` with a prompt that lists every item from `gatekeeperResult.missing` and provides explicit creation instructions for each. Verified by a test that mocks `attemptAgentRelaunch` and asserts the prompt string contains each missing artifact path and a creation instruction keyword (e.g., "create" or "write").
- SC2: The relaunch loop respects a configurable retry limit. Default is 2 attempts. Verified by a test that mocks `attemptAgentRelaunch` to always return `{ relaunched: true }` and asserts that `performHandoff` calls it at most 2 times before returning `{ ok: false, error: "..." }`.
- SC3: When `attemptAgentRelaunch` returns `{ relaunched: true }` and the subsequent `performHandoff` call succeeds, the handoff proceeds to the review transition (no error returned). Verified by a test that mocks `attemptAgentRelaunch` to succeed on the first retry and asserts `result.ok === true`.
- SC4: `buildPushbackBody()` includes artifact-creation instructions for each missing artifact type (MISSION.md, CP-*.md, backlog task file). Verified by a test asserting the returned body string contains creation keywords for each artifact type present in the missing list.
- SC5: All existing tests in `test/handoff.test.js` and `test/gatekeeper.test.js` pass without modification (no regressions). Verified by running `node --test test/handoff.test.js test/gatekeeper.test.js` and confirming exit code 0.
- SC6: Static analysis (`./scripts/verify-local.sh static-analysis`) passes cleanly on the final tree.

## Risks and Assumptions

- **Risk:** Agent relaunch could loop indefinitely if the agent consistently fails to create the missing artifacts. Mitigation: bounded retry limit (default 2), configurable via option. After exhausting retries, the error message clearly states that manual intervention is required and lists the remaining missing artifacts.
- **Risk:** The `attemptAgentRelaunch` function may not be designed to handle gatekeeper pushback prompts (it was built for genuine gate failures). Mitigation: review the function's prompt handling path; if it needs adaptation, scope the change narrowly to the relaunch prompt builder or the relaunch dispatcher.
- **Assumption:** The error classifier (task-1389, C3) has been implemented or is available, providing the dispatch framework that distinguishes gatekeeper pushback from other error classes. If not, this mission wires the relaunch directly into the gatekeeper-pushback return path without the classifier.
- **Assumption:** The Forgejo token for the gatekeeper user is available, so the pushback was successfully posted. If the token is missing (`skipped: true`), the existing behavior (hard-fail with error message) is preserved.
- **Assumption:** The implementer agent has execution context available (the same context that `attemptAgentRelaunch` uses). If not, the relaunch attempt fails gracefully and the error propagates to the caller.

## Checkpoints

- CP 1: `buildPushbackBody()` in `lib/tools/gatekeeper.ts` is extended to include explicit artifact-creation instructions for each missing artifact type. Test in `test/gatekeeper.test.js` asserts the new instruction content.
- CP 2: `lib/commands/handoff.ts` is updated to handle the `gatekeeperPushedBack: true` case by invoking `attemptAgentRelaunch()` with bounded retries (default 2). Tests in `test/handoff.test.js` cover the relaunch path, the retry limit, and the success-after-relaunch path.
- CP 3: `lib/commands/active.ts` `runHandoffAndReview()` routes gatekeeper-pushback failures through the relaunch path. Integration test in `test/handoff.test.js` or `test/repair-handoff.test.js` verifies end-to-end behavior.

## Gates

- [ ] ./scripts/verify-local.sh docs
- [ ] ./scripts/verify-local.sh static-analysis
- [ ] ./scripts/verify-local.sh test-hygiene

## Restricted Areas

- `lib/tools/gatekeeper.ts` `checkMandatoryFiles()` — do not modify artifact detection logic.
- `lib/commands/repair-handoff.ts` `repairHandoff()` and `isRelaunchableError()` — do not modify the error classifier (task-1389 scope).
- `lib/tools/forgejo.ts` — do not modify Forgejo API interactions.
- `lib/core/verification.ts` — do not modify verification gate execution.

## Stop Rules

- Stop if the `attemptAgentRelaunch` function requires changes beyond passing a new prompt string (indicating a deeper architectural change that belongs to the C3 error classifier mission).
- Stop if the bounded retry mechanism requires modifying more than 3 files (indicating scope creep).
- Stop if any existing test in `test/handoff.test.js` or `test/gatekeeper.test.js` fails without a clear code-level cause (indicating unintended regression).
- Stop if static analysis (`./scripts/verify-local.sh static-analysis`) cannot be brought to clean after 3 fix attempts.
