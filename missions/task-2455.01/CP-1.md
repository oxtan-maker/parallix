# Checkpoint 1 — Reproduction test for TASK-2455.01

## Summary
Wrote `test/task-2455.01-target-user-repro.test.ts` before any production
change. The test exercises the three supported generation surfaces and asserts
`product.targetUser` is absent from each:

- code-owned defaults via `loadEffectiveConfig()` (and that `product.name` is preserved)
- the public schema at `config/workflow.config.schema.json` (that `product.properties.targetUser` is undeclared)
- setup-generated workflow config via `buildWorkflowConfig()` (and that `product.name` is still produced)

At the mission parent commit (`22ada3d07`) all three assertions fail; the test
turns green only once the retirement change removes the field from every
surface. Partial config merging and all other `product`/`adapters` settings are
untouched by this test.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Repro fails at parent commit, green after fix | `npm test -- --unit-test-headroom --test-name-pattern "TASK-2455.01" test/task-2455.01-target-user-repro.test.ts` → 3 fail (`TASK-2455.01 defaults omit product.targetUser while keeping product.name`, `TASK-2455.01 public schema does not declare product.targetUser`, `TASK-2455.01 setup-generated workflow config omits product.targetUser`) | Complete (red) |
| Repro covers defaults, schema, setup | `test/task-2455.01-target-user-repro.test.ts` (3 tests, all currently failing) | Complete |

## Next action
CP-2: remove `product.targetUser` from `src/adapters/config/product-config.ts`,
`config/workflow.config.schema.json`, and `src/adapters/review/setup-review-config.ts`,
and drop it from the checked-in `workflow.config.json` sample, then confirm the
repro turns green.
