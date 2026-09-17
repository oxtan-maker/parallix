# CP-8: Pre-review gate repair — task-2526 parser commit cherry-picked

## Summary

The pre-review push-time gate for area `static-analysis` failed with exit `1` on
a single test:

```
✖ web mission summary renders folded YAML description text
  AssertionError: folded scalar must not leak the YAML marker
  actual: '>-'
ℹ tests 2640  ℹ pass 2639  ℹ fail 1
```

This is the same inherited failure recorded in `missions/task-2527/CP-7.md`:
`test/task-2526-web-summary-repro.test.ts` sits on `main` while the parser fix it
covers does not, so `main` is red on this test and every branch inherits it.
Verified again this round — `main` (`bded98f04`), `origin/main` (`4acc5fca3`),
and `review/main` (`bded98f04`) are all ancestors of HEAD, and none contains the
block-scalar handling.

Round 1 finding F1 asked that this mission not carry its own parser repair, and
that still holds. Instead of reintroducing a divergent fix, this checkpoint
cherry-picks task-2526's own commit:

```
git cherry-pick -x d7de5f39d
```

`d7de5f39d` (`task-2526: fold YAML block-scalar mission descriptions in
parseTaskFrontmatterValue`) comes from `review/mission/task-2526`, the mission
that owns the defect and is itself in review. It touches only
`src/adapters/backlog/task-file-io.ts`.

The cherry-pick conflicted for one reason unrelated to the fix: `main` rewrote
the quote-stripping regex in the same function
(`/(?:^['"])|(?:['"]$)/g` versus task-2526's `/^['"]|['"]$/g`) after task-2526
branched. Resolved by taking task-2526's block verbatim over `main`'s file, which
yields a blob byte-identical to task-2526's own result: both sides of the
resolved diff report `index …..89c470e61`. Because the post-image matches
task-2526's exactly, `git rebase` drops this commit as already-applied once
task-2526 integrates.

My earlier independent implementation of the same fix, reverted under F1 in
`missions/task-2527/CP-7.md`, is not restored — this is task-2526's patch, not
mine.

## Gate results

- `./scripts/verify-local.sh static-analysis` — exit `0`,
  `=== Static Analysis Gate: ALL STAGES PASSED ===`.
- `./scripts/verify-local.sh all` — exit `0`, `tests 2640`, `pass 2640`,
  `fail 0` (was `pass 2639`, `fail 1`).
- `npx tsx --test test/task-2526-web-summary-repro.test.ts` —
  `✔ web mission summary renders folded YAML description text`,
  `✔ web mission summary preserves an ordinary single-line description`
  (`pass 2`, `fail 0`).
- `npx tsx --test test/task-2527-local-sonar-no-auth.test.ts` —
  `✔ local SonarQube scan submits without authentication configuration`
  (`pass 1`, `fail 0`).

## Mission scope unchanged

`package.json`, `sonar-project.properties`, and `infra/sonarqube/compose.yml`
remain identical to `main`, so both round-1 findings stay resolved: no
credential-stripping scanner wrapper and no mission-authored parser repair. The
only mission-authored change outside `missions/` and `backlog/` is still
`test/task-2527-local-sonar-no-auth.test.ts`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Pre-review gate for area `static-analysis` passes | `./scripts/verify-local.sh static-analysis` (exit `0`), `./scripts/verify-local.sh all` (exit `0`, `tests 2640`, `pass 2640`, `fail 0`) | PASS |
| Clean-shell `npm run sonar` submits `parallix` to `http://127.0.0.1:9000` without a 401, missing-token error, or prompt | `npm run sonar:up`, `npm run sonar`; anonymous `GET /api/plugins/installed` returns `403` on `sonarqube:25.6.0.109173-community` (`missions/task-2527/CP-5.md`) | BLOCKED (Stop Rule 1) |
| Local scanner configuration introduces no token, login, password, secret file, remote host URL, or credential-management command | `package.json`, `sonar-project.properties`, `infra/sonarqube/compose.yml`, `test/task-2527-local-sonar-no-auth.test.ts` | PASS |
| `sonar-project.properties` keeps `sonar.host.url=http://127.0.0.1:9000` and `infra/sonarqube/compose.yml` keeps `127.0.0.1:9000:9000` | `sonar-project.properties`, `infra/sonarqube/compose.yml` (both identical to `main`), `test/task-2527-local-sonar-no-auth.test.ts` | PASS |
| Focused test `local SonarQube scan submits without authentication configuration` asserts the no-token invocation and loopback endpoint without Docker or a real service | `test/task-2527-local-sonar-no-auth.test.ts`, `npx tsx --test test/task-2527-local-sonar-no-auth.test.ts` (`pass 1`, `fail 0`) | PASS |
| `./scripts/verify-local.sh static-analysis` and `./scripts/verify-local.sh all` exit zero on the final tree | `./scripts/verify-local.sh static-analysis` (exit `0`), `./scripts/verify-local.sh all` (exit `0`) | PASS |

Next action: the gate blocker is cleared by cherry-picking task-2526's own commit `d7de5f39d` rather than reauthoring the fix, so both declared gates exit `0` and the reviewer can re-decide round 2; the SonarQube goal itself remains halted under Stop Rule 1 pending direction on changing the SonarQube image, accepting one local token, or closing task-2527 as unachievable without credentials.
