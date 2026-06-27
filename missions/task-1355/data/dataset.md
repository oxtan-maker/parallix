# Dataset: per-mission change size vs. review rounds

Reproducible evidence base for `findings.md`. Generated 2026-06-27.

## How it was built

- **Population:** the 29 squash-merged `mission/task-XXXX` commits in this repo's
  `git log` (each mission lands as exactly one commit), intersected with the
  missions that carry a `missions/task-XXXX/review-state.json`.
- **Change-size metrics** (per mission commit, via `git show --numstat`):
  - `srcLines` = insertions+deletions **excluding** mission bookkeeping
    (`missions/**`, `backlog/**`, `coverage/**`, `package-lock.json`). This is the
    code/test/doc change a reviewer actually reads.
  - `srcFiles`, `srcHunks` = files / `@@` hunks under the same exclusion.
  - `totalNet`, `totalFiles` = the whole commit including mission bookkeeping
    (kept only to demonstrate the reverse-causation confound — see findings §1).
- **Defect proxy:** `reviewRounds` = the `round` value in `review-state.json`,
  i.e. the number of review passes needed before `APPROVED`. `round=1` means the
  diff was approved on the first pass (clean); `round>=3` means the reviewer sent
  the work back for rework two or more times (a strong defect signal). Review
  rounds are used rather than raw "findings" counts because the
  `reviewer_findings` event format is inconsistent across older missions, whereas
  `round` is recorded uniformly by the workflow.

## Correlations (Pearson r / Spearman ρ, n=29)

| Candidate metric | Pearson r | Spearman ρ | Notes |
|---|--:|--:|---|
| net **source** lines | +0.39 | +0.37 | strongest non-confounded metric |
| files touched (source) | +0.15 | +0.22 | weak |
| hunks (source) | +0.06 | +0.27 | weak |
| net lines **incl. mission docs** | +0.65 | +0.65 | **confounded** — review activity itself writes `review-events/*` files into the commit, so rounds inflate the line count (reverse causation). Rejected. |

## Tercile bins by source lines

| Bucket | n | srcLines range | mean rounds | % with rounds≥3 |
|---|--:|---|--:|--:|
| small | 9 | 0–79 | 1.89 | 11% |
| medium | 9 | 92–235 | 2.00 | 22% |
| large | 11 | 270–1106 | 3.91 | 73% |

## Raw rows (sorted by source lines)

| Mission | srcLines | srcFiles | srcHunks | totalNet | totalFiles | reviewRounds |
|---|--:|--:|--:|--:|--:|--:|
| task-1357 | 0 | 0 | 0 | 810 | 14 | 2 |
| task-1352 | 0 | 0 | 0 | 135 | 4 | 1 |
| task-1349 | 0 | 0 | 0 | 429 | 10 | 2 |
| task-1347 | 1 | 1 | 1 | 457 | 12 | 2 |
| task-1351 | 2 | 1 | 1 | 511 | 13 | 2 |
| task-1344 | 14 | 1 | 1 | 271 | 11 | 2 |
| task-1346 | 28 | 2 | 2 | 310 | 10 | 2 |
| task-1309 | 29 | 2 | 2 | 200 | 8 | 1 |
| task-1348 | 79 | 2 | 4 | 817 | 19 | 3 |
| task-1305 | 92 | 2 | 2 | 437 | 14 | 2 |
| task-1325 | 98 | 3 | 3 | 442 | 12 | 1 |
| task-1332 | 105 | 1 | 1 | 922 | 26 | 5 |
| task-1353 | 122 | 5 | 6 | 2463 | 30 | 3 |
| task-1331 | 131 | 12 | 14 | 568 | 20 | 1 |
| task-1345 | 133 | 2 | 8 | 544 | 16 | 2 |
| task-1324 | 135 | 2 | 2 | 496 | 13 | 2 |
| task-1350 | 217 | 11 | 20 | 686 | 24 | 1 |
| task-1343 | 235 | 5 | 8 | 447 | 10 | 1 |
| task-1327 | 270 | 4 | 8 | 615 | 15 | 2 |
| task-1340 | 272 | 13 | 16 | 1284 | 48 | 5 |
| task-1339 | 302 | 4 | 21 | 1454 | 33 | 7 |
| task-1328 | 559 | 9 | 26 | 787 | 20 | 1 |
| task-1323 | 576 | 9 | 24 | 1297 | 35 | 5 |
| task-1341 | 598 | 21 | 60 | 1385 | 44 | 4 |
| task-1342 | 701 | 15 | 37 | 1503 | 47 | 5 |
| task-1336 | 879 | 6 | 9 | 1918 | 29 | 4 |
| task-1335 | 1008 | 16 | 73 | 2267 | 41 | 5 |
| task-1290 | 1035 | 55 | 295 | 2313 | 81 | 4 |
| task-1360 | 1106 | 47 | 330 | 1443 | 56 | 1 |

## Notable outliers (qualitative)

- **task-1360** — 1106 src lines, 47 files, but **1 round** (clean first pass).
  A mechanical ESLint cleanup: large but low-logic-risk. Shows raw line count
  over-predicts risk for bulk mechanical edits.
- **task-1328** — 559 src lines, 1 round (clean). A focused, well-structured change.
- **task-1332** — 105 src lines but **5 rounds**. Small but hard; size under-predicts
  risk here. Confirms size is a *necessary-but-not-sufficient* signal.
