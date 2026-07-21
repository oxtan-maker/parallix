# CP-3: Canonical ESM bundle and deterministic manifests

Added the esbuild-owned canonical bundle pipeline. `npm run bundle` clears only
the ignored `build/` directory, emits the ESM payload and source map, writes an
asset manifest, then writes a sorted SHA-256 manifest over those artifacts.
The bundle has no `createRequire` or first-party `require()` calls: the CLI uses
a static command registry and the former first-party lazy loads use static ESM
imports. The Node 22.23.1 bundle is therefore a CP-3 artifact, not an ESM SEA
claim; the latter remains TASK-2286 work on Node 25/26-or-newer.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Canonical build emits only the declared ESM payload, source map, asset manifest, and SHA-256 manifest | `scripts/build-canonical-bundle.js:11`, `package.json:59`, `build/` | PASS |
| Repeated clean builds have an identical canonical manifest | `npm run bundle`, `build/manifest.sha256` comparison | PASS |
| Bundle entry has no first-party runtime module lookup | `src/platform/runtime/index.ts:64`, `src/platform/runtime/px.ts:240`, `rg createRequire build/px.mjs` | PASS |
| Bundle runs on the L3 Node baseline without a runtime node_modules dependency | `node --enable-source-maps build/px.mjs --version`, ADR 0044 | PASS |
| Bundle source map retains TypeScript sources | `build/px.mjs.map`, `src/entry/px.ts:1` | PASS |

Next action: run source and bundle CLI compatibility checks, source-level tests, full verification, and static analysis; retain the dist rollback shim until TASK-2285's npm compatibility gate passes.
