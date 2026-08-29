# CP-3: Vite browser build, manifest-allowlisted serving, package-mode smoke

## Work summary

**Separate Vite browser build (ADR 0054).**
- New `web/` tree at the repository root (outside `src/`, which is the
  canonical-bundle source and forbidden in the package): `web/index.html`,
  `web/src/main.tsx` (React 19 `createRoot`), `web/src/shell.tsx` (minimal
  shell; board data/mutations are later missions), `web/src/style.css`
  (system fonts only), `web/vite.config.ts` (absolute root/outDir so CWD
  cannot skew the output; `esbuild: { jsx: 'automatic' }` — no
  plugin-react/HMR needed for a production build; dev server pinned to
  `127.0.0.1`).
- `package.json`: `build:web` (`vite build --config web/vite.config.ts`),
  `build` now chains `build:web && bundle`, plus a dev-only `dev:web`.
  The Vite artifact (`build/web/`, hashed `assets/*`) is a separate build
  step and separate files — never part of `px.mjs`, never counted against
  the 5 MB stop rule (gate output: 2,316,843 bytes PASS after this CP).
- `scripts/build-canonical-bundle.ts`: after asset staging, stages
  `build/web/` into the published tree and writes
  `build/web/manifest.json` — the serving allow-list
  (`{ version: 1, files: { relPath: { size, sha256, contentType } } }`,
  sorted, manifest never lists itself). Fails the build if
  `build/web/index.html` is missing. The manifest and every web file are
  covered by `build/manifest.sha256`, so the package-content audit
  checksums them (`npm run test:package-content` — 39 files, checksums
  verified).

**Package-mode smoke (new `test/web-package-smoke.integration.test.ts`).**
Real `npm pack` → isolated extraction (`--strip-components=1`), then the
packaged `node build/px.mjs web` process serves over loopback:
- "web package smoke: the tarball ships the built web assets and nothing
  else" — top level is exactly `LICENSE NOTICES README.md build
  package.json`; no `src/`, `node_modules/`, `web/` source, `test/`, or
  `docs/`; manifest integrity (sizes) verified per entry.
- "web package smoke: the packaged tarball serves the shell from built
  assets without src, CDN, or a dev server" — serving process argv is
  `node …/build/px.mjs web` (no Vite dev server); shell 200 with
  `text/html`, full protection header set (CSP `default-src 'self'`,
  `X-Frame-Options: DENY`, `nosniff`, `no-referrer`); HTML contains no
  `http(s)://` reference (no CDN) and no inline executable script; the
  served HTML minus the injected CSRF meta is byte-identical to the
  packaged `build/web/index.html` (served from built assets, not source or
  any other local file); the referenced hashed module script serves 200
  `text/javascript` and contains the shell.
- "web package smoke: the per-launch session is unavailable after the
  process exits" — `px_session` cookie issued; after SIGTERM the origin
  refuses connections (memory-only session dies with the process).

`test/default-test-suite.test.ts` registers the smoke file in the expected
integration set (npm-pack boundary).

**Verification.** `./scripts/verify-local.sh static-analysis` PASS (after
fixing node:test option ordering in the smoke file). `npm run test:package-content`
PASS. Smoke suite 3/3 pass. `npm run build` PASS (web + canonical, 2.2 MB).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Browser bundle built independently of `px.mjs`; 5 MB stop rule unchanged | `npm run build:web` (separate Vite step → `build/web/`), `npm run build` (canonical gate output "2.2 MB within 5 MB stop rule"); `scripts/build-canonical-bundle.ts` | PASS |
| Asset serving limited to manifest allowlist; traversal rejected | `test/web-security-policy.test.ts` "web security: asset path resolution rejects traversal and non-allowlisted paths"; `test/web-host.integration.test.ts` "web host: rejects asset traversal and serves only manifest allowlisted entries"; `test/web-package-smoke.integration.test.ts` "web package smoke: the tarball ships the built web assets and nothing else" (real manifest, per-entry integrity) | PASS |
| CSP, frame, content-type, referrer protections; no inline executable script | `test/web-host.integration.test.ts` "web host: serves the shell on the actual origin with the full protection header set"; `test/web-package-smoke.integration.test.ts` (header assertions against the packaged shell) | PASS |
| Package-mode smoke serves shell without source, CDN, uploaded artifact, or Vite dev server | `test/web-package-smoke.integration.test.ts`: "web package smoke: the packaged tarball serves the shell from built assets without src, CDN, or a dev server", "web package smoke: the per-launch session is unavailable after the process exits" | PASS |
| Host binds explicit loopback / port 0, non-loopback rejected | `test/web-host.integration.test.ts` (CP-2, unchanged) | PASS |
| Host header validated against actual origin | `test/web-host.integration.test.ts` "web host: rejects Host header that is not the actual loopback origin" (CP-2, unchanged) | PASS |
| Per-launch unguessable memory-only session | `test/web-host.integration.test.ts` + `test/web-package-smoke.integration.test.ts` session tests | PASS |
| State-changing routes reject absent/incorrect Origin, session, CSRF; GET read-only | `test/web-host.integration.test.ts` + `test/web-security-policy.test.ts` (CP-2, unchanged) | PASS |
| Unsupported methods, content types, oversized bodies rejected | `test/web-host.integration.test.ts` (CP-2, unchanged) | PASS |
| Focused negative tests cover all cases; repository verification gates pass | `npm test`, `./scripts/verify-local.sh all`, `./scripts/verify-local.sh static-analysis` — CP-4 | PENDING |

Next action: CP-4 — run the mission gates `./scripts/verify-local.sh all` and `./scripts/verify-local.sh static-analysis` to completion, verify the 5 MB stop rule text is unchanged (`git diff` vs the pre-mission baseline), record the actual loopback bind address and the absence of a remote-listener path, then write CP-4.md.
