---
id: TASK-2852
title: >-
  Remove rebase ambient context fallbacks and delete superseded context bridges
  and overloads
status: backlog
assignee: []
created_date: '2026-11-11 09:58'
updated_date: '2026-11-11 09:58'
labels:
  - ai_sdlc
  - context-migration
dependencies:
  - TASK-2850
  - TASK-2851
priority: high
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Part 3 of 3 (final), split from wave child px-0042.03 (cancelled: its CP-1 trace estimated 250-350 NEL, above the 235 Medium ceiling, and wave children cannot be split again). Depends on TASK-2850 (part 1) and TASK-2851 (part 2, review adapters). Each part is Medium (81-235 NEL including tests and deletions); re-estimate after tracing and stop for an operator decision rather than force-fit if it comes out Large.

## Goal
Finish the context migration: the rebase adapter uses the explicitly resolved execution context, and every superseded implementation, temporary bridge, optional-context overload and dead helper left by the first two children of wave px-0042 and by parts 1 and 2 is deleted. Close with a consumer audit.

## Why
Optional context makes an omitted propagation compile and reintroduces the wrong-checkout/default-environment bugs (PX-0034: wrong-checkout integration, nested configuration loss). This is the final cutover; no dormant alternative or dual-write fallback may remain.

## Traced sites (from the px-0042.03 CP-1 trace; re-verify against current source)
- src/adapters/rebase/rebase-workflow-adapter.ts: `cwd` and `launchIdentityOptions` cascade `options.executionContext || rootDir || process.cwd()`.
- src/application/rebase-context.ts resolveRebaseLocation (`context?`) is the `px rebase` entry resolver and recursion carrier: a candidate supported entry boundary, not a removal target. Decide and record explicitly.
- Any bridge left by parts 1 and 2 (they name their callers and point to this task for removal), plus any remaining optional `executionContext?` on ports, adapters, runtime types and test helpers (test/helpers/review-preparation-ports.ts, test/helpers/mission-mutation-context.ts).
- Production callers already hold a live context: src/adapters/mission/execute-mission-adapters.ts, src/composition/production-capabilities.ts, src/composition/cli-lifecycle-commands.ts, src/composition/application-services.ts.
- Retained-assertion owners: test/unit/composition/configuration-propagation.test.ts, test/unit/interfaces/cli/mission-context-discovery.test.ts, test/unit/adapters/cli/commands/integrate-landed-closeout-recovery-contract.test.ts.

## Scope
Remove the rebase adapter cascade; audit all production callers of the migrated context APIs and every temporary bridge from the earlier children; delete obsolete mutation overloads, defaults, dead helpers and redundant tests only after assertion mapping. Permit process.cwd/config discovery only at explicitly identified entry or read-only boundaries (px rebase entry, read-only convenience, proven landed recovery); do not ban ambient reads repo-wide. Preserve installed CLI behavior, custom bases, lost/cleaned worktree recovery, credential handling, async failure identity and no-side-effect rejection. Final evidence separates supported read-only/entry discovery from removed mutation defaults and records complete consumer adoption.

## Contract
Read ADRs 0037, 0051, 0053 and 0057 first, plus the sibling tasks and the results of TASK-2850 and part 2. Domain rules stay pure; application use cases observe facts and sequence effects through typed ports; composition wires adapters. Before edits, record a finite behavior/caller matrix as px checkpoint evidence (source and assertion references for every relevant branch, including error, fallback, restart and compatibility branches); not a production registry or permanent doc. Preserve each distinct assertion unless a contract change is explicitly approved; link every replaced behavior to a retained assertion and its new owner; delete redundant tests only after mapping. Surface contradictions rather than silently choosing policy. Reuse current owners; no parallel dispatcher, shadow state machine, catch-all utility or duplicate source of truth. A helper is not delivered until production callers use it. No any, as never, unsafe double casts or optional production dependencies hiding incomplete wiring. Keep typed failure identity, reviewer/implementer identity, revision/evidence binding, CAS, atomic lifecycle/event writes and operator authority. Do not add, restore, weaken or retune verification gates, budgets or tiers; no architecture-principle changes without the explicit operator decision required by AGENTS.md. Update live docs only for changed behavior.

## Out of scope
Review preparation (TASK-2850) and review adapters (part 2) migrations; unrelated terminal, metrics, storage-schema, provider-quota or verification-policy redesign; any claim of measured bug-frequency improvement.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The rebase adapter takes a required resolved execution context; the options.executionContext || rootDir || process.cwd() cascades are gone, with no production caller left on them.
- [ ] #2 Search and call tracing finds no obsolete mutation overload, bridge, unchecked cast, optional argument or catch fallback that reinstates ambient context; deleted helpers have no production callers.
- [ ] #3 The px rebase entry resolver and any other remaining ambient read are listed as explicit entry or read-only boundaries, separate from removed mutation defaults, in checkpoint evidence.
- [ ] #4 Redundant tests are deleted only after each distinct assertion is mapped to a retained owning-suite case; focused owning-suite checks and unit headroom pass; no gate, budget or tier change, no integration test over 3.5s.
- [ ] #5 A manual check from a different checkout, using a temporary repository and isolated state, shows rebase and landed-cleanup scenarios targeting the correct mission and base and never mutating the wrong checkout or operator state; actual commands, results and cleanup are recorded.
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
