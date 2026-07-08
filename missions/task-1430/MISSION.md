# Mission: Strengthen reviewer instructions to ignore rebasing artifacts (task-1430)

## Goal

Add explicit, unambiguous instructions to review prompts directing reviewers to ignore spurious diff entries caused by branch stale-ness and to focus only on changes introduced by the mission itself. This eliminates token waste from reviewers commenting on files that will be automatically resolved when parallix rebases the branch onto current main before integration.

## Why Now

Task-1407 introduced the `reviewBaseline` SHA to pin the diff base at review launch time, preventing reviewers from seeing concurrent merges to main. However, agents still generate noise findings on changes that appear in the diff because the mission branch forked from an older point in main. Example: Codex flagged the removal of `custom-agent-smoke` gate and deletion of `test/e2e-real-agent-smoke.test.js` as material scope violations in task-1424, when these files were in fact missing from the branch due to stale baseline — not actual mission changes. These deletions will disappear once parallix rebases the branch onto current main. Every such false-positive comment consumes reviewer tokens and implementer cycles to push back or park. The root cause is missing explicit guidance in the prompts about what constitutes a legitimate mission change versus rebasing artifact.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: Token waste from spurious review findings on rebasing artifacts; task-1407 proved the baseline mechanism works but the prompts lack clear reviewer guidance

## Scope

- `prompts/review.md`: Add explicit "Rebasing Artifacts" subsection under "Minimum loop contract" instructing reviewers to ignore diff entries that are solely due to the branch being behind main and that will be resolved by parallix's automatic rebase before integration. Include concrete examples: file deletions from main, additions to main that appear as missing, and any change whose merge-base diff against the mission's actual parent commit is empty.
- `prompts/review-verbose.md`: Add the same "Rebasing Artifacts" subsection with equivalent instructions.
- `prompts/act-on-review.md`: Add note that implementers should push back on review findings that are rebasing artifacts using the new "Not a mission change — will be resolved by rebase" rationale.
- `prompts/act-on-review-verbose.md`: Add the same push-back guidance.
- `lib/review/review-prompts.ts`: Thread a new `missionBranchBaseSha` or similar variable into prompt builders if needed to give reviewers the authoritative base commit for comparison (stretch; only if the prompt text requires it for clarity).

## Out of Scope

- Changes to `lib/review/review-loop.ts` rebase logic or baseline capture — task-1407 already solved this.
- Changes to `lib/review/rebase.ts` — rebase behavior is correct and not part of this fix.
- Modifying the `reviewBaseline` mechanism from task-1407.
- Changes to Forgejo/PR surface behavior.
- Adding new CLI flags or configuration.
- Changing review verdict logic or artifact formats.

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

- C1: `prompts/review.md` contains a "Rebasing Artifacts" or equivalently-named subsection explicitly instructing reviewers to ignore diff entries caused by stale branch baseline and to focus only on mission-introduced changes.
- C2: `prompts/review-verbose.md` contains the same subsection with the same instruction.
- C3: `prompts/act-on-review.md` contains explicit push-back guidance for findings that are rebasing artifacts.
- C4: `prompts/act-on-review-verbose.md` contains the same push-back guidance.
- C5: The instruction text in all four prompt files includes at least one of the phrases: "will be resolved by parallix rebase", "not a mission change", "rebasing artifact", or "branch stale-ness".
- C6: `npm test` passes with zero failures after the changes.
- C7: `./scripts/verify-local.sh docs` passes with zero errors.

## Risks and Assumptions

- **Risk:** Reviewers might over-apply the new instruction and ignore legitimate scope violations that happen to align with main changes. **Mitigation:** The instruction explicitly limits the ignore rule to entries that "will be resolved by parallix rebase" — reviewers must still flag actual mission changes that violate scope even if they touch the same files.
- **Risk:** The new text could conflict with existing prompt sections or create ambiguity. **Mitigation:** Add the new subsection as a distinct bullet or paragraph under the existing "Minimum loop contract" or "Requirements" sections, clearly separated from other instructions.
- **Assumption:** The `reviewBaseline` SHA from task-1407 is already the correct mechanism; adding textual guidance is sufficient to eliminate the false-positive comments.
- **Assumption:** Reviewers will read and follow the new explicit instructions without needing code enforcement.
- **Risk:** Prompt changes could trigger model-specific behavior differences across agent families. **Mitigation:** The new instructions are declarative (what to ignore) not procedural (how to review), minimizing family-specific variance.

## Checkpoints

- CP 1: Draft the "Rebasing Artifacts" instruction text and add it to `prompts/review.md` and `prompts/review-verbose.md` under their respective instruction sections.
- CP 2: Add push-back guidance for rebasing artifacts to `prompts/act-on-review.md` and `prompts/act-on-review-verbose.md`.
- CP 3: Run `./scripts/verify-local.sh docs` and verify zero errors.
- CP 4: Run `npm test` and confirm all existing tests pass (0 failures).

## Gates

- [ ] ./scripts/verify-local.sh docs
- [ ] ./scripts/verify-local.sh all

## Restricted Areas

- `backlog/` — do not modify backlog task metadata (assignee, status, IDs). The workflow records ownership itself.
- `missions/` — do not modify existing mission contracts or checkpoint documents except for this task-1430 MISSION.md.
- `lib/review/rebase.ts` — do not modify rebase logic.
- `lib/review/review-loop.ts` — do not modify baseline capture or rebase orchestration.
- `lib/commands/` — no CLI command changes.
- `config/` — no configuration changes.
- Do not add new test files; only modify existing prompt files and add tests to existing test files if needed for verification.

## Stop Rules

- Stop if adding the new instructions requires modifying `review-loop.ts` baseline capture — escalate for scope review.
- Stop if the new instructions could cause reviewers to miss legitimate scope violations — add explicit caveat that scope violations must still be flagged regardless of rebase status.
- Stop if `npm test` reveals regressions not present on main at the mission's parent commit — investigate and exclude any test-only fixes from this mission's scope.
