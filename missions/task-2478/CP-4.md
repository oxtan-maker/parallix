# CP 4 — Re-review and revision integrity

## Summary of work done

Added focused tests proving the correction loop's revision-integrity and
stale-approval defenses (criterion 8, ADR 0048 fail-closed). These drive the
Review aggregate commands in `src/domain/review.ts` directly.

Proven behaviors:

1. **A stale earlier-round approval cannot satisfy the later round.**
   `applyReviewerCommand({ type: 'approve' })` on a round that is
   `awaiting-implementation` throws (`cannot approve while review is
   awaiting-implementation`); an already-approved round is terminal and
   `beginNextReviewRound` rejects it (`cannot begin a new round while review is
   approved`).
2. **`CHANGES_MADE` alone is not proof the finding was resolved.**
   `applyImplementerCommand({ type: 'submit-resolution', resolutions: [] })`
   throws (`Missing resolution for F1`); a resolution must name every finding.
3. **Round 2 evaluates the revised revision, not the pre-fix tree.**
   `beginNextReviewRound` sets round-2 `subject.revision` to the implementer's
   `resultingRevision` (`rev-2`) and round-2 `decision` starts `null`; the later
   round needs its own independent approval, recorded against round 2.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Earlier-round APPROVED cannot satisfy the later round | `src/domain/review.ts` `applyReviewerCommand` / `beginNextReviewRound`; `test/task-2478-revision-integrity.test.ts` "rejects an approve against a round still awaiting implementation" + "begins round 2 … an already-approved round is terminal and cannot re-round" | PASS |
| `CHANGES_MADE` disposition alone is not proof the finding was resolved | `src/domain/review.ts` `applyImplementerCommand` → `validateResolutions`; `test/task-2478-revision-integrity.test.ts` "rejects an empty resolution" | PASS |
| Re-review evaluates the later round/revised revision | `src/domain/review.ts` `beginNextReviewRound` sets round-2 `subject.revision`; `test/task-2478-revision-integrity.test.ts` "begins round 2 on the revised revision" asserts `subject.revision === rev-2` and round number 2 | PASS |
| Final approval associated with the later round | `src/domain/review.ts` `applyReviewerCommand`; `test/task-2478-revision-integrity.test.ts` "round 2 requires its own independent approval, attached to round 2" | PASS |
| Fail-closed (ADR 0048): no agent can hallucinate an approval | guards throw on illegal transitions; no open path to set `APPROVED` outside `applyReviewerCommand` while `awaiting-review` | PASS |
| Focused tests run directly and pass (no .only / bare .skip) | `node --test test/task-2478-revision-integrity.test.ts` → 5 pass; ESLint clean | PASS |

## Next action
Commit CP-4. Then CP 5: run the deterministic `double-cli` correction scenario
end-to-end through the real review + act-on-review path in a disposable repo
(`review.provider: "none"`), inspect the raw transcript for the six replay
checks, regression-run the ordinary first-value Hello World demo to confirm it
still takes the immediate-`APPROVED` path, and document everything under
`## Demo Replay Findings`. If the scenario does not reach `REQUEST_CHANGES` after
a reasonable retry budget, document it rather than injecting a finding.
