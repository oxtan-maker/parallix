# Checkpoint 1 — Parallel integration gates and terminal output

## Summary

The gate scheduler reads concurrency and `after` dependencies from repository configuration. This repository declares six checks after build and holds Sonar until a fresh coverage file exists. The terminal view owns rendering and keeps each gate's recent output separate. Cancellation has a five-second TERM grace period followed by KILL. The standalone verifier now runs the same coverage and Sonar commands and leaves CodeQL manual.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Six independent checks after build; Sonar waits for coverage | `workflow.config.json:24` and `test/repository-gates.test.ts`, `this repository starts every independent check while Sonar waits for coverage` | PASS |
| Stale coverage cannot release Sonar | `test/repository-gates.integration.test.ts`, `a stale coverage report cannot release the dependent Sonar gate` | PASS |
| One terminal owner with isolated output and restored input | `src/adapters/config/gate-dashboard.ts:20`, `src/adapters/config/gate-dashboard.ts:76`; `test/repository-gates.test.ts`, `parallel success output stays isolated while results retain each complete log` | PASS |
| TERM-resistant cancellation is bounded | `test/repository-gates.integration.test.ts`, `cancel escalates from TERM to KILL when a gate ignores TERM`; `src/adapters/config/repository-gates.ts:448` | PASS |
| Output retention is bounded; serial piped runs stream live | `test/repository-gates.integration.test.ts`, `gate output retention keeps a bounded tail` and `serial non-TTY gate output arrives before the gate finishes` | PASS |
| Standalone commands match merge commands; CodeQL stays manual | `test/integration-pipelines.test.ts`, `repo integration config keeps workflow gate on the targeted mission-lifecycle suite` | PASS |

## Verification

- `./scripts/verify-local.sh static-analysis` — passed.
- `./scripts/verify-local.sh all` — passed, 3,033 tests.
- `./scripts/verify-local.sh docs` — passed.
- Focused gate tests — 104 passed or intentionally skipped, 0 failed; the new real-command integration tests passed.

## Next action

Commit the candidate, generate fresh LCOV, and run Sonar on that commit before integration.
