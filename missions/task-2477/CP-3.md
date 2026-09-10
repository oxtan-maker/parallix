# CP 3 — Verdict and findings

## Work done
Made the verdict first-class and state-derived, confirmed blocking findings render
on `CHANGES REQUESTED` via `parseReviewFindings`, and proved review-infrastructure
failures still surface at default verbosity. The verdict code (`renderReviewVerdict`)
and independence classifier (`reviewIndependence`) were already present from prior
task-2477 work; this checkpoint added the remaining focused tests and verified the
findings wiring end to end.

- Verdict is emitted from the persisted authoritative state only:
  `renderReviewVerdict` (`review-loop.ts`) prints `========== APPROVED ==========`
  only when `reviewState === 'APPROVED'`, and `====== CHANGES REQUESTED ======`
  with `Blocking finding: …` lines when `reviewState === 'REQUEST_CHANGES'`; other
  states (e.g. `COMMENT`) produce no verdict.
- Ordering: in the approve branch `renderReviewVerdict` runs before
  `transitionVirtualFn(slug, 'approved')`; in the fixing branch it runs before
  `transitionTaskFn(slug, 'active')` and the implementer relaunch.
- Findings reuse `parseReviewFindings` (`review-round.ts`): `consumeReviewerArtifacts`
  builds `findingSummaries` from `parseReviewFindings(findings).map(f => f.summary)`
  (`review-artifacts.ts:559`), which become `blockingFindings` and are printed by
  `renderReviewVerdict`.
- Infrastructure failures keep default visibility: incomplete reviewer artifacts
  with an infra diagnostic (`post failed` / `persist failed`) emit
  `Reviewer artifact infrastructure failure: …` and escalate, at default verbosity.

## Demo Replay Findings
No new replay defects in this checkpoint; all CP-1/CP-2 defects are dispositioned
in CP-2. The `CHANGES REQUESTED` terminal presentation (verbatim) is:

```
====== CHANGES REQUESTED ======
Blocking finding: <summary>
```

rendered before the implementer relaunch, satisfying the mission's requirement
that findings be readable without opening `missions/<slug>/review-events/*.md`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Verdict first-class, prominent, emitted before task-transition/persistence | `renderReviewVerdict` `review-loop.ts`; `test/task-2477-review-presentation.test.ts` "verdict prominence: APPROVED emitted before the review-stopped transition line" | PASS |
| Verdict derived from persisted authoritative state; no approval when not APPROVED | `renderReviewVerdict` guards on `reviewState === 'APPROVED'`; `test/task-2477-review-presentation.test.ts` "non-APPROVED persisted state emits no APPROVED presentation" | PASS |
| `CHANGES REQUESTED` renders parsed blocking findings before relaunch | `parseReviewFindings` `review-round.ts`; `findingSummaries` `review-artifacts.ts:559`; `test/task-2351-review-loop-selection.test.ts` "review verdict presentation is authoritative and renders blocking findings before follow-up work" | PASS |
| Infrastructure failures still surface at default verbosity | `review-loop.ts` incomplete-artifact branch; `test/task-2477-review-presentation.test.ts` "incomplete reviewer-artifact infrastructure failure survives at default verbosity" asserts `Reviewer artifact infrastructure failure` | PASS |
| Non-authoritative review states produce no verdict | `test/task-2351-review-loop-selection.test.ts` "review verdict presentation is authoritative…" asserts a `COMMENT` state logs nothing | PASS |

## Next action
Re-record `docs/assets/first-value-demo.cast` with real agents via
`scripts/record-first-value-demo.sh`, re-render the GIF, inspect both, fix any
in-scope defect, run the focused tests directly, then run `./scripts/verify-local.sh all`
(CP-4).
