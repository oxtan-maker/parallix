# CP-1: Reproduction test for the ineffective task-provider configuration

## Summary

Added `test/task-2455.02-task-provider-config-repro.test.ts` before any
production change. The test writes a `workflow.config.json` containing
`{ "adapters": { "tasks": { "provider": "other" } } }` into a temporary root and
asserts two things about that unsupported override:

1. `validateWorkflowConfig` reports an issue naming `adapters.tasks.provider`
   and the supported `backlog-md` value.
2. Task-storage composition (`resolveTaskStorage`, the shared boundary used by
   the backlog task adapter in `src/adapters/backlog/task-file-io.ts`) refuses
   to resolve backlog-Markdown directories for the unsupported provider.

Both assertions fail at the mission parent commit `763db33a4`, by assertion —
not by an import or module-resolution error — so the red state demonstrates the
defect rather than a missing symbol.

Observed red output at `763db33a4` from
`npx tsx --test test/task-2455.02-task-provider-config-repro.test.ts`:

- `an unsupported adapters.tasks.provider is rejected by configuration validation`
  fails with `expected a validation issue for adapters.tasks.provider, got []`.
- `an unsupported adapters.tasks.provider does not compose the backlog-Markdown task adapter`
  fails with `AssertionError ... Missing expected exception ... expected: /adapters\.tasks\.provider/`.

No production file was modified in this checkpoint.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Regression test exists at the mission-declared path | `test/task-2455.02-task-provider-config-repro.test.ts` | Done |
| Test loads configuration with `adapters.tasks.provider: "other"` | Test `"an unsupported adapters.tasks.provider is rejected by configuration validation"` builds `{ adapters: { tasks: { provider: 'other' } } }` and passes it to `validateWorkflowConfig` | Done |
| Test asserts lifecycle composition does not proceed on the unsupported value | Test `"an unsupported adapters.tasks.provider does not compose the backlog-Markdown task adapter"` asserts `resolveTaskStorage` throws | Done |
| Test is red at the mission parent commit | `npx tsx --test test/task-2455.02-task-provider-config-repro.test.ts` at commit `763db33a4` reports `pass 0 / fail 2`, both `ERR_ASSERTION` | Done |
| Validated `backlog-md` selection implemented | Deferred to CP 2 per `missions/task-2455.02/MISSION.md` | Pending |
| Schema, setup output, `px config`, and `docs/config.md` aligned | Deferred to CP 3 per `missions/task-2455.02/MISSION.md` | Pending |
| `./scripts/verify-local.sh all` succeeds | Deferred to CP 3 gate run | Pending |

Next action: Implement `resolveTaskProvider` in `src/adapters/config/product-config.ts`, reject non-`backlog-md` values in `validateWorkflowConfig`, route `resolveTaskStorage` through that selection, and add the supported-value coverage that pins `backlog-md` to the backlog-Markdown adapter (CP 2).
