# Mission: Broaden active-step auto-commit so handoff does not strand implementation files (task-2202)

Reproduction-Test: test/task-2202-repair-handoff-autocommit.test.js

## Goal
Change the active-step handoff repair path so a cleanly exited implementation agent does not fail handoff solely because it forgot to commit ordinary mission worktree changes outside the current mission-artifact allowlist. The mission must lock that bug with a failing reproduction test first, then make the post-execute auto-commit logic cover the intended implementation files while still refusing clearly unsafe cases such as merge conflicts, rebase failures, or operator-local/generated state.

## Why Now
The current behavior contradicts the operator expectation in the backlog task: after a successful `active` run, forgetting `git add`/`git commit` is a mechanical miss that the harness should be able to repair. Instead, `repairHandoff()` currently accepts only mission-owned files plus a small workflow-generated allowlist, and it rejects ordinary implementation paths as "non-mission paths". That blocks exactly the kind of weak-agent cleanup the workflow is supposed to absorb, and it pushes a routine handoff fix back onto the human.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: `repairHandoff()` currently rejects dirty `lib/`/`test/`/repo-root implementation files during active-step auto-repair; behavior is localized and already covered by focused handoff tests

## Scope
- Author a failing reproduction test under `test/` that demonstrates the current bug: active-step handoff repair refuses to auto-commit ordinary implementation files in the mission worktree even when the agent already exited successfully and the dirty tree contains no conflicts.
- Trace the exact safe-path rules used by `repairHandoff()` and any helper predicates it relies on, including `mission-utils` and workflow-generated artifact checks.
- Widen the auto-commit behavior only for the active-step handoff repair path so repo-local implementation files created or modified by the mission worktree are staged and committed automatically instead of being rejected as "non-mission paths".
- Preserve the existing repair behaviors for branch-behind auto-rebase, conflict detection, and stage/commit failure reporting.
- Add or update focused regression coverage for both the newly accepted implementation-file case and the unsafe cases that must still refuse auto-commit.
- Keep the backlog task labeled with exactly one classification label (`ai_sdlc`) plus `bug`.

## Out of Scope
- Changing review-step or integrate-step artifact policy outside the active-step post-execute handoff repair path.
- Replacing the bounded repair logic with an unconditional `git add -A` of the entire worktree.
- Auto-committing operator-local state or generated directories such as `.workflow/`, `.sessions/`, `.forgejo-local/`, `graphify-out/`, or any git-conflicted entries.
- Reworking mission-state transitions, reviewer routing, or Forgejo submission logic.
- Broad redesign of `isMissionArtifact()` for unrelated commands unless the reproduction proves that helper itself is the narrow root cause.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- A reproduction test at `test/task-2202-repair-handoff-autocommit.test.js` fails on the mission parent commit by exercising `repairHandoff()` with dirty implementation paths such as `lib/...` and `test/...` plus the mission/backlog files for the same slug, and it proves the current result is a blocker containing the "non-mission paths" refusal.
- After the fix, the same reproduction path passes by staging and committing those implementation files with the existing deterministic auto-commit message for the active-step handoff repair flow.
- Existing safe-path protections remain intact: regression coverage proves `repairHandoff()` still refuses conflicted entries, still reports stage/commit failures instead of silently succeeding, and still performs the existing branch-behind auto-rebase path.
- The widened auto-commit logic does not absorb operator-local or generated paths: regression coverage proves paths under `.workflow/`, `.sessions/`, `.forgejo-local/`, or `graphify-out/` are not treated as ordinary implementation files for this repair flow.
- The implementation is limited to the active-step repair seam and its directly-coupled helpers/tests; no unrelated workflow state-machine behavior or review/integrate policy changes are introduced.
- `./scripts/verify-local.sh static-analysis` passes on the final tree.

## Risks and Assumptions
- Risk: broadening the auto-commit set too far could accidentally stage operator-local state, generated output, or infrastructure files. Mitigation: lock the intended safe/unsafe boundaries in tests before changing the predicate.
- Risk: the current "mission-only" restriction may be shared by other commands that should remain stricter. Mitigation: keep the behavioral expansion scoped to the active-step handoff repair path unless a directly-coupled helper must change.
- Assumption: by the time `repairHandoff()` runs after `px active`, the mission worktree's dirty implementation files are intended outputs of the just-finished mission, not unrelated edits from another workflow.
- Assumption: the operator intent is not "commit literally everything"; the harness should still exclude clearly unsafe or non-repo-runtime paths even after this bug is fixed.

## Checkpoints
- CP 1: Author `test/task-2202-repair-handoff-autocommit.test.js` as a failing reproduction test that simulates a successful active-step handoff repair attempt with dirty `lib/` and `test/` paths for the current slug, asserts the parent commit returns the current "non-mission paths" blocker (red), and documents why those files should be auto-committable in this workflow path (green after the fix).
- CP 2: Trace and document the current acceptance boundary in `repairHandoff()` and its helper predicates, including which path classes are intentionally safe, intentionally forbidden, and currently misclassified for this mission.
- CP 3: Implement the narrow predicate/repair change so active-step auto-repair stages and commits the intended implementation files without weakening conflict, stage-failure, or branch-behind handling.
- CP 4: Extend regression coverage for forbidden paths (`.workflow/`, `.sessions/`, `.forgejo-local/`, `graphify-out/`, conflicted entries) and run the required verification gates.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done that names the concrete workflow path exercised in that checkpoint.
- A `## Goal Check` section using that exact heading.
- A 3-column pipe-delimited markdown table with columns: `| Criterion | Evidence | Status |`.
- At least one evidence row per success criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `lib/commands/repair-handoff.ts:340`
  2. **Exact test names** — e.g., `"repairHandoff auto-commits safe mission files"`
  3. **Test file paths** — e.g., `test/task-2202-repair-handoff-autocommit.test.js`
  4. **ADR references** — e.g., `ADR 0048`
  5. **Recognized repo commands or paths** — e.g., `` `node --test test/task-2202-repair-handoff-autocommit.test.js` ``, `` `node --test test/repair-handoff.test.js` ``, `` `git status --porcelain` ``, `` `px review task-2202 --verify` ``, or `` `./scripts/verify-local.sh static-analysis` ``
- Raw `stat`/`ls` output or generic prose alone is not enough; if shell output is included, pair it with one of the accepted references above in the same checkpoint.
- A non-generic `Next action:` line at the bottom that names the next file, test, or command to touch.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Reproduction stays red on parent commit | `test/task-2202-repair-handoff-autocommit.test.js`, `node --test test/task-2202-repair-handoff-autocommit.test.js` | PASS |
| Active-step repair path widened in the intended seam | `lib/commands/repair-handoff.ts:340` | PASS |
| Static-analysis gate ran | `./scripts/verify-local.sh static-analysis` | PASS |

## Gates
- [ ] node --test test/task-2202-repair-handoff-autocommit.test.js
- [ ] node --test test/repair-handoff.test.js
- [ ] ./scripts/verify-local.sh static-analysis
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify source files outside the active-step handoff repair seam and its directly-coupled helpers/tests unless the reproduction proves a narrower fix is impossible.
- Do not change backlog task `assignee` semantics or mission state-ordering behavior.
- Do not implement a blanket repo-wide auto-stage/auto-commit policy across unrelated workflow commands.
- Do not start committing generated/operator-local paths just to make the reproduction pass.

## Stop Rules
- Stop if reproducing the bug shows the failure is not in `repairHandoff()`/handoff repair at all, but in a different command path that needs a separate mission.
- Stop if the only working fix is equivalent to `git add -A` over the entire worktree or otherwise stages operator-local/generated paths that this repo intentionally keeps separate.
- Stop if the intended safe file boundary cannot be specified deterministically in tests; that would mean the mission contract is underspecified and needs clarification before implementation.
