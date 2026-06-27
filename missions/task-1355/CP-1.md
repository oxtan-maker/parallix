# CP-1 — Metric analysis complete

## Summary

Evaluated all four candidate change-size metrics (net lines, files touched, hunks,
cyclomatic complexity delta) against the four required axes — ease of computation,
game-ability, correlation with review effort, and relevance to defect detection —
using a real dataset built from this repo's archived missions.

Built a reproducible dataset (`data/dataset.md`) from the 29 squash-merged
`mission/task-XXXX` commits joined to each mission's `review-state.json`. Used
**review rounds to approval** as the defect proxy (uniformly recorded; `round≥3` =
significant rework). Computed Pearson/Spearman correlations for each computable
metric and tercile-binned defect rates.

Key empirical result: **net source lines** is the strongest *non-confounded*
correlate of rework (Pearson +0.39, Spearman +0.37). Large-tercile missions
(270–1106 src lines) needed rework on 73% of cases vs 11% for the small tercile
(0–79 lines). Files touched (+0.15) and hunks (+0.06) correlate weakly. The
total-net-lines metric correlates higher (+0.65) but is **rejected as confounded**:
review activity writes `review-events/*` files into the same commit, so more rounds
mechanically inflate the line count (reverse causation). Cyclomatic-complexity delta
is assessed qualitatively (most defect-relevant in theory, but highest computation
cost and no existing tooling in-repo; gathering it is out of scope per Restricted
Areas). **Recommended metric: net changed source lines.**

## Goal Check

| Mission item | Status | Evidence |
|---|---|---|
| All four metrics evaluated on 4 axes | Done | `missions/task-1355/findings.md:§1` (comparison table), `data/dataset.md` correlations table |
| Ease of computation assessed | Done | `findings.md:§1` rows for each metric |
| Game-ability assessed | Done | `findings.md:§1` (whitespace/comment gaming + `-w` mitigation) |
| Correlation with review effort (data) | Done | `data/dataset.md` Pearson/Spearman table (srcLines +0.39); built from `git show --numstat` over 29 mission commits |
| Relevance to defect detection | Done | `data/dataset.md` tercile bins (73% vs 11% rework rate); `findings.md:§1` |
| Chosen metric justified vs other 3 | Done | `findings.md:§1` recommendation paragraph + confound rejection of total-lines |

## Next action

Decide the measurement point (draft vs handoff) and the breach action, each with
explicit rejection of alternatives, then record in `findings.md` §2–§3 → CP-2.
