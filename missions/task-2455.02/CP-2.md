# CP-2: Validated `backlog-md` provider selection at the task composition boundary

## Summary

`src/adapters/config/product-config.ts` now owns the task-provider contract:

- `SUPPORTED_TASK_PROVIDERS` declares `backlog-md` as the only provider this
  release implements.
- `validateWorkflowConfig` rejects any other `adapters.tasks.provider` value
  with an issue naming the field and the supported value. Because
  `src/adapters/cli/commands/config.ts` already prints validation issues and
  exits non-zero, `px config` now fails on an unsupported provider instead of
  echoing it back as effective configuration.
- `resolveTaskProvider(rootDir)` is the shared provider-selection function. An
  omitted provider resolves to the built-in `backlog-md` default; an
  unsupported value throws.
- `resolveTaskStorage` calls `resolveTaskProvider` before resolving any
  directory, so every caller of the shared task-storage boundary — including
  `getTaskStorage` in the backlog-Markdown adapter
  `src/adapters/backlog/task-file-io.ts` and the merge-noise task scan in
  `src/adapters/git/merge-noise.ts` — routes through provider selection rather
  than an unconditional backlog-Markdown adapter.

`test/task-2455.02-task-provider-config-repro.test.ts` grew supported-value
coverage alongside the CP-1 red assertions: the `backlog-md` value validates
clean, resolves through `resolveTaskProvider`, and selects backlog-Markdown task
directories via `getTaskStorage`; an omitted provider keeps the same default.

No second provider, plugin interface, or discovery mechanism was added, per the
mission's Restricted Areas.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `other` override fails validation and does not compose the backlog-Markdown adapter | Tests `"an unsupported adapters.tasks.provider is rejected by configuration validation"`, `"an unsupported adapters.tasks.provider does not compose the backlog-Markdown task adapter"`, and `"an unsupported adapters.tasks.provider stops the backlog-Markdown task file adapter"` in `test/task-2455.02-task-provider-config-repro.test.ts` | Done |
| `backlog-md` selects the backlog-Markdown adapter through provider selection | Test `"the supported adapters.tasks.provider selects the backlog-Markdown task adapter"`; `resolveTaskStorage` calls `resolveTaskProvider` in `src/adapters/config/product-config.ts` | Done |
| Regression test red at parent, green after the fix | Red at `763db33a4` (recorded in `missions/task-2455.02/CP-1.md`); `npx tsx --test test/task-2455.02-task-provider-config-repro.test.ts` now reports `pass 5 / fail 0` | Done |
| Shared boundary covers every task composition entry point | `resolveTaskStorage` is the single storage resolver used by `src/adapters/backlog/task-file-io.ts` (`getTaskStorage`) and `src/adapters/git/merge-noise.ts`; both are covered through `getTaskStorage` in the repro test | Done |
| No pre-existing configuration behavior regressed | `npx tsx --experimental-test-module-mocks --test test/product-config.test.ts` reports `pass 38 / fail 0`; `npx tsc --noEmit` reports no diagnostics | Done |
| Schema, setup output, `px config` text, and `docs/config.md` aligned | Deferred to CP 3 per `missions/task-2455.02/MISSION.md` | Pending |
| `./scripts/verify-local.sh all` succeeds | Deferred to CP 3 gate run | Pending |

Next action: Constrain `adapters.tasks.provider` to an enum of `backlog-md` in `config/workflow.config.schema.json`, drop the free-text task-provider prompt from `src/adapters/review/setup-review.ts`, document the supported value in `docs/config.md` and remove its known-gap entry, then run `./scripts/verify-local.sh all` (CP 3).
