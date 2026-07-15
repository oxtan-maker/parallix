---
id: TASK-2221
title: Decide the trust boundary for mission-declared gates
status: backlog
assignee: []
created_date: '2026-07-11 00:00'
labels:
  - adr
  - security
  - architecture
  - guardrail
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`runDeclaredGates()` reads command text from an agent-editable `MISSION.md` file and executes it through `bash -c`. Its current “validation” checks delimiter balance and apparent file existence, but does not and cannot sanitize general shell syntax. The product needs an explicit decision about whether mission-authored commands are trusted code, require operator approval, or must resolve to repository-owned gate definitions.

Create ADR 0051 to define this authority boundary before changing runtime behavior. The ADR must distinguish syntax/path preflight from security validation, reconcile the decision with ADR 0031, ADR 0041, and ADR 0048, and leave implementation work as explicitly identified follow-up tasks rather than mixing policy and code in this mission.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Add `docs/adr/0051-mission-declared-gate-trust-boundary.md` and register it in `docs/adr/index.md`
- [ ] #2 Document the current end-to-end authority and data flow: who can modify `MISSION.md`, when it is committed/reviewed, how gate lines are parsed, and where `bash -c` executes them
- [ ] #3 State explicitly that balanced-delimiter and path-existence checks are syntax/path preflight, not shell-command sanitization
- [ ] #4 Evaluate at least four alternatives: unrestricted mission-declared shell commands, explicit per-run operator approval, repository-owned named gate IDs, and a restricted argv/allowlist model
- [ ] #5 Compare alternatives on agent autonomy, non-interactive execution, backwards compatibility, auditability, command expressiveness, cross-platform behavior, and resistance to malicious or hallucinated commands
- [ ] #6 Choose one model and define concrete invariants for trusted instruction sources, approval ownership, fail-closed behavior, logging/audit evidence, and the emergency escape hatch
- [ ] #7 Define migration behavior for existing `## Gates` mission content, including whether legacy shell commands warn, require approval, fail, or remain supported behind an explicit compatibility setting
- [ ] #8 Reconcile the decision with ADR 0031's instruction authority, ADR 0041's repository-owned integration gates, and ADR 0048's declared-gate pre-validation control
- [ ] #9 Identify bounded follow-up implementation and documentation missions with dependencies on this ADR; do not modify gate execution behavior in this mission
- [ ] #10 Run `./scripts/verify-local.sh docs` and link-check or equivalent documentation verification successfully
<!-- AC:END -->

## Out of Scope

- Implementing the selected gate-execution model
- Changing `runDeclaredGates()` or integration pipeline configuration
- General sandboxing of AI agent processes
- Redesigning verification gates unrelated to mission-declared commands

## Codex Pre-Draft

**Goal:** produce ADR 0051 as a decision record, not a partial security implementation. Establish who authorizes a gate command, what validation can honestly guarantee, and how existing mission gate text migrates.

**Scope and proof:** trace `MISSION.md` creation, commit/review ownership, gate parsing, and `bash -c` execution; compare the four required models against the stated criteria; select one model with fail-closed, audit, compatibility, and emergency-escape invariants; list bounded follow-up tickets. Update the ADR index and run the docs gate.

**Checkpoints:** (1) evidence-backed current-state/data-flow inventory; (2) alternatives matrix and proposed decision; (3) ADR/index finalization and documentation verification.

**Stop rule:** do not change gate execution, silently claim shell sanitization, or choose a trust model without recording the operator authority and legacy-command migration consequence.

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
