---
id: TASK-2724
title: Fix configuration propagation gaps in board and agent discovery
status: done
assignee: [codex]
created_date: '2026-10-12 04:23'
updated_date: '2026-10-12 04:24'
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
- [ ] #6 First-run agent autodetection and px config --write receive the composition configuration throughout their launcher probes. Retained focused regressions cover installed launchers available only on supplied PATH, fully empty detection, partial detection and preservation of existing config on implicit runs.
- [ ] #7 Claude provider-transcript retention searches the same composition-supplied home as the launcher and confinement paths. A focused isolated regression with a supplied home different from the process home proves the native transcript is retained without reading or modifying real provider state.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Follow-up audit of TASK-2668.08 confirmed additional callers of migrated APIs that omit the composition configuration. (1) src/adapters/agents/first-run-config.ts filterEligible calls workflowLauncherStatus(agent, worktree) without configuration; FirstRunAgentConfigOptions has no configuration field. Both the implicit hook in src/composition/create-cli.ts ensureWorkflowAgentConfig and explicit px config --write in src/adapters/cli/commands/config.ts reach this path. Actual launcher-status reproduction on this host: Codex and Claude each report supported=false, health=missing with default configuration, and supported=true, health=ok with resolveConfiguration(process.env). First-run consequences: fully empty detection skips writing and emits a misleading no-agent warning on explicit write; partial detection can persist eligibility lists excluding installed families. Existing working-tree configs remain untouched by the implicit hook. (2) src/adapters/agents/run-session.ts transcriptRoot calls claudeProjectDir(worktree) without the configuration already available in createRunSession. TASK-2668.08 changed claudeProjectDir from os.homedir() to configuration.storage.homeDirectory || os.homedir(). Under a composition-supplied HOME different from the process home, launch/confinement uses the configured path but retention searches the default home, potentially omitting the native Claude transcript. This conditional gap is established by call tracing; no real provider session or HOME was changed. Other default-configuration callsites were observed but are not asserted as confirmed defects without tracing their production reachability and behavior. Keep any further audit bounded to configuration propagation changed by 5f1e5b06ed; require evidence before expanding scope.
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
