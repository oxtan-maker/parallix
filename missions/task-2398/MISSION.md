# Mission: `px review approve` never records an authoritative approval when the round is in `fixing` (task-2398)

## Goal
Record an authoritative `ReviewerDecision` with `decision.kind === 'approved'` on the Review aggregate whenever an `approve` verdict is recorded through `px review`, and make an `approve` that cannot legally move the current round to the `approved` phase fail loudly (non-zero exit, actionable message) instead of printing `[PASS]` after a swallowed transition error.

The regression: an `approve` verdict reports `[PASS]` but writes no authoritative `ReviewerDecision` on the Review aggregate whenever the current round's phase is not `reviewing` (e.g. `fixing`). The mission stays permanently unintegratable — `px integrate` refuses forever with:

```
[FAIL] Mission task-2380 is in review without an authoritative approval.
       Record a ReviewerDecision through px review before integration.
```

Existing aggregate state for the stuck round (`mission_review_rounds`, round 1): `decision_kind = changes-requested`, `decision_comment = APPROVED`, `disposition = APPROVED`, `phase = fixing`, `decided_at` = the *request-changes* time.

## Why Now
The bug blocks integration for any mission whose final round is stuck in `fixing` (reviewer requested changes, implementer follow-up never recorded a resolution, then a later `approve` was recorded against the still-`fixing` round). Such missions can never reach `recoveryEstablishesApproval` (`integrate.ts:868-895`), which requires `lastRound.decision.kind === 'approved'`. It is a silent no-op: `[PASS]` is printed but no authoritative decision is written, and no CLI path repairs the round.

This is pre-existing review-loop code; mission `task-2380` did not introduce it — its branch touches no review-recording code. Fixing it restores the review loop's integrity invariant: every `[PASS] approve` must correspond to an authoritative `approved` decision on the aggregate.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: regression (bug), code health, review-loop integrity

## Scope
- Add an aggregate counterpart to `approve` mirroring `recordRequestedChanges` -> `applyReviewerCommand` (`review-round.ts:86`, `review-commands.ts:906-928`): record `decision.kind === 'approved'` on the Review aggregate from both approve paths.
- `submitReviewOutcome` (`src/adapters/review/review-commands.ts`) approve path: stop swallowing the transition error; surface a non-zero exit with an actionable message when the round cannot legally reach `approved`.
- `recordReviewVerdict` (`src/adapters/review/review-artifacts.ts`) approve path: same loud-failure + authoritative-write behaviour.
- No path may leave a round with `disposition === 'APPROVED'` and `decision.kind === 'changes-requested'`.
- `REVIEW_PHASE_TRANSITIONS` (`src/domain/review.ts:129-134`) allows `fixing -> reviewing | pending-approval` only; the fix must not silently accept an illegal transition from `fixing` to `approved`.
- Document a repair path for a mission already stuck in the inconsistent state (approved disposition on a `fixing` round) that reaches integration.
- Approving a round that is legitimately `awaiting-review` stays unchanged.

## Repair path for a round already stuck in the inconsistent state

The fix refuses to write `disposition === 'APPROVED'` over a
`changes-requested` decision, and `REVIEW_PHASE_TRANSITIONS` still forbids
`fixing -> approved`. A mission whose round is **already** stuck in that
contradictory state (as `task-2380` was: `decision_kind = changes-requested`,
`disposition = APPROVED`, `phase = fixing`) therefore cannot be repaired by
re-running `px review ... approve` — that now fails loudly — and cannot be
welded to `approved` by widening the transition table. It reaches integration
by first clearing the outstanding request-changes and then approving a fresh
round, using only existing review-loop commands:

1. **Resolve the stuck round.** The implementer submits a resolution for the
   outstanding findings (`round-resolution.md` / disposition artifact, i.e.
   `applyImplementerCommand` `submit-resolution`). This moves the round to
   `pending-approval` / `ready-for-next-round` and clears the
   `changes-requested` decision that the stuck `APPROVED` disposition was
   masking.
2. **Open the next round.** The next `px handoff` begins round N+1 on the same
   pull request or local branch, which starts in `awaiting-review`.
3. **Approve the fresh round.** Record `approve` against that `awaiting-review`
   round. `recordApproval` now writes `decision.kind === 'approved'` on the
   Review aggregate and returns the Mission to `integration`, so `px integrate`
   passes the approval gate (`lastRound.decision.kind === 'approved'`).

This restores the invariant — every `[PASS] approve` corresponds to an
authoritative `approved` decision on the aggregate — without widening the legal
`fixing` transitions or adding a new CLI subcommand. A round that is
legitimately `awaiting-review` is unaffected; its `approve` records the
authoritative decision exactly as before.

## Out of Scope
- No changes to `REVIEW_PHASE_TRANSITIONS` legal edges beyond what is required to make the approve path fail loudly (do not widen `fixing` transitions as a general change).
- No changes to reviewer eligibility, stage-launch windows, or the pre-review gate.
- No changes to the Forgejo/PR posting path outside what is needed to record the aggregate decision.
- No refactoring of unrelated review-loop code (e.g. `applyImplementerCommand`, `resumeReview`).
- No new dependencies or new public CLI subcommands.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion is falsifiable and free of unqualified adjectives.

- SC1: An `approve` verdict recorded while the round is `awaiting-review` records `decision.kind === 'approved'` on the Review aggregate and the mission integrates. Falsified if `px integrate` still reports "in review without an authoritative approval".
- SC2: An `approve` recorded while the round is in `fixing` (request-changes then approve) exits non-zero with an actionable message and does NOT write `disposition === 'APPROVED'` with `decision.kind === 'changes-requested'`. Falsified if the command prints `[PASS]` and exits 0.
- SC3: Both approve paths are covered by tests: `submitReviewOutcome` (`src/adapters/review/review-commands.ts`) and `recordReviewVerdict` (`src/adapters/review/review-artifacts.ts`). Falsified if either path lacks a focused test.
- SC4: A red-to-green reproduction test locks the task-2380 state (request-changes, then approve on the `fixing` round) and asserts the resulting decision and the `px integrate` approval gate. Falsified if the test is absent or does not fail red at the parent commit.
- SC5: Approving a round legitimately `awaiting-review` is unchanged (existing `domain-review-workflow-state.test.ts` / `domain-mission.test.ts` approve behaviour preserved). Falsified if any existing approve test regresses.
- SC6: `./scripts/verify-local.sh static-analysis` passes on the final tree. Falsified if the gate reports any ESLint or `tsc --checkJs` error.

## Risks and Assumptions
- The two approve paths may record the decision through different call sites; both must be patched or a sibling caller stays broken (root-cause fix, not symptom patch).
- `recoveryEstablishesApproval` (`integrate.ts`) requires `lastRound.decision.kind === 'approved'`; the repair path for already-stuck missions must set that decision kind without widening the legal phase transitions.
- Assumption: the Review aggregate is the source of truth for integration gating; the flat `ReviewState.disposition` alone is insufficient (this is exactly the bug).
- Idempotency: a replayed approve must report `unchanged`, not rewrite the decision, mirroring `recordRequestedChanges`.

## Checkpoints
- CP 1: Reproduction test locks the bug (red) — author a focused test in `test/` that reproduces request-changes then approve on a `fixing` round and asserts the resulting decision + `px integrate` approval gate; it must fail red at the mission's parent commit.
- CP 2: Fix `submitReviewOutcome` approve path in `src/adapters/review/review-commands.ts` to record an authoritative `approved` decision and fail loudly on an illegal transition.
- CP 3: Fix `recordReviewVerdict` approve path in `src/adapters/review/review-artifacts.ts` to the same behaviour.
- CP 4: Document the repair path for a mission already stuck in the inconsistent state, and confirm `awaiting-review` approve is unchanged.
- CP 5: Run the full draft verification gate and capture proof.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `npm test -- test/task-2398-approve-fixing-round.test.ts` ``, `` `px integrate --slug task-2380` ``, or `` `./scripts/verify-local.sh static-analysis` ``
  2. **Test names** — must match a test name in the repo (e.g. a test in `test/domain-review-workflow-state.test.ts`)
  3. **Test file paths** — must be an existing test file, e.g. `test/task-2398-approve-fixing-round.test.ts`
  4. **ADR references** — e.g. `ADR 0039` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- **Weak-agent failure mode (explicit):** raw `stat`/`ls` output or generic prose alone is NOT sufficient evidence. Pair any shell output with at least one of the accepted references above (a recognized repo command, a real test name, an existing test file path, or an ADR reference). A checkpoint that only pastes `ls`/`stat` or says "the test passes" in prose will be rejected.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Reproduction test locks the bug | `test/task-2398-approve-fixing-round.test.ts`, `"approve on a fixing round fails loudly and records no approved decision"`, `` `npm test -- test/task-2398-approve-fixing-round.test.ts` `` | PASS |
| Authoritative approval on awaiting-review | `test/domain-review-workflow-state.test.ts`, `"dispositions that share a decision kind stay distinguishable"` | PASS |
| Static analysis clean | `` `./scripts/verify-local.sh static-analysis` `` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- `src/domain/review.ts` `REVIEW_PHASE_TRANSITIONS` (do not widen legal transition edges as a general change; only fail loudly).
- `src/adapters/cli/commands/integrate.ts` `recoveryEstablishesApproval` (read for the repair path; do not weaken the `lastRound.decision.kind === 'approved'` gate).
- Reviewer eligibility, stage-launch windows, and the pre-review gate.
- Any Forgejo/PR-posting code outside what is needed to record the aggregate decision.
- Do not modify source files outside `src/adapters/review/review-commands.ts`, `src/adapters/review/review-artifacts.ts`, `src/adapters/review/review-round.ts`, `src/adapters/review/review-state-mapping.ts`, `src/adapters/cli/commands/integrate.ts`, and the new reproduction test.

## Stop Rules
- Stop before implementing: this is a draft-only mission; do not write the fix or the reproduction test in this phase.
- Stop if the two approve paths route through a shared function not yet identified — re-read `review-commands.ts`, `review-artifacts.ts`, and `review-round.ts` before drafting the fix.
- Stop if `graphify-out/graph.json` is absent (do not run graphify query/path/explain; fall back to reading source directly).
- Do not run any verification gate other than the single `./scripts/verify-local.sh all` during drafting.
- Do not transition the task to `ready`; the harness does that after a clean draft.

Reproduction-Test: test/task-2398-approve-fixing-round.test.ts
