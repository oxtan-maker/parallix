---
id: TASK-2217
title: Extract stats report rendering from the stats command
status: refined
assignee: [custom]
created_date: '2026-07-11 00:00'
labels:
  - refactor
  - maintainability
  - user_value
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`stats.ts` is roughly 2,200 lines and mixes CSV persistence, data normalization, historical inference, aggregation, CLI parsing, and terminal rendering. Extract one cohesive presentation seam so the command becomes easier to change without altering stats behavior.

Move the weekly/range table-formatting and report-rendering helpers into a focused module such as `lib/commands/stats-report.ts`. Keep aggregation, persistence, historical inference, and CLI dispatch in `stats.ts`. This is a behavior-preserving extraction, not a report redesign.

Target change size: 250-500 total added plus deleted lines in the final diff, including tests and generated runtime artifacts. If the extraction cannot remain in that range, narrow the helper set rather than expanding the mission.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Extract a cohesive report-rendering slice from `stats.ts` into one focused module; preferred candidates are `formatStatsTable`, report-window renderers, and their presentation-only helpers
- [ ] #2 Keep CSV I/O, row normalization, historical implementer/fix-round inference, telemetry accumulation, and CLI argument parsing in `stats.ts`
- [ ] #3 Preserve the existing public exports from `stats.ts` so callers require no migration
- [ ] #4 Existing weekly, range, and mission-phase report output remains byte-for-byte compatible for covered fixtures
- [ ] #5 Add or adjust focused tests that exercise the extracted module directly and prove the compatibility contract through the original `stats.ts` entry points
- [ ] #6 The final diff contains 250-500 added plus deleted lines as reported by `git diff --numstat` (excluding `graphify-out/`); if outside the range, document why in the final checkpoint and reduce scope where feasible
- [ ] #7 Run `./scripts/verify-local.sh static-analysis` and the focused stats tests successfully
<!-- AC:END -->

## Out of Scope

- Changing report wording, colors, columns, or date-window semantics
- Reworking CSV schemas or persistent storage
- Refactoring historical stats inference
- Introducing a new formatting dependency
- Halucinating a new architecture, follow the ADR patterns established
## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
