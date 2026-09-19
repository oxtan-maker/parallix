# Mission: Fix ALL HIGH-or-worse SonarQube problems (task-2525.04)

## Goal
Resolve **every** SonarQube finding with severity **High, Critical, or Blocker** — no exceptions, no exclusions, no sweeping under the rug. Each such finding must be either (a) genuinely fixed at the code site so the rule no longer fires, or (b) explicitly captured in a bounded follow-up task with a stated target and an accepted deadline by the end of this mission. Fixing means changing the code or its behavior so the issue is removed — **not** hiding it. Hiding = suppressing/downgrading/disabling the rule, editing `sonar-project.properties`, excluding a path, or moving the problem elsewhere so a scanner no longer reports it. None of those count as a fix.

The count of unresolved HIGH-or-worse findings must reach **zero** at mission end. A finding left unresolved without a bounded follow-up (with a stated target) is a mission failure.

## Keep-the-Bar Enforcement Wiring
Fixing the current debt is not enough: after this mission, **no mission may ever merge to `main` when it creates a new High-or-worse SonarQube issue.** This bar is kept only if the SonarQube quality gate actually **fails** on new High/Critical/Blocker issues and is wired into the merge boundary. This is owned jointly with TASK-2525.03 (which wires the shared SonarQube command into the GitHub required workflow and the pre-integration gate plan). 2525.04 adds the one thing 2525.03 alone does not guarantee: the gate must fail on new High-or-worse findings, not merely run the scanner.

- The pre-integration gate plan (`workflow.config.json` → `adapters.gates.preIntegration`) must include the SonarQube scan as a mandatory gate whose failure blocks the review → integration approval / merge boundary.
- The GitHub required workflow (`ci-required`) must run the same shared SonarQube command and fail the check on a non-passing quality gate.
- The quality gate must carry an explicit **new-issue condition on severity High, Critical, and Blocker** (e.g. `New High issues > 0` fails the gate). Running the scanner without such a condition does not keep the bar: a scan can "pass" while still reporting High-or-worse issues.
- This is configuration of the gate's pass/fail condition, not suppression of a rule: it does not disable, downgrade, or exclude any rule and does not reduce any count. It sets the bar that every future merge must clear.

## Why Now
Open HIGH-or-worse SonarQube findings are a durable quality debt: they turn the SonarQube quality gate into a merge blocker for every future merge and accumulate risk over time. This mission clears the entire HIGH-or-worse set under strict discipline so the debt is zero — not merely reduced or visually lowered.

## No-Sweep Rule (non-negotiable)
The following are **not** fixes and are forbidden as a way to close a finding:
- Disabling, suppressing, downgrading, or excluding a SonarQube rule or path.
- Editing `sonar-project.properties` (or any SonarQube config) to change severity, add exclusions, or reduce a count.
- Mass suppression or metric-only relocation of the problem (e.g. splitting one finding into many, or moving it to a path the scanner does not scan).
- Reporting a reduced count while findings remain open with no follow-up.

Every HIGH-or-worse finding must be accounted for at mission end: fixed (rule no longer fires at that code site) or captured in a bounded follow-up with a stated target. Silence is not resolution.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: entire HIGH-or-worse SonarQube finding set must be closed; no partial reduction or suppression allowed; durable inventory of findings is the starting ground truth.

## Scope
- Every SonarQube finding ranked **High, Critical, or Blocker** in the durable inventory (or, if no inventory exists, every such finding surfaced by a local scan of the `src` tree).
- Fixing each finding at the code site so the rule no longer fires, keeping every observable behavior, and shipping focused regression tests for any changed branch.
- Promoting any finding whose fix changes behavior that cannot be captured by a focused regression test to a bounded follow-up task with a stated target and deadline — **never** leaving it open-unaccounted and **never** suppressing it to close it.
- Accounting for every single HIGH-or-worse finding in the final triage: fixed, or bounded follow-up with a stated target.
- Wiring the SonarQube quality gate (failing on new High-or-worse issues) into the merge boundary: the pre-integration gate plan and the GitHub required workflow, coordinated with TASK-2525.03.

## Out of Scope
- Changing SonarQube rule severity, disabling/suppressing/downgrading a rule, excluding a path, or editing `sonar-project.properties` to reduce a count.
- Running the SonarQube server as the source of truth to redefine the count; a local scan (`scripts/sonar-local.ts` or the repo's ranking tool) may confirm a rule at a code site, but the mandate is "close all HIGH-or-worse," not "match a server count."
- Leaving any HIGH-or-worse finding open with no follow-up.
- Metric-only refactors that lower a complexity number without changing an observable behavior.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives without an attached metric and vague quantifiers. For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: **Zero unresolved HIGH-or-worse findings at mission end.** Every finding with severity High, Critical, or Blocker is either fixed at its code site (rule no longer fires) or captured in a bounded follow-up task with a stated target. No finding is left open-unaccounted.
- SC2: Every completed fix that changes control flow has a focused regression test under `test/` covering each newly reachable branch; the relevant test file(s) pass via `npm test` (or the specific `tsx test/<path>.test.ts`) at the mission's final commit.
- SC3: **No suppression.** `sonar-project.properties` declares supported Sonar way defaults with no rule globally disabled, suppressed, or downgraded to reduce a count; no per-site suppression carries a count-moving effect. Any remaining per-site suppression must carry a written false-justification in the checkpoint, and must not be used to close a HIGH-or-worse finding.
- SC4: No HIGH-or-worse finding was closed by relocation, mass suppression, path exclusion, or a metric-only change. Every finding that no longer fires has a behavior change evidenced by a passing focused test (SC2), or is a legitimate false positive documented in the checkpoint.
- SC5: The full static-analysis gate passes at the final commit: `./scripts/verify-local.sh static-analysis` (ESLint, `tsc --checkJs`, and test-hygiene) exits 0.
- SC6: Each slice stays within the per-slice NEL budget (ADR 0047); anything beyond the assigned slices becomes a bounded follow-up task with a stated target rather than an unbounded refactor.
- SC7: **The bar is wired into the merge boundary.** The pre-integration gate plan (`workflow.config.json` `adapters.gates.preIntegration`) and the GitHub required workflow (`ci-required`) both run the shared SonarQube command and fail on a non-passing quality gate; the gate carries an explicit new High/Critical/Blocker issue condition; `./scripts/verify-local.sh static-analysis` passes and the focused configuration test (per TASK-2525.03 DOD #4) proves both declarations call the shared command. A future merge creating a new High-or-worse issue is therefore blocked.

## Risks and Assumptions
- Some HIGH-or-worse findings live behind real external boundaries that cannot be exercised by a focused test (e.g. real Forgejo, process/port startup). Mitigation: promote to a bounded follow-up with a stated target — do NOT suppress or exclude to close them.
- A fix that changes shared control flow risks regressions in sibling callers. Mitigation: SC2 requires focused tests for changed branches; run affected test files and `./scripts/verify-local.sh static-analysis` after each fix.
- Scope creep across the entire finding set. Mitigation: bounded slices per ADR 0047 NEL budget; anything beyond assigned slices becomes a bounded follow-up with a stated target (SC6).
- The mandate is "close all HIGH-or-worse," which is larger than a single-rule slice. Mitigation: prioritize by severity (Blocker → Critical → High) and by code-site proximity; track every finding so none is silently dropped.

## Checkpoints
- CP 1: Full inventory + plan. Gather the complete set of HIGH-or-worse findings (durable inventory, or local scan of `src`). Classify each as fix-at-site, promote-to-follow-up, or documented-false-positive. Record the full list, per-finding severity, per-finding disposition, and the plan to reach zero unresolved.
- CP 2: First fix + regression tests. Fix the highest-severity slice at its code site, keep every observable behavior, add focused tests for each changed branch under `test/`. Run affected test files and `./scripts/verify-local.sh static-analysis` before advancing.
- CP 3: Continue fixes. Repeat CP 2 for the next findings, bounded by the NEL budget (ADR 0047). Promote any finding whose fix cannot be covered by a focused regression test to a bounded follow-up with a stated target; do not suppress it.
- CP 4: Final triage pass. Confirm every HIGH-or-worse finding is fixed or captured in a bounded follow-up with a stated target (SC1); confirm no rule was disabled, suppressed, downgraded, or path-excluded to move a count (SC3/SC4).
- CP 5: Final verification. Run the full `./scripts/verify-local.sh all` gate and confirm it passes; record the result in the Goal Check.
- CP 6: Enforcement wiring confirmation. Confirm the SonarQube quality gate fails on new High-or-worse issues and is wired into both the pre-integration gate plan and the GitHub required workflow, coordinated with TASK-2525.03. Prove with a named configuration test or a `./scripts/verify-local.sh` invocation that both pipeline declarations invoke the shared scan command and that the gate's new-issue condition includes High, Critical, and Blocker severities.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `npm test -- test/<path>.test.ts` ``, `` `px review <slug> --verify` ``, or `` `./scripts/verify-local.sh static-analysis` ``
  2. **Test names** — must match a test name in the repo
  3. **Test file paths** — must be an existing test file
  4. **ADR references** — must correspond to an existing file under `docs/adr/`
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above. NOTE: raw `stat`/`ls` output or a prose sentence like "the count is lower now" is NOT sufficient evidence on its own — pair it with one of the accepted references. The implementer must show both the shell output AND the accepted reference that ties that output to the criterion.
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

## Coordination
- TASK-2525.03 owns the existing shared-command wiring. This mission owns SC7: the shared command must reject a quality gate that permits any new issue, which necessarily includes High, Critical, and Blocker issues.

## Restricted Areas
- Do not edit `sonar-project.properties` or any SonarQube config to change severity, disable, suppress, downgrade, or exclude a path.
- Do not run the SonarQube server or alter `infra/sonarqube` as the source of truth to redefine the count.
- Do not add a test whose only assertion counts lines or complexity without asserting a behavior.
- Do not close a HIGH-or-worse finding by suppression, relocation, path exclusion, or a metric-only change.
- Do not create or edit backlog files outside the follow-up tasks this mission legitimately generates; do not modify the `assignee` field on any backlog file.
- Do not modify source files outside the slice scope, the `test/` regression tests for those slices, the durable inventory, and this MISSION.md.

## Stop Rules
- Stop the whole mission if `./scripts/verify-local.sh static-analysis` fails and the failures are not directly caused by the current fix and immediately resolvable.
- Stop advancing a slice if its fix changes observable behavior that cannot be covered by a focused regression test (SC2) — promote the finding to a bounded follow-up with a stated target rather than shipping an untested change or suppressing it.
- Stop if the assigned NEL budget (ADR 0047) is exhausted; remaining findings become bounded follow-up tasks with a stated target (SC6) — but never suppress them to close.
- Stop editing source outside the slice scope, the associated `test/` regression tests, the durable inventory, and this MISSION.md.
