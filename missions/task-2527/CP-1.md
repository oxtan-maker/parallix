# CP-1: Trace and no-token contract

Traced `npm run sonar` to the pinned `sonarqube-scanner` v5 wrapper. Its only
token input is `SONAR_TOKEN`; the local `sonar-project.properties` contains no
credential and retains the loopback host. The scanner reads environment values
with higher precedence than project properties. Added the focused hermetic
contract test; it is red until CP-2 supplies the local anonymous-server setting
and clean-shell invocation.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Clean-shell scan can submit without authentication | `package.json`, `sonar-project.properties`, `npm run sonar` | PENDING CP-2 |
| Local configuration has no credential workflow | `sonar-project.properties`, `test/task-2527-local-sonar-no-auth.test.ts` | PASS |
| Loopback server endpoints remain configured | `sonar-project.properties`, `infra/sonarqube/compose.yml` | PASS |
| Focused no-token contract test exists | `test/task-2527-local-sonar-no-auth.test.ts`, `"local SonarQube scan submits without authentication configuration"` | PASS |
| Final verification commands pass | `./scripts/verify-local.sh static-analysis`, `./scripts/verify-local.sh all` | PENDING CP-3 |

Next action: CP-2 will set the traced forced-authentication server setting and make `npm run sonar` clear `SONAR_TOKEN`, `SONAR_LOGIN`, `SONAR_PASSWORD`, and `SONAR_SCANNER_OPTS` before invoking the scanner.
