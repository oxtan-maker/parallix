# Checkpoint 3 — Persisted verdict, status surface, recovery procedure, gates

## Work done
Exercised the persisted-verdict → `px status <slug>` surface, documented the
supported recovery procedure for a mission left with a completed review but an
unrecorded verdict, and ran both mission gates on the final tree.

**Persisted verdict visible in status.** A verdict recorded by the fixed path is
written onto the Review aggregate round. Two tests cover the write→aggregate
chain end to end (neither injects `readReviewStateFn` into `postWorkflowReview`,
so a regression that drops the bound forward fails them):

- `records an approve verdict onto the current round without renumbering it`
  (`test/task-2385-stale-review-round-repro.test.ts`) exercises the real
  self-author local-verdict path (`postWorkflowReview` with a self-authoring
  PR), captures the state passed to `writeReviewState`, and asserts the
  persisted `ReviewState` carries the current round number (2, not a fabricated
  round 1) with `disposition` stamped `APPROVED` and phase `approved`.
- `records an approve verdict onto the stored round 2 through the bound
  consumption path` (same file) drives the FULL artifact-consumption seam via
  `reviewLoopBindings` with a real bound store and a self-authoring PR, and
  asserts `store.state.mission.review.rounds[1]` (round 2) ends
  `disposition === 'APPROVED'`, `phase === 'approved'`, round numbers still
  `[1, 2]`. This is the production `consumeReviewerArtifacts` →
  `postWorkflowReview` → `recordLocalReviewVerdict` chain with the reader
  forwarded the way composition does it; the missing-forward regression
  (TASK-2385 F1) makes the verdict read miss and throws, so this test is the
  one that proves the central promise that a valid verdict persists.

The status projection (`src/application/projections/mission-board.ts`,
`mission-detail.ts`) was not changed by this mission; it surfaces whatever the
mission store holds. Its formatting is covered by the pre-existing
`renderStatus` fixture (`test/status-command-use-case.test.ts`), which asserts
only that a hand-built `reviewDisposition: 'approved'` renders into the
`Review: round …, phase …, disposition approved` line — it does not itself
exercise persistence. The write→aggregate persistence is therefore asserted by
the new repro test above; the render fixture covers rendering only.

**Recovery procedure for an already-affected mission.** The defect stranded a
mission in the `review` lane with a Review aggregate present but the current
round carrying no disposition (the write failed the UNIQUE constraint and the
verdict was never stored). Supported operator recovery:

1. **Identify the unrecorded verdict.** Run `px status <slug>`; a stranded round
   shows its phase as `reviewing` and disposition as `none`/`pending` even though
   the reviewer artifacts and PR comment already landed. Confirm the completed
   approval by inspecting the mission's review artifacts / review events.
   `px review <slug> --status` reports the same lane state.
2. **Re-record the dropped verdict.** The case that actually strands missions
   is the autonomous loop path (TASK-2385 F1): the loop's own
   `consumeReviewerArtifacts` produced the approval but never forwarded the
   bound reader to `recordLocalReviewVerdict`, so the verdict read missed and
   was lost — not a manual reviewer's `--submit-review`. The loop's own
   re-consume is now corrected (the bound reader and `missionStore` are
   forwarded), but the reviewer artifacts were already deleted on the first
   pass, so the operator re-records directly with the corrected review command
   path: `px review <slug> --submit-review approve` forwards the bound reader
   and stamps the current round `APPROVED` (works with the provider enabled or
   in standalone `provider=none`); confirm it is a self-author round by checking
   `px status <slug>` shows the round as `approved`. The mapper now rejects any
   stale lower round before persistence and the verdict read-miss fails closed,
   so the re-record cannot re-introduce the defect.
3. **Confirm** with `px status <slug>` that the round now reports
   `disposition approved`.
4. **Adjacent repair commands the repository ships** (for the related states, not
   the "Review already exists" case above): `px review <slug> --reconcile-review`
   repairs an interrupted handoff where the mission is in the `review` lane with
   no valid Review aggregate, and `px review <slug> --backfill-review` migrates a
   pre-cutover mission that carries a `review-state.json` but no Review. Neither
   applies once a valid Review aggregate already exists.

No production SQLite data was modified and no schema change was made; recovery
uses only supported `px` workflow commands.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Verdict persists to Review aggregate and shows in `px status <slug>` | `test/task-2385-stale-review-round-repro.test.ts`: `records an approve verdict onto the current round without renumbering it` (postWorkflowReview self-author path, persisted round 2 / APPROVED) and `records an approve verdict onto the stored round 2 through the bound consumption path` (reviewLoopBindings seam, `store.state.mission.review.rounds[1]` disposition APPROVED, phase approved, round numbers [1,2]); status projection (`mission-board.ts`) unchanged by this mission, rendering covered by pre-existing `renderStatus` fixture | PASS |
| Recovery procedure cites supported `px` command / path | documented `px status <slug>`, `px review <slug> --status`, `px review <slug> --reconcile-review`, `px review <slug> --backfill-review` (all present in `src/interfaces/cli/review.ts` flag list) | PASS |
| Identify unrecorded verdict procedure | `px status <slug>` shows stranded round phase `reviewing` / disposition `none`; confirmed against status use-case rendering | PASS |
| Re-record + confirm procedure | autonomous-loop stranded verdict re-recorded via `px review <slug> --submit-review approve` (forwards bound reader, stamps current round APPROVED; provider-enabled and standalone `provider=none` paths both covered), confirm via `px status <slug>` reports `disposition approved` | PASS |
| Static-analysis gate passes | `./scripts/verify-local.sh static-analysis` → `ALL STAGES PASSED` | PASS |
| Full `all` gate passes | `./scripts/verify-local.sh all` → `# tests 1956`, `# pass 1956`, `# fail 0` | PASS |

## Gates

- `./scripts/verify-local.sh static-analysis` (node ≥22.23.1):
  `[1/4] ESLint clean` · `[2/4] tsc typecheck clean` · `[3/4] test-hygiene clean`
  · `[4/4] test typecheck clean` → `ALL STAGES PASSED`.
- `./scripts/verify-local.sh all`: `# tests 1948` / `# pass 1948` / `# fail 0`
  / `# skipped 0`. No new failures versus the parent commit.

## Next action
Round-2 human findings (F1/F3/F4 already fixed in-tree; F2 seam test added to
`test/task-2385-stale-review-round-repro.test.ts`; F5 recovery procedure
corrected to cover the autonomous-loop path) addressed; both gates green
(`./scripts/verify-local.sh static-analysis` ALL STAGES PASSED,
`./scripts/verify-local.sh all` 1956/0). Hand off for the next reviewer
decision on mission/task-2385.
