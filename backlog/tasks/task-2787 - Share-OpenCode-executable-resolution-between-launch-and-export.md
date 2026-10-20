---
id: TASK-2787
title: Share OpenCode executable resolution between launch and export
status: backlog
assignee: []
created_date: '2026-10-19 09:56'
labels: []
dependencies: []
ordinal: 268008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace the duplicated executable search in src/adapters/agents/opencode.ts and opencode-export.ts with one small leaf resolver used by both live paths.

Context:
Preserve ADR 0051's adapter boundaries, TASK-2668.08/TASK-2711's explicit configuration ownership and TASK-2761's provider prompt transport. Keep executable resolution distinct from invocation and capture behavior.

Success criteria:

1. Launch and export use the same resolver with identical configured-path, PATH, installation-directory, candidate-deduplication, executable-check and fallback precedence.
2. Remove both copied resolver bodies. Place the common mechanism below the callers so the existing launcher-to-export dependency does not become an import cycle.
3. Preserve supplied configuration and environment, custom binary paths, fresh/resumed invocation, prompt delivery, transcript export, cancellation and confinement. Do not reintroduce ambient environment reads or change other providers' candidate policies.
4. Extend the existing owning tests using controlled executable candidates and fake launch/export boundaries, proving both production callers use the resolver. Follow current focused verification and exercise the public path with disposable fake-provider state.
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
