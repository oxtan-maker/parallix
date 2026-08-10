# CP-1 — Baseline and contract

Established the authoritative statistics metric contract and inventory. The contract assigns lifecycle facts to lane history, limits telemetry to execution measurements, defines delivery completion as first `integration → done`, defines missing-data behavior and per-metric coverage, and names the shared application projection used by the board and cohort CLI. The inventory also identifies the remaining production-composition repository-identity derivation for CP-2 consolidation.

Focused regression coverage now verifies that the contract names every decision metric. Existing TASK-2347 regressions provide baseline proof for identity isolation, lifecycle history, dwell attribution, truthful throughput, runtime separation, injected-clock aging, provenance, shared semantics, and review bounces.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 repository identity has a single documented scope and contamination baseline | `docs/metric-contract.md:9`, `test/task-2347-01-repository-identity-repro.test.ts` | PASS |
| SC2 lifecycle authority baseline includes missions without telemetry | `docs/metric-contract.md:10`, "throughput excludes active and review telemetry, and weekly buckets use closure week" | PASS |
| SC3 delivery completion is distinct from administrative closure | `docs/metric-contract.md:11`, `test/task-2347.02-lifecycle-history.test.ts` | PASS |
| SC4 dwell, lane age, bottleneck, historical flow, and observation-time rules are specified | `docs/metric-contract.md:12`, `docs/metric-contract.md:22`, `docs/metric-contract.md:23`, `test/task-2347-06-repro.test.ts` | PASS |
| SC5 weekly throughput time semantics are explicit | `docs/metric-contract.md:24`, `test/task-2347.04-throughput-truthful.test.ts` | PASS |
| SC6 lifecycle time and runtime/missing telemetry are distinct | `docs/metric-contract.md:21`, `docs/metric-contract.md:27`, `test/task-2347.05-cycle-time-vs-runtime.test.ts` | PASS |
| SC7 review bounce and review-fix metrics are separate | `docs/metric-contract.md:25`, `docs/metric-contract.md:26`, `test/task-2347.09-bounce-rate.test.ts` | PASS |
| SC10 contract covers every user-visible statistics class and names shared calculation ownership | `docs/metric-contract.md:14`, `docs/metric-contract.md:18`, "statistics metric contract names every board and CLI decision metric with its semantic inputs" | PASS |

Next action: Consolidate primary-worktree repository identity at every production composition boundary and repair lifecycle completion/temporal projection semantics in CP-2.
