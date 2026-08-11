---
id: TASK-2219
title: Extract Forgejo API transport from workflow operations
status: backlog
assignee: []
created_date: '2026-07-11 00:00'
labels:
  - refactor
  - maintainability
  - forgejo
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`forgejo.ts` is roughly 1,800+ lines and mixes settings/auth resolution, Curl transport, PR operations, Git remote synchronization, review polling, comments, and merge-state reconciliation. Extract the synchronous and asynchronous Forgejo HTTP transport into a focused module such as `forgejo-api.ts`.

The transport module should own request construction, Curl invocation, response parsing, and normalized transport errors. Domain operations such as creating PRs, posting reviews, polling decisions, and syncing Git refs remain in `forgejo.ts` and consume the extracted transport.

Target change size: 250-500 total added plus deleted lines in the final diff, including tests and generated runtime artifacts. Preserve all current public behavior and injection seams.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Extract `forgejoApi` and `forgejoApiAsync` plus only their transport-specific helpers into one focused module
- [ ] #2 Keep Forgejo settings/auth resolution, token discovery, PR/review domain operations, Git remote operations, and merge synchronization in `forgejo.ts`
- [ ] #3 Preserve `forgejoApi` and `forgejoApiAsync` as public exports from `lib/tools/forgejo.ts` so existing consumers remain compatible
- [ ] #4 Preserve request method, URL, authorization header, JSON body behavior, timeout behavior, response parsing, status/statusCode fields, and existing normalized error text
- [ ] #5 Preserve test injection of the process runner/request implementation without adding real network calls to unit tests
- [ ] #6 Add focused transport tests covering success, non-2xx responses, malformed JSON, spawn/request failure, and timeout behavior for synchronous and asynchronous paths
- [ ] #7 The final diff contains 250-500 added plus deleted lines as reported by `git diff --numstat` (excluding `graphify-out/`); if outside the range, document why in the final checkpoint and reduce scope where feasible
- [ ] #8 Run `./scripts/verify-local.sh static-analysis` and the focused Forgejo tests successfully
<!-- AC:END -->

## Out of Scope

- Replacing Curl with a different HTTP client
- Changing Forgejo authentication or token storage
- Altering PR, review, comment, or merge semantics
- Refactoring Git remote synchronization

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
