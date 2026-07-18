# CP-2 — Dist package boundary

## Summary

Changed the package boundary to CommonJS `dist/` output. The manifest now
exports only the package root and its own manifest, sends `main` and `px` to
`dist/`, and limits the publication allowlist to emitted output plus the ADR
0044 runtime assets and release documents. TypeScript now emits source maps
without declarations. `prepack` refreshes the retained sibling-`.js`
compatibility runtime, validates its freshness guard, and then produces the
production `dist/` build.

Both shipped entries enable Node source maps. The `px` entry resolves
`package.json` through T2's package-root helper, so its version information
works from `dist/px.js` as well as the retained checkout sibling. A focused
`npm pack --dry-run --json` audit passed: it contains `dist` JavaScript and
maps plus the permitted assets, and omits TypeScript, tests, mission/backlog,
and graph operator state.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Manifest declares CommonJS and only supported dist exports | `package.json:7`, `package.json:8`, `package.json:10`, `package.json:13` | PASS |
| Production build emits JavaScript and source maps under dist | `tsconfig.json:6`, `tsconfig.json:8`, `tsconfig.json:9`; `npm run build` | PASS |
| Shipped entries enable Node source maps and locate the package root | `px.ts:25`, `px.ts:28`, `index.ts:15`, `index.ts:110` | PASS |
| Prepack runs both retained compatibility build and production build | `package.json:54`, `package.json:55`, `package.json:56` | PASS |
| Tarball contains only ADR 0044 permitted runtime content | ADR 0044; `npm pack --dry-run --json` | PASS |
| Source-checkout sibling runtime remains available | `package.json:54`; `npm run build:cjs` | PASS |
| Named tarball test successors remain queued for dist-install proof | `test/task-1424-post-integrate-publish-reinstall.test.js`; `test/package-persistent-data.test.js` | PENDING CP-3 |

Next action: update the two existing tarball integration tests to assert the dist artifact, install it into a temporary prefix, and execute `status` plus `stats` outside this checkout.
