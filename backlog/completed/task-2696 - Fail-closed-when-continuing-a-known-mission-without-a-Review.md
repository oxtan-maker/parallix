---
id: TASK-2696
title: Fix command termination allowing execution after failure
status: done
assignee: [codex]
created_date: '2026-10-09 07:44'
labels:
  - bug
dependencies: []
priority: high
ordinal: 200008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Fix the command termination contract that allows failed CLI operations to continue executing. The task-2668.08 review transcript is the motivating reproduction: `px review --continue` reports missing-review failures, then selects a reviewer and enters round 1 before persistence fails.

Confirmed source evidence: the composed CLI supplies exit callbacks in `runBareCommand` and `runTargetCommand` that record a status and return, then casts them to a `never` return type. CLI callers receive a callback presented as terminating even though it returns. Separately, `ReviewWorkflowAdapter` discards intervention/blocker helper results, and `ReviewRoundUseCase.continue` invokes those helpers before loading the Review; its guard admits a known Mission without a Review. These are interacting defects. A missing-Review guard alone would patch this entry condition while leaving the termination mismatch intact.

Make command termination reliable at the existing CLI/composition boundary, with the original status returned to the owning caller and cleanup allowed to complete. Determine the bounded mechanism from existing contracts; do not prescribe a blanket `process.exit`, a generic exception that is mistaken for an unexpected error, or a repository-wide port redesign. Audit catch boundaries and nested command execution so intentional termination cannot be swallowed or mistaken for success. Retain explicit handling of failed review prerequisites where the injected callback is allowed to return.

Product risk: execution after a reported failure can launch agents or mutate state. Killing the process to fix that can instead skip current-work cleanup or terminate a board/supervisor hosting an in-process command. Both outcomes must be prevented. Ordinary success termination and nonzero statuses must retain their meaning; real unexpected errors must remain visible.

Keep the missing-Review scenario as a regression: reject continuation before intervention/blocker mutation, provider access, reviewer selection, agent launch, or round persistence, with one diagnostic and appropriate `--start` guidance. Preserve valid continuation and handoff readiness checks. The task-2668.08 record being active with unchecked criteria does not establish Review state loss or criteria reset; do not fabricate recovery or approval evidence.

Scope is command termination and the directly affected review prerequisite chain. Record the audited scope and any independently confirmed remaining defects. Preserve existing ports/adapters and composition authority. If a boundary or dependency-direction change proves necessary, stop dependent implementation and obtain the repository-required subsequent architecture decision with evidence, alternatives, and behavioral risks.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Retain a focused red-to-green regression through production CLI composition proving that a requested command exit stops subsequent command work, preserves the exact exit status (including success), and returns through owner cleanup without terminating the host process.
- [ ] #2 Fix the returning-callback/terminating-contract mismatch at the existing command boundary; verify relevant catch boundaries and nested execution preserve intentional termination while unexpected errors remain failures. No returning callback is falsely cast as `never` in the changed composition paths.
- [ ] #3 A known Mission without a Review is rejected once before intervention/blocker mutation, provider access, reviewer selection, agent launch, or persistence. Retain regression coverage for a returning exit callback and failed prerequisite results; valid existing-Review continuation still works.
- [ ] #4 Audit directly affected review resume paths and command termination owners; record confirmed scope and remaining defects with source evidence. Preserve handoff success-criteria checks and distinguish missing Review from proven state loss.
- [ ] #5 Manually exercise the composed command end to end with isolated state and safe boundary doubles, demonstrating failure stops work and valid execution still works, without touching live Mission statistics, provider state, or the real database.
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


## Locked mission implementation and audit

The application-owned locked mission targets missing-Review continuation and
its directly affected prerequisite chain. The implementation rejects a null
persisted round before intervention/blocker helpers in
`src/application/review-round-use-case.ts`. The adapter supplies a genuinely
terminating, invocation-local helper exit callback and consumes only its own
stop signal; unexpected exceptions propagate. No application port or dependency
direction changes are needed.

Audited paths:

- `src/adapters/review/review-intervention-commands.ts`: `--resume` returns after
  helper failure; missing store, failed load, missing Review, and missing actor
  all have explicit returns. Normal non-intervened reviews are successful no-ops.
  `--continue` formerly discarded helpers' ambiguous no-op/failure values;
  adapter-local termination now stops before the next helper or loop binding.
- `src/application/review-loop/review-loop.ts`: `prepareStart` returns null after
  provider or handoff failure, and its caller returns before reviewer selection.
  Failed store reads propagate. State resume itself is a pure conversion through
  `ReviewState.from` in `src/adapters/review/review-loop.ts`.
- `src/composition/create-cli.ts`: bare and target dispatch now use an
  invocation-local termination boundary. Requested exits throw an identity
  consumed only by its owning invocation; owner `finally` blocks run before
  the exact status returns. Integration-owned re-review uses its own boundary,
  and nonzero exits cannot be mistaken for approval. Unexpected errors propagate
  to the existing failure reporter. Review parser catches surround parsing only;
  review prerequisite catches surround store access only. The review adapter
  consumes only its own helper stop identity and rethrows outer termination.
- `src/application/review-command-use-case.ts`: observes the precise value thrown
  by the injected exit, publishes success as ended and nonzero exit as blocked,
  then rethrows for owner cleanup. Unexpected errors retain their diagnostic.
- `--start` retains its handoff readiness checks. The existing incomplete-criteria
  rejection in `test/unit/adapters/cli/commands/mission-handoff-verification-contract.test.ts`
  stays green. Missing Review is not evidence of state loss or criteria reset.

Parent-red regressions remain in the owning review-round and CLI adapter suites.
Manual composed CLI checks used isolated in-memory Missions, production review
persistence bindings, and doubled external mechanisms: missing Review produced
one failure and zero downstream effects; valid persisted-review dry-run reached
reviewer prompt rendering with no agent launches or Mission writes. Verification
commands and measurements are recorded in application-owned checkpoints.

## Follow-up verification

The production-composition exit regression fails on the parent: work after all
six requested exits executes. It passes with invocation-local termination,
including statuses 0, 1, and 23, host survival, cleanup, and unexpected failures.
The known-Mission/no-Review start contract performs a successful handoff,
launches its assigned reviewer, and reaches approval without human escalation.
The dedicated invocation suite owns termination identity and nested-owner
semantics; review workflow publication remains covered by its existing suite.
