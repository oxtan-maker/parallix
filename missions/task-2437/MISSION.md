# Mission: Harden, package and cut over the local web operator board (task-2437)

## Goal
Harden the ADR 0054 React/Vite/Fastify local web board slice, prove the published
`npm` artifact launches the web UI from shipped files only, and perform the
user-facing `px ui` rollout — fixing only defects found by running the feature as
a hostile reviewer — while keeping the Ink TUI as the proven rollback/fallback
path. The web board reuses the existing application projections and use cases
(`BoardProjection`, `projectMissionActivity`, `runWebCommand`) and never touches
Git, SQLite, files, agents, or subprocesses from the browser.

## Why Now
The web board prototype and its Fastify adapter are wired (tasks 2427–2436) but
not yet proven against a hostile run, published-layout launch, or the user-facing
`px ui` command. ADR 0054's own "Implementation and verification gates" section
requires loopback-only binding, mutation authorization, schema rejection,
reconnect behavior, fail-closed results, and CLI compatibility — none of which
are yet closed. This is the integration/adversarial-verification boundary that
turns "wired" into "shippable", and it depends on TASK-2436 (board handoff/resume).

## Refinement Signals
- Predicted NEL bucket: Large (235+)
- Confidence: High
- Selection note: activate as-is
- Main drivers: adversarial verification of a live HTTP boundary, published-artifact
  proof, and a user-facing command cutover across the web/transport/host/stream,
  packaging, and CLI layers.

## Scope
- Adversarial end-to-end run of the web board: initial board, attention flow, one
  harmless read, one confirmed mocked mutation, failed mutation,
  stale-confirmation conflict, reconnect, page reload, unavailable capability,
  clean shutdown.
- Security E2E against the real loopback Fastify host (not a mocked boundary):
  wrong `Host`, foreign `Origin`, missing/invalid session, missing/invalid CSRF,
  malformed/oversized JSON, unknown action, method confusion, path traversal,
  and a direct crafted request for an unavailable action.
- Disposable-repository integration smoke proving server projection and typed
  controller wiring without contacting real Forgejo or launching a paid/real agent.
- Current-work semantics regression: authoritative live work animates;
  coordinator-only evidence never becomes a running-agent claim; stale/unconfirmed
  work stays distinct.
- Serialization regression for indefinite block duration and unknown-versus-zero
  liveness in a real HTTP snapshot.
- High-volume synthetic SSE/progress/reconnect tests proving bounded server/client
  buffers, listeners, and timers (no real-time soak/sleep to hide leaks).
- `npm pack`/published-layout smoke: web UI launches using only shipped files —
  no `src/`, `.dc.html`, CDN, or workspace-only asset required.
- Keep the existing `px.mjs` 5 MB stop rule (scripts/build-canonical-bundle.ts SC6)
  unchanged; report browser-asset size as a separate measurement; do not weaken the
  canonical gate to hide browser size growth.
- Browser bundle audit: no Node built-ins, concrete persistence adapters,
  shell/process APIs, or source-map path leakage exposing local filesystem details
  in normal errors.
- User-facing launch command per ADR 0054 and existing CLI conventions; TUI
  fallback works and uses the same production projection/controller contracts.
- Fix elements missing from the design relative to the reference design
  `/tmp/Parallix Kanban Board Controller.zip`, and remove hallucinated extras
  (e.g. Parallels displayed twice — once for product name, once for repo name).
- Docs updated for durable user behavior/security/rollback only.

## Out of Scope
- Redesign of the board layout, lanes, or attention ranking.
- Dependency upgrades unrelated to the web board.
- "Cleanup while here" changes outside the web/transport/host/stream/packaging/CLI scope.
- Deleting the Ink TUI fallback (ADR 0054 does not authorize it).
- Remote access, multi-user auth, offline mutation, or persistence/backup/concurrency changes (ADR 0054 reconsideration triggers).
- Server-rendering, a client router, or a second browser state framework (ADR 0054 rejected these).

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion is falsifiable; no
> subjective adjectives or vague quantifiers without an attached metric.

- SC1 Browser E2E `test/...web-*.test.ts` covers all twelve scenarios: initial
  board, attention flow, one harmless read, one confirmed mocked mutation, failed
  mutation, stale-confirmation conflict, reconnect, page reload, unavailable
  capability, clean shutdown. Fails at the mission's parent commit if any scenario
  is unimplemented.
- SC2 Security E2E exercises the real loopback host for all ten classes (wrong
  Host, foreign Origin, missing/invalid session, missing/invalid CSRF,
  malformed/oversized JSON, unknown action, method confusion, path traversal,
  direct crafted request for an unavailable action). Each class asserts a
  fail-closed result (4xx / rejected); no class is mocked.
- SC3 Disposable-repository integration smoke proves server projection and typed
  controller wiring end to end without touching real Forgejo or a paid/real agent.
- SC4 Current-work regression: live work animates; coordinator-only evidence does
  not surface as a running-agent claim; stale/unconfirmed work stays distinct —
  asserted in `test/current-work-publication.test.ts` / `test/current-work-reconciliation.test.ts`.
- SC5 Serialization regression asserts indefinite block duration and
  unknown-versus-zero liveness in a real HTTP snapshot via `test/web-transport.test.ts`
  (WEB_TRANSPORT_VERSION 2 wire states).
- SC6 High-volume synthetic SSE/progress/reconnect tests assert bounded buffer
  limits (`WEB_EVENT_BUFFER_LIMIT`), listener count, and timer count with no
  `setTimeout`/`setInterval` soak and no `sleep` to delay assertions.
- SC7 `npm pack` + extracted-tarball smoke launches the web UI from shipped files
  only; the served HTML has zero `http(s)://` references and no inline executable
  script; the per-launch session dies with the process.
- SC8 `npm run test:bundle` and the canonical 5 MB stop rule
  (scripts/build-canonical-bundle.ts SC6, `maxSizeBytes = 5 * 1024 * 1024`) pass
  unchanged; browser-asset size is reported as a separate measurement.
- SC9 Browser bundle audit asserts no Node built-ins, no concrete persistence
  adapters, no shell/process APIs, and no source-map path leakage of local
  filesystem details in normal errors.
- SC10 `px ui` follows ADR 0054 and existing CLI conventions; TUI fallback launches
  and uses the same production projection/controller contracts as the web board.
- SC11 Docs (docs/adr, README, graphify-out/wiki) describe only durable user
  behavior/security/rollback; no volatile source/test inventory.
- SC12 TASK-2283 umbrella acceptance criteria rechecked one by one in the final
  checkpoint matrix; any unmet criterion becomes a new scoped follow-up, never a
  waiver.
- SC13 Missing design elements from `/tmp/Parallix Kanban Board Controller.zip` are
  fixed; hallucinated extras (including duplicate Parallels) are removed.
- SC14 Full repository integration gate (`./scripts/verify-local.sh all`) passes on
  the final tree with captured evidence.

## Risks and Assumptions
- The loopback Fastify host binds an ephemeral port; tests must use port 0 /
  loopback-only and never a fixed or network-exposed port.
- CSRF/session validation is fail-closed by design; hardening must not relax it to
  make a test pass.
- Browser bundle size may grow with React DOM/Vite output; the 5 MB gate is on the
  `px.mjs` canonical bundle only, so browser assets are measured separately and must
  not be hidden by weakening that gate.
- The Ink TUI is the rollback path; any packaging change must keep it launchable.
- Assumption: `/tmp/Parallix Kanban Board Controller.zip` reference design is
  available; if absent, treat design-fidelity fixes as follow-ups rather than
  inventing requirements.
- Assumption: TASK-2436 board handoff/resume contracts are stable; this mission
  depends on them.

## Checkpoints
- CP 1: Adversarial scope map — run the web board as a hostile reviewer, record
  every defect against the twelve browser scenarios and ten security classes, and
  lock the failing behavior into targeted tests before any fix.
- CP 2: Browser E2E hardening — implement/repair the twelve scenarios in
  `test/...web-*.test.ts`; red→green per scenario.
- CP 3: Security E2E hardening — exercise the real loopback host for all ten
  classes; each asserts fail-closed; no mocked boundary.
- CP 4: Integration smoke + current-work + serialization regression —
  disposable-repository wiring proof, current-work semantics, and indefinite-block /
  liveness snapshot assertions.
- CP 5: High-volume SSE/progress/reconnect tests — bounded buffer/listener/timer
  assertions with no soak/sleep.
- CP 6: Packaging proof — `npm pack`/extracted-tarball launch smoke, browser bundle
  audit, and separate browser-asset size report; canonical 5 MB gate untouched.
- CP 7: `px ui` cutover + TUI fallback — user-facing launch per ADR 0054, TUI uses
  the same production contracts.
- CP 8: Design fidelity — fix missing elements and remove hallucinated extras
  relative to `/tmp/Parallix Kanban Board Controller.zip`.
- CP 9: Docs + TASK-2283 recheck — durable docs only; final TASK-2283 acceptance
  matrix with evidence; full integration gate passes.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references.
  Parallix already accepts, in priority order:
  1. **Recognized repo commands or paths** — e.g., `` `npm run test:integration` ``,
     `` `./scripts/verify-local.sh all` ``, `` `npm run test:bundle` ``,
     `` `npm pack` ``, `` `px ui` ``, `` `node --import tsx test/web-host.integration.test.ts` ``
  2. **Test names** — must match a test name in the repo, e.g.
     `"real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"`
  3. **Test file paths** — must be an existing test file, e.g.
     `test/web-host.integration.test.ts`, `test/web-security-policy.test.ts`,
     `test/web-package-smoke.integration.test.ts`,
     `test/current-work-publication.test.ts`, `test/web-transport.test.ts`
  4. **ADR references** — must correspond to an existing file under `docs/adr/`,
     e.g. `ADR 0054`, `ADR 0044`, `ADR 0048`, `ADR 0051`, `ADR 0053`
  5. **File:line references** — accepted when needed, but line numbers eventually
     rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but
  MUST be paired with one of the accepted references above. A raw `ls`/`stat` dump
  or a paragraph of prose alone does NOT satisfy a criterion — pair shell output
  with a recognized command, test name, test path, or ADR reference.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md` | PASS |
| Security E2E exercises real loopback host | `test/web-security-policy.test.ts`, `"wrong Origin is rejected fail-closed"` | PASS |
| Full integration gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not touch the Ink TUI rendering beyond keeping it launchable as the fallback.
- Do not modify the canonical 5 MB stop rule (scripts/build-canonical-bundle.ts SC6)
  or the `px.mjs` gate.
- Do not relax CSRF, Origin, session, or schema validation in the Fastify host or
  transport to make a test pass.
- Do not add npm runtime dependencies (ADR 0054: any Fastify/React DOM/Vite stays
  in devDependencies, bundled, audited under ADR 0044).
- Do not contact internet services, real Forgejo, or real/paid coding agents from
  default or integration tests.
- Do not add sleeps, retries without root cause, larger timeouts, or permissive
  CORS to make a flaky E2E pass.
- Do not delete, rename, or move the backlog task file.

## Stop Rules
- Stop before implementing if the reference design zip is absent and the work
  would require inventing requirements.
- Stop and create a follow-up for any TASK-2283 criterion that cannot be met; do
  not waive it.
- Stop if hardening a security class requires relaxing the fail-closed boundary.
- Stop if the browser bundle exceeds the separate browser-asset budget in a way
  that cannot be reduced without a redesign (out of scope).
- Stop before pushing any mission branch to `origin` (main only).
