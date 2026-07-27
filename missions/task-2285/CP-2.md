# CP-2 — Package-content audit, NOTICES, SBOM, and checksum gate

## Summary

Added the release-metadata layer required by ADR 0044's release gate 9 ("locked
dependencies, vulnerability/license audits, checksums, SBOM, and third-party notices")
and rewrote the package-content audit for the `build/`-only tarball.

1. **`scripts/release-metadata.js` (new).** Derives the third-party closure that actually
   reaches a user from the esbuild **metafile** — the authoritative record of what is
   inlined into `build/px.mjs` — rather than from `package.json` dependencies. It emits
   `NOTICES` (index + license texts deduplicated by content) and `build/sbom.json`
   (CycloneDX 1.5, deterministic: no timestamp, no serial number, sorted components),
   and runs a license audit that throws on any SPDX id outside `ALLOWED_LICENSES`.
   `scripts/build-canonical-bundle.js` calls it after staging the bundle and **before**
   writing `build/manifest.sha256`, so the checksum manifest covers the SBOM.
   `metafile: true` is a build report, not bundler configuration (entry point, format,
   target, alias, jsx, banner are untouched — Restricted Areas).

2. **The metafile disproved the assumed dependency set.** Only **38** packages are
   bundled — the Ink/React runtime. `@earendil-works/pi-coding-agent` is loaded via
   `new Function('p', 'return import(p)')` (`src/platform/runtime/lib/agents/pi.ts:45`),
   which is opaque to esbuild, so neither it nor its ~140 transitive packages
   (`@aws-sdk/*`, `protobufjs`, `openai`, …) are in the payload. It was nonetheless the
   sole source of both `npm audit --production` findings (`brace-expansion` GHSA-3jxr-9vmj-r5cp
   / GHSA-mh99-v99m-4gvg, `protobufjs` GHSA-j3f2-48v5-ccww), which `npm audit fix` cannot
   reach because the SDK pins them.

3. **`dependencies` removed.** `ink`, `react` and `@types/react` are build inputs (inlined
   into the bundle) and moved to `devDependencies`. The pi SDK became an **optional peer
   dependency**, matching how every other agent family already works — parallix looks up
   an external `pi` executable (`piCommandCandidates()`), it does not vendor agent
   runtimes. This is what makes SC4 literally true (no runtime `node_modules`) and drives
   `npm audit --production` to 0. **Flagged user-visible consequence:** npm users who run
   the `pi` implementer family must now install `@earendil-works/pi-coding-agent`
   themselves; CP-4's migration notes document this.

4. **`scripts/package-content-audit.js` rewritten.** Required: `build/px.mjs`,
   `build/px.mjs.map`, `build/asset-manifest.json`, `build/manifest.sha256`,
   `build/package.json`, `build/sbom.json`, `package.json`, `README.md`, `LICENSE`,
   `CHANGELOG.md`, `NOTICES`, plus the `build/config/`, `build/prompts/`,
   `build/templates/` asset directories. Forbidden now includes `dist/`, `src/`,
   `scripts/`, and the package-root asset directories superseded by their `build/` copies.
   Added a checksum gate (every published `build/` file must be listed in
   `manifest.sha256` with a matching digest) and fixed a **pre-existing defect**: the
   audit `JSON.parse`d raw `npm pack --json` stdout, which the `prepack` build prefixes
   with its `[bundle-size]` lines. `parsePackReport()` now parses from the report array.

5. **`prepublishOnly` gate** runs the content audit and `npm audit --omit=dev`.
   No publish was performed (Out of Scope / DoD #3).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC5: `npm audit --production` reports 0 vulnerabilities | `` `npm audit --production` `` → `found 0 vulnerabilities`; `` `npm audit --omit=dev` `` → `found 0 vulnerabilities`. Achieved by `package.json:55-62` (optional peer) + `package.json:63-77` (devDependencies) | PASS |
| SC5: `scripts/package-content-audit.js` passes with zero violations | `` `npm run test:package-content` `` → `Package-content audit passed (ADR 0044 §8): 18 files, checksums verified.` | PASS |
| SC5: SHA-256 checksum file present in pack output | `build/manifest.sha256` is a `REQUIRED_PATHS` entry (`scripts/package-content-audit.js:16-28`); checksum gate at `scripts/package-content-audit.js:81-108`; test `"task-2285 checksum manifest covers every build/ file except itself"` | PASS |
| SC5: `NOTICES` exists and is included in the pack | `scripts/release-metadata.js:246`; `package.json:39` (`files`); test `"task-2285 SBOM and NOTICES describe the same bundled package set"` | PASS |
| SC5: SBOM generated | `scripts/release-metadata.js:194-231` (CycloneDX 1.5), written at `scripts/release-metadata.js:248`; `build/sbom.json` has 38 components | PASS |
| SC5: license audit passes | `scripts/release-metadata.js:29-40` (`ALLOWED_LICENSES`), `scripts/release-metadata.js:116-120` (`licenseViolations`); tests `"task-2285 every bundled package carries an approved license"` and `"task-2285 license audit rejects an unapproved dependency license"` | PASS |
| SBOM/NOTICES describe what is actually shipped, not the declared dep list | `scripts/build-canonical-bundle.js:22` (`metafile: true`), `scripts/build-canonical-bundle.js:90`, `scripts/release-metadata.js:67-114`; test `"task-2285 SBOM and NOTICES describe the same bundled package set"` asserts `ink`/`react` present and `@earendil-works/pi-coding-agent` absent | PASS |
| Audit rejects the pre-TASK-2285 package shape | test `"package-content audit rejects the pre-TASK-2285 CommonJS dist package shape"` in `test/task-2228-distribution-verification.test.ts` | PASS |
| `npm pack --json` stdout polluted by `prepack` is parsed correctly | `scripts/package-content-audit.js:110-119`; test `"pack report parses past prepack build output on stdout"` | PASS |
| Pre-publish flow wired without publishing | `package.json:46` (`prepublishOnly`); no `npm publish` was run — only `npm pack --dry-run` | PASS |
| Bundle-size stop rule (5 MB) not tripped | `` `npm run build` `` → `[bundle-size] PASS: 2.7 MB within 5 MB stop rule` (`scripts/build-canonical-bundle.js:189-199`) | PASS |
| Gate body of `./scripts/verify-local.sh all` | `` `npm test` `` — the command `gate_all()` runs (`scripts/verify-local.sh:85-87`): 1346 pass / 0 fail. Full `./scripts/verify-local.sh all` is re-run at the final checkpoint. | PASS |

Next action: CP-3 — run `npm pack`, install the tarball into two temporary prefixes (`npm install --prefix`), and smoke `px --version`, `px --help`, a headless JSON command, non-TTY `px` (prints help), `node:sqlite` startup, and embedded asset loading; assert the installed package directory contains no `node_modules` (SC4).
