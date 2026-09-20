# CP-4 — Gates and final evidence

## Summary
Ran the repository gates declared in `MISSION.md` and recorded final evidence
for every success criterion. All scoped behaviour from SC1–SC8 is covered by the
task-2520 regression suite and passes. The integration-suite gate was repaired so
it exercises the task-2520 `reconcileForgejoBase` pre-step without a real worktree
(see below).

Gate evidence:
- `./scripts/verify-local.sh static-analysis` → exit 0: ESLint clean,
  `tsc` typecheck clean, test-hygiene clean, test typecheck clean.
- `./scripts/verify-local.sh all` → exit 0: full suite 2876 tests, 2876 pass,
  0 fail (unit-test-budget timeout=1000ms/test, suite budget=180000ms,
  elapsed≈50s, within budget).
- `npm run test:integration` (integration-suite gate) → exit 0: 2317 pass, 0
  fail. The `syncMerged` paths in `test/forgejo.test.ts` now inject a benign
  `gitRunner` so the pre-landed `reconcileForgejoBase` step is an `unchanged`
  no-op instead of falling through to the real `git` (which, against this
  checkout's `review` remote, would perform a real diverged reconcile and inject
  an extra push that breaks these tests' exact push/fetch-sequence assertions).

No scoped behaviour was omitted: SC1–SC3 are covered by the diverged-base
reconcile suite, SC4/SC5/SC7 by the resume-landing and integrate-rebase-state
suites, and SC6 by the rebase-inprogress suite. SC8 (automated coverage + gates)
is satisfied by this run.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 ancestor base by normal fast-forward push; non-ancestor tree-equivalent base by `--force-with-lease` pinned to fetched SHA | `test/task-2520-diverged-base-reconcile.test.ts`, `"ancestor Forgejo base is reconciled by a normal fast-forward push"` + `"diverged-but-content-equivalent Forgejo base is reconciled with force-with-lease, then the landed commit fast-forwards"` (`forceWithLeaseRef === main:<fetched-sha>`) | PASS |
| SC2 forced-update diagnostic names fetched base SHA and local replacement SHA; landed commit fast-forwards or fails with a diagnostic | `src/adapters/forgejo/forgejo-git.ts` `reconcileForgejoBase` (old→new SHA logs, `overwrite-refused` / `forgejo-base-push-failed`); push-sequence assertions in `test/task-2520-diverged-base-reconcile.test.ts` | PASS |
| SC3 abort before any force push when Forgejo base holds absent content | `test/task-2520-diverged-base-reconcile.test.ts`, `"content-different Forgejo base refuses the force push before any force update"` (`result.error === 'overwrite-refused'`, `pushCalls.length === 0`) | PASS |
| SC4 integration verifies mission branch based on current local base before squash/landing | `test/task-2520-integrate-rebase-state.test.ts`, `"integration rebase aborts when the local base is not an ancestor of the mission (SC4)"` | PASS |
| SC5 retry after `sync-merged` skips rebase and resumes landing closeout | `test/task-2520-resume-landing.test.ts`, `"retry after failed sync-merged skips rebase and resumes landing closeout"` | PASS |
| SC6 `px rebase` does not emit clean-completion result while a rebase is active | `test/task-2520-rebase-inprogress.test.ts`, `"px rebase does not report clean completion while a rebase is in progress (SC6)"` | PASS |
| SC7 integration rebase inspects mission worktree for active rebase, reports/cleans paused rebase; clean only when no rebase active | `test/task-2520-integrate-rebase-state.test.ts`, `"integration rebase reports a paused rebase in the mission worktree (SC7)"` + `"integration rebase completes cleanly when no rebase is active in the mission worktree (SC7)"` | PASS |
| SC8 scoped automated tests cover all four scenarios and repository gates pass | `test/task-2520-diverged-base-reconcile.test.ts`, `test/task-2520-resume-landing.test.ts`, `test/task-2520-integrate-rebase-state.test.ts`, `test/task-2520-rebase-inprogress.test.ts`; `./scripts/verify-local.sh all` (exit 0), `./scripts/verify-local.sh static-analysis` (exit 0) | PASS |

## Gates

| Gate | Command | Status |
|---|---|---|
| all | `./scripts/verify-local.sh all` (exit 0, 2876/2876 pass) | PASS |
| static-analysis | `./scripts/verify-local.sh static-analysis` (exit 0) | PASS |
| integration-suite | `npm run test:integration` (exit 0, 2317/2317 pass) | PASS |

## Next action
Commit CP-3.md and CP-4.md with the task-2520 implementation on
`mission/task-2520`. Handoff verification requires both checkpoint documents to
be present and committed. Review round 1 is APPROVED (no findings); the only
outstanding step is external formal approval, which is an operator/provider
dependency outside this worktree.
