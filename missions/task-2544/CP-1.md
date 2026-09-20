# CP 1 — Map the current analysis identity and query path end to end

## Goal
Record every place the `parallix` SonarQube project key is hardcoded so the
per-worktree/branch isolation in later checkpoints has a complete target list.

## Work done
Traced the full SonarQube identity lifecycle from scan submission to
quality-gate query across every file named in the mission scope.

**Scan submission path.** `npm run sonar` → `tsx scripts/sonar-local.ts scan` →
`runSonar()`. The scanner (`sonar-scanner-npm`) reads `sonar-project.properties`
for `sonar.projectKey`, and `runSonar` additionally pins
`-Dsonar.newCode.referenceBranch=main`.

**Quality-gate query path.** `assertNewIssuesFail()` queries
`GET /api/qualitygates/get_by_project?project=<PROJECT_KEY>` then
`GET /api/qualitygates/show?name=<gate>` and asserts the gate fails on
`new_violations > 0`.

**Every hardcoded `parallix` location found:**

| File | Line | Role | Hardcoded value |
|---|---|---|---|
| `sonar-project.properties` | 1 | Scan identity submitted by scanner | `sonar.projectKey=parallix` |
| `scripts/sonar-local.ts` | 10 | Query constant for `assertNewIssuesFail` | `const PROJECT_KEY = 'parallix'` |
| `scripts/sonar-local.ts` | 73 | `get_by_project` query uses `PROJECT_KEY` | `?project=${PROJECT_KEY}` |
| `scripts/sonar-local.ts` | 96–99 | Comment asserting all worktrees share `parallix` | — (behavioral note) |
| `test/task-2525.03-sonar-enforcement.test.ts` | 82 | Reads recorded baseline key | `/sonar.projectKey=parallix/` |

**Shared-gate call sites (both invoke `npm run sonar`, so both inherit the
identity):**
- `.github/workflows/ci-required.yml` — "Run coverage plus mandatory SonarQube quality gate" step: `npm run test:coverage -- --threshold 0 --lcov && npm run sonar`.
- `workflow.config.json` `adapters.gates.preIntegration[3]` (`quality-gate`, order 4): `npm run test:coverage -- --threshold 0 --lcov && npm run sonar`.
- `config/integration-pipelines.json` — does not declare a sonar/quality gate directly; the `quality-gate` gate lives in `workflow.config.json` (confirmed by grep, no matches here).

**Local no-token path (must stay unchanged):** `setupSonar()` creates/reuses the
forgejo file token at `.forgejo-local/tokens/sonarqube`; `runSonar` prefers
`process.env.SONAR_TOKEN` (CI) then the file token; host is loopback
`http://127.0.0.1:9000` overridable via `SONAR_HOST_URL`.

## Constraint discovered
`sonar-project.properties` is a static, tracked file checked out identically in
every worktree, so the per-worktree key cannot live in that file. The override
must be applied at scan time via the scanner's `-Dsonar.projectKey=` flag
(from `runSonar`) and matched at query time (from a shared resolver in
`assertNewIssuesFail`). Native `sonar.branch.name` is rejected up front (needs
Developer/Enterprise edition; loopback is community). → drives CP 2.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Scan identity source mapped | `sonar-project.properties:1` `sonar.projectKey=parallix` | PASS |
| Query constant location mapped | `scripts/sonar-local.ts` line 10 `const PROJECT_KEY = 'parallix'` | PASS |
| Query call site mapped | `scripts/sonar-local.ts` line 73 `?project=${PROJECT_KEY}` | PASS |
| Shared gate call sites mapped | `workflow.config.json` `adapters.gates.preIntegration` `quality-gate`; `.github/workflows/ci-required.yml` coverage+sonar step | PASS |
| No sonar gate in integration-pipelines | `grep -i sonar config/integration-pipelines.json` (0 matches) | PASS |
| Local no-token path confirmed unchanged target | `scripts/sonar-local.ts` `setupSonar` / `readSonarToken` (`.forgejo-local/tokens/sonarqube`) | PASS |

## Next action
Commit CP-1.md, then execute CP 2: choose per-worktree/per-branch project-key
isolation, define the `main` dedicated identity, and write ADR 0060.
