# CP-5: Forced authentication proven locked, dead config removed, Stop Rule 1 upheld

## Summary

Re-verified the blocker reported in CP-2 through CP-4 directly against the
running local service and found the earlier explanation partly wrong, which
changed the tree.

Earlier checkpoints kept `SONAR_FORCEAUTHENTICATION: "false"` in
`infra/sonarqube/compose.yml` and described it as effective ("it did take effect
for anonymous browsing"). That is not the case on the pinned image. The running
container does carry the variable, and the server still reports the setting as
enabled:

```
$ docker inspect <sonarqube container> --format '{{range .Config.Env}}{{println .}}{{end}}' | grep FORCE
SONAR_FORCEAUTHENTICATION=false

$ curl -s "http://127.0.0.1:9000/api/settings/values?keys=sonar.forceAuthentication"
{"settings":[{"key":"sonar.forceAuthentication","value":"true","parentValue":"true"}],"setSecuredSettings":[]}

$ curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:9000/api/plugins/installed
403
```

On `sonarqube:25.6.0.109173-community` forced authentication is locked on: the
compose variable is accepted by Docker, ignored by SonarQube, and both `value`
and `parentValue` remain `true`. The scanner's first authenticated engine call,
`GET /api/plugins/installed`, therefore returns `403` for an anonymous client,
which is the same rejection recorded in CP-4.

Consequences applied to the tree:

- Removed the inert `SONAR_FORCEAUTHENTICATION: "false"` line from
  `infra/sonarqube/compose.yml`. It granted nothing, and leaving a knob that
  reads as "local analysis is anonymous" is itself an auth footgun of the kind
  this mission exists to remove. `infra/sonarqube/compose.yml` is now byte-identical
  to `main`, still publishing only `"127.0.0.1:9000:9000"` on the unchanged
  `sonarqube:25.6.0.109173-community` image and `postgres:16-alpine` topology.
- Retargeted the corresponding assertion in
  `test/task-2527-local-sonar-no-auth.test.ts` from the removed setting to
  `assert.doesNotMatch(compose, /SONAR_(?:TOKEN|LOGIN|PASSWORD)\b/)`, so the test
  pins the credential-free compose contract rather than a setting the server
  ignores. The loopback assertion `assert.match(compose, /127\.0\.0\.1:9000:9000/)`
  is retained.
- `package.json` keeps the one surviving correction:
  `"sonar": "env -u SONAR_TOKEN -u SONAR_LOGIN -u SONAR_PASSWORD -u SONAR_SCANNER_OPTS sonar-scanner-npm"`,
  so an inherited developer-shell credential cannot silently mask the
  unauthenticated path.
- `sonar-project.properties` remains untouched: `sonar.projectKey=parallix`,
  `sonar.host.url=http://127.0.0.1:9000`, `sonar.sources=src`, `sonar.tests=test`,
  `sonar.test.inclusions=**/*.test.ts`, `sonar.exclusions`,
  `sonar.javascript.lcov.reportPaths=coverage/lcov.info`, `sonar.qualitygate.wait=true`.

The entire branch diff against `main` outside `missions/` and `backlog/` is now
`package.json` and `test/task-2527-local-sonar-no-auth.test.ts`
(`git diff main --stat -- . ':(exclude)missions' ':(exclude)backlog'`), with zero
files changed under `src/`.

## Stop Rule 1 upheld, with a stronger basis

Stop Rule 1 states: stop if the pinned local SonarQube Community image cannot
accept an anonymous local submission without adding credentials or pre-creating
an account. CP-4 raised it on the grounds that the anonymous `Anyone` group lacks
the `scan` permission. This checkpoint establishes the stricter fact that forced
authentication itself cannot be disabled on this image, so no permission grant
would help either: the scanner must present a credential before any engine call
succeeds. Every remaining route to a submission — generating a token, logging in
as an administrator, pre-creating an account, or editing server-side permission
state — is listed under this mission's Out of Scope and Restricted Areas.

Direction is required on whether the parent SonarQube rollout wants a local
credential bootstrap, a different image or version that permits anonymous
analysis, or acceptance that the local path requires one token.

## Gate results on this tree

- `./scripts/verify-local.sh static-analysis` — exit `0`: `PASS: ESLint clean`,
  `PASS: tsc typecheck clean`, `PASS: no test-hygiene violations`,
  `PASS: test typecheck clean`, `=== Static Analysis Gate: ALL STAGES PASSED ===`.
- `./scripts/verify-local.sh all` — exit `1`: `tests 2640`, `pass 2639`, `fail 1`.
  The single failure is `test/task-2526-web-summary-repro.test.ts`, test name
  `web mission summary renders folded YAML description text`
  (`AssertionError: folded scalar must not leak the YAML marker`). It is inherited
  from `main`: this branch changes no file under `src/` and does not touch that
  test, so the failure is not attributable to this mission and cannot be repaired
  inside its scope.
- `npx tsx --test test/task-2527-local-sonar-no-auth.test.ts` —
  `✔ local SonarQube scan submits without authentication configuration`
  (`tests 1`, `pass 1`, `fail 0`), reading only `package.json`,
  `sonar-project.properties`, and `infra/sonarqube/compose.yml`; no Docker, no
  scanner process, no network socket.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Clean-shell `npm run sonar` submits `parallix` to `http://127.0.0.1:9000` without a 401, missing-token error, or prompt | `npm run sonar:up`, `npm run sonar`; `sonar.forceAuthentication` reports `value` and `parentValue` `true` on `sonarqube:25.6.0.109173-community` despite `SONAR_FORCEAUTHENTICATION=false` in the container, and anonymous `GET /api/plugins/installed` returns `403` | BLOCKED (Stop Rule 1) |
| Local scanner configuration introduces no token, login, password, secret file, remote host URL, or credential-management command | `package.json`, `sonar-project.properties`, `infra/sonarqube/compose.yml`; `test/task-2527-local-sonar-no-auth.test.ts` asserts `assert.doesNotMatch(properties, /^sonar\.(?:token\|login\|password)=/m)` and `assert.doesNotMatch(compose, /SONAR_(?:TOKEN\|LOGIN\|PASSWORD)\b/)` | PASS |
| `sonar-project.properties` keeps `sonar.host.url=http://127.0.0.1:9000` and `infra/sonarqube/compose.yml` keeps `127.0.0.1:9000:9000` | `sonar-project.properties`, `infra/sonarqube/compose.yml` (now identical to `main`), `test/task-2527-local-sonar-no-auth.test.ts` | PASS |
| Focused test `local SonarQube scan submits without authentication configuration` asserts the no-token invocation and loopback endpoint without Docker or a real service | `test/task-2527-local-sonar-no-auth.test.ts`, `npx tsx --test test/task-2527-local-sonar-no-auth.test.ts` (`pass 1`, `fail 0`) | PASS |
| `./scripts/verify-local.sh static-analysis` exits zero on the final tree | `./scripts/verify-local.sh static-analysis` (exit `0`, `=== Static Analysis Gate: ALL STAGES PASSED ===`) | PASS |
| `./scripts/verify-local.sh all` exits zero on the final tree | `./scripts/verify-local.sh all` (exit `1`, `tests 2640`, `pass 2639`, `fail 1`): inherited `main` failure in `test/task-2526-web-summary-repro.test.ts`, test `web mission summary renders folded YAML description text`; this branch changes no `src/` file | BLOCKED (inherited from `main`, outside mission scope) |

Next action: `./scripts/verify-local.sh static-analysis` exits `0` and the focused test `local SonarQube scan submits without authentication configuration` passes, while `./scripts/verify-local.sh all` exits `1` solely on the inherited `test/task-2526-web-summary-repro.test.ts` failure; the mission halts under Stop Rule 1 because `sonarqube:25.6.0.109173-community` keeps `sonar.forceAuthentication` locked to `true` regardless of `SONAR_FORCEAUTHENTICATION`, so direction is needed on whether to change the SonarQube image/version, accept a single local token, or close this task as not achievable without credentials.
