# Mission: Update use-case document with four missing use cases (task-1378)

## Goal

Extend `docs/use-cases.md` by adding four new use cases — **(UC-7) frictionless agent-output review via `px diff` and Forgejo PR viewer**, **(UC-8) velocity enhancement through parallel mission throughput**, **(UC-9) agent submission from feature branches**, and **(UC-10) automated QA integration to reduce agent errors** — each with the four required evidence-backed parts (P persona, B before→after pain, E non-README evidence, C confidence + justification), then update the ranking table (section 2), limitations (section 5), and red-team analysis (section 4) to reflect the additions.

## Why Now

`docs/use-cases.md` was written as a discovery artifact covering six confirmed/partial use cases (UC-1 through UC-6). Since then, the operator has accumulated real-world evidence for four additional capabilities that are currently undocumented: the `px diff` command for mission diffs, Forgejo PR review integration, observed velocity gains (~30 missions/week), feature-branch submission flows, and automated QA hooks. Without these entries, the use-case inventory is incomplete and any downstream positioning (README, marketing, or user-facing docs) omits capabilities that are already in use and measurable. Updating now ensures the inventory reflects the current product state before any new public claims are made.

## Refinement Signals

- Estimated agent % usage limit: 25-50%
- Confidence: Medium
- Selection note: activate as-is
- Main drivers: inventory gap (four user-validated use cases undocumented), downstream readiness (README and positioning docs depend on a complete inventory), low-risk documentation-only change.

## Scope

- **`docs/use-cases.md`**: Add four new use cases in §1 (Confirmed and Partial use cases), each following the established format:
  - **UC-7**: Frictionless review of agent output via `px diff` and Forgejo PR viewer. Evidence sources: `px.js` or `lib/commands/diff.js` (if `px diff` exists), Forgejo PR viewer integration in review flow (`lib/review/`), and operator experience notes.
  - **UC-8**: Velocity enhancement — operator achieving ~30 missions/week through Parallix workflow. Evidence sources: retrospective data (`docs/use-cases.md` already cites ~27/week in P4/P6; reconcile and extend), any velocity tracking artifacts.
  - **UC-9**: Agent submission from a feature branch. Evidence sources: `lib/commands/draft.js` feature-branch handling, `lib/core/mission-utils.js` branch resolution, any feature-branch-specific tests.
  - **UC-10**: Automated QA integration — hooking Parallix into standard QA practices (static analysis, linting, test gates) to reduce agent errors. Evidence sources: `scripts/verify-local.sh`, `.eslintrc.cjs`, `workflow.config.json` verification adapter, TASK-1353/TASK-1360/TASK-1361 gate infrastructure.

- **§2 (Ranking table)**: Re-evaluate rankings with the new use cases. Determine if any of UC-7 through UC-10 displace UC-1 through UC-6 in the top-3.

- **§4 (Red-team)**: Add any new adversarial objections surfaced by the new use cases.

- **§5 (Limitations)**: Add any new honesty constraints or caveats specific to the new use cases (e.g., Forgejo dependency for UC-7, velocity measurement caveats for UC-8).

- **`README.md`**: If any new use case earns a Confirmed ranking in §2, ensure README §"What it does" and §"Use cases" reference it. Otherwise, no README changes.

## Out of Scope

- Writing or modifying any source code in `lib/`, `test/`, `scripts/`, or `tools/`.
- Creating new test files or modifying existing tests.
- Modifying `workflow.config.json`, `.eslintrc.cjs`, or any configuration file.
- Adding new commands or CLI features.
- Modifying `package.json`, `index.js`, or `px.js`.
- Changing the ADR index or architecture decision records.
- Replacing the existing six use cases; only add the four new ones.
- Editing any files outside `docs/use-cases.md` and conditionally `README.md` (only if ranking changes require it).

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives and vague quantifiers.

- **SC1:** `docs/use-cases.md` contains exactly ten use cases labeled UC-1 through UC-10 (six existing plus four new: UC-7, UC-8, UC-9, UC-10).
- **SC2:** Each of the four new use cases includes all four required parts: (P) persona/buyer, (B) before→after pain, (E) non-README evidence with file:line or test-name citations, (C) confidence level (Confirmed/Partial/Aspirational) with a one-line justification.
- **SC3:** UC-7 cites at least one concrete evidence source for `px diff` or mission-diff viewing capability (e.g., `px.js`, `lib/commands/diff.js`, or relevant review/Forgejo integration code).
- **SC4:** UC-8 cites measurable throughput data with specific numbers and source references (retrospectives, evaluation summaries, or stats), reconciling the existing ~27/week figure with the operator's reported ~30 missions/week.
- **SC5:** UC-9 cites evidence for feature-branch submission (branch resolution logic in `lib/commands/draft.js` or `lib/core/mission-utils.js`, or corresponding tests).
- **SC6:** UC-10 cites evidence for automated QA integration (gate script `scripts/verify-local.sh`, verification adapter in `lib/core/verification.js`, or static-analysis gate tasks).
- **SC7:** §2 (Ranking table) is updated to reflect the four new use cases, with the top-3 re-evaluated. If no new use case enters top-3, the table retains UC-1, UC-2, UC-3.
- **SC8:** §4 (Red-team) includes any new adversarial objections for the four new use cases.
- **SC9:** §5 (Limitations) includes any new honesty constraints for the new use cases.
- **SC10:** `npm test` passes (0 failures, same or fewer skipped tests than baseline).

## Risks and Assumptions

- **Risk:** `px diff` command does not exist as a standalone command — the diff/view capability may be embedded in `px integrate` or `px review` rather than a dedicated subcommand. Mitigation: trace the actual implementation; if no `px diff` exists, frame UC-7 around the closest available mechanism (e.g., `px integrate` diff preview, Forgejo PR diff viewer).
- **Risk:** Velocity data for UC-8 may conflate different metrics (completed missions vs. user-value missions). Mitigation: cite the same caveats used in existing UC-1 analysis (different mission-output measures, overhead percentages).
- **Risk:** Feature-branch submission (UC-9) may not have a distinct code path — it could be the same as primary-branch flow with extra resolution logic. Mitigation: document the actual difference (if any) between primary and feature branch handling in `draft.js`.
- **Risk:** Automated QA integration (UC-10) overlaps significantly with UC-5 (adopt without rewriting CI). Mitigation: distinguish UC-10 as the *agent-error reduction* angle (QA gates catch agent mistakes before review) versus UC-5 as the *CI adoption* angle (keep existing gates rather than invent new ones).
- **Assumption:** The four use cases described by the operator map to real, evidenced capabilities in the codebase. If one lacks evidence, mark it Aspirational rather than fabricating citations.
- **Assumption:** No source-code changes are needed to document these use cases — this is a documentation-only mission.
- **Assumption:** Existing use cases UC-1 through UC-6 are accurate and need no corrections.

## Checkpoints

- **CP 1:** Research phase — trace evidence for all four use cases in source code, tests, and existing retrospectives. Confirm which evidence sources exist for each.
- **CP 2:** Draft UC-7 through UC-10 in §1 of `docs/use-cases.md` with all four required parts (P, B, E, C). Flag any use case that cannot meet the evidence requirement as Aspirational.
- **CP 3:** Update §2 (Ranking table), §4 (Red-team), and §5 (Limitations) to incorporate the new use cases.
- **CP 4:** Conditional README update — if any new use case enters the top-3 ranking, update README §"What it does" and §"Use cases" to reference it.
- **CP 5:** Verification — `npm test` passes, all file references resolve, no placeholder text remains.

## Gates

- [ ] ./scripts/verify-local.sh docs

## Restricted Areas

- **Source code directories** (`lib/`, `test/`, `scripts/`, `tools/`) — do not modify any `.js` files.
- **Configuration files** (`workflow.config.json`, `.eslintrc.cjs`, `package.json`, `tsconfig.json`) — do not modify.
- **CLI entry points** (`index.js`, `px.js`) — do not modify.
- **Architecture Decision Records** (`docs/adr/`) — do not modify.
- **Any files outside `docs/use-cases.md` and conditionally `README.md`** — no other file changes.

## Stop Rules

- Stop if any of the four use cases lacks credible evidence — document it as Aspirational with a clear note that it needs implementation or measurement before Confirmed status.
- Stop if resolving evidence requires tracing through more than 5 files per use case — flag as a separate research task.
- Stop if `npm test` fails due to an unrelated pre-existing issue — do not attempt to fix test failures.
- Stop if the ranking re-evaluation in §2 would require rewriting more than 20 lines of the existing table — simplify the re-ranking rather than restructuring the entire section.
- Stop if the evidence for UC-7 shows that `px diff` does not exist and no equivalent diff-viewing capability exists in the codebase — mark UC-7 as Aspirational and stop adding evidence citations for it.
