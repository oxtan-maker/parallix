# CP-4 — final feasibility record and verification

The completed feasibility record is retained at
`proofs/task-2277-local-runtime/REPORT.md`; source and configuration remain
under that explicitly non-production directory, while generated bundles,
source maps, and diagnostic captures were removed after their results were
recorded. No production runtime source was changed. The
historical comparison `git diff --name-only c38620fd..HEAD -- dist` produced
no paths, confirming the existing CommonJS `dist/` runtime is unchanged from
the mission parent commit.

The declared gate `./scripts/verify-local.sh all` passed after rebuilding the
repository and running its default test suite. The proof's own type boundary
also passed with `./node_modules/.bin/tsc --noEmit` in the proof directory.
Node.js v22.23.1 remains suitable for this source-and-bundle proof but not for
the final ESM SEA entry, which is explicitly deferred to TASK-2286 without a
CommonJS wrapper proposal.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 source-run proof covers React/Ink, SQLite, asset, built-in, and safe subprocess | `proofs/task-2277-local-runtime/src/entry.tsx:1`, `proofs/task-2277-local-runtime/REPORT.md:9` | PASS |
| SC2 the selected single ESM bundle executes without runtime `node_modules` resolution | `proofs/task-2277-local-runtime/package.json:7`, `proofs/task-2277-local-runtime/runtime-loader.mjs:1`, `proofs/task-2277-local-runtime/REPORT.md:13` | PASS |
| SC3 forced error stack maps to an exact TypeScript filename and line | `proofs/task-2277-local-runtime/src/entry.tsx:12`, `node --enable-source-maps build/local-runtime-proof.mjs --force-error` | PASS |
| SC4 non-TTY path completes without initializing Ink | `proofs/task-2277-local-runtime/src/entry.tsx:35`, `proofs/task-2277-local-runtime/REPORT.md:17` | PASS |
| SC5 report retains byte size, ten individual timings, inventory, and warnings without release claim | `proofs/task-2277-local-runtime/REPORT.md:21`, `proofs/task-2277-local-runtime/REPORT.md:40` | PASS |
| SC6 ESM SEA is unproven on Node 22.23.1 and deferred to TASK-2286 | `proofs/task-2277-local-runtime/REPORT.md:46`, ADR 0044 | PASS |
| SC7 all retained spike material is in the non-production proof directory and `dist/` is unchanged | `proofs/task-2277-local-runtime/REPORT.md:5`, `git diff --name-only c38620fd..HEAD -- dist` | PASS |
| Mission-declared verification gate passes | `./scripts/verify-local.sh all` | PASS |

Next action: commit this final checkpoint document so every mission checkpoint and its Goal Check evidence are committed for Parallix handoff.
