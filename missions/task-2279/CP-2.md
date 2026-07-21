# CP-2: ESM source boundary and no-emit typecheck

Moved the authored TypeScript runtime from the root `index.ts`/`px.ts` and `lib/` tree into `src/platform/runtime/`, preserving its dependency-relative layout while the ADR 0051 seams are exposed at the target `src/application/`, `src/adapters/`, and `src/interfaces/` boundaries. `src/entry/px.ts` is the source startup point and enables source maps before calling the compatibility runtime. The source subtree has its own ESM package boundary, so NodeNext enforces explicit `.js` specifiers without changing the root package's CommonJS setting required by the executable `dist/` rollback shim.

`tsconfig.json` is now a no-emit source project covering `src/**/*.ts` and `src/**/*.tsx`; `npm run typecheck` is the authoritative runtime check. The development command runs the ESM entry. A source-only `FilesystemAssetStore` establishes logical-key asset access and rejects traversal keys; remaining legacy asset consumers will be routed through it as part of the canonical-bundle work.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Authored runtime now resides under the `src/` source tree | `src/platform/runtime/index.ts:8`, `src/platform/runtime/px.ts:3`, `src/platform/runtime/lib/application/active-service.ts:1` | PASS |
| Target application, adapter, interface, platform, and entry boundaries exist with the ADR 0051 composition seam | `src/application/services/index.ts:1`, `src/adapters/legacy/index.ts:1`, `src/interfaces/cli/dispatcher.ts:7`, `src/platform/runtime/lib/composition/application-services.ts:12`, `src/entry/px.ts:1` | PASS |
| NodeNext ESM checking enforces explicit source specifiers and emits no JavaScript | `src/package.json:1`, `tsconfig.json:5`, `tsconfig.json:13`, `npm run typecheck` | PASS |
| Headless compatibility entry remains executable through the ESM source startup path | `src/entry/px.ts:5`, `src/platform/runtime/px.ts:237`, `npm run dev -- --version` | PASS |
| Logical-key filesystem asset adapter is available for runtime migration | `src/platform/assets/asset-store.ts:6`, `src/platform/assets/asset-store.ts:24` | PASS |
| CommonJS rollback shim remains isolated from the source migration | `package.json:7`, `package.json:10`, `docs/adr/0044-workflow-distribution-model.md:79` | PASS |

Next action: add the deterministic esbuild canonical-bundle pipeline, generated asset and SHA-256 manifests, and bundle-level source-map and headless compatibility tests.
