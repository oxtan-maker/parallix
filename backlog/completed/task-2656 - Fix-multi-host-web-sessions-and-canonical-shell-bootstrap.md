---
id: TASK-2656
title: Fix multi-host web sessions and canonical shell bootstrap
status: done
assignee: [codex]
created_date: '2026-10-06 08:24'
labels: []
dependencies: []
ordinal: 167008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Allow multiple Parallix web hosts on the same loopback address to work in one
browser profile without invalidating each other's commands.

Ensure every accepted shell entry route supplies the session and CSRF bootstrap
required by that host.

Preserve the existing fail-closed security boundary.

## Context and defects to verify

Reference revision: 09dfbad1dc7fa69a15a6b747cca5e6de2eeeba51.

The reviewed host:
- Issues `px_session=<per-launch value>; HttpOnly; SameSite=Strict; Path=/`.
- Uses that fixed cookie name across launches on different ports.
- Injects the CSRF meta value and sets the cookie when serving `/`.
- Serves `/index.html` through the asset route using the original HTML bytes.

Reproduce:
1. Opening host B overwrites host A's same-name cookie, causing A's subsequent
   mutations to fail session authorization.
2. Direct navigation to `/index.html` loads a shell without the mutation
   credentials supplied at `/`.

Verify the actual starting HEAD. Do not assume the review's line numbers or
implementation are unchanged.

## Scope and ownership

Primary production ownership:
- src/interfaces/web/host.ts
- src/interfaces/web/security.ts
- A small cohesive host/bootstrap helper, only if necessary.
- src/adapters/web/asset-store.ts only if a narrowly justified change is needed.

Read the existing transport constants, asset manifest, startup/binding flow,
browser CSRF reader, security ADR, and owning host/security tests.

Do not change:
- Browser snapshot synchronization or command pending state.
- Application dispatch, lifecycle, or persistence.
- Loopback-only policy, permitted mutation routes, or authorization authority.
- Transport DTOs merely to implement cookie naming.

## Required behavior

### 1. Collision-free cookie identity

Use a deterministic cookie namespace appropriate to the actual bound endpoint.
A stable per-bound-port name is a reasonable default: the value must remain
unguessable and renewed per launch.

Requirements:
- Issuance and extraction use one definition of the cookie name.
- Port 0 resolves to the actual OS-assigned port before naming cookies.
- Two hosts on the same loopback address do not replace each other's cookies.
- Restarting a host does not cause unbounded accumulation of per-launch cookie
  names. Old launch credentials must remain invalid.
- Preserve supported IPv4 and IPv6 binding behavior.

Do not encode credentials in URLs, expose HttpOnly cookies to JavaScript,
or clear cookies belonging to another host.

Do not add a fallback that accepts the old shared cookie and reintroduces
ambiguity. Unrelated and legacy cookies must not authenticate a request.

Cookie namespacing is not authorization. Continue requiring the correct
current launch value and the existing Host, Origin, and CSRF checks.

### 2. One authoritative shell-bootstrap path

Ensure `/` and every already-accepted asset resolution targeting `index.html`
either:
- Serve through the same bootstrap function, or
- Redirect safely to the canonical bootstrapped route.

Base this on validated asset resolution, not a fragile literal URL comparison.
Cover supported encoded spellings, trailing-slash handling, and query strings
without expanding the set of accepted assets.

The final shell response must:
- Set the correct host's session cookie.
- Contain the matching non-executable CSRF meta value.
- Retain no-store and existing protection headers.

Keep hashed-asset caching unchanged. Preserve manifest allowlisting and
rejections for traversal, malformed encodings, unknown files, and invalid hosts.
Do not introduce a blanket SPA fallback or open redirect.

### 3. Preserve rejection semantics

Missing or wrong Origin, session, and CSRF credentials must still fail before
dispatch. A cookie/token from host A must not authorize a request to host B.

Keep existing method, content-type, body-size, loopback binding, and protection
header checks. Do not broaden CORS or make mutations credential-optional.

## Required regression tests

Extend existing security-policy and actual host-boundary suites.

Use isolated fixtures and temporary listeners. Command dispatch may be a
controlled application-port double; no real mission mutation is required.

Prove:

1. Two hosts on the same address and different actual ports share one cookie
   store. Bootstrap A, bootstrap B, then make valid commands to both; repeat
   in the reverse order. Neither host invalidates the other.
2. Host A credentials supplied to B are rejected before dispatch.
   Unrelated cookies and the legacy shared cookie cannot bypass validation.
3. An OS-assigned port produces the correct cookie identity and accepts its
   own credentials.
4. Relaunching an endpoint changes the capability; previous launch credentials
   are rejected and fresh bootstrap restores valid access.
5. Direct `/index.html` navigation from a fresh cookie store reaches a fully
   bootstrapped shell and supports an authorized command.
6. Every accepted alternate index resolution uses that same bootstrap behavior.
   Rejected asset paths remain rejected.
7. Existing negative authorization, cache policy, protection-header, and
   asset-traversal tests remain green.

The multi-host test must model browser cookie sharing correctly. Do not give
each port a private jar or key cookies by origin including port.

Prefer the existing browser harness when available. Otherwise exercise real
host responses with a shared host/path/name cookie store and assert actual
Set-Cookie identities and command authorization. Do not add a large browser
test stack for this mission.

Retain red-on-parent, green-on-fix regressions for both defects.
Pure cookie-name unit tests alone are insufficient.

## Guardrails and verification

Read AGENTS.md, scoped instructions, applicable security ADRs, and ADR 0057.
Follow current repository instructions and extend the owning suites.

Classify any new real-boundary suite in the existing category registry.
Tests must clean up listeners, fixtures, and processes on failure as well
as success. Do not require a model backend or external service.

Run focused security/host regressions, then:
- ./scripts/verify-local.sh static-analysis
- Relevant existing build/type checks.
- ./scripts/verify-local.sh docs if live documentation changed.

Do not rerun full repository gates unnecessarily; Parallix owns the normal
full lifecycle verification. Do not weaken gates, assertions, or time budgets.

Keep production changes cohesive and within repository size constraints.
No unrelated authentication redesign or application-boundary changes.

## Completion evidence

Record:
- Starting/final commit identities and exact verification commands/results.
- Both original failures and their retained regression tests.
- The chosen cookie namespace and restart behavior.
- The canonical-shell decision and covered alternate paths.
- Evidence that negative authorization tests still reject before dispatch.
- Any limitations, particularly whether a real browser was exercised.

Do not claim browser end-to-end verification when only HTTP/policy tests ran.
Do not integrate or push to origin; use the normal review workflow.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
