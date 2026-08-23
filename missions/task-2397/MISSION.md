# Mission: Fix integrate recovery for active mission with already-approved review (task-2397)

## Goal
`px integrate` must close a mission whose review was approved **outside** the
local CLI (e.g. approved directly on the Forgejo PR) while the local mission
status is still `active`. Currently it aborts with
`[FAIL] Mission state transition failed: A submitted review must be awaiting a
reviewer decision` even though an authoritative approval already exists on the
provider.

Root cause is a gap in the two recovery branches of
`recoverMissionForIntegration` (`src/adapters/cli/commands/integrate.ts`):

- Branch A (`status === 'active'`) unconditionally calls `submitForReviewFn`
  to replay the `active -> review` handoff. When the stored round is already
  `approved`, the `handoff-command-use-case.ts` `priorReview` path returns the
  review unchanged; `decideMission` then runs `submit-for-review` against that
  already-`approved` round and throws at `src/domain/mission-workflow.ts:97`
  because the guard requires `reviewStatus(command.review) === 'awaiting-review'`.
- The workflow guard's idempotency short-circuit only fires when
  `mission.status === 'review'`. An `active` mission carrying an already-decied
  round is neither idempotent nor re-submittable, so there is no valid path
  from `active + approved review` to `integration`. The `resubmission`
  exception requires `!recordedRound.decision`, so an already-approved same-round
  resubmission is explicitly rejected rather than treated as a no-op.

Reproduction-Test: test/task-2397-integrate-active-approved-recovery.test.ts

The fix adds the missing path so Branch A recognizes an already-approved round
and drives the `approve` transition to `integration` at the stored `decidedAt`,
mirroring Branch B's behaviour without re-submitting or rewriting the round.

## Why Now
This is a live recovery dead-end: any mission approved on the provider before
the local status advanced to `review` is stranded in `active` and cannot be
integrated by `px integrate`. The failing state (`active` + `rounds[-1].decision
=== 'approved'` + `context.approval.defaultUserApproved === true`) is exactly
what Branch A hits. It is pre-existing recovery/workflow code (blame traces to
the task-2378 / task-2376 / task-2357 era) and is **not** introduced by the
bounce-kernel mission task-2377.05, whose only edit to `integrate.ts` was the
F3 implementer resolution guard — so the fix stays scoped to recovery and the
workflow guard and does not touch bounce logic.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: regression in `px integrate` lifecycle recovery; stranded
  missions in `active` with an authoritative provider-side approval;
  acceptance criteria #1–#6 in the backlog task.

## Scope
- Fix Branch A of `recoverMissionForIntegration` in `src/adapters/cli/commands/integrate.ts`
  so an `active` mission whose latest review round is already `approved` skips
  the `submitForReview` replay and transitions to `integration` at the stored
  `decidedAt`, preserving the recorded decision, its `decidedAt`, and the
  reviewed change/PR.
- Fix the `submit-for-review` guard in `src/domain/mission-workflow.ts` so an
  `active` mission carrying an already-decided round is treated idempotently
  (no-op, no rewritten round, no lane event) instead of throwing.
- Add a focused reproduction test that locks the bug (red before, green after).
- Preserve Branch B (`status === 'review'`) externally-approved recovery:
  its timestamp/override behaviour stays intact.

## Out of Scope
- Any change to the bounce-kernel (task-2377.05) logic in `integrate.ts`.
- New `px` subcommands, flags, or CLI surface.
- Rewriting the Forgejo provider sync or handoff composition.
- Changing behaviour for genuinely fresh (`awaiting-review`) rounds, for
  `request-changes`, or for missions without an authoritative approval.
- Touching `mission-workflow.ts` guards outside the `submit-for-review` case.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- #1 `recoverMissionForIntegration` on an `active` mission whose
  `review.rounds[-1].decision.kind === 'approved'` (with a `decidedAt`) and
  `context.approval.defaultUserApproved === true` returns
  `{ recovered: true, status: 'integration', occurredAt: <decidedAt> }` and does
  **not** throw `IntegrationAbort` with "A submitted review must be awaiting a
  reviewer decision". Verified by the reproduction test
  `test/task-2397-integrate-active-approved-recovery.test.ts` turning green and by the existing `integrate.test.ts` recovery suite.
- #2 The recovery does **not** call `submitForReview` for the already-approved
  round and does not rewrite it: the loaded mission after recovery has
  `review.rounds[-1].decision.kind === 'approved'`, the same `decidedAt`, and the
  same reviewed change/PR as before. Verified by an assertion in the
  reproduction test capturing the round before and after the call.
- #3 A genuine fresh submit-for-review (`review.rounds[-1]` still
  `awaiting-review`) still transitions `active -> review` unchanged. Verified by
  the existing `integrate.test.ts` recovery test that submits through the
  handoff operation (the R5 branch) and by `integrate-workflow-gate.test.ts`.
- #4 Branch B (`status === 'review'`) externally-approved recovery keeps
  passing: the human override is recorded at its own `decidedAt` and the
  `approve` transition runs at that same time. Verified by
  `integrate.test.ts` recovery tests asserting lane-event `occurred_at` equals
  the stored approval time.
- #5 The focused reproduction test `test/task-2397-integrate-active-approved-recovery.test.ts`
  exists, reproduces the `active + approved` recovery, and asserts the mission
  reaches `integration` with the approval decision intact.
- #6 `./scripts/verify-local.sh static-analysis` passes on the final tree.

## Risks and Assumptions
- Assumption: an `active` mission whose latest round is already `approved` is a
  real approval that should drive `approve`, not a stale round to re-submit.
  If a future state ever carries `active` + `approved` without a provider
  approval, the guard in AC #3 (fresh round only) and the override-recorded
  requirement keep that from being mis-handled.
- Risk: widening the workflow guard's idempotency to `active` could mask a
  genuine re-submission. Mitigate by scoping the no-op to the exact
  `status === 'active' && recordedRound.decision` case, mirroring the existing
  `status === 'review'` short-circuit.
- Risk: touching `mission-workflow.ts` affects every transition path; run the
  full `integrate` and workflow-gate suites, not only the new test.

## Checkpoints
- CP 1: Reproduction test locks the bug. Author `test/task-2397-integrate-active-approved-recovery.test.ts`.
- CP 2: Fix Branch A recovery in `integrate.ts` to skip re-submit for an already-approved round and drive the `approve` transition.
- CP 3: Fix the `submit-for-review` guard in `mission-workflow.ts` so an `active` mission with an already-decided round is idempotent.
- CP 4: Goal Check — all acceptance criteria #1–#6 pass with durable evidence.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `npm test -- test/task-2397-integrate-active-approved-recovery.test.ts` ``, `` `px review <slug> --verify` ``, or `` `./scripts/verify-local.sh all` ``
  2. **Test names** — must match a test name in the repo (find them with `` `grep -rn "test(" test/integrate.test.ts` ``)
  3. **Test file paths** — e.g., `test/task-2397-integrate-active-approved-recovery.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0039` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above. This is the weak-agent failure mode: raw `ls`/`stat` output or a sentence like "the test passes" alone is **not** evidence. Pair any shell output with one accepted reference — e.g. `` `npm test -- test/task-2397-integrate-active-approved-recovery.test.ts` `` returning the green test name, or `` `./scripts/verify-local.sh static-analysis` `` returning a clean report.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Reproduction test locks the bug | `test/task-2397-integrate-active-approved-recovery.test.ts`, `` `npm test -- test/task-2397-integrate-active-approved-recovery.test.ts` `` | PASS |
| Fix Branch A recovery | `src/adapters/cli/commands/integrate.ts` | PASS |
| Fix workflow guard | `src/domain/mission-workflow.ts:97` | PASS |
| Static analysis clean | `` `./scripts/verify-local.sh static-analysis` `` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh static-analysis

## Restricted Areas
- Do not modify the bounce-kernel logic introduced by task-2377.05 in `integrate.ts`.
- Do not add new CLI subcommands, flags, or `px` surface.
- Do not touch Forgejo provider sync, handoff composition, or any
  `mission-workflow.ts` guard outside the `submit-for-review` case.
- Do not change behaviour for genuinely fresh (`awaiting-review`) rounds, for
  `request-changes`, or for missions without an authoritative approval.

## Stop Rules
- Stop before implementing; this draft produces the contract only.
- Do not run tests beyond the single `./scripts/verify-local.sh all` gate.
- Do not push the mission branch to `origin`; only `main` may push to origin.
- Stop if the reproduction test path must change; keep `Reproduction-Test:` accurate.
