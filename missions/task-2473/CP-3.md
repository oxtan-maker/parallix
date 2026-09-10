# CP-3 — Focused coverage + repository gate

## Summary of work done

Added focused command/workflow coverage for every surface the mission enumerates,
in `test/task-2473-resume-review-repro.test.ts`:

- **non-intervened review** — a `ready-for-next-round` review is left untouched
  (`outcome === 'ready-for-next-round'`);
- **approved review carrying a stale intervention** — `reviewStatus` reports
  `approved` ahead of the stale flag, so `--resume` rejects it and the review
  stays `approved`;
- **actor attribution** — a named operator clearing a real `human-intervention`
  stop is recorded on a `human_note` review event with its identity (the
  `--actor` override is attributable, not a discarded presence check);
- **audit-event round derivation** — the `human_note` round follows the
  recovered review's current round (not hard-coded to 1); a round-2 stop
  exports a round-2 event (`records the audit event at the recovered round`);
- **non-intervened review** — a `ready-for-next-round` review is left untouched
  (`outcome === 'ready-for-next-round'`);
- **reload-does-not-resurrect round trip** — persisted `intervention === null`,
  `reviewStateDataFrom(review).metadata` omits `humanEscalationReason` /
  `humanEscalatedAt`, and `applyReviewStateToReview(review, reviewStateDataFrom(review)).intervention === null`;
- **ordinary review-command compatibility** — `--continue` and `--resume` are
  both recognized by `unknownReviewFlags`, and the existing review-command and
  workflow suites retain their outcomes.

Ran the required mission gate `./scripts/verify-local.sh all` on the final tree.

## Gate result

`./scripts/verify-local.sh all` exits 0:

- Static analysis: ESLint clean on `src/`, `npm run typecheck` (tsc --noEmit)
  clean, test-hygiene scanner clean, `tsc --noEmit --project tsconfig.test.json`
  clean.
- Docs: authored documentation contains no volatile implementation evidence and
  relative links resolve.
- Tests: 2464 pass / 0 fail / 0 skipped (per-test 1000 ms cap, suite budget
  180000 ms, elapsed ~31.7 s). Bundle 2.3 MB within the 5 MB stop rule.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Regression repro red at parent commit, green after fix | `test/task-2473-resume-review-repro.test.ts` — 9 tests, all pass; 4 failed at parent commit `96796f9a7` | Pass |
| Recovery rejects non-`human-intervention` | `rejects a review that is not in human-intervention` | Pass |
| Recovery requires authorized `--actor` | `requires an authorized --actor to clear the intervention` (missing identity rejected) | Pass |
| Clearing actor is attributed | `attributes the clearing actor to a review event` records the operator on a `human_note` event | Pass |
| Audit event records recovered round | `records the audit event at the recovered round` — round-2 stop exports a round-2 event | Pass |
| Intervention cleared on both persistence surfaces | `does not resurrect the intervention on reload` (SQLite columns + `reviewStateDataFrom` metadata) | Pass |
| Derived-status handoff runs without `MissionRuleViolation` | `lets the derived-status handoff proceed without a MissionRuleViolation` | Pass |
| Stale intervention on approved review ignored | `leaves an approved review that carries a stale intervention untouched` | Pass |
| Existing review commands/behavior retained | `test/review-commands.test.ts` (30), `test/domain-mission.test.ts`, `test/task-2322.12-review-recovery.integration.test.ts`, `test/current-work-publication.test.ts`, `test/task-2332.14-review-use-case.test.ts` all green | Pass |
| Mission gate passes on final tree | `./scripts/verify-local.sh all` exits 0 (2464 pass / 0 fail) | Pass |

## Next action

Commit `CP-3.md`. All declared checkpoints are committed and the single mission
gate passes; nothing left to hand off to review (no `px review` / `px integrate`
invoked).
