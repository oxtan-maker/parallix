# Checkpoint 1 — Failing reproduction for an unsupported review-provider enum

## Summary
Added a regression in `test/config-command.test.ts` that drives
`{ "adapters": { "review": { "provider": "unsupported" } } }` through the
`config` command. At the parent commit `302bf57d0` the command exits `0` and
prints an effective configuration, so the new test fails (red): the schema
enum `["forgejo", "none", null]` is not enforced. The same test is retained and
turns green once `validateWorkflowConfig` rejects the enum violation. The red
baseline was committed as `302bf57d0`; the fix and the remaining schema
coverage landed in `4bf7fa38c` (see CP-2).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Unsupported review provider is rejected via `px config` | `test/config-command.test.ts`, test `config rejects an unsupported review provider enum value as fallback defaults and exits non-zero` | PASS |
| Red baseline proves parent commit exits 0 without a structural-validation error | parent commit `302bf57d0`; `npx tsx --experimental-test-module-mocks --test test/config-command.test.ts` fails that one test | PASS |
| Green after fix: exit 1, structural-validation diagnostic naming the provider rule, fallback-default output | commit `4bf7fa38c`; same test command passes 4/4 | PASS |
| Existing `px config` invalid-file behavior preserved | `test/config-command.test.ts`, test `config reports structurally invalid overrides as fallback defaults and exits non-zero` | PASS |

## Red evidence (parent commit `302bf57d0`)
```
✖ config rejects an unsupported review provider enum value as fallback defaults and exits non-zero
ℹ pass 3
ℹ fail 1
```

## Green evidence (commit `4bf7fa38c`)
```
✔ config reports malformed JSON as fallback defaults and exits non-zero
✔ config reports structurally invalid overrides as fallback defaults and exits non-zero
✔ config rejects an unsupported review provider enum value as fallback defaults and exits non-zero
✔ config leaves a non-git standalone directory unchanged
ℹ pass 4
ℹ fail 0
```

Next action: commit CP-2 (schema-aligned validation + focused per-constraint unit coverage).
