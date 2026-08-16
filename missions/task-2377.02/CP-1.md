# CP-1 — Typed result contract and in-process wiring

## Summary of work done

- Added the pre-review rebase result contract to the application port module
  `src/application/ports/rebase-workflow.ts`: `PreReviewRebaseOperation`
  (`commit` | `rebase` | `push`), `PreReviewRebaseGateEvidence` (area, command,
  exitCode, stdout, stderr — field names match `PreReviewGateResult` so the
  review loop can consume either source), `PreReviewRebaseHookEvidence` (hook
  identity + preserved output), the discriminated `PreReviewRebaseFailure`
  (`hook` / `gate` / `conflict` / `unsafe-worktree` / `other`), and the
  `PreReviewRebaseResult` / `PreReviewRebaseOutcome` result types.
- Rewrote `rebaseBeforeReviewRound` in `src/adapters/review/rebase.ts` to run the
  rebase workflow **in-process**: it builds a `RebaseWorkflowPort` through
  `createRebaseWorkflowPort` and drives `runRebaseWorkflow([slug, '--push'], port)`.
  The `child_process` / `spawnSync` import, the `px rebase` argv construction, and
  the tsx-vs-`px.mjs` entrypoint selection are gone.
- Added the exit-capturing seam required by the mission's risk note:
  `port.exit` records the code instead of calling `process.exit`, so
  `runRebaseWorkflow`'s ~15 exit sites needed **no** control-flow rewrite (each
  already returns immediately after `port.exit`). `src/application/rebase-workflow.ts`
  is unmodified — the standalone `px rebase` command still gets the real
  `process.exit` from `createRebaseWorkflowPort`'s default `exitFn`.
- Installed the remaining observations as structural port seams rather than text
  matches: `port.createPr` (push attempt + failure evidence), `port.resolveConflictsForMission`
  (shared-file set, read after the workflow mutates it in place),
  `port.startAgent` (conflict-resolution launch), and
  `port.handleHookFailureAutoBounce` (records the hook identity the workflow
  classified from the failing git operation and returns `false`, so the in-process
  workflow never spends the hook-retry budget).
- `commitSafeMissionArtifacts` now reports `hookFailure: true` with
  `hook: 'pre-commit'` from the failing git operation instead of testing the
  commit output with `HOOK_FAILURE_RE`; it also returns `unsafeFiles` for the
  typed `unsafe-worktree` failure.
- The rebase adapter is imported **lazily** (`await import`) inside the async
  function: a static import would restore the
  `handoff -> review-loop -> rebase-workflow-adapter -> review-loop` cycle this
  module was extracted to break.
- New regression suite `test/task-2377-02-pre-review-rebase-inprocess.test.ts`
  drives the real `runRebaseWorkflow` against a fully mocked `RebaseWorkflowPort`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| 1 — no `child_process`/`spawnSync` import and no `px rebase` argv in `src/adapters/review/rebase.ts`; the path reaches the workflow through `RebaseWorkflowPort` | `src/adapters/review/rebase.ts`, `rebaseBeforeReviewRound`; `` `git grep -n "spawnSync\|child_process" src/adapters/review/rebase.ts` `` (no matches); test `"pre-review rebase module spawns no CLI subprocess"` in `test/task-2377-02-pre-review-rebase-inprocess.test.ts` | PASS |
| 1 — injected port seam invoked exactly once per pre-review rebase | `"pre-review rebase drives the rebase workflow port in-process exactly once"` (asserts one port creation, one workflow run, argv `[slug, '--push']`), `test/task-2377-02-pre-review-rebase-inprocess.test.ts` | PASS |
| 3 (part) — push-time gate failure whose output contains `pre-push` is a gate failure with area, command, non-zero numeric exit code, and `hookFailure: false` | `"push-time gate failure whose output contains pre-push classifies as a gate failure"`, `test/task-2377-02-pre-review-rebase-inprocess.test.ts` | PASS |
| 4 (part) — genuine hook failure reports hook identity and preserved output | `"genuine hook failure during the pre-review rebase reports hook identity and output"` and `"genuine pre-commit failure on the pre-review safety commit reports hook evidence"`, `test/task-2377-02-pre-review-rebase-inprocess.test.ts` | PASS |
| Restricted area — `src/application/rebase-workflow.ts` unchanged; standalone `px rebase` behavior preserved | `` `git diff --stat <parent>..HEAD -- src/application/rebase-workflow.ts` `` is empty; `test/task-1272-standalone-rebase.test.ts`, `test/task-1272-standalone-cycle.test.ts`, `test/rebase-use-case.test.ts` pass unmodified (14/14 with `test/task-1135-coverage.test.ts`) | PASS |
| Source and test typecheck plus lint clean on changed files | `` `npx tsc --noEmit -p tsconfig.json` ``, `` `npx tsc --noEmit -p tsconfig.test.json` ``, `` `npx eslint src/adapters/review/rebase.ts src/application/ports/rebase-workflow.ts test/task-2377-02-pre-review-rebase-inprocess.test.ts` `` — all clean | PASS |
| Mission baseline is green (stop-rule check) | `./scripts/verify-local.sh all` at the mission parent commit: `tests 2257 / pass 2257 / fail 0` | PASS |

Note: `HOOK_FAILURE_RE` and the `Hook rebounce available in CLI rebase command`
message were removed as part of this rewrite; CP-2 records the search evidence
for criteria 2 and 6 together with the review-loop / `HandoffRebasePort`
propagation.

Next action: CP-2 — propagate the typed result into
`src/adapters/review/review-loop.ts` (hook path builds its `PreReviewGateResult`
from `failure.hook`, and a `failure.kind === 'gate'` push failure is reported as
a gate failure rather than a hook failure) and widen `HandoffRebasePort` in
`src/application/ports/handoff-workflow.ts` to `PreReviewRebaseOutcome`, then
record the `git grep` evidence for criteria 2 and 6.
