# CP-2: runtime harness and captured baseline

Implemented `npm run benchmark:runtime`. It builds the canonical bundle and a
separate bundled composition probe before measuring. The CLI scenarios run in
a temporary Git fixture containing one `task-bench` document, a fresh
`PARALLIX_HOME`, and `PARALLIX_TEST_NO_FORGEJO=1`. The benchmark retains raw
samples and the captured baseline in `runtime-results.json`; that generated
evidence is checkpoint material, not live authored documentation.

The Git PATH wrapper records each timed child invocation and `worktree list`
call. SQLite query and task-document read counters are explicitly unavailable:
the isolated built child offers no non-invasive seam for them. Board builds use
controlled in-memory read adapters, so their counters are explicitly zero.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| One documented command covers the five named scenarios on controlled fixtures | `npm run benchmark:runtime`; `scripts/benchmark-runtime.ts`; `missions/task-2404/runtime-results.json` | PASS |
| Timed scenarios have warmup, samples, build exclusion, and robust summary | `npm run benchmark:runtime`; `missions/task-2404/runtime-results.json` | PASS |
| Results include required environment and scenario metadata | `missions/task-2404/runtime-results.json` | PASS |
| CLI and projection counter availability is explicit | `missions/task-2404/runtime-results.json`; `scripts/benchmark-runtime.ts` | PASS |
| Board scale uses exact small and at-least-10:1 large fixture counts | `missions/task-2404/runtime-results.json`; `scripts/benchmark-runtime.ts` | PASS |
| Startup isolates fresh CLI execution from composition-root loading | `missions/task-2404/runtime-results.json`; `scripts/benchmark-runtime.ts` | PASS |
| Focused tests cover summary, fixture scale, and counter reporting | `test/runtime-benchmark.test.ts` | IN PROGRESS |
| Required verification gate passes | `./scripts/verify-local.sh all` | PENDING |

Next action: Commit focused harness tests, rerun unchanged benchmark definitions, assess the composition-root sample, and run the final gate.
