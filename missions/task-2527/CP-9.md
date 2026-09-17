# CP-9: Review round 2 resolution — cherry-pick removed, mission blocked

## Summary

Round 2 raised one finding, and it is accepted and fixed.

### F2/F1 — Keep task-2526's parser patch out of this mission (fixed)

The reviewer is right on both points. Cherry-picking `d7de5f39d` put a source
change on this mission branch as commit `3e268494a`, and an inherited origin does
not make that a rebase artifact — the commit is authored onto
`mission/task-2527` and shows up in the reviewed diff. CP-8's reasoning that
`git rebase` would later drop it does not change what the current diff contains.

Reverted with `git revert 3e268494a` (revert commit `7404e7605`), then rebased
onto the advanced `main` (`00b4a4aba`). `src/adapters/backlog/task-file-io.ts` is
identical to `main` again.

The reviewed diff outside `missions/` and `backlog/` is now exactly one file:

```
$ git diff main --stat -- . ':(exclude)missions' ':(exclude)backlog'
 test/task-2527-local-sonar-no-auth.test.ts | 19 +++++++++++++++++++
 1 file changed, 19 insertions(+)
```

No file under `src/` is changed. `package.json`, `sonar-project.properties`, and
`infra/sonarqube/compose.yml` are identical to `main`, so round 1's F1 and F2
both remain resolved.

## Why this mission is now blocked

Removing the cherry-pick restores the pre-review gate failure that bounced this
branch before, and the mission has no in-scope way to clear it:

- `./scripts/verify-local.sh static-analysis` — exit `0`,
  `=== Static Analysis Gate: ALL STAGES PASSED ===`.
- `./scripts/verify-local.sh all` — exit `1`: `tests 2641`, `pass 2640`,
  `fail 1`. The single failure is `test/task-2526-web-summary-repro.test.ts`,
  test `web mission summary renders folded YAML description text`. That test is
  on `main` while the parser fix it covers is not, so `main` itself is red on
  it and every branch cut from `main` inherits the failure. Confirmed again this
  round: `main` is now `00b4a4aba` and still has no block-scalar handling in
  `src/adapters/backlog/task-file-io.ts`.
- `npx tsx --test test/task-2527-local-sonar-no-auth.test.ts` —
  `✔ local SonarQube scan submits without authentication configuration`
  (`pass 1`, `fail 0`).

The pre-review push gate for area `static-analysis` runs the full unit suite, so
it fails on that inherited test. The only two ways to make it pass are carrying
task-2526's patch, which round 2 explicitly forbids, or waiting for
`review/mission/task-2526` to integrate. The reviewer named the correct
resolution: let task-2526 integrate its own patch and let this mission stop.

The SonarQube goal itself is independently halted under Stop Rule 1, unchanged
since `missions/task-2527/CP-5.md`: `sonarqube:25.6.0.109173-community` keeps
`sonar.forceAuthentication` locked to `true` even with
`SONAR_FORCEAUTHENTICATION=false` present in the container, and anonymous
`GET /api/plugins/installed` returns `403`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Round 2 finding resolved: no task-2526 parser patch in the mission diff | `git revert 3e268494a` (revert `7404e7605`); `src/adapters/backlog/task-file-io.ts` identical to `main`; `git diff main --stat` reports only `test/task-2527-local-sonar-no-auth.test.ts` | PASS |
| Clean-shell `npm run sonar` submits `parallix` to `http://127.0.0.1:9000` without a 401, missing-token error, or prompt | `npm run sonar:up`, `npm run sonar`; anonymous `GET /api/plugins/installed` returns `403` on `sonarqube:25.6.0.109173-community` (`missions/task-2527/CP-5.md`) | BLOCKED (Stop Rule 1) |
| Local scanner configuration introduces no token, login, password, secret file, remote host URL, or credential-management command | `package.json`, `sonar-project.properties`, `infra/sonarqube/compose.yml`, `test/task-2527-local-sonar-no-auth.test.ts` | PASS |
| `sonar-project.properties` keeps `sonar.host.url=http://127.0.0.1:9000` and `infra/sonarqube/compose.yml` keeps `127.0.0.1:9000:9000` | `sonar-project.properties`, `infra/sonarqube/compose.yml` (both identical to `main`), `test/task-2527-local-sonar-no-auth.test.ts` | PASS |
| Focused test `local SonarQube scan submits without authentication configuration` asserts the no-token invocation and loopback endpoint without Docker or a real service | `test/task-2527-local-sonar-no-auth.test.ts`, `npx tsx --test test/task-2527-local-sonar-no-auth.test.ts` (`pass 1`, `fail 0`) | PASS |
| `./scripts/verify-local.sh static-analysis` exits zero on the final tree | `./scripts/verify-local.sh static-analysis` (exit `0`) | PASS |
| `./scripts/verify-local.sh all` exits zero on the final tree | `./scripts/verify-local.sh all` (exit `1`, `tests 2641`, `pass 2640`, `fail 1`): inherited `test/task-2526-web-summary-repro.test.ts` failure, fix pending on `review/mission/task-2526` | BLOCKED (external dependency; round 2 forbids repairing it here) |

Next action: the round-2 finding is fixed and the mission diff is back to the single focused test, so task-2527 stops here and waits on two external decisions — `review/mission/task-2526` integrating its parser patch so the full-suite gate can go green, and product direction on the SonarQube goal under Stop Rule 1 (change the image or version, accept one local token, or close task-2527 as unachievable without credentials).
