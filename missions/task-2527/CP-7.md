# CP-7: Review round 1 resolution (codex, REQUEST_CHANGES)

## Summary

Both round-1 findings were accepted and fixed. The mission diff is now confined
to the focused test; no source file and no SonarQube configuration file is
modified by this branch.

### F1 — unrelated frontmatter-parser repair removed (fixed)

`src/adapters/backlog/task-file-io.ts` is reverted to `main`. The reviewer is
right that the block-scalar parser repair is outside this SonarQube mission, and
it is already owned elsewhere: `review/mission/task-2526` carries the same
`src/adapters/backlog/task-file-io.ts` change together with
`test/task-2526-web-summary-repro.test.ts`, and that mission is in review. The
repair therefore lands through its own mission rather than this one. Parked
against task-2526, not dropped.

### F2 — regressive scanner wrapper reverted (fixed)

`package.json` is reverted to `main`: the `sonar` script is
`"sonar": "sonar-scanner-npm"` again. The reviewer's reasoning holds — CP-5
established that `sonarqube:25.6.0.109173-community` keeps
`sonar.forceAuthentication` locked to `true` and returns `403` on anonymous
`GET /api/plugins/installed`, so stripping `SONAR_TOKEN`, `SONAR_LOGIN`,
`SONAR_PASSWORD`, and `SONAR_SCANNER_OPTS` could not produce a successful
anonymous scan, and it additionally broke the one path that does work for a
developer holding a valid local credential. The mission halts for product
direction instead of shipping that wrapper.

`test/task-2527-local-sonar-no-auth.test.ts` keeps its mission-required name and
now asserts `assert.equal(packageJson.scripts.sonar, 'sonar-scanner-npm')`, so it
pins a scanner invocation that carries no credential argument, alongside the
unchanged loopback and no-credential assertions.

## Resulting diff

`git diff main --stat -- . ':(exclude)missions' ':(exclude)backlog'` reports one
file, `test/task-2527-local-sonar-no-auth.test.ts` (19 insertions).
`package.json`, `sonar-project.properties`, `infra/sonarqube/compose.yml`, and
every file under `src/` are identical to `main`.

## Gate results

- `./scripts/verify-local.sh static-analysis` — exit `0`,
  `=== Static Analysis Gate: ALL STAGES PASSED ===`.
- `./scripts/verify-local.sh all` — exit `1`: `tests 2640`, `pass 2639`,
  `fail 1`. The single failure is `test/task-2526-web-summary-repro.test.ts`,
  test `web mission summary renders folded YAML description text`. That test is
  present on `main` while its fix is still in review on
  `review/mission/task-2526`, so `main` itself is red on this test and this
  branch inherits it. Reverting the parser repair per F1 necessarily restores
  this failure; the two requirements cannot both be satisfied from this mission.
- `npx tsx --test test/task-2527-local-sonar-no-auth.test.ts` —
  `✔ local SonarQube scan submits without authentication configuration`
  (`pass 1`, `fail 0`).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Clean-shell `npm run sonar` submits `parallix` to `http://127.0.0.1:9000` without a 401, missing-token error, or prompt | `npm run sonar:up`, `npm run sonar`; anonymous `GET /api/plugins/installed` returns `403` and `sonar.forceAuthentication` stays `true` on `sonarqube:25.6.0.109173-community` (`missions/task-2527/CP-5.md`) | BLOCKED (Stop Rule 1) |
| Local scanner configuration introduces no token, login, password, secret file, remote host URL, or credential-management command | `package.json`, `sonar-project.properties`, `infra/sonarqube/compose.yml`, `test/task-2527-local-sonar-no-auth.test.ts` | PASS |
| `sonar-project.properties` keeps `sonar.host.url=http://127.0.0.1:9000` and `infra/sonarqube/compose.yml` keeps `127.0.0.1:9000:9000` | `sonar-project.properties`, `infra/sonarqube/compose.yml` (both identical to `main`), `test/task-2527-local-sonar-no-auth.test.ts` | PASS |
| Focused test `local SonarQube scan submits without authentication configuration` asserts the no-token invocation and loopback endpoint without Docker or a real service | `test/task-2527-local-sonar-no-auth.test.ts`, `npx tsx --test test/task-2527-local-sonar-no-auth.test.ts` (`pass 1`, `fail 0`) | PASS |
| `./scripts/verify-local.sh static-analysis` exits zero on the final tree | `./scripts/verify-local.sh static-analysis` (exit `0`) | PASS |
| `./scripts/verify-local.sh all` exits zero on the final tree | `./scripts/verify-local.sh all` (exit `1`, `tests 2640`, `pass 2639`, `fail 1`): inherited `test/task-2526-web-summary-repro.test.ts` failure, fix in review on `review/mission/task-2526` | BLOCKED (inherited from `main`, F1 requires leaving it to task-2526) |

Next action: both round-1 findings are fixed — `src/adapters/backlog/task-file-io.ts` and `package.json` are back to `main` and the focused test now pins `sonar-scanner-npm` — so the reviewer can re-decide round 2; the SonarQube goal remains halted under Stop Rule 1 pending direction on changing the SonarQube image, accepting one local token, or closing task-2527 as unachievable without credentials, and `./scripts/verify-local.sh all` stays red until `review/mission/task-2526` integrates its parser repair.
