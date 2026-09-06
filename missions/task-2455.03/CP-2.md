# Checkpoint 2 — Align shared workflow-override validation with the config schema

## Summary
Rewrote `validateWorkflowConfig` in `src/adapters/config/product-config.ts` to
enforce every constraint declared by `config/workflow.config.schema.json` while
preserving the schema's `additionalProperties:true` policy (unknown keys stay
allowed at the top level and in every open adapter section; only `runners` and
`subagents` are closed objects). Added focused unit coverage in
`test/product-config.test.ts` for each schema constraint: object types, string
fields, `tasks.storage` string-or-object, nullable review-provider enum,
positive-integer `maxConcurrentCustom`, string-valued agent models, the closed
enum-restricted `runners.custom`, and the closed nullable non-negative
`subagents.maxParallel`. `tsc --noEmit` is clean.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Object types enforced for `product` and adapter sections | `test/product-config.test.ts`, test `validateWorkflowConfig rejects non-object product/adapters shapes` | PASS |
| String fields enforced (tasks/missions/review) | `test/product-config.test.ts`, tests `validateWorkflowConfig rejects a non-string tasks.provider`, `...missions.branchPrefix`, `...review.remote` | PASS |
| `tasks.storage` string-or-object form enforced | `test/product-config.test.ts`, tests `validateWorkflowConfig accepts a string or object tasks.storage` / `... rejects a non-string, non-object tasks.storage` | PASS |
| Review provider restricted to forgejo/none/null | `test/product-config.test.ts`, tests `validateWorkflowConfig accepts forgejo, none, and null review providers` / `... rejects an unsupported review provider enum value` / `... rejects a non-string, non-null review provider type` | PASS |
| Positive-integer `maxConcurrentCustom` | `test/product-config.test.ts`, test `validateWorkflowConfig rejects invalid maxConcurrentCustom values` | PASS |
| String-valued agent models | `test/product-config.test.ts`, test `validateWorkflowConfig accepts string-valued agent models and rejects non-string values` | PASS |
| Closed, enum-restricted `runners.custom` | `test/product-config.test.ts`, test `validateWorkflowConfig enforces the closed, enum-restricted runners.custom` | PASS |
| Closed, nullable non-negative `subagents.maxParallel` | `test/product-config.test.ts`, test `validateWorkflowConfig enforces the closed, nullable non-negative subagents.maxParallel` | PASS |
| Allowed unknown properties preserved | `test/product-config.test.ts`, test `validateWorkflowConfig preserves allowed unknown properties` | PASS |
| Validation matches the schema contract | `config/workflow.config.schema.json` vs `src/adapters/config/product-config.ts` `validateWorkflowConfig` | PASS |
| Typecheck clean | `tsc --noEmit` exits 0 | PASS |

## Evidence: `tsc --noEmit`
```
$ npx tsc --noEmit
(no output, exit 0)
```

## Evidence: product-config suite
```
$ npx tsx --experimental-test-module-mocks --test test/product-config.test.ts
ℹ pass 50
ℹ fail 0
```

Next action: commit CP-2, then run CP-3 (caller verification + `./scripts/verify-local.sh all`).
