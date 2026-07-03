# CP-1: Generic post-integrate hook contract in config/schema/defaults

## Summary of work done

- Added `adapters.integrate: {}` to the default config in `lib/core/product-config.ts:8-24` so the new adapter section exists with no configured hook by default, and is picked up by the existing `deepMerge`/`loadEffectiveConfig` path without any special-casing.
- Extended `config/workflow.config.schema.json` with an `adapters.integrate.postIntegrateCommand` string property (`config/workflow.config.schema.json:64-80`), documenting the env vars the hook receives and that leaving it unset is a no-op.
- Added a new module `lib/core/post-integrate-hook.ts` implementing the generic hook contract, mirroring the existing `adapters.verification.command` pattern in `lib/core/verification.ts`:
  - `resolvePostIntegrateCommand(rootDir)` — reads `adapters.integrate.postIntegrateCommand` via `loadAdapterConfig`, returns `null` when unset/blank.
  - `buildPostIntegrateHookEnv(params)` — builds `INTEGRATE_HOOK_SLUG`, `INTEGRATE_HOOK_BASE_WORKTREE`, `INTEGRATE_HOOK_BASE_BRANCH`, `INTEGRATE_HOOK_VARIANT` env vars.
  - `runPostIntegrateHook(params)` — no-op (`{ ran: false, ok: true }`) when no command is configured; otherwise runs the command via `bash -lc` from `params.baseWorktree` and returns `{ ran, ok, command, output, exitCode }`.
- This module is intentionally decoupled from `lib/commands/integrate.ts` wiring, which is CP2/CP3 scope; CP1 only proves the contract in isolation.

## Goal Check

| Success criterion | Evidence |
| --- | --- |
| SC1: repo-local post-integrate command is optional and documented in schema/effective-config | `lib/core/product-config.ts:8-24` (`integrate: {}` default); `config/workflow.config.schema.json:64-80` (schema); test `loadEffectiveConfig has no post-integrate hook by default` and `loadEffectiveConfig merges a repo-declared post-integrate hook command` in `test/product-config.test.js:86-104` |
| Hook resolution reads the new config key | `lib/core/post-integrate-hook.ts:24-30` (`resolvePostIntegrateCommand`); tests `resolvePostIntegrateCommand returns null when no workflow.config.json is present`, `...returns null when postIntegrateCommand is absent`, `...returns the trimmed configured command` in `test/post-integrate-hook.test.js:20-40` |
| Hook receives slug/base worktree/base branch/variant context | `lib/core/post-integrate-hook.ts:34-40` (`buildPostIntegrateHookEnv`); test `buildPostIntegrateHookEnv exposes slug, base worktree, base branch, and variant` in `test/post-integrate-hook.test.js:47-59` |
| No-op behavior when unconfigured | `lib/core/post-integrate-hook.ts:52-55` (`runPostIntegrateHook` returns early when `resolveCommandFn` yields `null`); test `runPostIntegrateHook is a no-op when no command is configured` in `test/post-integrate-hook.test.js:61-71` |
| Hook execution and failure surface (exit code, output) as data, not thrown | `lib/core/post-integrate-hook.ts:56-65`; tests `runPostIntegrateHook runs the configured command from the base worktree with hook env` and `runPostIntegrateHook reports a non-zero exit as a failed hook, not thrown` in `test/post-integrate-hook.test.js:73-124` |

Test run: `FORCE_COLOR=0 node --test test/post-integrate-hook.test.js test/product-config.test.js` — 41 passed, 0 failed.
Full existing suite still green: `FORCE_COLOR=0 node --test test/integrate.test.js test/product-config.test.js` — 85 passed, 0 failed (pre-wiring baseline, confirms CP1 introduced no regressions before CP2 touches `integrate.ts`).

Next action: Wire `runPostIntegrateHook` into `lib/commands/integrate.ts`'s three success paths (Variant A closeout, Variant B fresh squash, Variant B resumed-from-existing-squash-commit) with exact-once invocation coverage (CP2).
