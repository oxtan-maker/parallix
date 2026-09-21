# CP-4: Cloud wiring tests and the real quality gate

## Summary

**Focused Cloud-wiring coverage.** Added `test/sonarqube-cloud-wiring.test.ts` (7 tests, hermetic — injected scanner spawn, no network, no Docker, no committed token) covering the surviving wiring:

- `"local sonar scan submits the worktree branch to the one Cloud project"` — the exact argument vector (`sonar.host.url=https://sonarcloud.io`, `sonar.organization=oxtan-maker`, `sonar.projectKey=parallix`, `sonar.branch.name=<real Git branch>`), that `resolveSonarBranch()` returns the Git branch verbatim, that the environment token reaches the scanner's child environment, and that the token never appears in an argument.
- `"github sonar scan lets the CI integration derive the branch identity"` — under `GITHUB_ACTIONS=true` no `sonar.branch.name` is sent and every other argument is identical to the local call.
- `"sonar scan fails closed when no token is supplied"` — throws and never spawns the scanner.
- `"sonar scan fails closed when the quality gate does not pass"` — a non-zero scanner status (what `sonar.qualitygate.wait=true` produces for a failed gate) throws instead of passing through.
- `"local verification and GitHub invoke the same pinned sonar entrypoint"` — `package.json` `sonar` script, the `quality-gate` entry in `workflow.config.json` `adapters.gates.preIntegration`, and `.github/workflows/ci-required.yml` all run the one shared command; `sonarqube-scanner` is present in `package.json` and `package-lock.json`; no `npx --yes`.
- `"sonar analysis configuration consumes LCOV and baselines new code on main"` — `coverage/lcov.info`, `sonar.sources=src`, `sonar.newCode.referenceBranch=main`.
- `"no local SonarQube path survives anywhere in the tracked tree"` — walks `git ls-files` and asserts no `infra/sonarqube/` file, and no `127.0.0.1:9000`, `SONAR_MODE`, or project-key resolver in `src/`, `test/`, `scripts/`, `.github/`, `package.json`, `workflow.config.json` or `sonar-project.properties`. ADR 0060 is excluded by design: a decision record names the mechanisms it rejects.

The GitHub trusted/untrusted credential boundary stays covered by `test/task-2525.03-sonar-enforcement.test.ts` ("task-2525.03: GitHub workflow sources SONAR_TOKEN only from environment secrets").

**Real Cloud quality gate reconciled.** The live `parallix` project was attached to the built-in `Sonar way` gate, which is weaker than TASK-2525 policy: new-code coverage `< 80` and no new-issue condition at all, and the built-in gate reports `manageConditions: false`, so it cannot be edited. The available credential is authorised (`api/users/current` → groups `Members`, `Owners`; `api/qualitygates/list` → `actions.create: true`), so per the mission's "configure the provider only if the credential is authorised" clause a project gate was created rather than escalating:

Gate `Parallix new code` (id 160611), now associated with project `parallix`:

| Metric | Condition | Source |
|---|---|---|
| `new_violations` | `GT 0` | TASK-2525.04 — fail on every new issue, High/Critical/Blocker included |
| `new_coverage` | `LT 90` | TASK-2525.03 — "SonarQube must fail new-code coverage below 90%" |
| `new_security_rating` | `GT 1` | carried over from `Sonar way` |
| `new_reliability_rating` | `GT 1` | carried over from `Sonar way` |
| `new_maintainability_rating` | `GT 1` | carried over from `Sonar way` |
| `new_duplicated_lines_density` | `GT 3` | carried over from `Sonar way` |
| `new_security_hotspots_reviewed` | `LT 100` | carried over from `Sonar way` |

Nothing was weakened: every `Sonar way` condition is preserved, the coverage threshold moved 80 → 90, and the missing new-issue condition was added.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Cloud endpoint/project, branch selection and token handling are covered | `test/sonarqube-cloud-wiring.test.ts`; `npx tsx --test test/sonarqube-cloud-wiring.test.ts` — 7/7 pass | PASS |
| Local and GitHub differ only in branch identity | tests "local sonar scan submits the worktree branch to the one Cloud project" and "github sonar scan lets the CI integration derive the branch identity" | PASS |
| Fail-closed semantics (token, gate) | tests "sonar scan fails closed when no token is supplied" and "sonar scan fails closed when the quality gate does not pass" | PASS |
| SC4: one entrypoint, lockfile-pinned scanner | test "local verification and GitHub invoke the same pinned sonar entrypoint" | PASS |
| SC5: trusted/untrusted credential boundary | `test/task-2525.03-sonar-enforcement.test.ts` — "task-2525.03: GitHub workflow sources SONAR_TOKEN only from environment secrets" | PASS |
| SC2/SC7: no retired local path or toggle survives | test "no local SonarQube path survives anywhere in the tracked tree" | PASS |
| Real Cloud gate matches TASK-2525 policy | live `api/qualitygates/get_by_project?organization=oxtan-maker&project=parallix` → `{"qualityGate":{"id":160611,"name":"Parallix new code"}}`; `assertNewIssuesFail()` from `scripts/sonar-local.ts` run against the live API prints "live quality gate satisfies new_violations > 0" | PASS |
| Policy not weakened to obtain green | gate conditions above keep every `Sonar way` condition and raise `new_coverage` from 80 to 90; ADR 0060 — "The SonarQube Cloud project owns its configured quality profile and quality gate" | PASS |

Next action: CP-5 — add the Cloud-only Sonar section to the developer/operator documentation, add the ADR 0060 entry to `docs/adr/index.md`, run `./scripts/verify-local.sh all`, then run `npm run sonar` from this worktree and capture the live `Server URL: https://sonarcloud.io` / SCM revision / `QUALITY GATE STATUS: PASSED` evidence.
