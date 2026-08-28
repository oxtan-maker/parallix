---
id: TASK-2427
title: Integrate draft as a typed board capability without browser argv
status: backlog
assignee: []
created_date: '2026-08-28 06:29'
labels:
  - ai_sdlc
  - board
  - draft
  - controller
dependencies:
  - TASK-2426
priority: high
---

## Description

Make `draft:create` executable through the board command boundary by reusing current draft application policy, without exposing CLI argv/options or adapter details to future web clients.

The existing draft use case still accepts `string[]`/options even though it is application-owned. The board surface must therefore use a narrow typed request and a trusted composition adapter; the browser must never be able to choose flags, environment values, filesystem paths, worktree paths, or agent-launch options.

## Acceptance Criteria

- [ ] #1 `draft:create` has a typed board request containing only the domain values genuinely required for the board action.
- [ ] #2 Composition maps that request to the existing draft workflow/use case; no browser/board request accepts argv arrays or arbitrary option bags.
- [ ] #3 Availability is derived from current authoritative workflow eligibility; invalid lifecycle state remains rejected even if a UI tries the endpoint directly.
- [ ] #4 Existing draft current-work publication, setup/scaffold/intake/transition ordering and failure behavior are preserved.
- [ ] #5 Duplicate/existing-worktree and preflight failures are returned as failure/rejection, never as a projected successful move.
- [ ] #6 Tests prove extra flags/environment/path fields cannot be smuggled through the typed request.
- [ ] #7 Existing CLI `px draft` behavior remains unchanged.

## Agent-slop guardrails

- Do not implement draft by spawning `px draft` as a subprocess.
- Do not accept a command string and split/parse it server-side.
- Do not add browser-selectable `WORKFLOW_AGENT` or other environment override in this task.
- Do not make the board write Markdown/SQLite/Git directly.
- If current draft application policy cannot be reused without a large refactor, keep `draft:create` unavailable and create a narrowly scoped follow-up rather than inventing a second draft path.

## Definition of Done

- [ ] #1 Unit tests use mocked workflow ports and prove one dispatch/one outcome.
- [ ] #2 CLI draft characterization tests remain green.
- [ ] #3 Verification/static-analysis gates pass.
- [ ] #4 Final checkpoint lists the exact typed fields accepted and proves raw argv/options are not part of the board boundary.
