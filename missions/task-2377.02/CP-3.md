# CP-3 — Regression coverage, migrated subprocess tests, suite green

## Summary of work done

- Migrated every subprocess-shaped assertion in `test/task-1107-repro.test.ts`
  and `test/review.test.ts` to the in-process contract. Both files gained a local
  `inProcessWorkflow(runs, {exitCode, port, onRun})` helper that supplies the
  `createRebaseWorkflowPortFn` / `runRebaseWorkflowFn` seams in place of the old
  `runFn` spawn double. `runFn` no longer appears in either file's
  `rebaseBeforeReviewRound` calls.
- Added the AC#2 / AC#3 regression coverage in
  `test/task-2377-02-pre-review-rebase-inprocess.test.ts` (7 tests), including
  the review-loop level assertion that a gate failure never reaches the
  hook-bounce branch.
- Declared the `review -> rebase` behaviour route in
  `adapterPortDependencies` (`src/adapters/architecture/boundary-guards.ts`).
  The pre-review rebase now depends on the `rebase` package through the
  application-owned port `src/application/ports/rebase-workflow.ts`, which is
  exactly the mechanism the guard's own doc comment prescribes; without the
  declaration `test/dependency-graph.test.ts` reported
  `cross-adapter-dependency-not-named`.
- Docs: no document describes the pre-review rebase as a nested CLI call, so
  none needed updating. `` `grep -rn "pre-review rebase" docs/ AGENTS.md README.md` ``
  returns no matches; the only `px rebase` mention in `docs/agents.md` documents
  the *handoff* repair path (`px active` → handoff → `px rebase <slug>`), which
  this mission does not change.

### Criterion 8 — assertions changed, by test name

`test/task-1107-repro.test.ts`

| Test name | What it asserted before | Change |
|---|---|---|
| `"rebaseBeforeReviewRound auto-commits safe mission artifacts before rebase"` | `assert.match(rebaseCalls[0].args[0], /px\.mjs$/)` — the spawned argv named the compiled bundle | now asserts `deepEqual(rebaseCalls, [[slug, '--push']])`, the in-process workflow argv |
| `"rebaseBeforeReviewRound invokes the TypeScript entrypoint through tsx in a source checkout"` | tsx entrypoint selection: `calls[0].command` ends with `node_modules/.bin/tsx` and argv is `[src/entry/px.ts, 'rebase', slug, '--push']` | **removed** — entrypoint selection no longer exists; the in-process seam is covered by `"pre-review rebase drives the rebase workflow port in-process exactly once"` |
| `"rebaseBeforeReviewRound uses the tsx source runtime in a checkout"` | same tsx entrypoint selection against `process.cwd()` | **removed**, same reason |
| `"rebaseBeforeReviewRound uses the compiled CLI outside a source checkout"` | compiled `px.mjs` entrypoint selection with `process.execPath` | **removed**, same reason |
| `"rebaseBeforeReviewRound reports shared-file rebase conflicts"` | combined-output regex classification: shared conflicts inferred from the child's stdout text | now drives `port.resolveConflictsForMission` and asserts `failure.kind === 'conflict'` with `sharedFiles` |
| `"rebaseBeforeReviewRound reports missing Forgejo token failure from rebase push"` | asserted the child's `No Forgejo token found for user "codex"` text was echoed | now asserts the typed `failure.kind === 'other'` / `operation === 'rebase'`; the workflow logs the token diagnostic itself, so the parent no longer re-echoes captured text |
| `"rebaseBeforeReviewRound reports generic rebase failure"` | `deepEqual` on the three-field result after a status-1 child | now asserts fields plus `failure.kind === 'other'` |
| `"rebaseBeforeReviewRound refuses rename or copy records with unsafe sources"`, `"…refuses to auto-commit when unsafe files are present"`, `"…refuses to auto-commit when unmerged conflicts exist"` | `deepEqual(result, {ok:false, sharedFileConflicts:false, hookFailure:false})` (exact three-field result), and `runFn: () => assert.fail(...)` | field-wise asserts plus `failure.kind === 'unsafe-worktree'`; the never-run guard moved from `runFn` to the workflow seam's `onRun` |

`test/review.test.ts`

| Test name | What it asserted before | Change |
|---|---|---|
| `"rebaseBeforeReviewRound succeeds after a clean rebase"` | success via a `runFn` spawn double returning status 0 | drives the in-process seam and additionally asserts the workflow argv `[['task-1087', '--push']]` |
| `"rebaseBeforeReviewRound reports shared-file conflicts with recovery instructions"` | combined-output regex classification from `runFn` stdout, plus `errors.some(m => m.includes(sharedFileOutput))` (raw child output echoed) | drives `port.resolveConflictsForMission` and asserts the typed `failure` object; the raw-echo assertion is gone because there is no child output to echo. The `Shared-file rebase conflicts detected` and `px review <slug> --start` recovery assertions are unchanged |
| `"rebaseBeforeReviewRound reports non-conflict rebase failures"` | `errors.some(m => m.includes('stale info'))` — the child's stderr text re-emitted by the parent | asserts `failure.kind === 'other'`; the `Rebase failed before launching reviewer` assertion is unchanged |

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| 1 — no subprocess spawn; port reached in-process, seam invoked once | `` `git grep -n "spawnSync\|child_process" src/adapters/review/rebase.ts` `` → no matches; `"pre-review rebase module spawns no CLI subprocess"` and `"pre-review rebase drives the rebase workflow port in-process exactly once"`, `test/task-2377-02-pre-review-rebase-inprocess.test.ts` | PASS |
| 2 — `HOOK_FAILURE_RE` gone; no hook-name regex in the file | `` `git grep -n "HOOK_FAILURE_RE" src/` `` → no matches (exit 1); remaining `pre-commit`/`pre-push` occurrences in `src/adapters/review/rebase.ts` are comments and the `hook: 'pre-commit'` literal set from the failing git operation | PASS |
| 3 — push-time gate failure containing `pre-push` is a gate failure with non-empty area, non-empty command, numeric non-zero exit code, `hookFailure: false` | `"push-time gate failure whose output contains pre-push classifies as a gate failure"`, `test/task-2377-02-pre-review-rebase-inprocess.test.ts`; loop-level: `"review loop treats a pre-review rebase gate failure as a gate failure, not a hook bounce"` | PASS |
| 4 — genuine hook failure reports `hookFailure: true`, hook identity, preserved output | `"genuine hook failure during the pre-review rebase reports hook identity and output"` (rebase operation → `pre-commit`) and `"genuine pre-commit failure on the pre-review safety commit reports hook evidence"` (commit operation), `test/task-2377-02-pre-review-rebase-inprocess.test.ts` | PASS |
| 5 — hook budget consumed in exactly one process | `"a pre-review rebase hook failure requests the hook bounce at most once"` (asserts `bounceRequests === 1` and zero in-child `git rebase --continue` retries) | PASS |
| 6 — `Hook rebounce available in CLI rebase command` nowhere under `src/` | `` `git grep -n "Hook rebounce available in CLI rebase command" src/` `` → no matches (exit 1) | PASS |
| 7 — standalone `px rebase` suites pass with no assertion edits | `test/task-1272-standalone-rebase.test.ts`, `test/task-1272-standalone-cycle.test.ts`, `test/rebase-use-case.test.ts` — unmodified (no entry for them in `git status`) and green inside `./scripts/verify-local.sh all` | PASS |
| 8 — pre-review gate / rebounce / call-order / repro / review suites pass; each changed assertion listed by test name | `test/task-1268-pre-review-gate-per-round.test.ts`, `test/task-2353-rebounce-reproduction.test.ts`, `test/task-1104-call-order.test.ts` unmodified and green; `test/task-1107-repro.test.ts` 11/11 and `test/review.test.ts` 118/118 green; changed assertions enumerated in the two tables above | PASS |
| 9 — verification gate green on the final tree | `./scripts/verify-local.sh all` → `exit=0`, `ℹ pass 2337 / ℹ fail 0` (baseline at the mission parent commit: `pass 2257 / fail 0`) | PASS |
| DoD 2 — lint and static analysis clean | `./scripts/verify-local.sh static-analysis` → ESLint clean, tsc typecheck clean, test-hygiene clean, test typecheck clean (ALL STAGES PASSED); `` `npx eslint test/task-1107-repro.test.ts` `` clean. `test/review.test.ts` reports the same 61 pre-existing lint findings before and after this change (verified by linting the `HEAD` copy of the file) and is outside the gate's `src/`-only ESLint scope | PASS |
| DoD 3 — no focused or unannotated skipped tests | `./scripts/verify-local.sh static-analysis` stage 3 `PASS: no test-hygiene violations`; run reports `ℹ skipped 0 / ℹ todo 0` | PASS |
| DoD 5 — docs reflect behavior | `` `grep -rn "pre-review rebase" docs/ AGENTS.md README.md` `` → no matches; the `px rebase` reference in `docs/agents.md` documents the handoff repair path, which is unchanged | PASS |
| Restricted areas respected | `src/application/rebase-workflow.ts`, `src/adapters/review/review-gate-handling.ts`, `src/application/hook-failure-workflow.ts`, `src/domain/review.ts` are absent from `git status --porcelain`; `test/task-1272-standalone-rebase.test.ts`, `test/task-1272-standalone-cycle.test.ts`, `test/rebase-use-case.test.ts` unmodified | PASS |

## Review round 1 response (REQUEST_CHANGES)

Reviewer finding 1 (blocking): `test/task-1104-rebase-cleanup.test.ts`,
`"rebaseBeforeReviewRound auto-commits safe mission artifacts"`, still injected
the deprecated `runFn` spawn double. With `runFn` ignored, the real in-process
`runRebaseWorkflow` ran against the temp repo on branch `master`, failed its
branch check, and returned `ok: false`. The file classifies into the mandatory
integration suite (`config/integration-pipelines.json`, `integration-suite`),
which the mission's `all` gate does not run, so the red escaped CP-3's gate.

Fix: migrated the test to the in-process seam contract (the same
`createRebaseWorkflowPortFn` / `runRebaseWorkflowFn` helper pattern as
`test/task-1107-repro.test.ts` and `test/review.test.ts`). The subprocess
assertion `runFn.mock.callCount() === 1` is replaced by an assertion that the
workflow was driven in-process exactly once with argv `[slug, '--push']`. The
auto-commit assertions (clean tree, commit subject
`workflow(task-1104): auto-commit mission artifacts before pre-review rebase`,
auto-commit log line) are unchanged; the second test in the file is unchanged
and stays green.

| Evidence | Result |
|---|---|
| `` `node --experimental-test-module-mocks --import ./test/bootstrap-parallix-home.ts --import tsx --test-force-exit test/task-1104-rebase-cleanup.test.ts` `` (reviewer's exact repro flags) | tests 2 / pass 2 / fail 0 |
| `npm run test:integration` (mandatory pre-merge integration gate) | pass 1506 / fail 0 |
| `./scripts/verify-local.sh all` on the committed tree | pass 2353 / fail 0, exit 0 |

## Blocker: commits could not be created (resolved)

The mission's checkpoint commits **could not be made**. This worktree's gitdir
(`/home/magnus/code/parallix/.git/worktrees/parallix-task-2377.02`) is on a
read-only mount in this session, so `git add` / `git commit` fail with
`Kunde inte skapa ".../index.lock": Skrivskyddat filsystem`:

```
$ findmnt -T /home/magnus/code/parallix/.git
TARGET       SOURCE                FSTYPE   OPTIONS
/home/magnus /home/magnus/.Private ecryptfs ro,...
$ findmnt -T /home/magnus/code/parallix-task-2377.02
TARGET                                  SOURCE                                  FSTYPE   OPTIONS
/home/magnus/code/parallix-task-2377.02 /home/magnus/.Private[/code/...]        ecryptfs rw,...
```

Only the worktree itself is writable; the shared object store and index are not.
All work is complete and verified in the working tree, but CP-1/CP-2/CP-3 and the
source changes are **uncommitted**. Handoff to review must not proceed until they
are committed.

Resolution: the read-only gitdir mount was session-specific. The workflow
capture commits contain every mission change, `px status task-2377.02` reports
0 uncommitted files, and the round-1 reviewer independently verified that the
committed tree matches the verified tree.

Next action: hand back to the reviewer — round-1 finding 1 fixed in
`test/task-1104-rebase-cleanup.test.ts`; the integration suite and the
declared gate are green on the committed tree.
