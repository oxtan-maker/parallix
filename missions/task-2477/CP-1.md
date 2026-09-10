# CP 1 — Replay and defect inventory

## Work done
Replayed the committed `docs/assets/first-value-demo.cast` review phase and traced
every default-visibility emission in `src/adapters/review/review-loop.ts`,
`review-agent-fallback.ts`, `review-gate-handling.ts`, and `review-artifacts.ts`.
Cast decoded with `python3` (asciinema v2) and grepped for the operator-facing
tokens the mission names. The trace below is the defect inventory for this
checkpoint. The committed cast is the pre-fix recording; the source tree already
carries prior task-2477 work (`reviewIndependence`, `renderReviewVerdict`,
single "Selected reviewer" site) but the cast was never re-recorded, so the cast
shows the OLD presentation while the code shows a mix.

## Demo Replay Findings

Defects observed in the committed `docs/assets/first-value-demo.cast` (decoded),
with exact source call site and disposition.

| # | Defect class | Observed in cast (verbatim) | Source call site | Action taken / out-of-scope |
|---|--------------|-----------------------------|------------------|------------------------------|
| 1 | Duplicate reviewer selection | `[INFO] Selected reviewer: custom (persisted)` printed at cast lines 575 **and** 576 | Formerly `review-loop.ts` round body **and** `review-agent-fallback.ts:460`; `review-loop.ts` duplicate already removed in current tree | REMOVED at source. Current tree emits it once at `src/adapters/review/review-agent-fallback.ts:460`. Add single-emission test (CP-2). |
| 2 | Combined header, no independence | `[INFO] Implementer: claude | Reviewer: custom (persisted)` (line 579); no independence line | `review-loop.ts` review-start block | RECOMPOSED in current tree into separate `Implementer:` / `Reviewer:` / `Independence:` lines. Verify order + verbose gating (CP-2). |
| 3 | Config given review priority | `[INFO] Focus: all | Max attempts: 5` (line 580) | `review-loop.ts` review-start block | Demote to verbose. Already verbose-gated in current tree. Verify (CP-2). |
| 4 | Config given review priority | `[INFO] Poll interval: 10s | Poll timeout: 600s` (line 581) | `review-loop.ts` review-start block | Demote to verbose. Already verbose-gated in current tree. Verify (CP-2). |
| 5 | Provider-disabled chatter | `[INFO] Forgejo validation skipped (review provider is not forgejo)...` | `review-loop.ts:403` | **GAP**: not verbose-gated in current tree. Demote to verbose (CP-2). |
| 6 | Provider-disabled chatter | `[INFO] Round N: review provider disabled; using workflow-owned review state.` | `review-loop.ts:554` | **GAP**: not verbose-gated. Demote to verbose (CP-2). |
| 7 | Provider-disabled chatter | `[INFO] Round N: review provider disabled; using workflow-owned disposition state.` | `review-loop.ts:995` | **GAP**: not verbose-gated. Demote to verbose (CP-2). |
| 8 | Duplicate pre-review gate | `[PASS] Pre-review gate passed for area "docs".` at lines 585 **and** 586 (and 1178/1179 round 2) | Formerly `review-loop.ts` round body **and** `review-gate-handling.ts:117`; `review-loop.ts` duplicate already removed | REMOVED at source. Current tree emits once per round via `runPreReviewGate`. Add single-emission test (CP-2). |
| 9 | Buried verdict | `[INFO] Round 1: reviewer outcome = REQUEST_CHANGES` (line 852); `[INFO] Round 2: reviewer outcome = APPROVED` (line 1511) | `review-loop.ts` round-body outcome log | REPLACED by `renderReviewVerdict` (prominent `APPROVED` / `CHANGES REQUESTED`). Verify prominence + ordering (CP-3). |
| 10 | Misleading independence | No independence concept anywhere in cast review phase | — | `reviewIndependence` exists in current tree; derive from agent-family identity, not display name. Verify both cases (CP-2). |
| 11 | Persistence chatter | `Persisted reviewer artifacts to repo store: ...` | `review-artifacts.ts:476` | Already `if (options.verbose)` gated. Confirm in test (CP-2). |

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Cast review phase replayed and every default-visibility emission traced | `python3` decode of `docs/assets/first-value-demo.cast`; grep of `Selected reviewer`/`Pre-review gate passed`/`workflow-owned` in `src/adapters/review/` | PASS |
| Duplicate reviewer-selection site identified | `src/adapters/review/review-agent-fallback.ts:460` (single current site) | PASS |
| Duplicate pre-review-gate site identified | `src/adapters/review/review-gate-handling.ts:117` (single current site) | PASS |
| Provider-disabled chatter sites identified for demotion | `review-loop.ts:403/554/995` | PASS |
| Buried-ident verdict site identified | `review-loop.ts` round-body outcome log (cast lines 852/1511) | PASS |
| Defect inventory captured in `## Demo Replay Findings` | this document | PASS |

## Next action
Demote the three provider-disabled lines (403/554/995) to verbose, confirm the
review-start header order, and add the single-emission + default-vs-verbose tests
(CP-2).
