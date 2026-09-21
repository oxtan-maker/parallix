# CP-7 — Cloud gate correction and current baseline

## Summary

ADR 0060 made SonarQube Cloud the sole analysis service after this mission was
created. The Cloud quality gate rejects new issues. The shared `npm run sonar`
command additionally requires the mission branch to be `LONG` and rejects
unresolved `HIGH,BLOCKER` impacts across its total code. It does not query or
block on the default project.

The default project inventory remains the source baseline for remediation: 15
`typescript:S5852`, 10 `typescript:S2699`, 2 `typescript:S2871`, 2
`plsql:DeleteOrUpdateWithoutWhereCheck`, and 1 `typescript:S5443`. It is not
a mission gate; the final candidate analysis must itself have zero High/Blocker
impacts.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Candidate LONG-branch total High/Blocker impacts are enforced | `test/task-2525.03-sonar-enforcement.test.ts`, `"task-2525.05: total-code check rejects a short mission branch and skips pull-request analysis"` | PASS |
| Candidate new issues are rejected | `scripts/sonar-local.ts`, `"task-2525.04: shared scanner rejects a quality gate that permits new High-or-worse issues"` | PASS |
| Candidate total High/Blocker impacts are zero | Pending final Cloud analysis | NOT ACHIEVED |
| No suppression is used for the review fixes | `src/adapters/git/agent-worktree.ts` has no `NOSONAR`; source-site changes are covered by focused tests | PASS |
| Static verification is clean | Pending final run after the current remediation batch | PENDING |

Next action: repair the first 2–3 source findings, then run the shared Cloud scan and record the candidate total-impact count.
