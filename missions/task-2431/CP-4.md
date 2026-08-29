# CP-4: Mission gates green, stop rule unchanged, bind address and listener-surface record

## Work summary

**Gates (mission-declared).**
- `./scripts/verify-local.sh all` — PASS (exit 0): `node scripts/verify-docs.mjs`
  plus `npm test` (default suite, 0 failures; includes
  `test/web-security-policy.test.ts` hermetic coverage).
- `./scripts/verify-local.sh static-analysis` — PASS (exit 0): ESLint,
  tsc src+scripts typecheck, test-hygiene, test typecheck — "ALL STAGES PASSED".
- The integration layer (`test/web-host.integration.test.ts`, 15 tests;
  `test/web-package-smoke.integration.test.ts`, 3 tests) is registered in the
  unconditional `integration-suite` gate (`config/integration-pipelines.json`,
  `npm run test:integration`, `always: true`) and was verified green at CP-2/CP-3.
- Gate checkboxes in `missions/task-2431/MISSION.md` are checked with the
  observed results.

**5 MB stop rule unchanged.** `git diff main -- scripts/build-canonical-bundle.ts`
shows exactly two additions in this file: `minify: true` (with its
justification comment) and the `build/web` staging block. The stop rule
itself is byte-identical to `main` (`const maxSizeBytes = 5 * 1024 * 1024; //
5 MB stop rule` and the unchanged PASS/FAIL emission). Current gate output:
`[bundle-size] build/px.mjs: 2 316 843 bytes (2.2 MB) … PASS … within 5 MB
stop rule` via `npm run build`.

**Actual loopback bind address (recorded).**
- Default: `127.0.0.1` on port `0` (OS-selected); the host reports the
  actual origin after listen (`WebHostInfo.origin`, e.g.
  `http://127.0.0.1:38389/` printed by `px web`). `--host ::1` is the only
  alternative, giving `http://[::1]:<port>/`.
- Proof that tests assert the actual advertised origin rather than assuming
  a hostname format: `test/web-host.integration.test.ts` "web host: binds
  explicit loopback and reports the actual origin" (asserts
  `^http:\/\/127\.0\.0\.1:\d+$` on the real bound port for the v4 literal and
  `^http:\/\/\[::1\]:\d+$` for the v6 literal, then uses the real value).

**Absence of a remote-listener path (recorded).**
- The bind host is a closed union: `LOOPBACK_LITERALS = ['127.0.0.1', '::1']`
  in `src/interfaces/web/security.ts`; `isLoopbackHost` rejects everything
  else (`0.0.0.0`, `::`, `localhost`, LAN addresses). `createWebHost` throws
  before any listener exists for a non-loopback host
  (`test/web-host.integration.test.ts` "web host: rejects non-loopback bind
  configuration before any listener").
- The CLI exposes only `--host 127.0.0.1|::1` and `--port`; `px web --host
  0.0.0.0` exits 1 with the refusal message. No CORS headers, no trust
  proxy, no origin allowlist configuration, and no environment variable or
  configuration file reaches the bind address: the only code path to
  `app.listen` is `createWebHost` with the validated literal.
- The Host-header policy pins every request to the launch's exact
  host+port, so even a misconfigured reverse path cannot widen the origin.

**Cleanup.** `graphify update .` run after the code changes.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Local host binds explicit loopback on port `0` unless a test seam overrides; non-loopback bind rejected; no remote-listener path | ADR 0054; `test/web-host.integration.test.ts` "web host: binds explicit loopback and reports the actual origin", "web host: rejects non-loopback bind configuration before any listener", "web host: a failing bind rejects start() and close() stays clean"; `test/web-security-policy.test.ts` "web security: isLoopbackHost accepts only explicit loopback literals" | PASS |
| Requests with a Host header not equal to the launch's loopback host and bound port are rejected | `test/web-host.integration.test.ts` "web host: rejects Host header that is not the actual loopback origin"; `test/web-security-policy.test.ts` "web security: expected Host header matches only actual loopback host and bound port" | PASS |
| Each `px` launch creates unguessable memory-only session protection, unavailable when the process exits | `test/web-host.integration.test.ts` "web host: session value differs per launch and is unavailable after close"; `test/web-package-smoke.integration.test.ts` "web package smoke: the per-launch session is unavailable after the process exits"; ADR 0054 | PASS |
| Every state-changing route rejects absent/incorrect Origin, session value, or CSRF; GET routes do not mutate state | `test/web-host.integration.test.ts` Origin/session/CSRF/405 tests; `test/web-security-policy.test.ts` mutation-authorization tests | PASS |
| Browser-asset responses enforce CSP, frame, content-type, referrer protections without inline executable script | `test/web-host.integration.test.ts` "web host: serves the shell on the actual origin with the full protection header set"; `test/web-package-smoke.integration.test.ts` (packaged-shell header assertions) | PASS |
| Asset serving accepts only manifest/allowlisted build paths; rejects traversal; cannot read arbitrary files | `test/web-security-policy.test.ts` "web security: asset path resolution rejects traversal and non-allowlisted paths"; `test/web-host.integration.test.ts` "web host: rejects asset traversal and serves only manifest allowlisted entries"; `test/web-package-smoke.integration.test.ts` "web package smoke: the tarball ships the built web assets and nothing else" | PASS |
| Unsupported methods, unsupported content types, oversized bodies rejected before JSON mutation routes exist | `test/web-host.integration.test.ts` "web host: rejects unsupported methods even with valid Origin, session, and CSRF", "web host: rejects a body over the configured limit", "web host: rejects an invalid JSON body with 400", "web host: rejects a non-JSON content type for state-changing requests" | PASS |
| Browser bundle produced independently of `px.mjs`; existing 5 MB stop rule unchanged | `npm run build:web` (separate Vite step → `build/web/`); `npm run build` (`[bundle-size] … PASS … within 5 MB stop rule`, 2,316,843 bytes); `scripts/build-canonical-bundle.ts` stop-rule lines byte-identical to `main` | PASS |
| Package-mode smoke serves shell without source, CDN, uploaded artifact, or Vite dev server | `test/web-package-smoke.integration.test.ts`: "web package smoke: the packaged tarball serves the shell from built assets without src, CDN, or a dev server" | PASS |
| Focused tests cover wrong Host, wrong Origin, missing/bad session, missing/bad CSRF, wrong method, oversized body, asset traversal; required verification gate passes | `test/web-security-policy.test.ts` (default suite via `npm test`), `test/web-host.integration.test.ts` + `test/web-package-smoke.integration.test.ts` (integration layer); `./scripts/verify-local.sh all` PASS; `./scripts/verify-local.sh static-analysis` PASS | PASS |

Next action: none — all declared checkpoints are committed (CP-1 through CP-4) and both mission-declared gates pass; mission complete and ready for Parallix lifecycle handoff.
