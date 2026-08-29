# CP-1 — Reproduce static-analysis omission

Added the focused self-development hook regression before changing the integration hook. It requires static analysis to occur before configured gates start.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 | `test/verify-local-integrate.test.ts`; "verify-local integrate runs static analysis before configured integration gates (task-2414)" | FAIL (expected red reproduction) |
| SC3 | `scripts/verify-local.sh static-analysis` remains the command invoked by the hook | PASS |
| SC4 | `config/integration-pipelines.json`; configured gate order remains unchanged | PASS |

Next action: Start static analysis in the integration hook, then rerun the reproduction.
