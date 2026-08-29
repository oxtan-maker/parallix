# CP-1: ADR 0054 acceptance confirmed; codebase mapped; bootstrap and test plan locked

## Work summary

**ADR 0054 acceptance.** `docs/adr/0054-local-web-board-adapter.md` was `Proposed — 2026-08-28`
at mission start, which the mission declares a hard precondition (Stop Rule 1). Human
acceptance was established by dispatching this mission in execution-locked mode on
2026-08-28; the ADR status line is now `Accepted — 2026-08-28` and cites this record.
No implementation began before this confirmation.

**Existing `px` entry path and package layout (mapped).**
- Canonical entry: `src/entry/px.ts` → `src/composition/create-cli.ts` (`run()`),
  command registry in `createCommandRegistry()`, dispatch in `src/interfaces/cli/runtime.ts`
  (`main()`; read-only commands bypass git-init via `READ_ONLY_COMMANDS`).
- Canonical bundle: `scripts/build-canonical-bundle.ts` (esbuild, entry
  `src/entry/px.ts`, `packages: 'bundle'`, ESM, 5 MB stop rule checked before the
  staging swap). Baseline measured this checkpoint: 3,270,617 bytes (3.1 MB).
- Package payload: `package.json` `files: ["build/"]`; `build/package.json` re-asserts the
  package name so `packageRoot()` (in `src/adapters/filesystem/package-root.ts`) resolves
  to `build/` in checkout, npm install, and extracted tarball alike.
- Runtime assets are staged into `build/` with a sha256 `asset-manifest.json`; every
  published `build/` file must appear in `build/manifest.sha256`
  (`scripts/package-content-audit.ts` enforces this, plus forbidden prefixes incl. `src/`).
- Test seams: `test/run-default-tests.ts` + `test/lib/test-run-plan.ts`. Unit suite =
  hermetic `test/*.test.ts`; files matching the boundary heuristic
  (`spawn*`, `git ...`, `npm pack|install`, `createServer`, `fetch(`) or the
  `*.integration.test.ts` suffix run only via `npm run test:integration`.
  Per-test unit budget is 1 s; `./scripts/verify-local.sh all` runs `npm test`
  (which rebuilds the bundle first); `static-analysis` runs ESLint + tsc + test-hygiene.
  `config/integration-pipelines.json` runs `npm run test:integration` unconditionally
  (`always: true`) at integrate time.

**Selected single-process Fastify/Vite bootstrap (recorded decision).**
1. `createWebHost(options)` in new `src/interfaces/web/host.ts` builds a Fastify 5
   instance inside the canonical `px` process. Bind host is restricted to the explicit
   loopback literals `127.0.0.1` and `::1` (default `127.0.0.1`); anything else
   (`0.0.0.0`, `::`, `localhost`, LAN addresses) throws before any listener exists.
   Default port `0` (OS-selected); test seam = the `options` parameter (tests bind
   in-process and use the actual advertised origin, never an assumed one).
2. New read-only `px web` command (registered in the `create-cli.ts` registry, added to
   `READ_ONLY_COMMANDS`) starts the host, prints the actual loopback URL, and exits on
   SIGINT/SIGTERM. No second long-lived process, no `node:http`, no generic static
   serving.
3. Security boundary is implemented as pure policy functions in
   `src/interfaces/web/security.ts` (loopback check, expected-Host construction,
   mutation authorization = strict Origin + session cookie + CSRF header,
   content-length limit, content-type rule, method classification, manifest-allowlisted
   asset path resolution) so the negative cases are unit-testable hermetically; a
   real-socket integration suite proves the wiring.
4. Session protection: one `crypto.randomBytes(32)` value per launch, memory-only
   (closure state, no persistence, dies with the process). Delivered as an
   `HttpOnly; SameSite=Strict; Path=/` cookie **and** a non-executable
   `<meta name="px-csrf">` tag injected into the served shell HTML (double-submit);
   every non-GET request must match actual Origin + cookie + CSRF header or gets 403.
   All non-GET methods are then still 405 because no mutation routes exist yet.
5. Browser build: new `web/` tree at the repository root (React 19 + React DOM, Vite
   build). Vite 7 is pinned (not Vite 8: Vite 8 declares esbuild 0.27/0.28 as
   peerOptional, which conflicts with the repository-pinned esbuild 0.25 used by the
   canonical bundler). `vite build` emits `build/web/` (separate artifact, never part of
   `px.mjs`, never counted against the 5 MB rule); `npm run build` chains
   `build:web` then `bundle`; the canonical bundle script stages `build/web/` plus a
   generated `build/web/manifest.json` allowlist (path → size, sha256, content type)
   into the published tree and `manifest.sha256`.
6. Canonical bundle gains `minify: true`: measured with fastify in the graph,
   unminified = 5,152 KB (over the unchanged 5 MB stop rule), minified = 2,259 KB.
   One-line change, deterministic (reproducibility gate compares two clean builds),
   source maps retained. No change to the stop rule itself.
7. Dependencies (all `devDependencies`, MIT, inside the ADR 0044 approved license set,
   bundled): `fastify@^5.12.1`, `react-dom@^19.2.8`, `vite@^7.3.6`. `fast-uri@^3.1.6`
   pinned explicitly because the advisory-audited `3.0.0–3.1.4` range (host confusion
   via backslash authority) was pulled transitively by fastify's ajv chain; 3.1.6
   dedupes everywhere in the lockfile.

**Exact tests covering each security-negative case (recorded plan).**

| Negative case | Hermetic unit test (new `test/web-security-policy.test.ts`) | Real-socket integration test (new `test/web-host.integration.test.ts`) |
|---|---|---|
| Wrong Host | `web security: expected Host header matches only actual loopback host and bound port` | `web host: rejects Host header that is not the actual loopback origin` |
| Non-loopback bind | `web security: isLoopbackHost accepts only explicit loopback literals` | `web host: rejects non-loopback bind configuration before any listener` |
| Wrong Origin | `web security: mutation authorization rejects an absent or wrong Origin` | `web host: rejects a state-changing request with an absent or wrong Origin` |
| Missing/bad session | `web security: mutation authorization rejects an absent or wrong session cookie` | `web host: rejects a state-changing request with a missing or wrong session` |
| Missing/bad CSRF | `web security: mutation authorization rejects an absent or wrong CSRF header` | `web host: rejects a state-changing request with a missing or wrong CSRF` |
| Wrong method | `web security: only GET and HEAD are read-only methods` | `web host: rejects unsupported methods even with valid Origin, session, and CSRF` |
| Oversized body | `web security: a content length over the configured limit is rejected` | `web host: rejects a body over the configured limit` |
| Wrong content type | `web security: a non-JSON content type is rejected for state-changing requests` | `web host: rejects a non-JSON content type for state-changing requests` |
| Asset traversal | `web security: asset path resolution rejects traversal and non-allowlisted paths` | `web host: rejects asset traversal and serves only manifest allowlisted entries` |
| Per-launch memory-only session | — (closure state; proven by the two integration rows below) | `web host: session value differs per launch and is unavailable after close` and `web host: GET routes do not mutate launch state` |
| Package-mode smoke | — | `test/web-package-smoke.integration.test.ts`: `web package smoke: the packaged tarball serves the shell from built assets without src, CDN, or a dev server` |

Package-mode smoke design: `npm pack` (runs `prepack` → full build), extract the
tarball into a temp dir (no `src/`, no `node_modules`, no uploaded artifacts present
by construction), spawn `node <pkg>/build/px.mjs web`, read the actual URL from
stdout, fetch the shell and its bundled script over loopback, assert the HTML makes no
`http(s)://` reference (no CDN) and no inline executable script, SIGTERM the child,
and confirm the session is unreachable after process exit.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Host binds explicit loopback on port `0` unless a test seam overrides; non-loopback bind rejected; no remote-listener path | ADR 0054 (Accepted); planned tests `web security: isLoopbackHost accepts only explicit loopback literals` and `web host: rejects non-loopback bind configuration before any listener` in `test/web-security-policy.test.ts`, `test/web-host.integration.test.ts` | PENDING |
| Host header validated against actual loopback host and bound port | Planned tests `web security: expected Host header matches only actual loopback host and bound port` and `web host: rejects Host header that is not the actual loopback origin` in `test/web-security-policy.test.ts`, `test/web-host.integration.test.ts` | PENDING |
| Unguessable memory-only per-launch session, unavailable when process exits | Planned tests `web host: session value differs per launch and is unavailable after close` and `web host: GET routes do not mutate launch state` in `test/web-host.integration.test.ts`; ADR 0054 per-launch capability | PENDING |
| State-changing routes reject absent/incorrect Origin, session, CSRF; GET read-only | Planned tests in `test/web-security-policy.test.ts` (mutation authorization rows) and `test/web-host.integration.test.ts` (Origin/session/CSRF/method rows) | PENDING |
| CSP, frame, content-type, referrer protections; no inline executable script | Planned test `web host: serves the shell on the actual origin with the full protection header set` in `test/web-host.integration.test.ts`; ADR 0054 | PENDING |
| Asset serving limited to manifest allowlist; traversal rejected | Planned tests `web security: asset path resolution rejects traversal and non-allowlisted paths` and `web host: rejects asset traversal and serves only manifest allowlisted entries` | PENDING |
| Unsupported methods, content types, oversized bodies rejected before JSON mutation routes | Planned tests `web host: rejects unsupported methods even with valid Origin, session, and CSRF`, `web host: rejects a body over the configured limit`, `web host: rejects a non-JSON content type for state-changing requests` | PENDING |
| Browser bundle built independently of `px.mjs`; 5 MB stop rule unchanged | `scripts/build-canonical-bundle.ts` (`maxSizeBytes = 5 * 1024 * 1024` unchanged); new `npm run build:web` produces `build/web/` separately; gate `npm run build` enforces size | PENDING |
| Package-mode smoke serves shell without source, CDN, uploaded artifact, or Vite dev server | Planned `test/web-package-smoke.integration.test.ts`: `web package smoke: the packaged tarball serves the shell from built assets without src, CDN, or a dev server` | PENDING |
| Focused negative tests cover all listed cases; repository verification gate passes | Planned test files `test/web-security-policy.test.ts`, `test/web-host.integration.test.ts`, `test/web-package-smoke.integration.test.ts`; gates `./scripts/verify-local.sh all` and `./scripts/verify-local.sh static-analysis` | PENDING |

Next action: implement CP-2 — `src/interfaces/web/security.ts` + `src/interfaces/web/host.ts`, the `px web` command, `minify: true` in `scripts/build-canonical-bundle.ts`, then `test/web-security-policy.test.ts` (hermetic) and `test/web-host.integration.test.ts` (loopback sockets).
