---
id: TASK-2737
title: Make Parallix-triggered context compaction default on with explicit opt-out
status: done
assignee: [codex]
created_date: '2026-10-13 14:36'
labels:
  - ai_sdlc
dependencies: []
priority: high
ordinal: 234008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace unconditional Parallix context-compaction instructions with a supported configuration policy that defaults on when omitted. The setting must control Parallix-triggered compaction at checkpoints, gates, and lifecycle boundaries through the existing configuration and prompt-building authority. Explicit opt-out disables the prompted compact behavior. Parallix development must leave the setting absent and inherit the ordinary on default, without repository-name checks or special development overrides. This is an implementation task following PX-0008 research and the explicit operator decision; the small research sample does not establish population-level savings. Keep provider-native near-context-limit safeguards separate: disabling Parallix-requested compaction does not disable the agent runtime safety mechanism or introduce fresh sessions. Reconcile the context-management ADR and superseded fresh-at-checkpoint proposal with this chosen policy. Research evidence: ../parallix-research/px-0008/strata-no-context-expanded/ and ../parallix-research/px-0008/frontier-checkpoint-pilot/strata-local/repairs/. No experiment runs or statistical expansion are required by this implementation task.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The public configuration schema and typed application configuration expose a validated opt-out policy for Parallix-triggered compaction; omission resolves to on, explicit enable resolves to on and explicit disable resolves to off.
- [ ] #2 All existing Parallix-owned checkpoint, gate, and lifecycle compaction instructions honor the resolved policy. Off emits no mandatory compaction request; on retains the supported compact policy. Durable mission evidence, failure diagnostics, authorization, and lifecycle rules are preserved.
- [ ] #3 The Parallix repository leaves the option unset in its self-development configuration and templates; it uses the same default-on path as consumers without any repository-specific branch.
- [ ] #4 Provider-native automatic near-limit compaction remains independently governed by the runtime configuration; this change neither disables its safeguards nor replaces retained conversations with fresh checkpoint sessions.
- [ ] #5 Focused owning-suite tests cover omitted, enabled, disabled, invalid, and supported configuration precedence cases, plus checkpoint, gate, lifecycle and self-development prompt behavior. Perform an isolated manual end-to-end launch check for both effective policies without creating production statistics.
- [ ] #6 Update operator configuration guidance and the context-management ADR to explain the default, opt-out behavior, and distinction from native near-limit compaction; reconcile superseded fresh-at-checkpoint instructions and remove obsolete unconditional code paths.
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
