---
id: TASK-2838
title: Normalize Claude structured quota events
status: backlog
assignee: []
created_date: '2026-11-03 18:37'
labels:
  - bug
  - ai_sdlc
dependencies: []
priority: high
ordinal: 308016
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Claude quota failures are currently normalized as `unexpected`, so the application never receives the typed `agent-quota` identity needed to persist a block and select another reviewer. The retained TASK-2835 stream contains a rejected `rate_limit_event` with `resetsAt`, followed by assistant/result API-error events carrying `api_error_status: 429` and `api_error: "usage_limit_reached"`.

This is a regression/coverage gap after the structured-failure migration, not evidence that px-0026 failed its stated scope. px-0026 (commit `7fe471216`) recognized Claude's human diagnostic (`You've hit your 5-hour limit ...`). TASK-2829 (commit `4fc3afd02`) deliberately removed transcript classification in favor of producer-owned structured failures, but its generic normalizer only reads conventional `status`, `statusCode`, `code`, and `type` fields. It does not translate Claude CLI's `api_error_status`, `api_error`, `rate_limit_event`, or nested reset metadata.

Extend the existing process failure-normalizer owner to translate Claude's structured quota shapes into the canonical `agent-quota` failure without reintroducing human-text matching. Preserve exact reset metadata when available, define precedence for duplicate events from one failed invocation, and keep unknown/malformed output fail-closed. Audit adjacent structured Claude failure identities only as needed to prevent the same schema-boundary mistake; do not broaden this mission into reviewer-selection policy, which is owned by TASK-2837.

Extend the existing owning unit suites with a focused parent-red/fix-green reproduction. Manually exercise the built public process boundary with a retained/sanitized JSONL fixture; no live quota consumption is required or appropriate.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The exact retained TASK-2835 rejected `rate_limit_event` shape normalizes to canonical `agent-quota` with provider source and the advertised reset time.
- [ ] #2 Claude assistant/result events with `api_error_status: 429` and `api_error: "usage_limit_reached"` normalize to canonical `agent-quota`, including nested reset epoch metadata when present.
- [ ] #3 Duplicate quota events emitted during one failed invocation resolve deterministically to the quota identity and do not degrade to `unexpected`.
- [ ] #4 Successful/allowed rate-limit status events, quoted human diagnostic text without structured markers, malformed JSON, and unrelated provider failures do not produce a false quota block.
- [ ] #5 The application consumer persists the translated quota block with the correct agent and reset metadata through the existing block-store contract.
- [ ] #6 Focused coverage is added to the existing failure-normalization and agent-limit owning suites, with the retained fixture red on the parent behavior and green after the fix.
- [ ] #7 A built-process manual check feeds a retained/sanitized Claude JSONL stream through the public execution boundary and demonstrates canonical quota classification without contacting Claude.
- [ ] #8 No transcript substring classifier is reintroduced, and unknown structured failures retain the existing fail-closed behavior.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
