---
id: TASK-2488
title: Split px --help into core and advanced sections
status: done
assignee: [custom]
created_date: '2026-09-11 08:35'
labels:
  - devex
  - cli
  - docs
  - user_value
dependencies: []
references:
  - src/interfaces/cli/runtime.ts
documentation:
  - docs/designs/reposition-as-trust-layer.md
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`px --help` prints twenty-five commands under a single "Core Commands" heading, plus a utility section and a block of notes. A first-time operator has no way to tell which three commands constitute the path to first value and which twenty-two are situational recovery, inspection, and integration tooling.

This matters for adoption specifically. The status quo Parallix is displacing is a hand-rolled arrangement of `git worktree` and tmux in roughly twenty lines of shell, and the reason it is hard to displace is that its owner can read all of it. A flat list of twenty-five commands is the opposite reading experience, on the surface a stranger sees within seconds of installing.

The lifecycle commands a first mission actually requires are a small subset. Most of the rest, including conflict resolution, rebasing, recovery, cancellation, statistics, configuration printing, the board views, and the alias table, are things an operator reaches for once they have a reason to.

The commands themselves are not changing, only how the help output is grouped and ordered. Any existing tests that assert on help text will need updating alongside.

This was raised during a CEO plan review of the trust-layer repositioning work and deferred as lower priority than the repositioning itself, but it sits on the same first-run surface.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 px --help distinguishes the commands needed for a first mission from situational and advanced commands
- [ ] #2 The commands needed to complete one mission end to end appear first and are identifiable without reading the whole list
- [ ] #3 No command is removed from the help output
- [ ] #4 No command behaviour changes
- [ ] #5 Tests that assert on help output are updated and pass
- [ ] #6 Any documentation that reproduces the help output is updated to match
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
