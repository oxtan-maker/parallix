# ADR 0047: Estimate Mission Size in Net Engineering Lines, Not Agent-Usage %

**Status:** Accepted
**Date:** 2026-06-27
**Task:** task-1355 (research; depends on the task-1267 hypothesis)

## Context

[task-1267](../../backlog/tasks/task-1267%20-%20Hypothesis-reduce-mission-size-to-increase-quality-controls.md)
hypothesized that smaller missions correlate with fewer defects and proposed a
flat **<1000-row ceiling**. task-1355 researched this against this repository's own
archived missions. The full reproducible dataset and method are in
[`missions/task-1355/data/dataset.md`](../../missions/task-1355/data/dataset.md);
the analysis is in [`missions/task-1355/findings.md`](../../missions/task-1355/findings.md).
Every quantitative claim in that research was re-verified against `git log` while
authoring this ADR (line counts, review rounds, correlations, terciles all
reproduce exactly), so the decisions below rest on measured data.

### Today missions are estimated in the wrong unit

Per [ADR 0032](0032-mission-refinement-state-and-usage-budget-signals.md) and
[ADR 0036](0036-mission-sizing-and-dependency-wave-heuristics.md), a mission's
draft-time size signal is **"Estimated agent % usage limit"** (e.g. "25–50%"). That
unit is agent-specific, non-portable across models, untethered from the artifact a
reviewer actually reads, and impossible to verify after the fact — there is no
ground truth to compare a "%-usage" estimate against, so it can never be calibrated.

### Not all lines are equal

Parallix missions are line-heavy by construction. Each mission emits `MISSION.md`,
per-checkpoint `CP-*.md`, `review-state.json`, and `review-events/*` files. These are
**administrative bookkeeping**, not delivery. The risk a reviewer must reason about
lives in the **engineering change** the mission ships — code and tests — not in its
workflow paperwork or prose.

Conflating them produces an actively misleading metric. Counting *total* commit lines
correlates with review rounds at **+0.65**, much stronger than the engineering change
alone (**+0.39**) — but this is **reverse causation, not signal**: every review round
writes more `review-events/*` files into the same squash commit, so a mission that was
hard to review mechanically grows its own line count. Any size signal must therefore
exclude administrative and documentation lines, or it measures the workflow rather than
the work.

## Decision

**Change the basis on which missions estimate their size, from agent-usage % to a
predicted count of Net Engineering Lines (NEL), expressed as one of three buckets.
Then capture the actual NEL at handoff so the draft estimate can, for the first time,
be checked for reliability.** This ADR records the design and the data-gathering plan;
it does **not** yet impose any gate or breach action — see "Why no enforcement yet".

### 1. The metric — Net Engineering Lines (NEL)

**NEL = insertions + deletions in code and test files**, computed `-w`
(whitespace-insensitive), **excluding**:

- workflow/process bookkeeping — `missions/**`, `backlog/**`, `review-*`, `*CP-*`;
- documentation — `**/*.md`, `docs/**`;
- generated / vendored — `package-lock.json`, `coverage/**`, and other lockfiles/build output.

"Net Engineering Lines" is chosen as the name precisely to make the exclusions
self-evident: *engineering* (code and tests, not prose), *net* (the diff, not the
whole tree). It is the only one of task-1355's four candidate metrics that has both a
usable correlation with review rework and **zero new tooling** — it is computable from
`git diff --numstat` today:

| Candidate | Correlation w/ review rounds (Pearson/Spearman) | Tooling | Verdict |
|---|---|---|---|
| **Net Engineering Lines** | **+0.39 / +0.37** | none | **Chosen** |
| Files touched | +0.15 / +0.21 | none | weak signal |
| Hunks (`@@`) | +0.06 / +0.27 | none | weakest |
| Cyclomatic complexity delta | not measurable in-repo | high (AST) | deferred (see Future Work) |

### 2. The draft estimate — a NEL bucket, replacing "% usage"

At draft, the `MISSION.md` size signal becomes a **predicted NEL bucket**, replacing
"Estimated agent % usage limit". The buckets are the empirical risk terciles found in
this repo's archived missions (see §4):

| Bucket | Predicted NEL | Observed rework rate in this repo (review round ≥ 3) |
|---|---|---|
| **Small** | 0–80 | 11% |
| **Medium** | 81–235 | 22% |
| **Large** | 235+ | 73% |

### 3. The actual — capture NEL at handoff

At handoff the **actual** NEL is computed from the merge diff (exact, cheap,
tamper-evident) and recorded alongside the draft bucket. This produces, per mission, a
`(predicted bucket, actual NEL, actual bucket, review rounds)` record — the
prediction-vs-actual series the workflow has never had.

### 4. Why these buckets — the data

Binning the 29 archived missions into terciles by NEL, against the share needing
rework (`review round ≥ 3`):

| Bucket | NEL range | mean review rounds | % needing rework |
|---|---|--:|--:|
| small | 0–79 | 1.89 | **11%** |
| medium | 92–235 | 2.00 | **22%** |
| large | 270–1106 | 3.91 | **73%** |

Missions above ~270 NEL needed rework **73%** of the time vs **11%** below ~80 — a
~6.6× higher rate, concentrated at the small→large boundary. The bucket edges (80, 235)
sit at these tercile boundaries. Note this places the risk inflection far below
task-1267's proposed 1000-row ceiling, so a 1000-line wall would have missed the entire
elevated-risk band.

### Why no enforcement yet — calibrate before you gate

task-1355 found the workflow has **no calibration data**: it never recorded a predicted
size, so there has never been a way to know whether an up-front estimate is trustworthy.
The findings show good reasons to doubt it — task-1360 shipped 1106 NEL but approved in
**1 round** (a mechanical ESLint cleanup), while task-1332 shipped only 105 NEL but took
**5 rounds** (small but hard) — i.e. whether a mission is large or *hard* depends on
facts discovered during implementation.

Gating on an uncalibrated estimate would therefore fire on noise. So this ADR
deliberately stops at **changing the unit and gathering the data**. A threshold and a
breach action (escalate review depth, force decomposition, block, etc.) are **deferred
to a follow-up decision** that will be made only once the draft NEL bucket is shown to
be a reliable estimator of the actual bucket. The whole point of capturing
`(predicted, actual)` pairs now is to make that future decision evidence-based instead
of guessed.

## Consequences

### Positive
- Size is estimated in a **portable, verifiable** unit (lines of engineering change)
  instead of an agent-specific, uncheckable "% usage".
- The signal measures **delivery risk**, not workflow paperwork; the +0.65 total-line
  confound is designed out by construction.
- For the first time the workflow accumulates **prediction-vs-actual** data, so the
  reliability of up-front sizing becomes an observable fact rather than an assumption.
- Zero new tooling — NEL is computable from `git diff --numstat` today.
- No disruption: nothing is blocked or escalated yet, so a wrong bucket costs nothing.

### Negative / Limitations
- The bucket edges (80 / 235) are provisional — n=29, single repo — and should be
  re-tuned as the corpus grows.
- NEL excludes documentation, so it **under-counts docs-heavy deliverables** (e.g.
  research/ADR missions). This is an accepted trade-off for now: such missions carry
  little executable-defect risk. Revisit if doc-only missions prove risky.
- NEL is gameable at the margin (padding logic with dead code); since nothing is gated
  on it yet, this is not yet a concern.

### Future Work
- Once enough `(predicted, actual)` pairs exist, **assess whether the draft NEL bucket
  is a reliable estimator** of the actual bucket — this is the trigger for a follow-up
  ADR on enforcement (threshold + breach action).
- Add a **cyclomatic-complexity-delta** metric once AST tooling lands; evaluate it
  against NEL on a larger sample.

## Links
- [task-1267 hypothesis](../../backlog/tasks/task-1267%20-%20Hypothesis-reduce-mission-size-to-increase-quality-controls.md)
- [Research findings (task-1355)](../../missions/task-1355/findings.md)
- [Reproducible dataset](../../missions/task-1355/data/dataset.md)
- [ADR 0032](0032-mission-refinement-state-and-usage-budget-signals.md) — amended: this ADR replaces the "% usage limit" draft signal with a NEL bucket.
- [ADR 0036](0036-mission-sizing-and-dependency-wave-heuristics.md) — amended: "Too Large" sizing is restated in NEL rather than agent-usage %.
- Implementation: [task-1379](../../backlog/tasks/task-1379%20-%20Replace-agent-usage-size-signal-with-Net-Engineering-Lines-NEL-bucket-capture-actual-at-handoff.md) (replace the % usage signal with a NEL bucket; capture actual NEL at handoff).
