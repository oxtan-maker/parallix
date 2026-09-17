# CP-6: Handoff rebase repair — block-scalar frontmatter fix

## Summary

Handoff verification failed with `Rebase failed before handoff. Ensure the
mission branch can be rebased onto the latest primary branch.` (classification
GateFailure, retry 1/2). Diagnosed by running the harness's own step rather than
guessing.

The rebase itself was never the problem:

```
$ px rebase task-2527
[INFO] Rebasing mission/task-2527 onto local main...
[PASS] Rebase completed cleanly.
```

`px rebase task-2527 --push` is what handoff runs, and its push-time
verification gate executes the full unit suite. That gate failed on a single
test, which is the real blocker:

```
$ px rebase task-2527 --push
[FAIL] ✖ web mission summary renders folded YAML description text
[FAIL]   AssertionError: folded scalar must not leak the YAML marker
[FAIL]     actual: '>-'
[FAIL] ℹ tests 2640  ℹ pass 2639  ℹ fail 1
```

## Root cause and fix

`parseTaskFrontmatterValue` in `src/adapters/backlog/task-file-io.ts` matched
only the remainder of the `field:` line (`^${field}:\s*([^\r\n]+)`). A YAML block
scalar puts the value on the following indented lines, so `title: >-` returned
the bare indicator `>-` as the mission title, which is exactly what the web board
rendered.

Fixed in the shared parser, not at a call site: every frontmatter reader routes
through this function (`getTaskFrontmatterValue` in the same module, and
`ConcreteMissionReadAdapter.readTaskMetadata` for `title`, `id`, and `closedAt`),
so one guard here repairs all of them. When the same-line value is a block-scalar
indicator (`>`, `|`, with optional chomping or explicit indent), the parser now
consumes the following indented lines: folded (`>`) joins with spaces, literal
(`|`) preserves line breaks. Plain and quoted scalars keep their previous
behaviour.

This is outside task-2527's SonarQube scope, but the mission branch cannot hand
off while the push gate fails, and the defect is a genuine one inherited from
`main` rather than anything this mission introduced.

## Verification

- `npx tsx --test test/task-2526-web-summary-repro.test.ts` —
  `✔ web mission summary renders folded YAML description text`,
  `✔ web mission summary preserves an ordinary single-line description`
  (`tests 2`, `pass 2`, `fail 0`). The second test pins the plain-scalar path
  against regression from this change.
- `./scripts/verify-local.sh static-analysis` — exit `0`,
  `=== Static Analysis Gate: ALL STAGES PASSED ===`.
- `./scripts/verify-local.sh all` — exit `0`, `tests 2640`, `pass 2640`,
  `fail 0` (previously `pass 2639`, `fail 1`).
- `npx tsx --test test/task-2527-local-sonar-no-auth.test.ts` —
  `✔ local SonarQube scan submits without authentication configuration`
  (`pass 1`, `fail 0`); the mission's own contract is unaffected.

## Mission scope unchanged

The SonarQube conclusion recorded in `missions/task-2527/CP-5.md` stands:
`sonarqube:25.6.0.109173-community` keeps `sonar.forceAuthentication` locked to
`true` regardless of `SONAR_FORCEAUTHENTICATION`, anonymous
`GET /api/plugins/installed` returns `403`, and Stop Rule 1 applies. This
checkpoint adds no token, login, password, remote host URL, or
credential-management path, and leaves `sonar-project.properties` and
`infra/sonarqube/compose.yml` untouched.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Handoff rebase onto the latest primary branch succeeds | `px rebase task-2527` (`[PASS] Rebase completed cleanly.`), `px rebase task-2527 --push` | PASS |
| Clean-shell `npm run sonar` submits `parallix` to `http://127.0.0.1:9000` without a 401, missing-token error, or prompt | `npm run sonar:up`, `npm run sonar`; anonymous `GET /api/plugins/installed` returns `403` on `sonarqube:25.6.0.109173-community` | BLOCKED (Stop Rule 1, per `missions/task-2527/CP-5.md`) |
| Local scanner configuration introduces no token, login, password, secret file, remote host URL, or credential-management command | `package.json`, `sonar-project.properties`, `infra/sonarqube/compose.yml`, `test/task-2527-local-sonar-no-auth.test.ts` | PASS |
| `sonar-project.properties` keeps `sonar.host.url=http://127.0.0.1:9000` and `infra/sonarqube/compose.yml` keeps `127.0.0.1:9000:9000` | `sonar-project.properties`, `infra/sonarqube/compose.yml`, `test/task-2527-local-sonar-no-auth.test.ts` | PASS |
| Focused test `local SonarQube scan submits without authentication configuration` asserts the contract without Docker or a real service | `test/task-2527-local-sonar-no-auth.test.ts`, `npx tsx --test test/task-2527-local-sonar-no-auth.test.ts` (`pass 1`, `fail 0`) | PASS |
| `./scripts/verify-local.sh static-analysis` exits zero on the final tree | `./scripts/verify-local.sh static-analysis` (exit `0`) | PASS |
| `./scripts/verify-local.sh all` exits zero on the final tree | `./scripts/verify-local.sh all` (exit `0`, `tests 2640`, `pass 2640`, `fail 0`) | PASS |

Next action: the push-gate blocker is repaired in `src/adapters/backlog/task-file-io.ts` and both declared gates now exit `0` on this tree, so handoff verification can re-run `px rebase task-2527 --push`; the SonarQube goal itself remains halted under Stop Rule 1 pending direction on changing the SonarQube image, accepting one local token, or closing task-2527 as unachievable without credentials.
