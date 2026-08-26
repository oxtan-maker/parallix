# CP-2: Green no-slug publication

The integrate use case now receives the adapter's existing slug inference seam,
so a bare integration command publishes running and ended `integrate` facts for
the mission it actually integrates. No new authority or phase was added.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Bare integrate publishes running and ended facts | `test/current-work-publication.test.ts`, `"px integrate without a slug publishes for the adapter-inferred mission"` | PASS |
| Explicit integrate publication remains intact | `test/current-work-publication.test.ts`, `"px integrate brackets the run with integrate-phase current work"` | PASS |
| Integration-lane board and TUI behavior is covered | `test/task-2411-integrate-work-detection.test.ts`, `"running integrate projects as working, not integrate-lane"` | PASS |
| Static analysis is clean | `./scripts/verify-local.sh static-analysis` | PASS |

Next action: run the declared full verification gate and capture it in CP-3.
