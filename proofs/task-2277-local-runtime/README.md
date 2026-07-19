# TASK-2277 local runtime proof

This directory is a disposable, non-production feasibility spike for TASK-2277.
It does not alter `lib/`, `bin/`, or the CommonJS `dist/` runtime.

## Bundler decision

ADR 0044 requires one canonical ESM payload that bundles UI dependencies and
does not load application or third-party JavaScript from `node_modules` at
runtime (ADR 0044, Distribution contract and V3–V6). The candidates are:

| Candidate | Decision | Reason |
|---|---|---|
| esbuild | Selected | Emits one ESM file and external source map with explicit `node:` externals; it can statically embed the TSX, React, Ink, and logical asset import. |
| tsup | Not selected | It is an esbuild wrapper, so it adds configuration surface without exercising a materially different bundling mechanism for this narrow proof. |

The selected build command is retained in `package.json` as `build`. Generated
bundle files, source maps, and command captures are deliberately not retained;
their observed warnings and limitations are recorded in `REPORT.md`. Native
Node built-ins, including `node:sqlite`, remain Node runtime imports rather than
third-party `node_modules` loads.

## Source-run matrix

| Capability | Source proof | Source command | Expected evidence |
|---|---|---|---|
| React and Ink | `src/entry.tsx` | `npm run source -- --mode=tty` | A minimal Ink render completes only when `--mode=tty` is requested. |
| SQLite | `src/entry.tsx` | `npm run source -- --mode=headless` | `node:sqlite` opens `:memory:` and returns a deterministic query result. |
| Logical asset | `src/asset.ts` | `npm run source -- --mode=headless` | Asset text is imported and reported by logical key. |
| Built-in module | `src/entry.tsx` | `npm run source -- --mode=headless` | `node:crypto` hashes the logical asset. |
| Harmless subprocess | `src/entry.tsx` | `npm run source -- --mode=headless` | `node:child_process` executes the current Node binary with `--version`; it makes no network or repository mutation. |
| Forced error | `src/entry.tsx` | `npm run source -- --force-error` | A source-mapped TypeScript filename and exact line appear in stderr. |
| Non-TTY | `src/entry.tsx` | `npm run source -- --mode=headless` | The headless branch completes without calling the Ink renderer. |

## Boundaries

Node.js 22.23.1 can test the ESM source and bundle, but it cannot prove the
final ESM SEA entry. Per ADR 0044, that proof is deferred to TASK-2286; this
spike will not introduce a CommonJS SEA wrapper.

Run `npm install`, then `npm run build`, to regenerate disposable output when
rechecking the proof. The output remains ignored from review material.
