# Checkpoint 2 — Retire product.targetUser from generation surfaces

## Summary
Removed `product.targetUser` from every supported generation surface:
- `src/adapters/config/product-config.ts` — dropped `targetUser` from `DEFAULT_CONFIG.product`
- `config/workflow.config.schema.json` — dropped the `product.properties.targetUser` declaration
- `src/adapters/review/setup-review-config.ts` — `buildWorkflowConfig` no longer emits `targetUser`
- `workflow.config.json` — dropped `targetUser` from the checked-in sample

`product.name` is preserved on all three, partial config merging is untouched,
and all remaining `product`/`adapters` settings are unchanged. The reproduction
test `test/task-2455.01-target-user-repro.test.ts` now passes all three
assertions (defaults, schema, setup).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| defaults omit field, keep name | `npm test -- --unit-test-headroom --test-name-pattern "TASK-2455.01" test/task-2455.01-target-user-repro.test.ts` → all 3 pass | Complete (green) |
| schema no longer declares field | `config/workflow.config.schema.json` `product.properties` has no `targetUser`; `test/task-2455.01-target-user-repro.test.ts` "TASK-2455.01 public schema does not declare product.targetUser" | Complete |
| setup config omits field | `src/adapters/review/setup-review-config.ts` `buildWorkflowConfig` emits no `targetUser`; `test/task-2455.01-target-user-repro.test.ts` "TASK-2455.01 setup-generated workflow config omits product.targetUser" | Complete |
| checked-in sample omits field | `workflow.config.json` `product` has only `name` | Complete |
| no production reference remains | `grep -rn targetUser src/ config/ workflow.config.json` returns nothing | Complete |

## Next action
CP-3: update `docs/config.md` to remove the `product.targetUser` known-gap entry,
run the targeted regression and the `./scripts/verify-local.sh all` gate, and
record the criterion evidence.
