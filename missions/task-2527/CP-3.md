# CP-3: Scope confirmation, verifier evidence, and Stop Rule 1

## Scope confirmation

The full mission diff touches three files plus checkpoint documents:
`package.json`, `infra/sonarqube/compose.yml`, and
`test/task-2527-local-sonar-no-auth.test.ts`. The only non-test, non-document
changes are:

```
+      SONAR_FORCEAUTHENTICATION: "false"
-    "sonar": "sonar-scanner-npm",
+    "sonar": "env -u SONAR_TOKEN -u SONAR_LOGIN -u SONAR_PASSWORD -u SONAR_SCANNER_OPTS sonar-scanner-npm",
```

Confirmed absent from the change set:

- No token, login, password, secret file, `.env` credential, token bootstrap
  flow, or credential-management path in `package.json`,
  `sonar-project.properties`, or `infra/sonarqube/compose.yml`.
- No remote-server setting: `sonar-project.properties` is unmodified and still
  declares `sonar.host.url=http://127.0.0.1:9000`.
- No source/test/coverage scope change: `sonar.sources=src`, `sonar.tests=test`,
  `sonar.test.inclusions`, `sonar.exclusions`,
  `sonar.javascript.lcov.reportPaths=coverage/lcov.info`, and
  `sonar.qualitygate.wait=true` are unchanged, as is the `parallix` project key.
- No non-loopback exposure: `infra/sonarqube/compose.yml` still publishes only
  `"127.0.0.1:9000:9000"`, on the unchanged
  `sonarqube:25.6.0.109173-community` image with the unchanged
  `postgres:16-alpine` database topology and existing named volumes.
- No GitHub Actions, Parallix pre-integration, quality-gate threshold, or
  unrelated package script was touched.
- `test/task-2527-local-sonar-no-auth.test.ts` reads only `package.json`,
  `sonar-project.properties`, and `infra/sonarqube/compose.yml` from disk; it
  starts no Docker container, spawns no scanner, and opens no network socket.

## Verifier results

- `./scripts/verify-local.sh static-analysis` — exit `0`:
  `PASS: ESLint clean`, `PASS: tsc typecheck clean`,
  `PASS: test-hygiene clean`, `PASS: test typecheck clean`,
  `=== Static Analysis Gate: ALL STAGES PASSED ===`.
- `./scripts/verify-local.sh all` — exit `0`: `tests 2632`, `pass 2632`,
  `fail 0`, `cancelled 0`, within the unit-test budget
  (`timeout=1000ms per test, suite budget=180000ms, elapsed=85545ms`).
- `npx tsx --test test/task-2527-local-sonar-no-auth.test.ts` —
  `✔ local SonarQube scan submits without authentication configuration`
  (`pass 1`, `fail 0`).

## Stop Rule 1 raised

The mission's first Stop Rule applies: the pinned local SonarQube Community
image cannot accept an anonymous local submission without adding credentials or
pre-creating an account.

With forced authentication disabled, the local service is reachable anonymously
(`GET /api/components/search?qualifiers=TRK` returns `200` and lists `parallix`),
and `npm run sonar` from a shell with `SONAR_TOKEN`, `SONAR_LOGIN`,
`SONAR_PASSWORD`, and `SONAR_SCANNER_OPTS` unset negotiates the server
(`Bootstrapper: SonarQube server version: 25.6.0`) before the engine rejects the
analysis:

```
[ERROR] ScannerEngine: You're not authorized to analyze this project or the project doesn't exist on SonarQube and you're not authorized to create it. Please contact an administrator.
```

On `sonarqube:25.6.0.109173-community` the `scan` permission is held only by the
`sonar-users` group ("Every authenticated user automatically belongs to this
group"); the anonymous `Anyone` group holds none. That permission is server
state, not scanner configuration: it cannot be expressed in `package.json`,
`sonar-project.properties`, or `infra/sonarqube/compose.yml`, and granting it
requires an authenticated administrator call or a pre-created account, both
excluded by this mission's Out of Scope and Restricted Areas. Direction is
required before any such grant, a volume reset, or a credential is introduced.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Clean-shell `npm run sonar` submits `parallix` to `http://127.0.0.1:9000` without a 401, missing-token error, or prompt | `npm run sonar:up`, `npm run sonar`; engine returned "You're not authorized to analyze this project" because the anonymous `Anyone` group holds no `scan` permission on `sonarqube:25.6.0.109173-community` | BLOCKED (Stop Rule 1) |
| Local scanner configuration introduces no token, login, password, secret file, remote host URL, or credential-management command | `package.json`, `sonar-project.properties`, `infra/sonarqube/compose.yml` | PASS |
| `sonar-project.properties` keeps `sonar.host.url=http://127.0.0.1:9000` and compose keeps `127.0.0.1:9000:9000` | `sonar-project.properties`, `infra/sonarqube/compose.yml`, `test/task-2527-local-sonar-no-auth.test.ts` | PASS |
| Focused test `local SonarQube scan submits without authentication configuration` asserts the contract without Docker or a real service | `test/task-2527-local-sonar-no-auth.test.ts`, `npx tsx --test test/task-2527-local-sonar-no-auth.test.ts` (`pass 1`, `fail 0`) | PASS |
| `./scripts/verify-local.sh static-analysis` and `./scripts/verify-local.sh all` exit zero on the final tree | `./scripts/verify-local.sh static-analysis` (exit `0`), `./scripts/verify-local.sh all` (exit `0`, `tests 2632`, `fail 0`) | PASS |

Next action: both declared verifiers pass on the final tree — `./scripts/verify-local.sh static-analysis` exit `0` and `./scripts/verify-local.sh all` exit `0` with `tests 2632` / `fail 0` — and the mission stops under Stop Rule 1 pending direction on how the anonymous `Anyone` group should receive the SonarQube `scan` permission without a credential or a pre-created account.
