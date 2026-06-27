# CP-3 — Findings document complete

## Summary

The findings document is complete and covers all four research areas with an
evidence-based, data-grounded recommendation. The declared gate passes.

Deliverables:
- `missions/task-1355/findings.md` — the findings doc: executive summary + §1 metric,
  §2 measurement point, §3 breach action, §4 data-driven threshold, §5 agent-estimation
  unreliability, §6 future enhancements, plus an SC-mapping table.
- `missions/task-1355/data/dataset.md` — reproducible dataset: method, correlations,
  tercile bins, raw 29-mission table, and outliers.

Recommendation (one of each, as required):
- **Metric:** net changed source lines (strongest non-confounded correlate, +0.39
  Pearson; whitespace/path gaming mitigated; complexity-delta noted as future ideal).
- **Measurement point:** handoff/actual (avoids the unreliable draft prediction;
  draft kept as advisory).
- **Breach action:** escalate review depth (graduated; other four options rejected
  with data).
- **Threshold:** advisory escalation at ~300 net source lines, provisional (n=29),
  backed by the 73%-vs-11% rework finding; TASK-1267's 1000-row ceiling rejected as
  too high.

Stop-rule check: a single superior metric *was* identifiable (no need for forced
hybrid); the data supported implementation (not a do-not-implement conclusion);
archived data was sufficient for a correlation; the chosen breach action (review
escalation) does not require modifying workflow scripts to *recommend*. No stop rule
triggered.

Gate: `./scripts/verify-local.sh docs` → `PASS: all required documentation present`.

## Goal Check

| Success criterion | Status | Evidence |
|---|---|---|
| SC1 — findings doc exists, all four areas | PASS | `missions/task-1355/findings.md:1` (file present); §1–§4 sections |
| SC2 — exactly one metric, compared vs other 3 | PASS | `findings.md` §1 table + recommendation; `data/dataset.md` correlations (srcLines +0.39 vs files +0.15, hunks +0.06) |
| SC3 — one measurement point, both trade-offs | PASS | `findings.md` §2 "The trade-off, stated explicitly" (reliability vs decomposition-timeliness) → handoff |
| SC4 — one breach action, other 4 rejected | PASS | `findings.md` §3 "Why the other four options are rejected" + winner |
| SC5 — agent estimation unreliability, concrete reason | PASS | `findings.md` §5 (3 reasons; task-1360/task-1332 data) |
| SC6 — quantitative finding (data exists) | PASS | `findings.md` §4 (73% vs 11% rework; Pearson +0.39); `data/dataset.md` tercile + raw tables |
| Declared gate passes | PASS | `./scripts/verify-local.sh docs` → "PASS: all required documentation present" |
| Backlog task file preserved | PASS | `backlog/tasks/task-1355 - Research-change-size-budget-...md` unmodified |
| No files created outside mission dir | PASS | all new files under `missions/task-1355/` (findings.md, data/dataset.md, CP-1..3) |

### Acceptance-criteria mapping (backlog task)

| AC | Status | Evidence |
|---|---|---|
| #1 diff-size vs bug-rate across archived missions | PASS | `data/dataset.md` (29 missions, git diff × review rounds) |
| #2 recommend metric + measurement point w/ rationale | PASS | `findings.md` §1, §2 |
| #3 recommend breach action (or not-implement) w/ justification | PASS | `findings.md` §3 |
| #4 why agent up-front estimation unreliable + does handoff avoid it | PASS | `findings.md` §5 |

## Next action

Mission complete — commit MISSION.md, CP-1..3, findings.md, and data/dataset.md, then
hand off to review. No further checkpoints.
