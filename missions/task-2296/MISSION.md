# Mission: Correct the packaged rebase-launcher regression assertion (task-2296)

## Goal

Unblock TASK-2294 by correcting the false test failure in the review-round rebase coverage. Preserve the established launcher architecture: source checkouts run `tsx src/entry/px.ts`; packaged installations run the compiled `px.js` adjacent to the loaded runtime module.

## Scope

- Update `test/task-1107-repro.test.ts` so its packaged-runtime assertion derives the expected CLI path from the loaded review module.
- Keep the exact `rebase`, slug, and `--push` invocation assertion.
- Record that the `.test-runtime` path is a test preload alias, not a production launcher regression.

## Out of Scope

- Changes to `rebaseBeforeReviewRound`, runtime selection, packaging, Forgejo review flow, or task status transitions.
- Any TASK-2294 domain-model, persistence, SQLite, or sync/async-seam change.

## Success Criteria

- The packaged-runtime test passes both when the loaded review module is under `dist/` and when the default suite aliases it under `.test-runtime/`.
- The test asserts Node, the entrypoint resolved from that loaded module, `rebase`, the supplied slug, and `--push` as one complete invocation.
- `./scripts/verify-local.sh all` passes.

## Evidence

The failed assertion expected `<checkout>/dist/px.js` while the default suite correctly loaded the review module from `<checkout>/.test-runtime/`. The runtime implementation resolves its packaged CLI relative to `MODULE_DIR` in `src/platform/runtime/lib/review/rebase.ts`; the default-suite alias is created by `scripts/build-test-runtime.js` and applied by `test/source-runtime-alias.js`.

## Checkpoints

- CP 1: Confirm the implementation's source-versus-packaged launcher split and the aliasing test harness.
- CP 2: Replace the hard-coded checkout path with the path derived from the loaded module; retain the full argument assertion.
- CP 3: Run the focused test and `./scripts/verify-local.sh all`, then hand off for integration.
