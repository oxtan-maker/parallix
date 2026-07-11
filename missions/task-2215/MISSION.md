# Mission: Fix missing error bounce for auto-remediation failure (task-2215)

## Goal

Restore the error-bounce mechanism so that when the handoff auto-checkpoint generation fails, the system classifies the failure as `MissingArtifacts` and auto-sends-back to the implementer agent for repair, instead of stranding the task with a `HumanOnly` infrastructure blocker message.

## Why Now

Task-2213's execute agent completed successfully but the automated handoff failed with `"No checkpoint documents found in ... even after auto-remediation. Implementation evidence is mandatory for review."` This error message does not match any pattern in `classifyError` (`lib/commands/repair-handoff.ts:68-138`), so it falls through to the default `InfraBlocker`/`HumanOnly` classification. Per ADR 0048, missing mandatory artifacts should be `MissingArtifacts` → `AutoSendBack`. The gap means the agent never receives a relaunch prompt, forcing manual operator intervention for what should be an automated recovery path.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: single classifier pattern gap in `repair-handoff.ts`; stale file reference in `handoff.ts` auto-checkpoint template; focused test coverage for both paths

## Scope
- Add a classification pattern in `lib/commands/repair-handoff.ts` that matches the auto-remediation failure message (`"even after auto-remediation"`) and returns `FailureClass.MissingArtifacts` / `DispatchAction.AutoSendBack`
- Fix the auto-generated checkpoint template in `lib/commands/handoff.ts` (`buildAutoCheckpointContent`) to reference `lib/commands/handoff.ts` (the actual TypeScript source) instead of `handoff.js` (which no longer exists), so the verifiable reference check passes
- Add a regression test for the classifier pattern in `test/repair-handoff.test.js`
- Add a regression test for the auto-generated checkpoint evidence validation in `test/handoff.test.js`

## Out of Scope
- Changing the `findCheckpoints` discovery logic in `lib/core/mission-utils/paths.ts`
- Modifying the auto-checkpoint generation flow (lines 255-279 of `handoff.ts`) — only the content template changes
- Changing the `classifyError` dispatch table or failure class definitions
- Modifying the `attemptAgentRelaunch` flow in `lib/commands/active.ts`
- Any changes to the gatekeeper, review, or integration pipelines

## Success Criteria
> **Falsifiability rule:** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- **SC1:** `classifyError("No checkpoint documents found in /some/path even after auto-remediation. Implementation evidence is mandatory for review.")` returns `{ failureClass: "MissingArtifacts", dispatchAction: "AutoSendBack" }`. Verified by a unit test in `test/repair-handoff.test.js` that asserts both `failureClass` and `dispatchAction` fields.
- **SC2:** `buildAutoCheckpointContent("task-XXXX")` produces a CP-1.md file whose Goal Check evidence rows pass the `findUnverifiableGoalCheckRow` validation in `lib/commands/handoff.ts:172-182`. Specifically, the evidence cell must cite a file:line reference that resolves to an existing file (e.g., `lib/commands/handoff.ts:262`). Verified by a unit test in `test/handoff.test.js`.
- **SC3:** The existing classifier test coverage in `test/repair-handoff.test.js` continues to pass: all 22 existing `classifyError` tests, all `isRelaunchableError` tests, and all `buildRelaunchPrompt` tests. No regression in the 8-class dispatch table.
- **SC4:** The existing handoff test coverage in `test/handoff.test.js` continues to pass: all existing `verifyHandoff`, `performHandoff`, `runDeclaredGates`, and `validateDeclaredGates` tests. No regression in the auto-checkpoint generation flow.
- **SC5:** `./scripts/verify-local.sh static-analysis` (ESLint + tsc --checkJs) reports zero errors on `lib/commands/repair-handoff.ts` and `lib/commands/handoff.ts`.
- **SC6:** `./scripts/verify-local.sh all` passes with 0 failing tests.

## Risks and Assumptions
- **Risk:** The error message format at `handoff.ts:267` may vary across code paths (e.g., different `fmt.path()` wrapping). Mitigation: the classifier pattern matches on the stable substring `"even after auto-remediation"` rather than the full message.
- **Assumption:** The `lib/commands/handoff.ts` file exists at the path referenced in the auto-generated checkpoint evidence. This is true in the current tree and is the canonical compiled source.
- **Assumption:** The `findCheckpoints` function in `lib/core/mission-utils/paths.ts` discovers `CP-1.md` files generated by `buildAutoCheckpointContent`. This is the existing behavior and is not being modified.
- **Risk:** The evidence cell format `lib/commands/handoff.ts:262` must match the file:line regex in `evidenceCellHasVerifiableReference` (`handoff.ts:119`). The regex `/[\w./-]+\.[\w-]+:(\d+)/` matches this format.

## Checkpoints
- CP 1: Author a failing reproduction test in `test/task-2215-missing-error-bounce.test.js` that verifies: (1) `classifyError` with the auto-remediation error message currently returns `InfraBlocker`/`HumanOnly` (red at parent commit, green after fix), and (2) `buildAutoCheckpointContent` produces evidence rows that fail `findUnverifiableGoalCheckRow` validation (red at parent, green after fix). The reproduction test file location: `test/task-2215-missing-error-bounce.test.js`. The assertions: (a) `classifyError(autoRemediationError).failureClass === FailureClass.InfraBlocker` before fix, `=== FailureClass.MissingArtifacts` after fix; (b) `findUnverifiableGoalCheckRow(evidenceRows, rootDir)` returns a non-null row before fix, `null` after fix.
- CP 2: Fix `classifyError` in `lib/commands/repair-handoff.ts` to recognize the `"even after auto-remediation"` error pattern and return `FailureClass.MissingArtifacts` / `DispatchAction.AutoSendBack`. Verify the reproduction test turns green for the classifier path.
- CP 3: Fix `buildAutoCheckpointContent` in `lib/commands/handoff.ts` to reference `lib/commands/handoff.ts:262` (existing TypeScript file) instead of `handoff.js` (non-existent). Verify the reproduction test turns green for the evidence validation path.
- CP 4: Run `./scripts/verify-local.sh static-analysis` and `./scripts/verify-local.sh all`. Verify all existing tests pass. Update the final checkpoint with real evidence for handoff.

Reproduction-Test: test/task-2215-missing-error-bounce.test.js

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `lib/commands/repair-handoff.ts:76` (must point to an existing file and line)
  2. **Test names** — e.g., `"classifyError recognizes auto-remediation failure as MissingArtifacts"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/task-2215-missing-error-bounce.test.js` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0048` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `./scripts/verify-local.sh static-analysis` ``, `` `node --test test/repair-handoff.test.js` ``, or `` `npm run typecheck` ``
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| classifyError recognizes auto-remediation failure | `lib/commands/repair-handoff.ts:76`, `"classifyError recognizes auto-remediation failure as MissingArtifacts"`, `test/task-2215-missing-error-bounce.test.js` | PASS |
| Auto-generated checkpoint evidence passes validation | `lib/commands/handoff.ts:842`, `"buildAutoCheckpointContent produces verifiable evidence rows"`, `test/task-2215-missing-error-bounce.test.js` | PASS |
| Static analysis gate passes | `./scripts/verify-local.sh static-analysis` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh static-analysis`
- [ ] `./scripts/verify-local.sh all`

## Restricted Areas
- `lib/core/mission-utils/paths.ts` — `findCheckpoints` discovery logic is out of scope
- `lib/commands/active.ts` — `attemptAgentRelaunch` flow is out of scope
- `lib/tools/gatekeeper.ts` — gatekeeper logic is out of scope
- `lib/review/review-commands.ts` — review pipeline is out of scope
- `backlog/tasks/task-2215 - missing-error-bounce.md` — do not modify the `assignee` field; the workflow records ownership itself
- `config/integration-pipelines.json` — gate configuration is out of scope
- `prompts/` — prompt templates are out of scope

## Stop Rules
- Do not implement any changes beyond the classifier pattern fix and the auto-checkpoint template fix
- Do not modify `findCheckpoints`, `attemptAgentRelaunch`, or any gatekeeper/review/integration code
- Do not add new failure classes or dispatch actions to the classifier — only add a new pattern mapping to existing `MissingArtifacts`/`AutoSendBack`
- Do not change the auto-checkpoint generation flow (lines 255-279 of `handoff.ts`) — only change the content produced by `buildAutoCheckpointContent`
- Do not edit the `assignee` field in the backlog task file
- Do not run `px review`, `px integrate`, or any workflow command beyond `./scripts/verify-local.sh all`