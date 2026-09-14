# CP-4 — Make `npm run test:ci` pass in a hosted-runner equivalent checkout

## Work Done

**Why this checkpoint exists.** Operator direction (2026-09-14, recorded in
`backlog/tasks/task-2500.05` `operator_note`). Review found that task-2500.04
proved `npm run test:ci` only on a workstation. Its preload isolated `HOME`, but
the run used a checkout with a local `main` branch, a sibling worktree on
`main`, no `CI` variable, and Node 24. A fresh detached checkout failed. On Node
22 the unit suite also failed, which the Node 24 workflow change already fixed.

**Hosted-runner equivalent.** No GitHub Actions run is possible from this
local-only mission branch (`AGENTS.md`), so the job was reproduced in docker
`node:24-bookworm` (Node 24.21.0, the version `node-version: '24'` +
`check-latest: true` installs):
- non-root user with a fresh tmpfs `HOME`, and `CI=true` plus `GITHUB_ACTIONS=true`;
- workspace `/home/runner/work/parallix/parallix` with no workstation state;
- `npm ci`, then `npm run test:ci`.

The pull-request checkout matches `actions/checkout@v4` with `fetch-depth: 0`:
detached at `refs/remotes/pull/1/merge`, with `main` only as `origin/main`. The
push checkout is `git checkout -B main`. Both then run the workflow's "Provide
the primary worktree" command.

**Root causes found in the detached PR checkout** (before the fixes, 28 unit and
75 CI-integration failures, plus 2 files hung until the suite budget ran out):

| Cause | Effect | Fix |
|---|---|---|
| No local `main` branch | `getPrimaryBranch` throws "Could not detect primary branch" | Workflow: `fetch-depth: 0`, then `git worktree add -b main "$RUNNER_TEMP/parallix-main" origin/main` when `refs/heads/main` is absent |
| No worktree on the primary branch | `resolveMainRepo` throws "Could not resolve primary repository" | Same workflow step: Parallix's standard layout, a primary worktree on `main` |
| Ambient `CI=true` | ink (`is-in-ci`) skips re-renders, so TUI tests (`tui-flow-panel`, `tui-responsive-layout`, `tui-wave-4-attention`, `tui-command-flow`, `task-2373-shutdown`, `task-2466-cancel-surfaces`, `task-2313-repro`) see no frames or hang | `test/bootstrap-parallix-home.ts` deletes `CI` / `CONTINUOUS_INTEGRATION`. `test/no-command-tty.test.ts` still passes `CI` explicitly |

**Approaches rejected.**
- Setting `PRIMARY_WORKTREE` globally in the preload broke `test/task-1109.test.ts`,
  because the env override wins over its `resolveMainRepo` mock.
- Adding a temporary repository plus `chdir` to each test file touched 11 files
  and changed what the tests exercise.

No assertion, fixture, or test selection changed, and no test is skipped or
disabled. The 25 skips in the CI integration lane existed before: monorepo-only
scripts (task-1302) and one Node TypeScript-strip check.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 literal `ci-required` job on PRs to protected primary | `.github/workflows/ci-required.yml` `jobs.ci-required.name: ci-required`; `on.pull_request.branches: [main]`; actionlint 1.7.12 (`rhysd/actionlint`) reports no findings | PASS |
| SC2 runs for github-publish ref, checks exact SHA | DEFERRED to `task-2500.06` (unchanged; see CP-3) | |
| SC3 Node >=22.23.1, lockfile install, `npm run test:ci` | `.github/workflows/ci-required.yml` `node-version: '24'` + `check-latest: true` (unit suite needs >=24.15.0); `npm ci`; final step `npm run test:ci`. Hosted-equivalent PR checkout: unit `tests 2580 / pass 2580 / fail 0`; CI integration `tests 2127 / pass 2102 / fail 0 / skipped 25`; `npm run test:bundle` and `npm run test:package-content` pass; 112 s. Push checkout: same counts; 188 s | PASS |
| SC4 read-only contents, no broad write | `.github/workflows/ci-required.yml` `permissions.contents: read`; the primary-worktree step is local git only | PASS |
| SC5 cancel PR runs, keep publication runs | `.github/workflows/ci-required.yml` `concurrency` unchanged from CP-3 | PASS |
| SC6 non-zero exit fails job | final run step `npm run test:ci` has no `if:` guard; before the fixes the hosted-equivalent run exited 1 | PASS |
| SC7 run duration | DEFERRED to `task-2500.06` for the live GitHub run; hosted-equivalent docker durations above are a proxy, not a GitHub measurement | |

## Gates

| Gate | Evidence | Status |
|---|---|---|
| `./scripts/verify-local.sh static-analysis` | exit 0, "Static Analysis Gate: ALL STAGES PASSED" | PASS |
| `./scripts/verify-local.sh all` | exit 0, `tests 2580 / pass 2580 / fail 0` | PASS |

## Next action:
Hand off for review. The first live GitHub Actions `ci-required` run (owned by `task-2500.06`) confirms these results on a real `ubuntu-latest` runner and records SC2/SC7.
