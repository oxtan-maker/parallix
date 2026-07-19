# CP-1 — proof boundary and bundler selection

The non-production spike directory is `proofs/task-2277-local-runtime/`. I
reviewed ADR 0044 and selected esbuild from two candidates (esbuild and tsup)
because its direct ESM output and source-map controls are sufficient to test
the ADR bundle contract without adding wrapper configuration. The source-run
matrix names the React/Ink, `node:sqlite`, logical asset, `node:crypto`,
harmless Node-version subprocess, forced-error, and headless paths. The
planned source command is `npm run source -- --mode=headless`; package setup
and execution remain for CP-2.

The limitation identified at this checkpoint is architectural rather than a
failed runtime test: Node.js 22.23.1 cannot prove an ESM SEA entry. ADR 0044
assigns that native-binary proof to TASK-2286, so no CommonJS wrapper will be
introduced here.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 source proof matrix names every required surface | `proofs/task-2277-local-runtime/README.md:22` | PLANNED |
| SC2 candidate selection applies ADR bundle-loading requirement | `proofs/task-2277-local-runtime/README.md:7`, ADR 0044 | PLANNED |
| SC3 forced-error command is defined | `proofs/task-2277-local-runtime/README.md:28` | PLANNED |
| SC4 headless command and expected no-Ink behavior are defined | `proofs/task-2277-local-runtime/README.md:29` | PLANNED |
| SC5 measurement and warning report is reserved | `proofs/task-2277-local-runtime/README.md:17` | PLANNED |
| SC6 ESM SEA limitation is deferred without a wrapper | `proofs/task-2277-local-runtime/README.md:34`, ADR 0044 | PASS |
| SC7 proof is confined to an explicitly non-production directory | `proofs/task-2277-local-runtime/README.md:3` | PASS |

Next action: create the isolated proof package, implement the TSX entry and asset, then source-run and bundle it with esbuild.
