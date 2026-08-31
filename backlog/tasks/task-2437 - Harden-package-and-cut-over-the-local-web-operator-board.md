---
id: TASK-2437
title: Harden, package and cut over the local web operator board
status: backlog
assignee: []
created_date: '2026-08-28 06:29'
labels:
  - ai_sdlc
  - web
  - board
  - security
  - e2e
  - packaging
dependencies:
  - TASK-2436
priority: high
---

## Description

Run the full feature as a hostile reviewer would, fix only defects in the implemented web-board slice, prove the published artifact, and perform the user-facing `px ui` rollout consistent with ADR 0054 and the existing CLI/distribution contracts.

This is not a polish/refactor mission. It is an integration/adversarial verification boundary. The Ink TUI remains an explicit rollback/fallback path during the initial web cutover because ADR 0054 does not authorize deleting the TUI and the existing interface is the safest rollback path.

## Acceptance Criteria

- [ ] #1 Browser E2E covers: initial board, attention flow, one harmless read, one confirmed mocked mutation, failed mutation, stale-confirmation conflict, reconnect, page reload, unavailable capability and clean shutdown.
- [ ] #2 Security E2E covers: wrong Host, foreign Origin, missing/invalid session, missing/invalid CSRF, malformed/oversized JSON, unknown action, method confusion, path traversal and direct crafted request for an unavailable action.
- [ ] #3 A disposable-repository integration smoke proves server projection/typed controller wiring without contacting real Forgejo or launching a paid/real agent.
- [ ] #4 Current-work semantics are regression-tested end to end: authoritative live work animates; coordinator-only evidence does not become a running-agent claim; stale/unconfirmed work remains distinct.
- [ ] #5 Serialization regression covers indefinite block duration and unknown-versus-zero liveness in a real HTTP snapshot.
- [ ] #6 High-volume synthetic SSE/progress/reconnect tests demonstrate bounded server/client buffers, listeners and timers; no real-time soak/sleep is used to hide leaks.
- [ ] #7 `npm pack`/published-layout smoke launches the web UI using only shipped files; no `src/`, `.dc.html`, CDN or workspace-only asset is required.
- [ ] #8 Existing `px.mjs` 5 MB stop rule remains unchanged and passes; web asset size is reported separately as a separate browser-asset measurement; do not hide browser size growth by weakening the canonical `px.mjs` gate.
- [ ] #9 Browser bundle has no Node built-ins, concrete persistence adapters, shell/process APIs or source-map path leakage that exposes local filesystem details in normal errors.
- [ ] #10 User-facing launch command follows ADR 0054 and existing CLI conventions; explicit TUI fallback works and uses the same production projection/controller contracts.
- [ ] #11 Docs describe only durable user behavior/security/rollback, not volatile source/test inventories.
- [ ] #12 TASK-2283's umbrella acceptance criteria are rechecked one by one; any unmet criterion becomes a new follow-up instead of being waived in the checkpoint.
- [ ] #13 Find and fix elements that is missing in the design relative to the reference design /tmp/Parallix\ Kanban\ Board\ Controller.zip
- [ ] #14 Find and fix elements that is halucinated extras in the design relative to the reference design (check the checkpoints and review evidence in this waves for comments that might be exceptions decided during the wave, one known item is that parllix can be displayed twice, one for the produce name and one for the repo name)

## Agent-slop guardrails

- Do not use this task for redesign, dependency upgrades unrelated to the web board, or “cleanup while here”.
- Do not fix failing E2E by adding sleeps, retries without root cause, larger timeouts, permissive CORS, disabled CSRF, or test-only server behavior.
- Do not mock the security boundary in the security E2E; exercise the actual local HTTP host.
- Do not contact internet services or real coding agents from default tests.
- Do not delete the TUI fallback just to simplify packaging unless the accepted ADR explicitly requires that cutover and rollback remains proven.

## Definition of Done

- [ ] #1 Full repository integration gate passes on the final tree with captured evidence.
- [ ] #2 Static analysis, package-content audit, bundle checks and browser/E2E suite pass.
- [ ] #3 No focused/unannotated skipped tests or new type-safety escape hatches exist.
- [ ] #4 Final checkpoint contains an explicit TASK-2283 acceptance-criteria matrix with test/evidence references.
- [ ] #5 Final reviewer answers: no duplicate authority? no browser shell path? no client-derived lifecycle? no unbounded buffer/listener? no untested security bypass? All must be “yes, verified” with evidence.
- [ ] #6 TASK-2283 can then be closed as the umbrella task; if not, leave it open and create narrowly scoped follow-ups.
