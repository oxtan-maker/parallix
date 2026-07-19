# CP-3 — diagnostics, non-TTY behavior, and measurements

The retained report records the forced-error result from both execution modes:
the bundle and source commands map the intentional failure to
`src/entry.tsx:12:9`. The explicit `--mode=tty` proof prints the Ink renderer
text and `inkInitialized:true`, while both headless paths print the normal
proof JSON without renderer output. The report also retains exact bundle and
source-map bytes, ten individual new-process timing values, direct and bundled
dependency inventory, and the observed esbuild/Node warnings.

The local timing values range from 391.781 ms to 484.584 ms. They are clearly
identified as host-local measurements, not a release-performance conclusion.
The unresolved technical limitation remains ESM SEA support on Node 22.23.1;
the report explicitly assigns its proof to TASK-2286.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 React/Ink, SQLite, asset, built-in, and subprocess proof executes | `proofs/task-2277-local-runtime/src/entry.tsx:1`, `proofs/task-2277-local-runtime/REPORT.md:9` | PASS |
| SC2 one ESM bundle has no runtime `node_modules` resolution | `proofs/task-2277-local-runtime/runtime-loader.mjs:1`, `proofs/task-2277-local-runtime/REPORT.md:13` | PASS |
| SC3 forced error maps to exact TSX source location | `proofs/task-2277-local-runtime/src/entry.tsx:12`, `node --enable-source-maps build/local-runtime-proof.mjs --force-error` | PASS |
| SC4 headless execution does not initialize Ink | `proofs/task-2277-local-runtime/src/entry.tsx:35`, `proofs/task-2277-local-runtime/REPORT.md:17` | PASS |
| SC5 report records bytes, ten raw timings, inventory, and warnings | `proofs/task-2277-local-runtime/REPORT.md:21`, `proofs/task-2277-local-runtime/REPORT.md:40` | PASS |
| SC6 ESM SEA is unproven and deferred to TASK-2286 | `proofs/task-2277-local-runtime/REPORT.md:46`, ADR 0044 | PASS |
| SC7 retained spike output is within the named proof directory | `proofs/task-2277-local-runtime/REPORT.md:5` | PASS |

Next action: commit the diagnostics report and retained proof updates, verify `dist/` remains unchanged from the mission parent, then run `./scripts/verify-local.sh all` for the final checkpoint.
