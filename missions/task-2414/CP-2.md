# CP-2 — Start static analysis from the integration hook

The repo-local integration hook now starts static analysis before it dispatches configured integration gates. The duplicate static-analysis configuration entry is removed; generic integration-plan resolution remains unchanged.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 | `test/verify-local-integrate.test.ts`; "verify-local integrate runs static analysis before configured integration gates (task-2414)" | PASS |
| SC2 | `scripts/verify-local.sh integrate`; `scripts/verify-local.sh static-analysis` | PASS |
| SC3 | `scripts/verify-local.sh static-analysis` | PASS |
| SC4 | `config/integration-pipelines.json` | PASS |

Next action: Add hermetic plan-class and failure-short-circuit regressions for the direct integration verifier.
