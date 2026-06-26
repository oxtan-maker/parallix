# Mission: sharpen review prompt to prevent reviewer from becoming implementer (task-1325)

## Goal

Sharpen the review agent prompt (`prompts/review.md` and `prompts/review-verbose.md`) so reviewer agents reliably stay in review-only mode — reporting findings without implementing fixes — while still permitting the narrow subset of file writes the workflow requires (artifacts, findings, outcomes, verdicts). Additionally, audit the worktree-related errors surfaced during task-1322's review attempt and add clarifying notes to the prompt or workflow where worktree state caused confusion.

## Why Now

During task-1322, qwen was selected as the reviewer agent. The agent "went ballistic" — it started fixing code instead of reviewing, violating the separation-of-duties contract. The prompt's current constraint ("No code changes, no repo-state edits" + "Do not edit repo files") was either too terse or ambiguous enough that the agent conflated review with implementation. Meanwhile, task-1308 already tackled the broader contract clarity issue, but the specific "reviewer must not implement" boundary was not explicitly called out. This risk compounds because every mission goes through review, and a misbehaving reviewer silently corrupts the branch under the guise of review.

## Refinement Signals

- Estimated agent % usage limit: 25-50%
- Confidence: High
- Selection note: activate as-is
- Main drivers: reviewer agent violated review-only contract in task-1322; prompt gap identified in live execution logs; task-1308 addressed structural clarity but not the implementer-boundary explicitly

## Scope

- Edit `prompts/review.md` (compact prompt used in autonomous review loop) to add an explicit "separation of duties" section that enumerates:
  - What the reviewer MUST NOT do (write code, fix bugs, modify mission artifacts, rebasing, squashing, pushing, merging, modifying workflow state files beyond review artifacts)
  - What the reviewer MUST DO (run verification commands, inspect diffs, write findings/outcome/verdict artifacts, report inconsistencies)
  - What the reviewer MAY do (write files to the configured artifact directory, create temporary diagnostic files in `/tmp`)
- Edit `prompts/review-verbose.md` (manual/dry-run variant) with the same separation-of-duties clarification
- Audit worktree-related errors from task-1322 review attempt (remote "review" not configured, worktree-dependent branch cannot be deleted) and add a brief "known limitations" note in the prompt if relevant, or file a separate backlog observation
- Update `test/review-prompts.test.js` to assert the new separation-of-duties language is present in generated prompts
- Update `lib/review/review-prompts.js` tests if any prompt content assertions need adjustment

## Out of Scope

- Modifying the review loop orchestration logic in `lib/review/review-loop.js`
- Changing the act-on-review prompts (`prompts/act-on-review.md`, `prompts/act-on-review-verbose.md`)
- Fixing worktree branch deletion or remote configuration (these are infra/harness issues; log observations only)
- Modifying agent launcher code (`lib/agents/`) or runtime matrix configuration
- Changes to `AGENTS.md` or `parallix/README.md`

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

1. The compact review prompt (`prompts/review.md`) contains an explicit "Separation of Duties" or equivalent section that lists at least 5 distinct "must not" items covering code edits, branch operations, PR operations, workflow state mutations, and merge/squash actions.
2. The verbose review prompt (`prompts/review-verbose.md`) contains matching separation-of-duties language.
3. Both prompts explicitly permit writing to the artifact directory (`{{artifactDir}}`) and `/tmp` as the sole exceptions to the "no repo edits" rule.
4. Both prompts retain all existing minimum-loop-contract bullets (mission load, `--verify`, diff inspection, artifact paths, Forgejo prohibition).
5. All 1571 existing tests pass after changes (verified via `npm test`).
6. The test suite includes at least 2 new assertions verifying the separation-of-duties content appears in generated prompts from `buildCompactReviewPrompt` and `buildReviewPrompt`.

## Risks and Assumptions

- **Risk:** Overly restrictive language could cause compliant agents (e.g., Codex) to refuse necessary artifact writes. Mitigation: explicitly whitelist artifact dir and /tmp.
- **Risk:** Agents may still ignore prompt constraints regardless of wording. Mitigation: the review loop's artifact consumption and state machine provide a safety net — a reviewer that doesn't produce artifacts will timeout and fail.
- **Assumption:** The existing prompt template substitution pipeline in `review-prompts.js` is stable and does not need restructuring.
- **Assumption:** Worktree issues observed in task-1322 are environmental (missing review remote, worktree dependency) rather than prompt-caused.

## Checkpoints

- CP 1: Read the current review prompts, the task-1322 review logs, and all related prompt tests. Document the exact prompt lines that caused ambiguity.
- CP 2: Draft revised `prompts/review.md` with explicit separation-of-duties section. Draft revised `prompts/review-verbose.md` with matching changes.
- CP 3: Update `test/review-prompts.test.js` with assertions for the new content. Run `npm test` — all pass.
- CP 4: Audit worktree errors from task-1322 logs. Decide whether prompt-level notes are warranted or if worktree issues belong in a separate backlog observation.

## Gates

- [ ] ./scripts/verify-local.sh docs
- [ ] npm test — all 1571+ tests pass with zero failures

## Restricted Areas

- Do not modify `lib/review/review-loop.js`, `lib/review/review-commands.js`, or `lib/review/review-state.js` — the prompt content change is the sole deliverable.
- Do not modify `lib/agents/` or any launcher configuration.
- Do not modify the `prompts/act-on-review.md` or `prompts/act-on-review-verbose.md` files.
- Do not create new prompt files; only edit existing ones.

## Stop Rules

- Stop if the prompt changes would require restructuring the template substitution pipeline in `review-prompts.js` — escalate to a separate task.
- Stop if adding separation-of-duties language breaks any existing test assertion about prompt content (re-check whether the test was asserting outdated/incorrect content).
- Stop if worktree investigation reveals a code-level bug in `lib/core/mission-utils.js` or `lib/review/review-loop.js` that must be fixed before the prompt change can ship — file a new task and halt this mission.
