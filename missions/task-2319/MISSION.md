# Mission: Stop tracking generated NOTICES artifacts in git (task-2319)

## Goal
Prevent the generated root-level `NOTICES` artifact from dirtying mission worktrees by removing it from version control while keeping it generated for published packages.

## Why Now
Current mission runs repeatedly generate `NOTICES`, then stop at the dirty-tree safety check with `Cannot auto-commit: dirty files include non-mission paths: NOTICES`. That failure is caused by tracking a generated packaging artifact in git. As long as the file remains tracked, every build can re-dirty an otherwise clean mission worktree.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: the root cause is repository policy, not mission-flow classification; the package build must continue to generate `NOTICES`, but git should stop tracking the generated output.

## Scope
- Stop tracking the repository-root `NOTICES` file while preserving its role in the published package.
- Add repository ignore coverage for the generated root-level `NOTICES` artifact.
- Verify that the release build still regenerates `NOTICES` and that package-shape checks still require it in the published artifact.
- Preserve existing mission-flow dirty-tree behavior for every other non-mission path.

Verification focus: generated `NOTICES` is ignored in git status after build; packaging still includes `NOTICES`.

## Out of Scope
- Changing the generator or contents of `NOTICES`.
- Ignoring arbitrary root-level files or generated artifacts other than the exact root-level `NOTICES`.
- Broad redesign of auto-commit, worktree cleanup, checkpoint creation, recovery orchestration, or package metadata.
- Editing unrelated mission contracts, backlog items, or documentation.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- `git ls-files --error-unmatch NOTICES` fails on the implementation tree because `NOTICES` is no longer tracked.
- `.gitignore` contains an exact root-level ignore entry for `NOTICES`, and after `npm run build` the generated file does not appear in `git status --short`.
- Release verification still treats `NOTICES` as required published metadata: package-shape tests and audits that require `NOTICES` remain green.
- `./scripts/verify-local.sh all` completes successfully on the implementation tree.

## Risks and Assumptions
- Risk: an overly broad ignore rule could hide unrelated root files. Mitigation: ignore only the exact root-level path `NOTICES`.
- Risk: some verification may have implicitly relied on a committed `NOTICES` file. Mitigation: verify through build- and pack-oriented tests that already treat build output as the source of truth.
- Assumption: `npm run build` and `prepack` remain the supported way to regenerate `NOTICES` before packaging.

## Checkpoints
- CP 1: Remove `NOTICES` from version control and add an exact `.gitignore` entry for the root-level generated artifact.
- CP 2: Run focused verification that `npm run build` regenerates `NOTICES`, `git status --short` stays clean for that artifact, and packaging tests still require and include `NOTICES`.
- CP 3: Run `./scripts/verify-local.sh all`; document final behavior and evidence for every success criterion.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- An exact `## Goal Check` heading.
- The exact 3-column pipe-delimited table header `| Criterion | Evidence | Status |`.
- At least one evidence row for every success criterion. Accepted evidence includes existing file:line references, exact test names, test file paths, ADR references, and recognized repository commands or paths such as backticked `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`.
- For this mission, cite the `.gitignore` change, the `git rm --cached` effect evidenced by git commands, the exact test name(s), and commands used to demonstrate regenerated-but-ignored `NOTICES` plus the final gate.
- Raw `stat`/`ls` output or generic prose alone is not evidence: if included, pair it with an accepted file:line reference, exact test name, test file path, ADR reference, or recognized repository command/path above.
- A non-generic `Next action:` line at the bottom that names the next mission-specific action.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md:28` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not change `NOTICES` generation, its contents, or its inclusion in the published package.
- Do not weaken ignore policy beyond the exact generated root-level `NOTICES` artifact.
- Do not alter mission workflow behavior unrelated to the dirty-worktree symptom caused by tracked `NOTICES`.
- Do not edit the backlog task's `assignee` field.

## Stop Rules
- Stop and request direction if verification shows that a committed `NOTICES` file is required by a workflow other than packaging.
- Stop and request direction if keeping `NOTICES` out of git requires changing packaging contracts beyond regenerate-on-build behavior.
- Stop and request direction if the generated file still dirties the worktree after an exact ignore rule and removal from version control.
