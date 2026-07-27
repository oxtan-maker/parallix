# CP-1 — Package metadata and `files` allowlist for the ESM bundle

## Summary

Switched the npm package from the transitional CommonJS `dist/` shape to the canonical ESM
bundle (`build/px.mjs`) and reduced the published tarball to the bundle plus release metadata.

Changes:

1. **`package.json` metadata** — `"type": "module"`, `bin.px` → `build/px.mjs`, `"main"` and
   `"exports"` removed, `engines.node` raised from `>=23.0.0` to `>=22.23.1` (ADR 0044:
   "The npm fallback supports Node.js 22.23.1 or newer initially").
2. **`files` allowlist** — now `build/`, `LICENSE`, `README.md`, `CHANGELOG.md`, `NOTICES`.
   Dropped `dist/`, `config/`, `data/`, `docs/`, `examples/`, `prompts/`, `templates/`,
   `tools/setup-forgejo-docker.sh`.
3. **`build/` is now the payload root.** `packageRoot()` resolves an asset root by walking up
   to the nearest `package.json` named `@magnusekdahl/parallix`. The build now writes that
   marker into `build/package.json` and stages the seven declared runtime assets under
   `build/`, so `FilesystemAssetStore` resolves them from the bundle directory in the checkout,
   in an npm install, and later from the SEA payload (TASK-2286) — without touching `src/`
   (Restricted Areas). `manifest.sha256` became recursive so it covers the staged assets.
4. **CommonJS type markers.** The root package is now ESM, so the CommonJS `.js` trees need
   local `{"type":"commonjs"}` markers: `scripts/package.json`, `test/package.json` (checked
   in; neither is published), plus generated `dist/package.json` and `.test-runtime/package.json`
   emitted by the build scripts. The `dist/` rollback artifact stays executable
   (`node dist/px.js --version` exits 0), and `dist/interfaces/tui/*.mjs` is unaffected.

Deferred to CP-2 (in scope, not yet done): `NOTICES` file, SBOM + checksum gate, and the
`scripts/package-content-audit.js` required/forbidden rewrite. Note that `npm pack --json`
stdout is prefixed by the `prepack` build's `[bundle-size]` lines; the audit's `JSON.parse` of
raw stdout is a pre-existing defect that CP-2 must fix.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: `"type": "module"` | `package.json:7` | PASS |
| SC1: `bin.px` is `build/px.mjs` | `package.json:9` | PASS |
| SC1: no `"main"`, no `"exports"` | `package.json` has no `main`/`exports` key (block `package.json:7`–`package.json:13` replaces the former `type: commonjs` / `main` / `exports` block) | PASS |
| SC1: `engines.node` is `>=22.23.1` | `package.json:12` | PASS |
| SC2: `files` ships only bundle + release metadata | `package.json:34`–`package.json:40`; `` `npm pack --dry-run --json` `` lists 16 entries: `CHANGELOG.md`, `LICENSE`, `README.md`, `package.json`, and 12 paths under `build/` | PASS |
| SC2: no `dist/`, `test/`, `src/`, `missions/`, `backlog/`, `node_modules/` in pack | `` `npm pack --dry-run --json` `` file list contains no path with those prefixes | PASS |
| SC7: `bin.px` equals the bundler outfile | `package.json:9` (`build/px.mjs`) vs `scripts/build-canonical-bundle.js:10` (`const output = path.join(buildDir, 'px.mjs')`) | PASS |
| Declared runtime assets resolve from the bundle payload root | `scripts/build-canonical-bundle.js:51-56` (payload-root marker), `scripts/build-canonical-bundle.js:58-79` (asset staging + manifest); `` `cd /tmp && node build/px.mjs aliases` `` exits 0 reading `config/state-map.json` | PASS |
| CommonJS rollback tree still loadable under an ESM root | `scripts/build-canonical-bundle.js:167-170` (`dist/package.json` type marker); test `"px ui spawns and exits 0 from shipped artifacts"` → `"dist/px.js ui exits 0 (CJS rollback artifact)"` in `test/tui-spawn.test.ts` | PASS |
| Bundle-size stop rule (5 MB) not tripped | `scripts/build-canonical-bundle.js:189-199`; `` `npm run build` `` prints `[bundle-size] PASS: 2.7 MB within 5 MB stop rule` | PASS |
| Gate body of `./scripts/verify-local.sh all` | `` `npm test` `` — the exact command `gate_all()` runs (`scripts/verify-local.sh:85-87`): 1334 pass / 0 fail / 0 cancelled. Full `./scripts/verify-local.sh all` invocation is re-run at the final checkpoint. | PASS |

Next action: CP-2 — rewrite `scripts/package-content-audit.js` required/forbidden lists for the `build/`-only tarball (and fix its `JSON.parse` of `prepack`-polluted `npm pack --json` stdout), author `NOTICES` from the production dependency tree (ink, react, @types/react, @earendil-works/pi-coding-agent), and add SBOM + SHA-256 checksum generation to the pre-publish flow.
