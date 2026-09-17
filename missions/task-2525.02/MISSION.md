# Mission: Reduce high-severity SonarQube maintainability debt (task-2525.02)

## Goal
Work down the high-severity maintainability debt from the 2026-09-16 SonarQube baseline in reviewable slices, starting with the 116 critical cognitive-complexity findings (rule `typescript:S3776`), then triaging the remaining critical/blocker maintainability findings into either completed fixes or separately bounded follow-up tasks. Every completed slice refactors a real control-flow path and ships focused regression tests for the changed branches; no finding is reduced by mass suppression or a metric-only refactor.

## Why Now
The parent mission (TASK-2525) baselined Parallix's first SonarQube analysis on 2026-09-16. TASK-2525.01 owns the 35 reliability (BUG) findings; this task owns the maintainability side, which is where the largest open critical/blocker count lives. TASK-2525.03 will make the SonarQube quality gate required in GitHub Actions and pre-integration, so the debt must be triaged into concrete slices before enforcement turns the baseline into a merge blocker. Working it now keeps legacy debt visible and bounded instead of letting the initial inventory block every future merge.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: 116 critical S3776 findings on the 2026-09-16 baseline; parent TASK-2525 enforcement gate (TASK-2525.03) makes the baseline a future merge blocker; dependency on TASK-2525.01 (reliability findings) already clearing the BUG count so maintainability is the remaining critical/blocker exposure.

## Scope
- Triage of the 116 critical `typescript:S3776` cognitive-complexity findings from the 2026-09-16 baseline, split into reviewable slices by shared source path.
- Refactoring of the highest-complexity slices where the refactor improves an observable boundary (behavior), with focused regression tests for every changed branch.
- Triage of the remaining critical/blocker maintainability findings (rules other than S3776) into either completed fixes or separately bounded follow-up tasks recorded in the backlog.
- Recording each slice's before/after target and the justification for any finding left as follow-up.

## Out of Scope
- Reliability (BUG) findings — owned by TASK-2525.01.
- Changing SonarQube rule severity, disabling/suppressing rules, or editing `sonar-project.properties` to reduce counts.
- Standing up or running the SonarQube server; the baseline inventory is the source of truth, not a fresh local analysis.
- Enforcement wiring (GitHub Actions / pre-integration) — owned by TASK-2525.03.
- Metric-only refactors that lower a complexity number without changing an observable behavior.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: Every completed S3776 slice that changes control flow has a focused regression test under `test/` covering each newly reachable branch; the relevant test file passes via `npm test` (or the specific `tsx test/<file>.test.ts` invocation) at the mission's final commit.
- SC2: The full static-analysis gate passes at the final commit: `./scripts/verify-local.sh static-analysis` (ESLint ≤30 warnings, `npm run typecheck`, `bash scripts/test-hygiene.sh`, and `npx tsc --noEmit --project tsconfig.test.json`) all exit 0.
- SC3: `sonar-project.properties` still declares supported Sonar way defaults with no rule globally disabled, suppressed, or excluded to reduce a count; any remaining suppression is a project-specific S3776 false positive with a written justification in the mission checkpoint.
- SC4: All 116 critical S3776 findings are accounted for at mission end — each is either resolved in a completed slice or captured in a separately bounded follow-up backlog task with a stated target; zero critical S3776 findings are left as untriaged open debt in this mission.
- SC5: No slice is a metric-only or suppression-only change — every completed slice that reduces an S3776 count also has a behavior change evidenced by a passing test (SC1), so the S3776 count never drops purely by relocating complexity or silencing the rule.

## Risks and Assumptions
- The SonarQube server is not run during this mission; the 2026-09-16 baseline inventory (116 critical S3776 findings) is treated as ground truth. Assumption: the inventory accurately reflects the current `src` tree. Risk: if `src` has drifted since the baseline, some findings may no longer apply — resolve by re-reading the rule at the code site, not by re-running the server.
- Reducing cognitive complexity can relocate it (e.g. extracting a helper that is itself complex) without removing it. Mitigation: SC5 forbids metric-only refactors; every slice must show a behavior change with a test.
- Refactoring shared control flow risks regressions in sibling callers. Mitigation: SC1 requires focused tests for changed branches; run the affected test files and `./scripts/verify-local.sh static-analysis` after each slice.
- Scope creep across all 116 findings. Mitigation: bounded slices per ADR 0047 NEL budget; anything beyond the assigned slices becomes a follow-up task (SC4).
- Assumption: `typescript:S3776` complexity is measured on the same rule set as the baseline (Sonar way defaults), consistent with SC3.

## Checkpoints
- CP 1: Baseline inventory and slice plan. Load the 2026-09-16 maintainability baseline, enumerate the 116 critical S3776 findings grouped by source path, and split them into reviewable slices (each slice = one shared path or one cohesive control-flow region) with a per-slice before/after complexity target. Triage the remaining critical/blocker maintainability findings (non-S3776) the same way. Record the slice list and the triage board in this checkpoint.
- CP 2: First slice refactor + regression tests. Refactor the highest-complexity slice, keep every observable behavior, and add focused tests for each changed branch. Run the affected test files and `./scripts/verify-local.sh static-analysis` before advancing.
- CP 3: Additional slices. Repeat CP 2 for the next slice(s) bounded by the NEL budget. Stop a slice if the refactor changes behavior that cannot be captured by a focused test without a larger change; promote the remainder to a follow-up task.
- CP 4: Final triage pass. Confirm every one of the 116 critical S3776 findings is resolved or captured in a bounded follow-up task (SC4); write the justification for each remaining finding; confirm no rule was disabled or suppressed to move a count (SC3).
- CP 5: Final verification. Run the full `./scripts/verify-local.sh all` gate and confirm it passes; record the result in the Goal Check.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `npm test -- test/repair-handoff.test.ts` ``, `` `px review <slug> --verify` ``, or `` `./scripts/verify-local.sh static-analysis` ``
  2. **Test names** — e.g., `"real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/e2e-real-agent-smoke.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0048` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above. NOTE: raw `stat`/`ls` output or a prose sentence like "the complexity is lower now" is NOT sufficient evidence on its own — pair it with one of the accepted references (a passing `./scripts/verify-local.sh static-analysis`, a named test file or test, an `ADR` reference, or a `npm`/`node`/`git`/`px` command). The implementer must show both the shell output AND the accepted reference that ties that output to the criterion.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `npm test -- test/repair-handoff.test.ts` ``, `` `px review <slug> --verify` ``, or `` `./scripts/verify-local.sh all` ``
  2. **Test names** — e.g., `"real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/e2e-real-agent-smoke.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0048` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh static-analysis
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not edit `sonar-project.properties` or any SonarQube rule configuration to change severity, disable, suppress, or exclude a rule.
- Do not run the SonarQube server or alter the `infra/sonarqube` configuration.
- Do not add a test whose only assertion counts lines or complexity without asserting a behavior.
- Do not create or edit backlog files outside the follow-up tasks this mission legitimately generates; do not modify the `assignee` field on any backlog file.
- Do not refactor a shared path to a metric target when no focused test can express the changed behavior — stop that slice and promote it.

## Stop Rules
- Stop the whole mission if `./scripts/verify-local.sh static-analysis` fails and the failures are not directly caused by the current slice's change and immediately resolvable.
- Stop advancing slices if a slice's refactor changes observable behavior that cannot be covered by a focused regression test (SC1) — promote the remainder to a follow-up task rather than shipping an untested change.
- Stop if the assigned NEL budget (ADR 0047) is exhausted; remaining S3776 findings become bounded follow-up tasks (SC4).
- Stop editing source outside `src/` refactor scope and the follow-up backlog tasks and this MISSION.md.
