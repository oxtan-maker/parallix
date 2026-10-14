---
id: TASK-2744
title: >-
  Preserve composed environment through handoff rebase and repair so installed
  Codex is detected
status: done
assignee: [codex]
created_date: '2026-10-14 11:03'
labels:
  - bug
dependencies: []
priority: high
ordinal: 239008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Nested handoff/rebase/repair paths lose the composition-owned configuration and falsely report installed agents as missing. Observed on 2026-10-14 while task-2712 rebased shared files. This defect exists on main; git diff main...mission/task-2712 is empty for the affected handoff, launcher-probes, rebase-workflow-adapter, execute-mission-adapters and repair-handoff files. Task-2712 did not introduce it.

Title: Handoff rebase loses composed environment and falsely reports NVM-installed agents missing

Observed: 2026-10-14, task-2712. Shared-file rebase conflicts cannot launch pinned codex, despite Codex being installed and present in the initiating process PATH.

Evidence:
- Integration PID 417882 and tmux launcher PID 418016 both inherit /home/magnus/.nvm/versions/node/v24.21.0/bin in PATH.
- In one process, workflowLauncherStatus('codex') returns supported=false, health=missing; passing resolveProcessConfiguration() returns supported=true, health=ok.
- DEFAULT_CONFIGURATION.forwardedEnvironment is {}. launcher-probes.ts passes that object as spawnSync env for bash command -v and launcher health. This replaces the inherited environment; Bash falls back to its default PATH, excluding NVM binaries.

Broken propagation boundaries:
- src/adapters/cli/commands/handoff.ts createHandoffPorts(configuration), rebase.rebaseBeforeReviewRound forwards options without configuration in rebaseWorkflowOptions.
- src/adapters/review/rebase.ts constructs createRebaseWorkflowPort from rebaseWorkflowOptions, hence probes and launches receive no composed configuration.
- src/adapters/mission/execute-mission-adapters.ts createDefaultExecuteMissionRuntime exposes bare performHandoff and repairHandoff, losing its configuration.
- src/adapters/cli/commands/repair-handoff.ts calls rebase without configuration.

Expected: The composition-owned configuration reaches every nested handoff, repair, rebase, launcher probe and launch. Missing executables must reflect the actual launch environment.

Proposed fix: Thread configuration through these existing adapter boundaries; preserve caller rebase seams. Add regression cases to owning handoff/rebase/runtime suites that assert the exact injected configuration reaches probes and launches. Avoid adding ambient process.env reads below composition.

Tmux is not required to reproduce. Other environment loss may still exist; the observed PATH in the live parent and launcher rules out an initial missing NVM PATH for this incident. The additional Swedish merge error is a dry merge attempted during an existing conflicted rebase; the fallback successfully classified shared files.

Mission recovery: Resolved conflicts preserving both documentation and landing-tree gates and configured gate rebound. Rebase completed with no remaining unmerged files. Landing-tree checks: 66 pass. Focused repository-gates and squash-payload integration checks: 40 pass. Docs pass.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Retain a focused regression in the existing owning suite that fails on parent behavior: nested handoff rebase receives the injected configuration and can probe the pinned agent in its intended environment.
- [ ] #2 Thread the same composition-owned configuration through execute runtime handoff, automatic handoff repair, nested rebase, availability probes and actual agent launches; preserve adapter boundaries and avoid ambient environment reads below composition.
- [ ] #3 Prove environment isolation and caller-provided rebase seams remain intact; an actually missing executable must still fail accurately.
- [ ] #4 Manually exercise the public handoff/rebase conflict flow in an isolated disposable repository with a launcher available only in the supplied PATH; record successful detection and conflict-resolution launch without touching production mission state.
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
