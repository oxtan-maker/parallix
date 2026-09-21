# Mission: Close every open SonarQube High-or-worse issue (task-2525.05)

## Goal
Resolve every currently open SonarQube Cloud issue with impact severity `HIGH` or `BLOCKER` through behavior-preserving code changes. A fresh mission branch analysis must be `LONG` and report zero unresolved `HIGH,BLOCKER` impacts across total code, while its Cloud quality gate rejects every new issue.

## Why Now
The Cloud default project has 30 open High-or-worse findings: 15 `typescript:S5852`, 10 `typescript:S2699`, 2 `typescript:S2871`, 2 `plsql:DeleteOrUpdateWithoutWhereCheck`, and 1 `typescript:S5443`. Leaving them open keeps severe reliability and maintainability debt in the active codebase.

## Refinement Signals
- Predicted NEL bucket: Large (235+)
- Confidence: High
- Selection note: activate as-is
- Main drivers: 138 findings across six TypeScript rules, dominated by 113 `typescript:S3776` findings; each must be resolved at its source without masking the analysis result.

## Scope
- Run a fresh SonarQube Cloud analysis and retain the mission High-or-worse total-impact result for execution checkpoints.
- Refactor the source sites responsible for all currently unresolved `HIGH` and `BLOCKER` impacts in `parallix`, including `typescript:S5852`, `typescript:S2699`, `typescript:S2871`, `plsql:DeleteOrUpdateWithoutWhereCheck`, and `typescript:S5443`.
- Add or adjust focused regression coverage where a non-trivial refactor needs it to demonstrate behavior preservation.
- Run the repository’s SonarQube scan and quality-gate workflow after remediation, then verify the unresolved-impact API result is zero.
- Ensure no mission can pass the Sonar gate when its candidate analysis has a new issue or any unresolved High-or-Blocker impact across total code.

## Out of Scope
- Suppressing, downgrading, disabling, excluding, bulk-marking accepted, or otherwise hiding SonarQube findings.
- Changing SonarQube rules, severity mappings, project configuration, or source exclusions to reduce the count.
- Resolving issues below `HIGH`, unrelated cleanup, feature work, or behavior changes not required to remove a finding.
- Editing external SonarQube service configuration.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- A fresh SonarQube Cloud analysis completes against project `parallix` after the final code changes.
- The candidate mission branch is analysed as `LONG` and reports zero unresolved `HIGH,BLOCKER` impacts across `reliability_issues`, `security_issues`, and `maintainability_issues`; its Cloud quality gate rejects every new issue.
- Every baseline finding is resolved by a source-site change; no suppression, rule/severity/configuration change, source exclusion, or bulk issue-status transition is used to reduce the unresolved count.
- All Cloud baseline rule families are eliminated from the unresolved High-or-worse inventory: `typescript:S5852`, `typescript:S2699`, `typescript:S2871`, `plsql:DeleteOrUpdateWithoutWhereCheck`, and `typescript:S5443`.
- Each non-trivial behavior-preserving refactor has focused regression evidence, with no `.only` or bare `.skip` introduced.
- `./scripts/verify-local.sh static-analysis` and `./scripts/verify-local.sh all` complete successfully on the final tree.

## Risks and Assumptions
- Assumption: the SonarQube Cloud project `parallix`, scanner, and API are available to the implementing environment.
- Risk: regex and workflow repairs can subtly alter parsing, error propagation, or asynchronous control flow; preserve existing observable behavior and lock it with focused tests before merging each refactor cluster.
- Risk: a fresh LONG-branch analysis can reveal High-or-worse findings outside the creation baseline; they remain in scope because completion is defined by the final mission total, not by the original count.
- Risk: the size of the remediation may require staged checkpoints; do not substitute partial inventory closure for the zero-result completion criterion.

## Checkpoints
- CP 1: Establish the Cloud execution baseline with a fresh analysis; record the mission total-impact inventory, its rule distribution, and the exact scan/API commands that establish the starting state.
- CP 2: Resolve the Cloud baseline findings in coherent source-site batches, adding focused tests for each non-trivial change and recording the remaining mission total after each batch.
- CP 3: Run the final fresh analysis and required SonarQube Cloud quality-gate workflow; capture the zero-result mission total-impact result and final repository verification evidence.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- Use the exact heading `## Goal Check` followed by the exact 3-column table header `| Criterion | Evidence | Status |`.
- Provide at least one evidence row for every success criterion, led by durable references Parallix verifies today: exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`.
- For the final zero-result criterion, cite the exact fresh-analysis command and mission metrics output that reports zero `HIGH,BLOCKER` impacts; cite focused test names and their test paths for behavior-preservation criteria.
- File:line references are accepted when needed but discouraged because line numbers rot; prefer the durable forms above.
- Raw `stat`/`ls` output or generic prose alone is not enough: pair any shell output or prose with an accepted command, test name, test path, or ADR reference.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify SonarQube quality profiles, severity mappings, project settings, scanner configuration, issue workflow/statuses, or source-exclusion settings to reduce findings.
- Do not use suppressions, ignores, generated-code markings, or bulk issue actions as substitutes for code-site remediation.
- Do not alter behavior outside the minimum needed to preserve behavior while resolving a reported issue; stop and escalate if a finding cannot be removed without a product decision.

## Stop Rules
- Stop and request direction if the SonarQube Cloud project, scanner, or mission metrics API cannot be reached after environment diagnostics, because the completion authority cannot be verified.
- Stop and request direction if resolving a finding requires changing a documented product contract, compatibility guarantee, persistence format, or external integration behavior.
- Stop and request direction if a proposed remediation depends on suppressing, reclassifying, excluding, disabling, or bulk-transitioning an issue rather than fixing its source site.
- Do not declare completion while the final mission `HIGH,BLOCKER` total is nonzero, a required scan/quality-gate command fails, or the final repository gate fails.
