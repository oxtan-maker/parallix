# CP-2: Loopback-only host, Host/session/CSRF boundary, bounded requests, focused security tests

## Work summary

**Host (single process, ADR 0054).**
- `src/interfaces/web/security.ts` — pure policy functions: `isLoopbackHost`
  (only the explicit literals `127.0.0.1`/`::1`; `localhost`, `0.0.0.0`, `::`,
  LAN addresses refused), `expectedHostHeader`/`evaluateHostHeader` (exact
  host+actual-bound-port equality), `evaluateMutationAuthorization`
  (strict Origin + session cookie + CSRF header, first-fail-wins reasons),
  `evaluateContentLength` (absent=411, malformed=400, over=413),
  `evaluateContentType` (only `application/json` for non-GET),
  `isReadOnlyMethod` (GET/HEAD only), `cookieValue`, and
  `resolveAssetPath` (single percent-decode, structural segment rejection,
  manifest-allowlist lookup; traversal and unlisted paths 400/404 by
  construction).
- `src/interfaces/web/host.ts` — `createWebHost(options)` builds the Fastify 5
  instance. Non-loopback `host` and invalid `port` throw before any listener.
  Per-launch unguessable `crypto.randomBytes(32)` value shared by the
  `HttpOnly; SameSite=Strict; Path=/` cookie and the non-executable
  `px-csrf` meta tag (double-submit). `onRequest` hook enforces, in order:
  Host → (non-GET) body-size gate → Origin/session/CSRF → content-type;
  read-only requests skip the body gate. `onSend` adds CSP
  (`default-src 'self'; script-src 'self'; style-src 'self'; … frame-ancestors
  'none'; form-action 'self'`, no `unsafe-inline`/remote sources),
  `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer` to every response. Routes: `GET /` (shell +
  Set-Cookie), `GET /*` (manifest-allowlisted assets from memory, hashed files
  `immutable`), and explicit catch-all 405 + `Allow: GET, HEAD` routes for
  POST/PUT/DELETE/PATCH/OPTIONS so no mutation route can be added silently.
  No CORS, no trust proxy, no persistent state; `close()` drains the listener.
- `src/adapters/web/asset-store.ts` (adapter layer) — `resolveWebAssetRoot`
  (package-root candidates `web/` then `build/web/`, manifest as presence
  marker) and `loadWebAssets` (reads the build manifest, verifies every
  asset's sha256 and size, loads the allowlisted files into memory once per
  launch; package-owned assets only, no ADR 0053 concept — registered as an
  infrastructure exclusion in the persistence guardrail). The host does no
  file IO itself, keeping the interfaces layer clean.
- `src/composition/create-cli.ts` — `px web` command registered (read-only:
  `src/interfaces/cli/runtime.ts` `READ_ONLY_COMMANDS`); composition wires
  `loadWebAssets(resolveWebAssetRoot(packageDir))` per invocation.
  `src/interfaces/cli/web.ts` — arg parsing (`--host`, `--port`), start,
  print actual origin, SIGINT/SIGTERM → close; errors propagate to `run()`
  (verified: `px web --host 0.0.0.0` exits 1 with the refusal message;
  `px web` before a web build exits 1 with "run `npm run build:web` first").
- `src/adapters/architecture/boundary-guards.ts` — new `web` adapter package
  declared with no sibling mechanism dependencies.
- `scripts/build-canonical-bundle.ts` — `minify: true`. Measured with fastify
  in the graph: unminified 5,152 KB (over the unchanged 5,120 KB stop rule),
  minified 2,315 KB PASS. Consequences handled: `test/tui-rollback-proof.test.ts`
  bundle assertions rewritten to minify-robust TUI markers (`Median cycle
  time`, `Median lane age` survive minification; headless startup isolation
  remains proven by `test/tui-headless-isolation.test.ts`), and policy
  decision types use string discriminants because the non-strict test
  tsconfig does not narrow boolean `ok` discriminants.
- `test/default-test-suite.test.ts` — `web-host.integration.test.ts` added to
  the expected integration set (it contains the `fetch(` boundary marker).

**Focused security tests (new).**
- `test/web-security-policy.test.ts` — 12 hermetic unit tests (default suite,
  no sockets): loopback literals, expected Host header (wrong port / wrong
  address / `localhost` / missing port / missing header), absent/wrong
  Origin, absent/wrong session cookie, absent/wrong CSRF, valid
  double-submit, method classification, content-length 411/400/413,
  content-type 415, cookie extraction, asset traversal table
  (`/..`, encoded `%2e%2e`, double-encoded `%252e`, backslash, NUL, `//`,
  interior `.`/empty segments, unlisted paths) and manifest content-type.
- `test/web-host.integration.test.ts` — 14 real-socket tests (integration
  layer, loopback port 0 only): actual-origin bind on `127.0.0.1` and
  `::1`, non-loopback bind refusal before any listener, shell + full
  protection header set + no inline script + no remote references +
  cookie/meta double-submit equality, forged/wrong-port/wrong-address Host
  via raw HTTP (fetch forbids the Host header), absent/wrong Origin,
  missing/wrong session, missing/wrong CSRF, 405 + Allow for
  POST/PUT/DELETE/PATCH/OPTIONS even with valid credentials, 413 over the
  limit, 400 invalid JSON, 415 non-JSON content type, raw-socket traversal
  vs manifest allowlist, per-launch value uniqueness + unreachability after
  close, and GET read-only determinism.

**Verification.** `./scripts/verify-local.sh static-analysis` PASS (ESLint,
tsc src + scripts, test-hygiene, tsc tests). `npm test` (default suite,
includes the new unit file) — 2172 pass / 0 fail. Integration web suite:
14/14 pass, clean worker exit.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Host binds explicit loopback on port `0` unless a test seam overrides; non-loopback bind rejected; no remote-listener path | `test/web-host.integration.test.ts` "web host: binds explicit loopback and reports the actual origin", "web host: rejects non-loopback bind configuration before any listener"; `test/web-security-policy.test.ts` "web security: isLoopbackHost accepts only explicit loopback literals"; ADR 0054 | PASS |
| Host header validated against actual loopback host and bound port | `test/web-host.integration.test.ts` "web host: rejects Host header that is not the actual loopback origin"; `test/web-security-policy.test.ts` "web security: expected Host header matches only actual loopback host and bound port" | PASS |
| Unguessable memory-only per-launch session, unavailable when process exits | `test/web-host.integration.test.ts` "web host: session value differs per launch and is unavailable after close", "web host: GET routes do not mutate launch state"; ADR 0054 | PASS |
| State-changing routes reject absent/incorrect Origin, session, CSRF; GET read-only | `test/web-host.integration.test.ts` Origin/session/CSRF/405 tests; `test/web-security-policy.test.ts` mutation authorization rows | PASS |
| CSP, frame, content-type, referrer protections; no inline executable script | `test/web-host.integration.test.ts` "web host: serves the shell on the actual origin with the full protection header set" | PASS |
| Asset serving limited to manifest allowlist; traversal rejected | `test/web-host.integration.test.ts` "web host: rejects asset traversal and serves only manifest allowlisted entries"; `test/web-security-policy.test.ts` "web security: asset path resolution rejects traversal and non-allowlisted paths" | PASS |
| Unsupported methods, content types, oversized bodies rejected before JSON mutation routes | `test/web-host.integration.test.ts` "…rejects unsupported methods…", "…rejects a body over the configured limit", "…rejects an invalid JSON body with 400", "…rejects a non-JSON content type…" | PASS |
| Browser bundle built independently of `px.mjs`; 5 MB stop rule unchanged | `npm run build` (2,315 KB PASS); `scripts/build-canonical-bundle.ts` 5 MB gate unchanged; `build:web` step lands in CP-3 | PENDING |
| Package-mode smoke serves shell without source, CDN, uploaded artifact, or Vite dev server | `test/web-package-smoke.integration.test.ts` — CP-3 | PENDING |
| Focused negative tests cover all listed cases; repository verification gate passes | `npm test` (2172 pass), `./scripts/verify-local.sh static-analysis` (this CP), `./scripts/verify-local.sh all` — CP-4 | PENDING |

Next action: implement CP-3 — the `web/` Vite tree (React/React DOM shell, strict CSP-compatible output), `npm run build:web`, manifest generation and staging in `scripts/build-canonical-bundle.ts`, then `test/web-package-smoke.integration.test.ts` (pack → extract → `px web` → fetch shell/assets, no src/CDN/dev server) and register it in `test/default-test-suite.test.ts`.
