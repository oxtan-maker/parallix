# CP-1: benchmark contract

Defined the stable benchmark surface as `npm run benchmark:runtime`, backed by
`scripts/benchmark-runtime.ts`. The runner builds before samples, creates an
isolated temporary Parallix home for each CLI scenario, and writes raw JSON to
`artifacts/benchmarks/runtime.json` (or `--output`). It will measure fresh
Node processes for `px --version`, `px status task-2404`, and `px stats`; the
CLI composition-root contribution separately by importing `create-cli` in a
fresh process; and `BoardProjectionBuilder` using deterministic in-memory
read adapters at 10 and 100 missions.

Each scenario has one warmup and five samples by default. The build precedes
all timed samples. Timing uses `process.hrtime.bigint()` around only the target
process or projection build. “Cold” means a newly spawned Node process per
sample; filesystem-cache control is intentionally not claimed. Result JSON
will preserve samples, median, maximum (the tail value for fewer than 20
samples), platform, CPU, Node version, revision, fixture counts, and scenario
metadata. CLI subprocess and `git worktree list` counts are collected from a
temporary `git` PATH wrapper; SQLite queries and task-document reads are
explicitly `unavailable` because the built child has no non-invasive existing
counter seam. The in-memory BoardProjection scenario reports zero operations
for all counters because it exercises the builder, not repository adapters.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| One documented command covers the five named scenarios on controlled fixtures | `npm run benchmark:runtime`; `scripts/benchmark-runtime.ts` | PLANNED |
| Timed scenarios have warmup, samples, build exclusion, and robust summary | `scripts/benchmark-runtime.ts`; `artifacts/benchmarks/runtime.json` | PLANNED |
| Results include required environment and scenario metadata | `scripts/benchmark-runtime.ts`; `artifacts/benchmarks/runtime.json` | PLANNED |
| CLI and projection counter availability is explicit | `scripts/benchmark-runtime.ts`; `artifacts/benchmarks/runtime.json` | PLANNED |
| Board scale uses exact small and at-least-10:1 large fixture counts | `scripts/benchmark-runtime.ts`; `artifacts/benchmarks/runtime.json` | PLANNED |
| Startup isolates fresh CLI execution from composition-root loading | `scripts/benchmark-runtime.ts`; `artifacts/benchmarks/runtime.json` | PLANNED |
| Focused tests cover summary, fixture scale, and counter reporting | `test/runtime-benchmark.test.ts` | PLANNED |
| Required verification gate passes | `./scripts/verify-local.sh all` | PENDING |

Next action: Implement `scripts/benchmark-runtime.ts` and its isolated fixture model.
