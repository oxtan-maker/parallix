---
id: TASK-2850
title: >-
  Require resolved execution context in review preparation and drop ambient cwd
  fallbacks
status: done
assignee: [custom]
created_date: '2026-11-11 09:58'
labels:
  - ai_sdlc
  - context-migration
dependencies: []
priority: high
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Part 1 of 3, split from wave child px-0042.03 (cancelled: its CP-1 trace estimated 250-350 NEL, above the 235 Medium ceiling, and wave children cannot be split again). Parts 2 and 3 are separate tasks that depend on this one. Each part is Medium (81-235 NEL including tests and deletions); re-estimate after tracing and stop for an operator decision rather than force-fit if it comes out Large.

## Goal
Review-preparation mutations use the explicitly resolved execution context supplied by their production callers. Remove the optional `executionContext?` and the `worktree || resolveWorktree(slug) || process.cwd()` cascades from the review-preparation port, executor, command use case and CLI adapter.

## Why
Optional context makes an omitted propagation compile and reintroduces the wrong-checkout/default-environment bugs (PX-0034: wrong-checkout integration, nested configuration loss) after the partial migration done in px-0042.01 (7c3dd4626) and px-0042.02 (eb3a7df62). Complete the existing context contracts; do not add a parallel context system.

## Traced sites (from the px-0042.03 CP-1 trace; re-verify against current source)
- src/application/ports/review-preparation-workflow.ts: `PerformReviewPreparationOptions.executionContext?` and `ReviewPreparationRebaseOptions.executionContext?`.
- src/application/review-preparation-executor.ts: performReviewPreparation, prepareStart, verifyReviewPreparation and validateReviewPreparationRequest each use `worktree || missionUtils.resolveWorktree || process.cwd()`.
- src/application/review-preparation-command-use-case.ts: writeFallbackSummary uses `options.rootDir || resolveWorktree || process.cwd()`.
- src/adapters/cli/commands/review-preparation.ts: agents.startAgent onLaunch uses `options.worktree || process.cwd()`.
- Production callers already hold a live context: src/adapters/mission/execute-mission-adapters.ts, src/composition/production-capabilities.ts, src/composition/cli-lifecycle-commands.ts, src/composition/application-services.ts.
- Retained-assertion owners: test/unit/composition/configuration-propagation.test.ts, test/unit/interfaces/cli/mission-context-discovery.test.ts, test/unit/adapters/cli/commands/integrate-landed-closeout-recovery-contract.test.ts, test/helpers/review-preparation-ports.ts runOptions, test/helpers/mission-mutation-context.ts. About 25 test files call performReviewPreparation (test/integration/mission/review-preparation.test.ts alone has 33 calls) and are not yet traced per assertion.

## Scope
Make the context required on the review-preparation path and delete the ambient fallbacks listed above. Permit process.cwd/config discovery only at explicitly identified entry or read-only boundaries; do not ban ambient reads repo-wide. Preserve installed CLI behavior, custom bases, lost/cleaned worktree recovery, credential handling, async failure identity and no-side-effect rejection. Migrate the affected tests to the required context while keeping every distinct assertion.

## Contract
Read ADRs 0037, 0051, 0053 and 0057 first, plus the sibling tasks. Domain rules stay pure; application use cases observe facts and sequence effects through typed ports; composition wires adapters. Before edits, record a finite behavior/caller matrix as px checkpoint evidence (source and assertion references for every relevant branch, including error, fallback, restart and compatibility branches); not a production registry or permanent doc. Preserve each distinct assertion unless a contract change is explicitly approved; link every replaced behavior to a retained assertion and its new owner; delete redundant tests only after mapping. Surface contradictions rather than silently choosing policy. Reuse current owners; no parallel dispatcher, shadow state machine, catch-all utility or dual-write fallback. No any, as never, unsafe double casts or optional production dependencies hiding incomplete wiring. A temporary bridge must delegate to the new owner, name its exact callers and the removal task (TASK-2852). Keep typed failure identity, reviewer/implementer identity, revision/evidence binding, CAS, atomic lifecycle/event writes and operator authority. Do not add, restore, weaken or retune verification gates, budgets or tiers; no architecture-principle changes without the explicit operator decision required by AGENTS.md. Update live docs only for changed behavior.

## Out of scope
Review adapters under src/adapters/review (part 2); rebase adapter and final bridge deletion (part 3); unrelated terminal, metrics, storage-schema, provider-quota or verification-policy redesign; any claim of measured bug-frequency improvement.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Production review-preparation mutation paths take a required resolved execution context; the listed worktree/rootDir/process.cwd cascades and optional executionContext? on the review-preparation port are gone, with no production caller left on them.
- [ ] #2 Before edits, checkpoint evidence maps each replaced branch, production caller and distinct existing assertion to its retained behavior and new owner; contradictions are resolved explicitly.
- [ ] #3 Every distinct existing assertion is retained in its owning suite (extend existing suites, unit-first; no new integration suite without an uncovered boundary; no integration test over 3.5s; no numeric task-ID suite).
- [ ] #4 Focused owning-suite checks and unit headroom (npm test -- --unit-test-headroom) pass; no gate, budget or tier change.
- [ ] #5 A manual check from a different checkout, using a temporary repository and isolated state, shows review preparation targeting the correct mission and base and rejecting without side effects; actual commands, results and cleanup are recorded; no operator DB, real PR or statistics writes.
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
