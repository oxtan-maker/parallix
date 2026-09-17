# CP-2: Local-only correction and clean-shell submission attempt

Implemented the smallest local-only correction traced in CP-1:

- `package.json` now runs `sonar` as
  `env -u SONAR_TOKEN -u SONAR_LOGIN -u SONAR_PASSWORD -u SONAR_SCANNER_OPTS sonar-scanner-npm`,
  so an inherited credential in the developer shell cannot be forwarded to the
  local scanner and cannot mask an unauthenticated failure.
- `infra/sonarqube/compose.yml` now sets `SONAR_FORCEAUTHENTICATION: "false"` on
  the `sonarqube` service. The port publication remains `127.0.0.1:9000:9000`
  and the image and database topology are unchanged.
- `sonar-project.properties` is untouched: it still carries
  `sonar.host.url=http://127.0.0.1:9000`, the `parallix` project key, the
  `src`/`test` inputs, `coverage/lcov.info`, and `sonar.qualitygate.wait=true`.

The focused contract test passes:
`npx tsx --test test/task-2527-local-sonar-no-auth.test.ts` reports
`✔ local SonarQube scan submits without authentication configuration`
(`tests 1`, `pass 1`, `fail 0`), with no Docker and no SonarQube access.

## Clean-shell submission attempt

`npm run sonar:up` recreated the service and
`curl http://127.0.0.1:9000/api/system/status` reported
`{"id":"243B8A4D-AaCpu2238wHW79XtA1Ue","version":"25.6.0.109173","status":"UP"}`.

With `SONAR_TOKEN`, `SONAR_LOGIN`, `SONAR_PASSWORD`, and `SONAR_SCANNER_OPTS`
unset, `npm run sonar` connected anonymously, negotiated the server
(`Bootstrapper: Server URL: http://127.0.0.1:9000`,
`Bootstrapper: SonarQube server version: 25.6.0`), loaded global settings, and
then failed at plugin load with:

```
[ERROR] ScannerEngine: You're not authorized to analyze this project or the project doesn't exist on SonarQube and you're not authorized to create it. Please contact an administrator.
```

`SONAR_FORCEAUTHENTICATION: "false"` did take effect for anonymous browsing:
`GET /api/components/search?qualifiers=TRK` returns `200` anonymously and lists
the existing `parallix` project. Analysis is gated by a separate server-side
permission. Inspecting the running service shows the `scan` permission is held
only by `sonar-users` ("Every authenticated user automatically belongs to this
group"); the anonymous `Anyone` group holds no `scan` permission, and granting
it requires an authenticated administrator call against the running server.

That grant cannot be expressed in `package.json`, `sonar-project.properties`, or
`infra/sonarqube/compose.yml`, and performing it requires an administrator
login/password or a pre-created account — both excluded by this mission's Out of
Scope and Restricted Areas. The pinned `sonarqube:25.6.0.109173-community` image
therefore cannot accept an anonymous local submission under the mission's
constraints, which triggers the first Stop Rule.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Clean-shell `npm run sonar` submits `parallix` to `http://127.0.0.1:9000` without a 401, missing-token error, or prompt | `npm run sonar:up`, `npm run sonar`; scanner reached the server anonymously but the engine returned "You're not authorized to analyze this project" because the `Anyone` group lacks the `scan` permission | BLOCKED (Stop Rule 1) |
| Local scanner configuration introduces no token, login, password, secret file, remote host URL, or credential-management command | `package.json`, `sonar-project.properties`, `infra/sonarqube/compose.yml` | PASS |
| `sonar-project.properties` keeps `sonar.host.url=http://127.0.0.1:9000` and compose keeps `127.0.0.1:9000:9000` | `sonar-project.properties`, `infra/sonarqube/compose.yml`, `test/task-2527-local-sonar-no-auth.test.ts` | PASS |
| Focused test `local SonarQube scan submits without authentication configuration` asserts the contract without Docker or a real service | `test/task-2527-local-sonar-no-auth.test.ts`, `npx tsx --test test/task-2527-local-sonar-no-auth.test.ts` (`pass 1`, `fail 0`) | PASS |
| `./scripts/verify-local.sh static-analysis` and `./scripts/verify-local.sh all` exit zero | recorded in CP-3 | PENDING CP-3 |

Next action: the clean-shell submission reached the local server anonymously but was rejected with "You're not authorized to analyze this project"; CP-3 records the declared verifier results and raises Stop Rule 1, because granting the `Anyone` group the `scan` permission on `sonarqube:25.6.0.109173-community` requires an administrator credential or a pre-created account.
