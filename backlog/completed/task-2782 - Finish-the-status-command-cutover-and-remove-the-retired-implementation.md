---
id: TASK-2782
title: Finish the status command cutover and remove the retired implementation
status: done
assignee: [codex]
created_date: '2026-10-19 09:54'
labels: []
dependencies: []
ordinal: 263008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Make the currently composed status command the sole implementation and move useful tests off src/adapters/cli/commands/status.ts before deleting that retired module.

Context:
Read ADRs 0051 and 0053 and the status-adapter migration in commit aafd1221. Preserve later TASK-2593 checkpoint/evidence display and TASK-2731 classification output, plus current timestamp, configuration and review-repair behavior. Follow TASK-2622.19's test ownership policy.

Success criteria:

1. The production path remains cli-read-commands composition, StatusCommandUseCase, the CLI interface and status-adapter. Migrate still-relevant assertions to that path, using its actual composition where the boundary is under test.
2. Remove the retired status implementation and duplicated worktree parsing/stale-worktree handling. Correct single-path-guardrail.test.ts so it no longer requires the retired file or accepts an obsolete alternative.
3. Preserve current CLI text, supported JSON and exit contracts, checkpoint/evidence history, classification unset/unknown states, review information and stale/unavailable-source handling. Preserve SQLite authority and explicit configuration injection.
4. Demonstrate retained behavioral assertions and actual status output with focused owning tests and a disposable public CLI check. Finish with no production or test caller depending on the retired command; do not add a compatibility wrapper that keeps both implementations alive.
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
