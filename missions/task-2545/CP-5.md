# CP 5 — Tiering confirmed; full green tree verified

## Summary
No file needed to move: all six assertions are now hermetic in place, so both
`test/forgejo.test.ts` and `test/task-2544-sonar-worktree-isolation.test.ts`
stay in `INTEGRATION_CI_TESTS`. `test/lib/test-categories.ts` was left unchanged
(no move ⇒ no `INTEGRATION_LOCAL_TESTS` entry, no `INTEGRATION_LOCAL_REASONS`
line). Production source was not touched (restricted area): the fix is the benign
`gitRunner` contract in the test fixtures and branch-env isolation in the
task-2544 tests.

Verification (all captured in logs under `/tmp` and reproducible against the
committed tree):

- Mission gate `./scripts/verify-local.sh all` → exit 0; `npm test` unit suite
  2884 pass / 0 fail.
- `./scripts/verify-local.sh static-analysis` → exit 0; ESLint clean,
  `npm run typecheck` clean, test-hygiene clean, test typecheck clean.
- `npm run test:integration:ci` → exit 0; 2310 tests, 2284 pass, 0 fail. All six
  named assertions pass in the GitHub-safe lane.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: six named assertions green on clean-runner subset | `npm run test:integration:ci` exit 0; `test/forgejo.test.ts` names `syncMerged treats 409 Conflict as success if commits match`, `syncMerged treats 405 Method Not Allowed as success if commits match`, `syncMerged fails on 409 Conflict if commits do NOT match`, `getPrStatus and syncMerged share the same FORGEJO_USER fallback contract`; `test/task-2544-sonar-worktree-isolation.test.ts` names `task-2544: two distinct branch analyses resolve to distinct identities`, `task-2544: querying one branch analysis targets only that branch identity` | PASS |
| SC2: files remain in CI lane | `test/lib/test-categories.ts` `INTEGRATION_CI_TESTS` lists both `test/forgejo.test.ts` and `test/task-2544-sonar-worktree-isolation.test.ts`; `./scripts/verify-local.sh all` passes `test/test-categories.test.ts` | PASS |
| SC3: no focused / unannotated skipped tests | `./scripts/verify-local.sh static-analysis` → `PASS: no test-hygiene violations`; grep of both files shows no `.only` / bare `.skip` | PASS |
| SC4: no prohibited CI dependency introduced | `test/lib/test-categories.ts` `PROHIBITED_CI_DEPENDENCY_MARKERS` scan passes under `test/test-categories.test.ts`; no `spawnSync('bwrap')` / `uv` / `graphify` / SEA markers added | PASS |
| SC5: no production behavior regressed | `npm test` (unit) 2884 pass / 0 fail via `./scripts/verify-local.sh all`; `src/adapters/forgejo/forgejo-git.ts`, `scripts/sonar-local.ts`, `src/adapters/forgejo/forgejo-auth.ts` unchanged; ADR 0060 per-worktree Sonar identity untouched | PASS |
| SC6: verification gate ran with captured proof | `./scripts/verify-local.sh all` exit 0 (unit 2884/0); `./scripts/verify-local.sh static-analysis` exit 0 (all 4 stages PASS); `npm run test:integration:ci` exit 0 (2310 tests, 0 fail) | PASS |

## Next action
All checkpoints committed and all mission gates pass; hand off without pushing to
`origin` (only `main` may go to `origin`; the harness performs lifecycle
transitions).
