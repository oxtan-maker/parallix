# Mission: Add a loopback-only web host and self-contained browser asset build (task-2431)

## Goal
After human acceptance of ADR 0054, deliver the minimal local web-board host inside the canonical `px` Node process: a Fastify server bound only to loopback on an ephemeral port and a Vite-built React/React DOM browser shell that is self-contained in package mode. Establish the ADR's security boundary before board data or mutations are introduced.

## Why Now
ADR 0054 requires the local-host security and packaging foundation before useful web routes exist. Establishing that boundary first prevents later board features from normalising remote exposure, permissive origins, reusable browser credentials, or a production dependency on the source tree or a Vite server.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: Activate only after ADR 0054 is Accepted; its current Proposed status is a hard precondition.
- Main drivers: Fastify inbound adapter in `px`; Vite browser build; loopback and same-origin security boundary; package-mode asset smoke coverage.

## Scope
- Add the Fastify local web adapter to the existing Node/`px` process, with an explicit loopback bind and OS-selected port `0` by default.
- Reject non-loopback bind configuration and validate the Host header against the actual loopback origin and bound port.
- Create memory-only, per-launch unguessable session state and require strict same-origin plus CSRF validation for every state-changing route; keep GET routes read-only.
- Set CSP, frame, content-type, and referrer protections for browser assets; set method, content-type, and body-size limits before JSON mutation routes exist.
- Build the React/React DOM browser shell with Vite as separate packaged assets, serving only allowlisted manifest/path entries.
- Add focused negative security coverage and a built/package-mode smoke that serves the shell without `src/`, an uploaded artifact, CDN resources, or a Vite dev server.

## Out of Scope
- Board data retrieval, board mutations, domain APIs, and UI workflows beyond the minimal browser shell.
- Any remote, LAN, `0.0.0.0`, or configurable permissive-CORS serving mode.
- A separate deployed process/runtime, Vite production server, CDN-hosted browser dependencies, or external font/script dependency.
- Persistent sessions, reusable bearer credentials in localStorage, and query-string API credentials.
- Raising or otherwise changing the existing 5 MB `px.mjs` stop rule.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- The local host binds an explicit loopback address on port `0` unless a test-only seam overrides it; non-loopback bind requests are rejected and no remote-listener configuration path exists.
- Requests with a Host header that does not equal the launch's loopback host and bound port are rejected.
- Each `px` launch creates unguessable, memory-only session protection that becomes unavailable when that process exits.
- Every state-changing route rejects an absent or incorrect Origin, session value, or CSRF value; GET routes do not mutate state.
- Browser-asset responses enforce CSP, frame protection, content-type protection, and referrer protection without requiring an inline executable script unless ADR 0054 documents a nonce/hash exception.
- Asset serving accepts only manifest/allowlisted build paths and rejects traversal attempts; it cannot read arbitrary repository or package files.
- Unsupported methods, unsupported content types, and bodies over the configured limit are rejected before JSON mutation routes are added.
- The browser bundle is produced independently of `px.mjs`, while the existing 5 MB `px.mjs` stop rule remains unchanged.
- A package-mode smoke serves the browser shell after source files and uploaded artifacts are unavailable, with no CDN request and no Vite development server.
- Focused tests cover wrong Host, wrong Origin, missing/bad session, missing/bad CSRF, wrong method, oversized body, and asset traversal; the required repository verification gate passes.

## Risks and Assumptions
- Assumption: ADR 0054 will be accepted before implementation starts; if it remains Proposed, this mission must not activate.
- Risk: binding semantics differ across IPv4 and IPv6 loopback; tests must assert the actual advertised origin rather than assume one hostname format.
- Risk: Fastify defaults or generic static-file helpers can weaken the intended boundary; implementation must use a bounded allowlist and explicit validation.
- Risk: package smoke fixtures may accidentally resolve local `src/` files or a running dev server; isolate the packaged artifact and assert the shell is served from built assets.
- Assumption: Fastify, React DOM, and Vite remain the ADR 0044-audited dependencies and can be bundled without creating another deployed runtime.

## Checkpoints
- CP 1: Confirm ADR 0054 is Accepted; map the existing `px` entry path, package layout, and test seams. Record the selected single-process Fastify/Vite bootstrap and the exact tests that will cover each security-negative case.
- CP 2: Implement loopback-only startup, actual-origin Host validation, memory-only launch session, same-origin/CSRF boundary, and bounded request handling. Add focused unit tests for wrong Host, wrong Origin, bad/missing session and CSRF, wrong method, and oversized body.
- CP 3: Add the separate Vite browser build and manifest-allowlisted asset serving with response protections. Add traversal coverage and package-mode smoke coverage that proves the shell works without source, CDN, uploaded artifact, or Vite dev server.
- CP 4: Run the required gates, confirm the `px.mjs` stop rule is unchanged, and document the actual loopback bind address plus the absence of a remote-listener path.

### Checkpoint Documentation Requirements
Every checkpoint document (`CP-N.md`) MUST lead its evidence with durable references Parallix verifies today: exact test names, ADR 0054 or ADR 0044, existing/new `test/` file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./scripts/verify-local.sh ...`. File:line references are accepted when needed but discouraged because line numbers rot.

It MUST include a work summary, then the exact heading `## Goal Check` and this 3-column table:

| Criterion | Evidence | Status |
|---|---|---|
| Each mission success criterion | Exact test name, `test/` path, ADR reference, or runnable repository command | PASS / FAIL / PENDING |

Include at least one evidence row for every success criterion, and finish with a non-generic `Next action:` line. Raw `stat`/`ls` output or generic prose alone is not enough; if included, pair it with an accepted command, test name, test path, ADR reference, or recognized repository path.

## Gates
- [x] ./scripts/verify-local.sh all
- [x] ./scripts/verify-local.sh static-analysis

## Restricted Areas
- Do not add board data, mutations, domain APIs, or a feature-complete web UI.
- Do not bind outside loopback, add remote mode/CORS bypasses, or treat an ephemeral port as authentication.
- Do not use Express, Next, `node:http`, generic `path.join(root, request.url)` static serving, a Vite production server, or a second long-lived process.
- Do not persist or expose reusable browser credentials through localStorage, query strings, history, or referrers.
- Do not change the canonical `px.mjs` 5 MB stop rule.

## Stop Rules
- Stop before implementation if ADR 0054 is not Accepted; obtain human acceptance rather than proceeding from Proposed.
- Stop and seek direction if satisfying the browser host requires a remote listener, a second deployed runtime, a production Vite server, CDN dependency, or a larger `px.mjs` bundle.
- Stop and seek direction if the package-mode smoke cannot be isolated from `src/`, uploaded artifacts, or a dev server without changing the stated packaging boundary.
- Stop and seek security review if Host/origin/session/CSRF validation cannot be made strict for the actual loopback origin and port.
