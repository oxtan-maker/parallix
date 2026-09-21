# CP-8 — Final Cloud verification

## Summary

The mission branch was analysed as a long-lived SonarQube Cloud branch. Source
site repairs removed every inherited High-or-Blocker finding without a
suppression, rule change, source exclusion, or issue-status transition. The
shared gate now rejects a short mission analysis, lets Cloud reject new issues,
and rejects any remaining High-or-Blocker impact in the long-lived candidate.

Reviewed source revision: `e042591810cca49f4bc70f673777cf1be9c5fdad`.
Cloud published that revision at `2026-09-21T17:44:14Z`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Fresh candidate analysis completes as LONG | `SONAR_USER_HOME=<temporary runtime cache> npm run sonar` exit 0 at reviewed source revision; scanner log `Branch name: mission/task-2525.05, type: long`; Cloud analysis `2026-09-21T17:44:14Z` reports revision `e042591810cca49f4bc70f673777cf1be9c5fdad` | PASS |
| Candidate has zero unresolved High/Blocker impacts across total code | Fresh scan exit 0; Cloud `api/issues/search?branch=mission/task-2525.05&resolved=false&impactSeverities=HIGH,BLOCKER` returns `total: 0` | PASS |
| Cloud quality gate passes and rejects new issues | Scanner log `QUALITY GATE STATUS: PASSED`; Cloud `api/qualitygates/project_status` returns `OK` | PASS |
| Gate refuses non-LONG candidates and never uses main as a substitute | `scripts/sonar-local.ts:41`, `scripts/sonar-local.ts:33`; `"task-2525.05: total-code check rejects a short mission branch and skips pull-request analysis"`, `"task-2525.05: shared scanner rejects High-or-Blocker issues in the candidate analysis"`, `"task-2525.05: candidate scope identifies local branches and GitHub pull requests"` in `test/task-2525.03-sonar-enforcement.test.ts` | PASS |
| S5852 regexes replaced at source | `src/adapters/backlog/task-metadata.ts:9` (`findFieldBlock`), `src/adapters/backlog/task-transitions.ts:237`; `"setTaskLabels replaces a CRLF block labels field"`, `"setTaskAssignee preserves CRLF and the next frontmatter field"`, `"setTaskAssignee accepts blank lines before CRLF block items"`, `"clearTaskAgentAssignee handles CRLF block form"` in `test/task-metadata-pure.test.ts`; `"replaceTaskAssignees rewrites a block field without consuming the next frontmatter field"` in `test/sonarqube-reliability-repairs.test.ts` | PASS |
| S5443 temp directory made private | `src/adapters/forgejo/forgejo-auth.ts:47`; `"resolveForgejoHome returns a private missing fallback in test context when FORGEJO_HOME is unset"` in `test/forgejo.test.ts` | PASS |
| S2871 sorts use explicit comparators | `src/application/projections/metrics.ts:193`, `src/application/projections/metrics.ts:198`; `test/sonarqube-s2871-sorts.test.ts` | PASS |
| PL/SQL whole-table UPDATEs carry row-selecting predicates (operator-requested) | `src/adapters/sqlite/migrations/0007-usage-statistics-identity.sql:46` (`length(actor_key) = 0`, column is `NOT NULL DEFAULT ''`), `:51-52` (skip already-normalized `stage`); the migration checker accepts main's recorded pre-Sonar checksum without rewriting the shared ledger; `"accepts the recorded pre-Sonar checksum for migration 0007 without rewriting it"` in `test/sqlite-adapter-cp1.test.ts` | PASS |
| S2699 tests assert real behavior | Assertions added in `test/cli-format.test.ts`, `test/review-artifacts.test.ts`, `test/sqlite-ports-cp2.test.ts`, `test/task-2286-native-sea-smoke.test.ts`, `test/task-2520-integrate-rebase-state.test.ts`, `test/tui-spawn.test.ts` | PASS |
| No suppression, rule, configuration-to-reduce, exclusion, or status transition | `grep -rn NOSONAR src scripts` returns nothing; `sonar-project.properties` is unchanged from main; per `docs/adr/0060-per-worktree-sonarqube-analysis-identity.md:110` the only Cloud setting changed is the long-lived branch pattern `(branch|release)-.*\|mission/.*`, which widens analysis | PASS |
| Required repository verification passes | `./scripts/verify-local.sh static-analysis` (ALL STAGES PASSED); `./scripts/verify-local.sh all` (2897 pass, 0 fail); `npm test` (2897 pass, 0 fail) | PASS |
| Docs reflect the gate change | `docs/adr/0060-per-worktree-sonarqube-analysis-identity.md:110` | PASS |

Follow-up: TASK-2551 removes mission Sonar branch analyses after integration. Missions still analysed as SHORT (`mission/task-2546`, `mission/task-2547`) need their Cloud branch deleted before their next scan.
