# Mission: regression-test-first lock-the-bug for bug-labeled missions (task-1354)

## Goal

Require any mission whose backlog task has `bug` as an **optional modifier label** (orthogonal to the `ai_sdlc`/`user_value` classification) to author and commit a failing reproduction test before the fix, then mechanically prove red→green. The draft prompt instructs bug missions to (a) specify the reproduction test as the first checkpoint and (b) **declare a red→green proof gate in the generated mission's own `## Gates` section**.

Enforcement is **declarative, not hardcoded**: a generic gate runner executes whatever gates a mission declares in `## Gates`. Bug missions declare a red→green gate line; non-bug missions do not, so they are unaffected without any special-case skip logic in shared code. The gate line invokes a generic, reusable red→green proof command that runs the declared reproduction test at the mission parent commit (expecting red/failure) and at HEAD (expecting green/success), exiting non-zero if either condition is unmet. **No `bug`-specific gate function or branch is added to `lib/tools/gatekeeper.js` or `lib/commands/handoff.js`, and the shared `prompts/execute.md` template is not modified** — the repro-before-fix requirement reaches the executor through the drafted MISSION.md, not the global execute prompt.

**Label model:** `bug` is a modifier, not a classification. A task has exactly one classification (`ai_sdlc`, `user_value`, or `unknown`) plus zero or more modifier labels (`bug`, etc.). Example: `labels: [ai_sdlc, bug]` is valid. A task with only `labels: [bug]` and no classification label is invalid — the classification is still required.

## Why Now

Bug-reduction initiative #3. Fixes currently don't always stick — TASK-1317 was minted twice and the same "task-id recycling collision" class recurred (TASK-1319/1322), the signature of fixing forward without a locking test. Prompts alone are not trusted — per the hallucinated-gate class (TASK-1306/1335), enforcement must live in the gate. Estimated 10-15% reduction concentrated on recurring/expensive bugs. This mission pairs with mutation-score ratchet (TASK-1269) so the repro can't be a trivially-passing shallow test.

## Label Model Change (Breaking-Safe Addition)

Before this mission, adding `bug` to a task's labels would break the classification pipeline because `getTaskClassification()` returned null when more than one classification-matching label was present. This mission fixes that by:

1. **`lib/tools/backlog.js`**: `getTaskClassification()` ignores non-classification labels (including `bug`) when counting matches. Only `ai_sdlc`, `user_value`, and `unknown` are classification labels. A `bug` label does not count toward the "exactly one classification" rule.
2. **`lib/tools/backlog.js`**: New `hasBugLabel(taskFilePath)` helper checks for the presence of `bug` in labels, independent of classification.
3. **`lib/commands/draft.js`**: Classification instructions allow `bug` as an additional label alongside `ai_sdlc` or `user_value`. The error message no longer says "no other value" — it says "no other classification value" and explicitly permits `bug`.
4. **`lib/commands/stats.js`**: `VALID_CLASSIFICATIONS` is unchanged (`ai_sdlc`, `user_value`, `unknown`). The `bug` label never enters the stats pipeline as a classification.

**Backward compatibility:** Existing tasks with `labels: [ai_sdlc]` or `labels: [user_value]` behave identically. Tasks with `labels: [ai_sdlc, bug]` now classify as `ai_sdlc` (previously would return null). No existing behavior changes — only new valid combinations are enabled.

## Scope

- **`lib/tools/backlog.js`**:
  - Factor out a single shared label-parsing primitive (e.g. `getTaskLabels(taskFilePath)`) that returns the full lowercased label list from both block and inline frontmatter formats. `getTaskClassification()` and `hasBugLabel()` must both consume this primitive — do **not** re-implement block+inline parsing in each function (the current `hasBugLabel` copy-paste of the parser is the anti-pattern this mission must avoid).
  - Modify `getTaskClassification()` to only count `ai_sdlc`, `user_value`, and `unknown` as classification labels. Non-classification labels like `bug` are ignored for classification purposes.
  - Add `hasBugLabel(taskFilePath)` function that returns `true` if the task has a `bug` label in its frontmatter, built on the shared primitive.
  - Export the shared primitive and `hasBugLabel` from the module.

- **`lib/commands/draft.js`**:
  - Update `resolveClassificationInstructions()` to say: "set exactly one of `ai_sdlc` or `user_value` in the Backlog task labels — plus optionally `bug` for bug-fix missions. Use `ai_sdlc` for workflow, prompt, or agent-fix work; use `user_value` for everything else (including code tech debt). Do not add a separate frontmatter field for mission type."
  - Update `buildRestartPrompt()` to say: "update the backlog task so labels contain exactly one of `ai_sdlc` or `user_value` (plus optionally `bug` if this is a bug fix)."

- **Draft prompt** (`prompts/draft.md`): Add a conditional section that triggers when the backlog task has a `bug` label (checked via `{{hasBugLabel}}` or equivalent). The section instructs the mission drafter to author a failing reproduction test as the first checkpoint, describing the test location, the reproduction scenario, and the expected failure at the parent commit. This is a prompt-only change — no code execution.

- **Execute prompt** (`prompts/execute.md`): **No change.** The shared execution template must not carry bug-specific instructions. The repro-before-fix requirement reaches the executor through the bug mission's own drafted MISSION.md (its first checkpoint and its declared `## Gates` line), authored by the draft prompt — not through the global execute template.

- **Generic gate runner** (`lib/commands/handoff.js` / wherever gates are executed): Make the mission's `## Gates` section machine-enforced by a generic runner that parses the declared gate commands and executes them, failing handoff if any declared gate exits non-zero. The runner is mission-agnostic — it has no knowledge of `bug`, classification, or red→green; it only runs whatever the mission declares.

- **Generic red→green proof command** (a reusable CLI subcommand / script, e.g. `px verify-repro --test <path>`): A mission-agnostic command that:
  1. Takes the reproduction-test path as an argument (the bug mission declares it in its `## Gates` line).
  2. Resolves the mission parent commit (the commit before the mission branch diverged).
  3. Runs the reproduction test at the parent — it must fail (red).
  4. Runs the reproduction test at HEAD — it must pass (green).
  5. Exits non-zero with a descriptive error if either condition is unmet.
  - This command contains **no `bug`-label branching**. It is invoked only because a mission declared it as a gate. There is **no `verifyRedGreenProof` function and no bug-specific step inserted into `gatekeeper.js` or `handoff.js` control flow**.

- **Draft prompt** (`prompts/draft.md`): For bug-labeled missions, the draft prompt instructs the drafter to (a) make the failing reproduction test the first checkpoint, and (b) add the red→green gate line to the generated MISSION.md `## Gates` section, pointing the generic proof command at the reproduction-test path. Non-bug missions get no such gate line.

- **Regression test**: Tests covering:
  - the shared label primitive parses both block and inline formats
  - `getTaskClassification()` returns `ai_sdlc` for `labels: [ai_sdlc, bug]` (not null)
  - `hasBugLabel()` returns `true` for `labels: [ai_sdlc, bug]` and `false` for `labels: [ai_sdlc]`
  - the generic gate runner executes a mission's declared `## Gates` and fails handoff when a declared gate exits non-zero
  - the generic red→green proof command: passes on a real red→green test, fails when the test is missing, and fails when the test already passes at the parent commit

## Out of Scope

- Changes to mutation-score ratchet (TASK-1269) — that mission is separate.
- Changes to the session marker system (TASK-1322) or any unrelated bug class.
- Changes to the Forgejo PR creation/update flow in `handoff.js` beyond what is needed to surface a declared-gate failure.
- Changes to the gatekeeper's existing mandatory-files check (`checkMandatoryFiles`) — it is untouched; the gate runner is a separate, additive step.
- Any `bug`-specific gate function, branch, or step in `gatekeeper.js`/`handoff.js`, and any change to `prompts/execute.md` — both are explicitly rejected approaches.
- Support for non-bug missions — they are explicitly unaffected per AC#5.
- Repos without a declared test runner/gate — they are skipped per AC#5.
- Adding new classification labels beyond `ai_sdlc`, `user_value`, `unknown`, and `bug` (future-proofing: the design allows arbitrary non-classification modifier labels, but only `bug` is recognized for the red→green gate).

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

1. **`getTaskClassification()` ignores `bug`**: For a task with `labels: [ai_sdlc, bug]`, `getTaskClassification()` returns `'ai_sdlc'` (not null). Verified by unit test in `test/backlog.test.js`.

2. **`hasBugLabel()` helper works**: `hasBugLabel()` returns `true` for tasks with `bug` in labels (block or inline format) and `false` for tasks without it. Verified by unit test in `test/backlog.test.js`.

3. **Draft prompt allows `bug` alongside classification**: `resolveClassificationInstructions()` output includes text permitting `bug` as an optional label. Verified by reading `lib/commands/draft.js` and confirming the instruction text.

4. **Non-bug classification unchanged**: Tasks with `labels: [ai_sdlc]` or `labels: [user_value]` classify identically as before. Verified by regression test in `test/backlog.test.js`.

5. **Draft prompt includes bug-repro instruction**: `prompts/draft.md` contains a conditional section (triggered when `bug` label is present) that requires the drafter to author a failing reproduction test. Verified by reading `prompts/draft.md`.

6. **Execute prompt unchanged**: `prompts/execute.md` has no bug-specific content; `git diff` against the parent branch shows zero changes to that file. The repro-before-fix requirement is present instead in the drafted bug mission's MISSION.md.

7. **Declarative gate runner**: A generic runner executes a mission's `## Gates` entries and fails handoff when any declared gate exits non-zero, with no knowledge of `bug`/classification/red→green. Verified by unit test that feeds it a mission with a failing declared gate.

8. **Generic red→green proof command**: A reusable command runs the declared reproduction test at the parent commit (expecting failure) and at HEAD (expecting success), and exits non-zero when the test is missing or already passes at the parent. Verified by unit tests for the pass case, missing-test case, and passes-at-parent case. No `verifyRedGreenProof` symbol exists in `gatekeeper.js`.

9. **Non-bug missions unaffected by construction**: Missions without the `bug` label never declare a red→green gate line, so the gate simply does not run — there is no skip flag or bug-branch in shared code. Verified by `git diff` showing no bug-specific branch in `gatekeeper.js`/`handoff.js` and a test confirming a mission with no such gate line runs no red→green proof.

10. **All existing tests pass**: `npm test` completes with 0 failures after the changes.

## Risks and Assumptions

- **Assumption**: The reproduction-test path is declared explicitly by the bug mission in its `## Gates` line (authored by the draft prompt). The generic proof command takes it as an argument — it does not have to guess the path from checkpoints or acceptance criteria.
- **Assumption**: The mission branch has a clean divergence point from the parent (primary) branch that the proof command can checkout. If the worktree setup produces an ambiguous merge base, the command must fail gracefully with an error.
- **Risk**: Some repos may not have a test runner configured. The proof command must detect this and fail with a clear, actionable message rather than a confusing crash.
- **Risk**: The reproduction test itself could be poorly written (e.g., flaky, or passing at parent due to unrelated state). The command only checks pass/fail — it does not validate test quality. Quality is a reviewer concern.
- **Assumption**: The `bug` label on the backlog task is reliable and is what causes the draft prompt to author the gate line. If a mission is mislabeled, the gate line is authored or omitted incorrectly. This is an operational/drafting risk, not shared-code risk.
- **Risk**: Running the proof adds latency to handoff (two extra test runs: parent + HEAD). For large test suites this could be noticeable. Mitigation: the command runs only the specific reproduction test, not the full suite.
- **Assumption**: The classification system remains strictly `ai_sdlc` / `user_value` / `unknown`. `bug` is a modifier, not a classification, and never enters the stats pipeline.

## Checkpoints

- CP 1: `lib/tools/backlog.js` updated — shared label-parsing primitive extracted; `getTaskClassification()` ignores `bug` label and `hasBugLabel()` both built on it; exported.
- CP 2: `lib/commands/draft.js` updated — classification instructions permit `bug` as optional modifier.
- CP 3: Draft prompt (`prompts/draft.md`) updated so bug missions make the repro test the first checkpoint AND declare the red→green gate line in the generated MISSION.md `## Gates`. `prompts/execute.md` is NOT modified.
- CP 4: Generic `## Gates` runner enforces declared gates at handoff; generic red→green proof command implemented (runs repro at parent → red, at HEAD → green). No `verifyRedGreenProof` and no bug-branch in `gatekeeper.js`/`handoff.js`.
- CP 5: Regression tests covering the shared label primitive, classification with `bug` label, `hasBugLabel()` behavior, the gate runner, and the red→green proof command cases. All existing tests still pass.

## Gates

- [ ] ./scripts/verify-local.sh docs
- [ ] npm test passes with 0 failures

## Restricted Areas

- Do not modify `prompts/draft.md` outside the bug-labeled conditional section. The rest of the prompt template must remain unchanged.
- Do not modify `prompts/execute.md` at all. The shared execution template carries no bug-specific content.
- Do not modify the gatekeeper's existing `checkMandatoryFiles` function or `runGatekeeper` control flow, and do not add any `bug`-specific gate function (e.g. `verifyRedGreenProof`) or branch to `gatekeeper.js`.
- Do not modify `lib/commands/handoff.js` beyond adding the generic, mission-agnostic `## Gates` runner step. The handoff orchestration (PR creation, backlog transition, rebase) is untouched, and the runner contains no `bug`/red→green branching.
- Do not change `VALID_CLASSIFICATIONS` in `lib/commands/stats.js` — it must remain `ai_sdlc`, `user_value`, `unknown`.
- Do not change the label format — `bug` must remain a string label in the backlog task frontmatter.

## Stop Rules

- Stop if the `bug` label cannot be reliably detected from the backlog task frontmatter (e.g., inconsistent formatting across tasks). Document the detection logic and stop after fixing the most common case.
- Stop if the reproduction-test path convention for the `## Gates` line cannot be made unambiguous. Document the exact gate-line format the draft prompt must author and the proof command must parse, and stop after pinning the convention.
- Stop if adding the generic `## Gates` runner breaks an existing handoff flow for missions that declare no gates — that path must remain identical to current behavior.
- Stop if `getTaskClassification()` starts returning null for existing tasks that previously classified correctly — the classification change must be backward-compatible.
