# Mission: Repair SonarQube reliability findings (task-2525.01)

## Goal
Resolve the 35 reliability findings from the 2026-09-16 SonarQube baseline by repairing root behavior, not by silencing rules. The 19 critical implicit string-sort findings (rule `typescript:S2871`) come first: every `.sort()` on the JS default (lexicographic string) ordering that should be numeric or otherwise ordered gets an explicit comparator. The remaining findings — regular-expression, control-character, and constant-conditional — are repaired per behavior. Every repair that changes runtime behavior gains a focused regression test; no rule is disabled, suppressed, or excluded to lower the count.

## Why Now
The 2026-09-16 baseline analysis produced a concrete, dated list of 35 reliability findings, of which 19 are rated **critical** (implicit string sorts that silently produce wrong ordering on numeric/mixed data — a latent correctness bug, not cosmetic). Left unfixed these are exactly the class of defect that slips into production as wrong sort order. The repo's own Definition of Done (TASK-2525) makes "zero open BUG findings for project parallix" a hard gate, and `./scripts/verify-local.sh static-analysis` is a required integration gate, so clearing these findings directly unblocks that gate's intent.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: dated baseline with a fixed finding count; 19 critical findings concentrated in a single rule (S2871) that maps to a small, enumerable set of `.sort()` calls; repair is localized to `src/` and covered by the existing `npm test` suite.

## Scope
- Triage the 2026-09-16 SonarQube baseline into a categorized list (rule id, file, behavior, critical vs non-critical), stored as checkpoint evidence.
- Repair all 19 critical implicit string-sort findings (`typescript:S2871`) by adding explicit comparators where the default lexicographic ordering is incorrect, and document why the remaining default-ordering `.sort()` calls are safe (string-keyed/lexical data) rather than changing them needlessly.
- Repair the regular-expression, control-character, and constant-conditional findings by fixing the underlying behavior per the baseline report.
- Add focused regression tests under `test/` for every repair that changes runtime behavior; keep existing tests green.
- Do not touch unrelated code, dependencies, or configuration beyond what each finding requires.

## Out of Scope
- Disabling, suppressing (e.g. `sonar.comments`, `@sonar` annotations, `@SuppressWarnings`), lowering severity of, or excluding any rule in `sonar-project.properties` or scanner config to reduce the finding count.
- Adding new SonarQube rules or changing the SonarQube server configuration.
- Rewriting the sort helpers, refactoring unrelated modules, or performance tuning beyond what each finding demands.
- Running a live SonarQube analysis against a server (not available in this environment); verification is via the dated baseline report and the static-analysis gate.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion is falsifiable with a concrete evidence form.

- **SC1** All 35 findings from the 2026-09-16 baseline are resolved: the baseline report's finding list (by rule id + file) is fully accounted for in the checkpoint triage, and each entry is either repaired or explicitly justified as a false positive with a code-level reason (not a rule disable).
- **SC2** 18 of the 19 critical `typescript:S2871` findings are fixed with an explicit comparator; the 19th (`src/domain/checkpoint.ts:56`) already had a numeric comparator. The count of remaining default-ordering `.sort()` calls on non-string data is zero. The enumerable set of candidate `.sort()` calls in `src/` includes at least: `src/interfaces/tui/agent-config-resolver.ts:31`, `src/application/projections/bug-frequency.ts:239`, `src/application/projections/metrics-read-adapter.ts:387`, `src/domain/checkpoint.ts:56`, `src/adapters/cli/commands/stats-report.ts:275`, `src/adapters/cli/commands/status.ts:329`, `src/adapters/cli/commands/status-adapter.ts:240`, `src/adapters/cli/commands/status-adapter.ts:399`, `src/adapters/sqlite/migration-runner.ts:169`, `src/adapters/sqlite/database-adapter.ts:377`, `src/adapters/verification/coverage-gate.ts:159` (and the remaining baseline-listed files).
- **SC3** Each behavior-changing repair has a focused regression test under `test/` that fails at the mission's parent commit (red) and passes after the repair (green); the total test count is non-decreasing and the full suite stays green.
- **SC4** No SonarQube rule is disabled, globally suppressed, lowered in severity, or excluded in scanner configuration. A grep for `sonar.comments`, `sonar.issue.effective`, `@sonar`, `@SuppressWarnings`, and `sonar.exclusions`/`sonar.coverage.exclusions` in the changed tree yields no new occurrences introduced by this mission.
- **SC5** `./scripts/verify-local.sh static-analysis` passes all four stages: ESLint on `src/` with warnings ≤ 30, `npm run typecheck` clean (no `error TS` beyond `TS18003`), `scripts/test-hygiene.sh` clean, and `npx tsc --noEmit --project tsconfig.test.json` clean.
- **SC6** The `.sort()` calls on string/lexical data that the baseline marks as correct (e.g. `src/adapters/cli/commands/stats-report-rendering.ts:175` over `Object.keys(groups)`, `src/adapters/sqlite/database-adapter.ts:377` fixed-width millisecond suffixes) are left behaviorally unchanged and are covered by regression coverage where the ordering is observable.

## Risks and Assumptions
- **Baseline availability.** The mission assumes the 2026-09-16 SonarQube baseline report is accessible to the implementer (it names the exact 35 findings). If only a summary is available, the implementer reconstructs the list from it and records the source in the triage checkpoint. Live analysis is not run locally.
- **Over-fixing.** Some default-ordering `.sort()` calls are correct for string data. Changing them risks behavior change with no benefit. Each change must be justified against the baseline's per-finding classification.
- **Numeric vs lexicographic.** The core risk of S2871 is numeric data sorted as strings (`["10"].sort()` → `["10","2"]` wrong). Repairs must compare by the real value type, not just silence the rule.
- **Test-hygiene gate.** New tests must satisfy `scripts/test-hygiene.sh` (no real Forgejo access, mocked external boundaries, unit tests < 500 ms) per repo unit-test rules.
- **Static-analysis warning budget.** ESLint allows ≤ 30 warnings; the repair must not push new warnings past that ceiling.

## Checkpoints
- CP 1: Triage & baseline categorization — enumerate all 35 findings, assign rule id / file / behavior / criticality, and classify each as (a) behavior-changing repair, (b) correct-as-is default sort, or (c) justified false positive. Record the categorized list as checkpoint evidence.
- CP 2: Implicit string sorts (`typescript:S2871`) — repair 18 of the 19 critical findings with explicit comparators (the 19th, `src/domain/checkpoint.ts:56`, already had a numeric comparator); add regression tests for any that change ordering behavior; document why the remaining default-ordering `.sort()` calls are safe.
- CP 3: Regular-expression findings — repair the underlying regex behavior per the baseline; add a regression test where behavior changes.
- CP 4: Control-character findings — repair the underlying handling per the baseline; add a regression test where behavior changes.
- CP 5: Constant-conditional findings — repair the dead/constant condition per the baseline; add a regression test where behavior changes.
- CP 6: Verify — run the static-analysis gate and full test suite; confirm no rule was disabled and the baseline finding list is fully resolved.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section using the exact heading `## Goal Check`
- A 3-column pipe-delimited markdown table with columns: `| Criterion | Evidence | Status |`
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts, in priority order:
  1. **Recognized repo commands or paths** — e.g., `` `./scripts/verify-local.sh static-analysis` ``, `` `npm test -- test/repair-sonarqube-sorts.test.ts` ``, `` `npm run typecheck` ``, `` `node --test` ``, `` `git <sha>` `` for the parent commit, or `` `px ...` ``
  2. **Test names** — must match a real test name in the repo, e.g. `"implicit string sort comparator produces numeric order"`
  3. **Test file paths** — must be an existing test file under `test/`, e.g. `test/repair-sonarqube-sorts.test.ts`
  4. **ADR references** — e.g. `ADR 0057` (must correspond to a file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- **Weak-agent failure mode (call this out explicitly):** raw `stat`/`ls` output or generic prose such as "all findings fixed" is NOT sufficient evidence. Pair any shell output with at least one of the accepted references above — e.g. do not just paste `ls test/`; cite the exact test file path and test name, or the exact `npm test`/`verify-local.sh` command that proves it.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Baseline fully triaged | `test/repair-sonarqube-sorts.test.ts`, `"2026-09-16 baseline: 35 findings enumerated and categorized"` | PASS |
| S2871 critical sorts repaired | `` `./scripts/verify-local.sh static-analysis` `` | PASS |
| Behavior-changing repairs tested | `test/repair-sonarqube-sorts.test.ts`, `"numeric sort comparator yields ascending numeric order (red at parent commit)"` | PASS |
| No rule disabled | grep `sonar.exclusions`/`sonar.comments` in changed tree yields none | PASS |

## Gates
- [ ] ./scripts/verify-local.sh static-analysis
- [ ] ./scripts/verify-local.sh all
- [ ] npm test

## Restricted Areas
- SonarQube server configuration, `sonar-project.properties`, scanner config, and any rule severity/disablement settings — do not modify to reduce the finding count.
- The backlog task file may be updated for labels only; do not rename, move, or delete it, and do not change its `assignee` field.
- Any file outside the specific source files named by the baseline findings and the new/modified test files under `test/` — do not touch unless a finding's root cause genuinely requires it, and document why.

## Stop Rules
- Stop before implementing: this draft phase produces only the mission contract and backlog label update.
- During execution, stop and escalate if the 2026-09-16 baseline report is unavailable and cannot be reconstructed.
- Do not proceed to disable/suppress/exclude a rule as a fix — that is a stop condition, not a solution.
- Do not expand scope to fix findings outside the 35-item baseline.
- Stop if `./scripts/verify-local.sh static-analysis` cannot pass after repair; re-inspect rather than lower the ESLint warning ceiling or suppress lint.
