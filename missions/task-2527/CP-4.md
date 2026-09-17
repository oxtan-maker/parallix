# CP-4: Independent verification, Stop Rule 1 confirmation, and final gate state

## Independent verification of the auth blocker

Re-traced the installed scanner (`sonarqube-scanner` v5.0.0, package name
`sonar-scanner-npm`, dependency `sonarqube-scanner@^5.0.0` in `package.json`)
end to end from `bin/sonar-scanner.js` → `src/runner.js` → `src/scan.js` →
`src/properties.js` → `src/scanner-engine.js` → `src/request.js`, and ran the
clean shell against the live service started by `npm run sonar:up`:

```
$ env -u SONAR_TOKEN -u SONAR_LOGIN -u SONAR_PASSWORD -u SONAR_SCANNER_OPTS npm run sonar
[INFO]  Bootstrapper: SonarQube server version: 25.6.0
[INFO]  Bootstrapper: JRE provisioning is supported
[INFO]  ScannerEngine: Load plugins index
[DEBUG] ScannerEngine: --> GET http://127.0.0.1:9000/api/plugins/installed
[DEBUG] ScannerEngine: <-- 403 http://127.0.0.1:9000/api/plugins/installed (3ms)
[DEBUG] ScannerEngine: Error response content: {"errors":[{"msg":"Insufficient privileges"}]}
[ERROR] ScannerEngine: You're not authorized to analyze this project or the project doesn't exist on SonarQube and you're not authorized to create it.
```

Root cause: the scanner sends **no** credentials when `SONAR_TOKEN`,
`SONAR_LOGIN`, `SONAR_PASSWORD`, and `SONAR_SCANNER_OPTS` are all unset (the
`sonar` script in `package.json` unsets them, and `getEnvironmentProperties()`
only maps `SONAR_TOKEN` → `sonar.token` per `constants.js`), so the engine's
first authenticated call `GET /api/plugins/installed` returns `403 Insufficient
privileges`. That endpoint requires the authenticated `scan`/`admin`
permission; the anonymous `Anyone` group holds none on
`sonarqube:25.6.0.109173-community`.

Checked every repo-owned lever and every no-auth escape hatch:

- `sonar-project.properties`: no `sonar.login`/`sonar.password`/`sonar.token`
  (the focused test asserts `assert.doesNotMatch(properties, /^sonar\.(?:token|login|password)=/m)`); host is loopback.
- `infra/sonarqube/compose.yml`: `SONAR_FORCEAUTHENTICATION: "false"` only opens
  the **web UI** anonymously — verified `GET /api/components/search?qualifiers=TRK`
  returns `200` anonymous — but it cannot grant the `scan` permission, which is
  server state, not a compose env var.
- `admin:admin` as `sonar.login`: the bootstrapper's JRE-provisioning check uses
  axios `Authorization: Bearer <token>` (`request.js`), so `Bearer admin:admin`
  is rejected at `GET /analysis/version` → `401` before the engine ever runs.
  A generated token requires an authenticated admin call (server state, out of
  scope).
- Project pre-creation (`/api/projects/create`) does not change the
  `/api/plugins/installed` `403` — that call is global, not project-scoped.
- No compose env var, image change, or database-topology change grants
  anonymous `scan`; doing so would touch Out of Scope items.

Conclusion: on `sonarqube:25.6.0.109173-community` there is **no**
repository-owned configuration that lets `npm run sonar` submit the `parallix`
analysis without a credential or a pre-created account. **Stop Rule 1 applies.**

## Gate state on the final committed tree

- `./scripts/verify-local.sh static-analysis` — exit `0`:
  `PASS: ESLint clean`, `PASS: tsc typecheck clean`,
  `PASS: no test-hygiene violations`, `PASS: test typecheck clean`,
  `=== Static Analysis Gate: ALL STAGES PASSED ===`.
- `./scripts/verify-local.sh all` — exit `1`: `tests 2640`, `fail 1`. The single
  failure is `test/task-2526-web-summary-repro.test.ts`
  ("web mission summary renders folded YAML description text"), a task-2526 web
  summary regression unrelated to this mission's SonarQube scope. Verified it
  fails on the pre-task base `5c105ee2` (`execute(task-2527): capture agent
  output`), i.e. before any task-2527 change:

  ```
  $ git checkout 5c105ee2 && npx tsx --test test/task-2526-web-summary-repro.test.ts
  ℹ pass 1  ℹ fail 1
  ```

  My task-2527 diff vs that base is only the backlog front-matter and this
  checkpoint (`git diff 5c105ee2 -- package.json sonar-project.properties
  infra/sonarqube/compose.yml test/` is empty).
- Focused contract test — `npx tsx --test test/task-2527-local-sonar-no-auth.test.ts`:
  `✔ local SonarQube scan submits without authentication configuration`
  (`pass 1`, `fail 0`). It reads only `package.json`, `sonar-project.properties`,
  and `infra/sonarqube/compose.yml` from disk; starts no Docker, spawns no
  scanner, opens no socket.

## Scope preservation (no auth footgun introduced)

- No token, login, password, secret file, `.env` credential, token bootstrap,
  or credential-management path in `package.json`, `sonar-project.properties`,
  or `infra/sonarqube/compose.yml`.
- `sonar-project.properties` unchanged: `sonar.projectKey=parallix`,
  `sonar.host.url=http://127.0.0.1:9000`, `sonar.sources=src`,
  `sonar.tests=test`, `sonar.test.inclusions=**/*.test.ts`,
  `sonar.exclusions=...`, `sonar.javascript.lcov.reportPaths=coverage/lcov.info`,
  `sonar.qualitygate.wait=true`.
- `infra/sonarqube/compose.yml` still publishes only
  `"127.0.0.1:9000:9000"` on the unchanged
  `sonarqube:25.6.0.109173-community` image with unchanged `postgres:16-alpine`
  topology and named volumes; `SONAR_FORCEAUTHENTICATION: "false"` retained.
- No GitHub Actions, Parallix pre-integration, quality-gate threshold, or
  unrelated package script touched.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `npm run sonar` from a clean shell submits `parallix` to `http://127.0.0.1:9000` without a 401, missing-token error, or prompt | `npm run sonar:up`, `npm run sonar`; engine returned `403 Insufficient privileges` on `GET /api/plugins/installed` because the anonymous `Anyone` group holds no `scan` permission on `sonarqube:25.6.0.109173-community` | BLOCKED (Stop Rule 1) |
| Local scanner configuration introduces no token, login, password, secret file, remote host URL, or credential-management command | `package.json`, `sonar-project.properties`, `infra/sonarqube/compose.yml`; `test/task-2527-local-sonar-no-auth.test.ts` (`assert.doesNotMatch(properties, /^sonar\.(?:token|login|password)=/m)`) | PASS |
| `sonar-project.properties` keeps `sonar.host.url=http://127.0.0.1:9000` and compose keeps `127.0.0.1:9000:9000` | `sonar-project.properties`, `infra/sonarqube/compose.yml`, `test/task-2527-local-sonar-no-auth.test.ts` | PASS |
| Focused test `local SonarQube scan submits without authentication configuration` asserts the contract without Docker or a real service | `test/task-2527-local-sonar-no-auth.test.ts`, `npx tsx --test test/task-2527-local-sonar-no-auth.test.ts` (`pass 1`, `fail 0`) | PASS |
| `./scripts/verify-local.sh static-analysis` exits zero | `./scripts/verify-local.sh static-analysis` (exit `0`, `Static Analysis Gate: ALL STAGES PASSED`) | PASS |
| `./scripts/verify-local.sh all` exits zero | `./scripts/verify-local.sh all` (exit `1`): pre-existing `test/task-2526-web-summary-repro.test.ts` failure on base `5c105ee2`, unrelated to this mission | BLOCKED (pre-existing, out of scope) |

## Next action:
Stop Rule 1 applies — `sonarqube:25.6.0.109173-community` cannot accept an
anonymous local `npm run sonar` submission without a credential or a pre-created
account, and no repository-owned config can grant that; direction is required on
granting the SonarQube `scan` permission to the anonymous `Anyone` group (or a
pre-created account / volume reset) before the clean-shell submission criterion
can be met. The `./scripts/verify-local.sh all` gate additionally fails on a
pre-existing task-2526 web-summary regression (`test/task-2526-web-summary-repro.test.ts`)
outside this mission's scope; that is a separate blocker for the `all` gate.
