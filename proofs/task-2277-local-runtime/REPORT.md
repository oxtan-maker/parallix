# TASK-2277 feasibility report

## Scope and environment

This is a non-production proof in `proofs/task-2277-local-runtime/`, run on Node.js v22.23.1. It does not change `lib/`, `bin/`, or the CommonJS `dist/` runtime. esbuild is selected; tsup was not selected because it wraps the same esbuild mechanism. The retained build command is `npm run build`.

## Runtime proof

`npm run source -- --mode=headless` and `node --enable-source-maps build/local-runtime-proof.mjs --mode=headless` both returned `{"inkInitialized":false,"logicalAssetKey":"proof/task-2277/asset.txt","assetDigest":"77bf542ee6aa","sqliteValue":44,"subprocessVersion":"v22.23.1"}`.

The entry imports React and Ink, `node:sqlite`, `node:crypto`, the logical asset, and `node:child_process`. Its subprocess is only the current Node executable with `--version`. `--mode=tty` calls Ink's renderer, unmounts it, and prints `TASK-2277 Ink proof` plus `{"inkInitialized":true}`. The normal headless branch does not call `render` and reports false.

The selected ESM bundle was `build/local-runtime-proof.mjs`. `node --enable-source-maps --experimental-loader ./runtime-loader.mjs build/local-runtime-proof.mjs --mode=headless` emitted no `NODE_MODULES_RUNTIME_LOAD` marker. Its source contained bundled dependency input, while the runtime trace resolved no first-party or third-party code from `node_modules`. The `createRequire` banner supports Ink CommonJS code that dynamically requests Node built-ins only. The generated bundle, source map, and command captures were discarded after recording this evidence; `npm run build` reproduces them.

## Source maps and non-TTY isolation

`node --enable-source-maps build/local-runtime-proof.mjs --force-error` fails intentionally and reports `src/entry.tsx:12:9`; the source command with `--force-error` reports the same TSX file and line. The two headless commands above print JSON but not `TASK-2277 Ink proof`; the only `render` call is guarded by `mode === 'tty'`.

## Measurements

The generated bundle was `2,416,978` bytes and its source map was `3,525,971` bytes. Ten individual bundle child-process starts, in milliseconds, were measured on the local development host with Node v22.23.1 and `--enable-source-maps`; these host-local measurements do not establish release performance.

| Run | Milliseconds |
|---:|---:|
| 1 | 469.197 |
| 2 | 478.919 |
| 3 | 410.665 |
| 4 | 475.043 |
| 5 | 391.781 |
| 6 | 403.571 |
| 7 | 484.584 |
| 8 | 412.787 |
| 9 | 406.078 |
| 10 | 403.582 |

The measurement command is `node --input-type=module -e "import {spawnSync} from 'node:child_process'; for (let index = 1; index <= 10; index += 1) { const start = process.hrtime.bigint(); const child = spawnSync(process.execPath, ['--enable-source-maps', 'build/local-runtime-proof.mjs', '--mode=headless'], {stdio: 'ignore'}); const elapsed = Number(process.hrtime.bigint() - start) / 1e6; if (child.status !== 0) process.exit(child.status ?? 1); console.log(index + ': ' + elapsed.toFixed(3)); }"`.

## Dependency inventory and warnings

Direct proof dependencies: `esbuild@0.25.12`, `ink@6.8.0`, `react@19.2.3`, `react-devtools-core@6.1.5`, `tsx@4.20.6`, `typescript@5.9.3`, and `@types/react@19.2.14`; their exact direct versions are retained in `package.json`. The bundle contained the React, Ink, react-reconciler, scheduler, signal-exit, ws, yoga-layout, and terminal-formatting dependency families.

Warnings and limitations: esbuild printed `2.3mb ⚠️`; Node v22.23.1 labels `node:sqlite` experimental; and Node labels `--experimental-loader` experimental for the source asset loader and runtime-resolution trace. Ink's CommonJS code requires the retained `createRequire` banner for Node built-ins.

## ESM SEA limitation

ESM SEA is unproven on Node.js 22.23.1 because this runtime accepts only a CommonJS SEA entry. ADR 0044 assigns the native ESM SEA proof to TASK-2286 on an ESM-capable Node 25/26-or-newer toolchain. This spike does not propose or add a production CommonJS SEA wrapper.
