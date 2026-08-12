---
id: TASK-2274
title: route role-owned review artifact failures to their producing agent
status: ready-for-integration
assignee: [custom]
created_date: '2026-07-17 00:00'
labels: [ai_sdlc]
dependencies: []
---

## Description

Complete ADR 0048's AutoSendBack coverage for autonomous-review artifacts. The
review loop currently has separate recovery paths for reviewer outcomes and
implementer dispositions, but lacks one explicit dispatcher that identifies an
artifact's producing role and routes the failure to that same role.

Implement a role-owned artifact recovery dispatcher. Reviewer findings/outcome/
verdict failures must relaunch the reviewer; implementation code, checkpoints,
round resolution, and PR disposition failures must relaunch the implementer.
Use bounded, persisted retry state and retain HumanOnly handling for infrastructure
and state-machine failures. Do not route reviewer failures to the implementer
merely because they occur during a mission implementation cycle.

## Acceptance Criteria

- [ ] Missing or malformed reviewer findings, outcome, or verdict artifacts are classified and sent back to the reviewer with a captured diagnostic.
- [ ] Missing or malformed implementer code/checkpoint, round-resolution, or PR-disposition artifacts are classified and sent back to the implementer with a captured diagnostic.
- [ ] Retry counts are persisted per producing role and are bounded; exhaustion produces an actionable stranded state without an uncontrolled loop.
- [ ] The dispatcher follows ADR 0048's AutoSendBack/HumanOnly decisions and does not auto-relaunch on Forgejo, authentication, or task-state failures.
- [ ] Regression tests cover both roles, malformed artifacts, absent artifacts, bounded retries, and correct task-state transitions.
- [ ] `./scripts/verify-local.sh static-analysis` and the relevant review-loop tests pass.

## Implementation Plan

1. Inventory every artifact consumer and identify its producing role.
2. Extract a role-owned recovery dispatcher that uses the existing ADR 0048 classifier and persisted review state.
3. Route reviewer and implementer artifact failures through that dispatcher.
4. Add focused ownership and retry-boundary regression tests.
5. Run static analysis and review lifecycle verification.
