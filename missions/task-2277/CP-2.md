# CP-2 — source and bundled runtime proof

The isolated proof package in `proofs/task-2277-local-runtime/` now contains
the TSX entry, logical text asset, source asset loader, esbuild configuration,
and runtime resolution loader. On Node.js v22.23.1, the source command
`npm run source -- --mode=headless` completed with the embedded asset key,
SQLite query value `44`, SHA-256 digest, and harmless `node --version`
subprocess result. The selected `npm run build` command produced the single
ESM bundle `build/local-runtime-proof.mjs` and its map.

The bundled headless command was run through `runtime-loader.mjs`; its log
contains only Node's experimental-loader and SQLite warnings, with no
`NODE_MODULES_RUNTIME_LOAD` marker. The bundle embeds third-party code (its
source comments identify it as build input) while the runtime resolver did
not resolve first-party or third-party JavaScript from `node_modules`.

The build warning is the esbuild size marker (`2.3mb ⚠️`), which will be
recorded with exact bytes and the complete warning inventory in CP-3. The
bundle needs a `createRequire` banner for Ink's CommonJS dependencies to
resolve Node built-ins; inspection confirms those dynamic imports are Node
built-ins, not unbundled packages.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 source TSX imports Ink, SQLite, asset, built-in, and harmless subprocess | `proofs/task-2277-local-runtime/src/entry.tsx:1`, `npm run source -- --mode=headless` | PASS |
| SC2 selected single ESM bundle runs without `node_modules` resolution | `proofs/task-2277-local-runtime/package.json:7`, `proofs/task-2277-local-runtime/runtime-loader.mjs:1`, `node --enable-source-maps --experimental-loader ./runtime-loader.mjs build/local-runtime-proof.mjs --mode=headless` | PASS |
| SC3 forced error is implemented for source-map exercise | `proofs/task-2277-local-runtime/src/entry.tsx:11` | PLANNED |
| SC4 headless branch skips the Ink renderer | `proofs/task-2277-local-runtime/src/entry.tsx:35`, `npm run source -- --mode=headless` | PASS |
| SC5 build warning and measurements await retained report | `proofs/task-2277-local-runtime/README.md:17` | PLANNED |
| SC6 ESM SEA remains explicitly deferred | `proofs/task-2277-local-runtime/README.md:34`, ADR 0044 | PASS |
| SC7 all spike sources and retained bundle output are confined | `proofs/task-2277-local-runtime/package.json:1` | PASS |

Next action: run the forced-error and non-TTY paths against the source and bundle, collect the source-map frame, raw timing values, byte size, dependency inventory, and warnings in the feasibility report.
