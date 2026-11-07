---
id: TASK-2837
title: Treat explicit reviewers as preferred with runtime fallback
status: done
assignee: [codex]
created_date: '2026-11-03 18:36'
updated_date: '2026-11-03 18:37'
labels:
  - ai_sdlc
dependencies: []
priority: high
ordinal: 307016
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Change explicit review routing so `--reviewer` selects the first reviewer to try, not a family that must succeed or stop the mission. When that reviewer cannot complete because of a typed usage quota, provider availability or entitlement failure, missing launcher, liveness timeout, or an unambiguous nonzero launch exit without a consumable verdict, persist any positive provider block and continue through the configured eligible review pool while preserving implementer/reviewer independence. The actual fallback reviewer becomes the recorded reviewer for artifact consumption and later rounds; do not spend reviewer-artifact repair attempts relaunching a provider known to be unavailable.

Repair the observed Claude Code 2.1.317 protocol drift as part of the same behavior: structured stream-json fields `api_error_status=429`, `api_error=usage_limit_reached`, and nested `rate_limit_info.resetsAt` must normalize to `agent-quota` with the real reset time. Keep human diagnostic text as presentation evidence, never the classification authority. Generic process fallback must still work if a future structured quota shape is not recognized.

Scope this change to reviewer preference and review continuation. Do not weaken pinned ownership for mutating implementers, conflict resolution, repair authority, or any other lane unless production caller tracing proves it is the same reviewer-preference contract. Rename review-facing `pinnedReviewer`/`pinnedAgent` concepts to `preferredReviewer`/`preferredAgent` where that makes the contract truthful; avoid a compatibility alias that leaves review behavior pinned underneath. Update CLI help and live operator documentation from requires/refused-never-replaced wording to preferred-first fallback semantics.

Retain the TASK-2835 production reproduction: Claude printed a structured 429 `usage_limit_reached` event, exited 1, was classified as unexpected, and was relaunched twice as incomplete-artifact recovery before `REVIEWER_ARTIFACT_RETRY_EXHAUSTED`. The fixed behavior must block Claude until its structured reset, select another eligible independent reviewer in the same review round, and preserve any already-recorded verdict or consumable artifact instead of duplicating review work. Manually exercise the built public review workflow in disposable state with a controlled failing preferred reviewer and a successful fallback; do not depend on consuming paid provider quota or mutate live mission history.
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

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A focused regression feeds the retained Claude stream-json `rate_limit_event`, synthetic assistant API error, and result shapes through the production spawn/failure-normalization path. `api_error_status` 429 plus `usage_limit_reached` becomes typed `agent-quota` with the nested reset timestamp; human wording changes do not affect classification.
- [ ] #2 An explicit `--reviewer` family is attempted first, but quota, provider unavailability or entitlement, missing launcher, liveness timeout, and an unambiguous nonzero launch exit without usable review artifacts fall back to the next configured eligible independent reviewer instead of failing as pinned.
- [ ] #3 Positive quota/availability evidence writes the checked provider block before reselection. Ambiguous failures do not poison the long-lived blocklist, but still use bounded in-run fallback. Selection excludes the implementer when another eligible family exists and preserves existing single-family policy.
- [ ] #4 The fallback family becomes the authoritative reviewer for artifact polling, persisted round state, presentation, telemetry, and later continuation. The original preferred family is not relaunched through incomplete-artifact repair while blocked, and fallback never mutates the Backlog assignee.
- [ ] #5 A verdict or consumable reviewer artifact recorded before a process exit is retained and consumed exactly once; fallback cannot overwrite a decided round, duplicate provider comments, or create a second reviewer decision for the same revision.
- [ ] #6 Review-facing `pinnedReviewer`/`pinnedAgent` naming and composition are replaced or narrowed so the code states preferred-first semantics. Hard ownership for implementers, conflict resolution, and repair remains unchanged unless traced production contracts prove otherwise.
- [ ] #7 CLI help and live operator documentation describe `--reviewer` as a preferred first choice with bounded eligible fallback and explain how to require manual operator control without claiming silent reviewer substitution is impossible.
- [ ] #8 Extend the existing failure-normalization, agent-launch fallback, reviewer-selection, and review-loop owning suites. Preserve distinct explicit-reviewer, persisted-reviewer, artifact-recovery, and independence assertions; no new integration/E2E suite, gate, category, or CPU-budget change.
- [ ] #9 Manually exercise the built public review command in isolated disposable repository/operator state: preferred reviewer exits with a controlled structured quota or launch failure, another eligible reviewer completes, state records the actual reviewer, and no incomplete-artifact retry is spent on the failed family. Retain invocation and result evidence without using live provider quota.
- [ ] #10 Focused checks, changed-file static analysis, and final repository verification pass under existing limits; every added unit case stays below 500 ms and every modified integration case and suite remains at or below 3.5 seconds.
<!-- AC:END -->
