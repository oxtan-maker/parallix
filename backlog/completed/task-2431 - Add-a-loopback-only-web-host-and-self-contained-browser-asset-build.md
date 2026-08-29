---
id: TASK-2431
title: Add a loopback-only web host and self-contained browser asset build
status: done
assignee: [custom]
created_date: '2026-08-28 06:29'
labels:
  - user_value
  - web
  - security
  - packaging
  - infrastructure
dependencies: []
references:
  - docs/adr/0054-local-web-board-adapter.md
priority: high
---

## Description

Implement the minimal local web host and browser build mandated by ADR 0054, without board data or mutations yet. **Do not activate this mission while ADR 0054 remains `Proposed`; human acceptance is a hard precondition.**

Use **Fastify inside the canonical Node/`px` process** as the inbound adapter and **Vite** for the React/React DOM browser build. Bind explicit loopback on an ephemeral port. Browser assets are self-contained and production packaging must not require a Vite dev server, CDN, external font/script, or source checkout. Fastify/React DOM/Vite are bundled and audited under ADR 0044; they do not create a second deployed application/runtime.

Implement the ADR 0054 security boundary now, before useful endpoints are added: one origin, per-launch mutation capability, strict Origin validation, loopback-only binding, and bounded/validated HTTP behavior. Choose the smallest concrete bootstrap mechanism that satisfies those properties and is testable; document it in code/tests rather than inventing a second authentication system.

## Acceptance Criteria

- [ ] #1 Server binds explicit loopback only and uses an OS-selected ephemeral port unless a test seam overrides it.
- [ ] #2 Non-loopback bind requests are rejected; there is no `0.0.0.0`, remote mode or permissive CORS option.
- [ ] #3 Host header is validated against the actual loopback origin/port to reduce DNS-rebinding exposure.
- [ ] #4 Per-launch unguessable session protection exists; session state is memory-only and dies with the `px` process.
- [ ] #5 State-changing routes (future or present) require strict same-origin + CSRF protection; all GET routes are read-only.
- [ ] #6 CSP/frame/content-type/referrer protections are set for browser assets; no inline executable script is required unless the ADR explicitly justifies a nonce/hash strategy.
- [ ] #7 Static assets are served from an allowlisted build manifest/path set; URL path traversal cannot read arbitrary package/repository files.
- [ ] #8 Request method, content type and body-size limits exist before JSON mutation routes are added.
- [ ] #9 Browser assets build separately from `px.mjs`; the existing 5 MB `px.mjs` stop rule is unchanged.
- [ ] #10 A built/package-mode smoke serves the shell without relying on `src/`, the uploaded artifact, a CDN or a dev server.

## Agent-slop guardrails

- Do not replace ADR 0054's Fastify + Vite architecture with Express, Next, `node:http`, a Vite runtime/dev server in production, or another long-lived process. Vite is build/dev tooling; Fastify is the local production adapter inside the existing `px` process.
- Do not treat random port as authentication.
- Do not put a reusable bearer token in localStorage or make API authorization depend on a query-string token that remains in history/referrers.
- Do not implement generic static-file serving with `path.join(root, request.url)`.
- Do not raise the canonical bundle limit to accommodate web work.
- Network tests bind only loopback port `0` and never contact the internet.

## Definition of Done

- [ ] #1 Security-negative tests cover wrong Host, wrong Origin, missing/bad session, missing/bad CSRF, wrong method, oversized body and asset path traversal.
- [ ] #2 Built-asset/package smoke passes.
- [ ] #3 Verification, package-content and static-analysis gates pass for changed scope.
- [ ] #4 Final checkpoint records actual bind address and proves no remote listener path exists.
