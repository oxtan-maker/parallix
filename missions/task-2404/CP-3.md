# CP-3: coverage, rerun, and final verification

Added isolated tests for the result summary, exact fixture ratio, and explicit
unavailable-counter reporting. A second run wrote to
`/tmp/task-2404-rerun.json` without changing the harness or fixture
definition; it retained the same six scenario definitions as the captured
baseline. On this baseline host, the bundled composition-root probe median was
218.532022 ms and cold `px --version` median was 192.039207 ms. That 26.492815
ms difference is evidence for a later before/after static-import experiment,
not authorization to change import behavior here.

Round-1 review reconciliation: the backlog description had been rewritten to
seven operator commands, conflicting with this locked mission. It now matches
the runtime-scenario scope in `MISSION.md`; no lifecycle or UI benchmarks were
added. The final gate output is retained as checkpoint evidence.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| One documented command covers the five named scenarios on controlled fixtures | `npm run benchmark:runtime`; `scripts/benchmark-runtime.ts`; `missions/task-2404/runtime-results.json` | PASS |
| Timed scenarios have warmup, samples, build exclusion, and robust summary | `npm run benchmark:runtime`; `missions/task-2404/runtime-results.json` | PASS |
| Results include required environment and scenario metadata | `npm run benchmark:runtime`; `missions/task-2404/runtime-results.json` | PASS |
| CLI and projection counter availability is explicit | `missions/task-2404/runtime-results.json`; "runtime benchmark explicitly reports unavailable child-process counters" in `test/runtime-benchmark.test.ts` | PASS |
| Board scale uses exact small and at-least-10:1 large fixture counts | `missions/task-2404/runtime-results.json`; "runtime benchmark fixture scale is exactly ten to one" in `test/runtime-benchmark.test.ts` | PASS |
| Startup isolates fresh CLI execution from composition-root loading | `npm run benchmark:runtime`; `missions/task-2404/runtime-results.json`; `scripts/benchmark-runtime.ts` | PASS |
| Focused tests cover summary, fixture scale, and counter reporting | `test/runtime-benchmark.test.ts`; "runtime benchmark summary reports median and maximum below twenty samples" | PASS |
| Required verification gate passes | `./scripts/verify-local.sh all`; `missions/task-2404/verification-all.txt` | PASS |

Next action: Hand off the committed benchmark baseline for later-tree comparison; any import-topology change requires a fresh before/after run of `npm run benchmark:runtime`.
