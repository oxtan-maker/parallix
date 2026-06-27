# CP-2 — Measurement point and breach action decided

## Summary

Decided the remaining two design questions and recorded both in `findings.md` with
explicit rejection of alternatives.

- **Measurement point: handoff (actual).** The draft-vs-handoff trade-off is stated
  explicitly — draft is the only point early enough for cheap decomposition but its
  prediction is unreliable (§5); handoff is exact but too late to decompose. Handoff
  wins because the decomposition upside is only worth having if the prediction can be
  acted on, and it cannot. The "too late to decompose" objection is neutralized by the
  chosen breach action (review escalation happens at handoff anyway). The draft estimate
  is retained as a non-binding operator advisory.
- **Breach action: escalate review depth.** All four alternatives are rejected with
  data-backed reasons: hard block (strands clean large missions — task-1360 at 1106
  lines / 1 round, task-1328 at 559 / 1 round), warn+override (no teeth), force
  decomposition (too late at handoff; misses small-but-hard task-1332 at 105 lines /
  5 rounds), do-not-implement (rejected because a real correlation exists, §4).

Measurement point and breach action are co-designed: handoff measurement + review
escalation are mutually consistent and correctly timed.

## Goal Check

| Mission item | Status | Evidence |
|---|---|---|
| One measurement point recommended | Done | `findings.md:§2` (handoff/actual) |
| Both trade-offs addressed (reliability + timeliness) | Done | `findings.md:§2` "The trade-off, stated explicitly" |
| One breach action recommended | Done | `findings.md:§3` (escalate review depth) |
| All 5 breach options addressed / 4 rejected | Done | `findings.md:§3` "Why the other four options are rejected" + winner rationale |
| Rejections backed by evidence | Done | `findings.md:§3` cites task-1360/1328/1332; `data/dataset.md` outliers |

## Next action

Finalize `findings.md` (verify all six SCs covered, §4 threshold backed by the §4
quantitative finding, §5 agent-estimation reasons), run the docs gate
`./scripts/verify-local.sh docs`, and commit MISSION + checkpoints + findings → CP-3.
