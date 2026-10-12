---
id: TASK-2724
title: Fix board falsely reporting installed agent launchers as missing
status: backlog
assignee: []
created_date: '2026-10-12 04:23'
labels:
  - bug
dependencies: []
priority: high
ordinal: 222008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The live web board reports installed Codex and Claude launchers as unavailable with reason launcher missing, while px status shows both families available. Traced to commit 5f1e5b06ed (TASK-2668.08, 2026-10-09): launcher probes now use configuration.forwardedEnvironment, but the board default createLauncherProbe calls workflowLauncherStatus without the composition configuration, falling back to DEFAULT_CONFIGURATION with an empty environment. The probe loses the workstation PATH. Reproduced locally: command -v for codex and claude fails with an empty environment and succeeds with the host environment. Correct composition wiring so board launcher probes receive the intended repository configuration and forwarded environment through existing boundaries. Preserve explicit configuration authority; do not restore ambient environment reads in adapters. The shared board projection may affect both web and TUI. Reviewer selection flags and Custom signal cooldown policy are out of scope.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Web and TUI board availability probes use the composition-supplied configuration and forwarded environment, discovering installed launchers on its PATH without depending on ambient adapter environment reads.
- [ ] #2 Retain a focused regression in the owning launcher-probe or board-composition contract suite: red on parent behavior and green with the fix, using an isolated executable available only on the supplied PATH and proving composition-to-probe propagation.
- [ ] #3 Genuinely missing launchers, failed health probes, inconclusive timeout handling, real runtime blocks and block expiry retain their existing semantics; configured Custom runner resolution remains correct.
- [ ] #4 Existing launcher-probe caching remains bounded and uses the correct configuration authority; repeated refreshes do not revert to an empty environment or falsely mark installed launchers unavailable.
- [ ] #5 Run focused owning contract checks and static-analysis; manually exercise the public web board API in an isolated safe setup and confirm installed launchers are available while a genuinely missing launcher remains unavailable, without changing real provider blocks or usage statistics.
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
