# Findings: per-mission change-size budget — metric, measurement point, threshold, and breach action

**Task:** TASK-1355 (research only; depends on TASK-1267)
**Date:** 2026-06-27
**Status:** recommendation for operator review — no enforcement implemented

## Executive summary

| Question | Recommendation |
|---|---|
| **Metric** | **Net changed source lines** (insertions+deletions, excluding mission bookkeeping and generated files, computed `-w` to ignore whitespace). |
| **Measurement point** | **Handoff (actual)** is the gate signal; a draft-time estimate is kept as a *non-binding advisory* only. |
| **Threshold** | **Advisory escalation trigger at ~300 net source lines**, tuned from this repo's data (the defect rate jumps at the 270-line tercile boundary). Explicitly provisional — n=29. |
| **Breach action** | **Escalate review depth** (force an extra, independent review pass / deeper review budget). Not a hard block, not warn-only, not forced decomposition. |

The recommendation is grounded in a real correlation found in this repository's
archived missions (§4), not intuition. TASK-1267's <1000-row ceiling is **rejected
as the operative threshold**: the data shows the risk inflection is far lower
(~270–300 source lines), and a hard line wall is the wrong *mechanism* regardless of
where the wall sits (§3, §5).

The full reproducible dataset and method are in [`data/dataset.md`](data/dataset.md).

---

## §1 — Metric: which signal to measure

### The four candidates, scored

| Metric | Ease of computation | Game-ability | Correlation w/ review effort (this repo) | Relevance to defects |
|---|---|---|---|---|
| **Net changed lines** | **Trivial** — `git diff --numstat`, already available at every stage | Medium — whitespace / commented-out code / generated files inflate it; mitigated by `-w` and path/glob exclusions | **Strongest measurable**: Pearson **+0.39**, Spearman +0.37 vs review rounds | High — directly bounds how much a human/agent reviewer must read |
| **Files touched** | Trivial — `git diff --numstat \| wc -l` | High — trivially split or merged across files; says nothing about depth per file | **Weak**: Pearson +0.15, Spearman +0.22 | Low–medium — breadth ≠ logic risk |
| **Hunks** (`@@` blocks) | Easy — count `@@` in unified diff | High — reflows / reformatting fragment or merge hunks arbitrarily | **Weakest**: Pearson +0.06, Spearman +0.27 | Low — measures dispersion, not difficulty |
| **Cyclomatic complexity delta** | **Hard** — needs per-language AST tooling; **none exists in-repo** and adding it is out of scope (Restricted Areas) | **Low** — hardest to game; tracks branching/logic directly | Not measured (no tooling); theoretically highest | **Highest in principle** — branching density is the textbook defect correlate |

### Recommendation: net changed source lines

Net source lines wins on the balance of the four axes **for this repo, now**:

1. **It is the only metric with both a usable correlation and zero new tooling.**
   At +0.39 Pearson it is 2–6× stronger than files (+0.15) or hunks (+0.06) against
   the rework signal, and it is already computable at every workflow stage.
2. **Complexity delta is theoretically superior but practically unavailable.** It
   would be the *ideal* metric (lowest game-ability, highest defect relevance), but
   measuring it requires AST tooling this repo does not have, and building it is
   explicitly out of scope. It is recorded here as the recommended *future*
   enhancement once a complexity tool is in the gate (see §6).
3. **Files and hunks are rejected on evidence**, not theory: both correlate weakly
   here and are the easiest to game (split a change across files, or reformat to
   shuffle hunks).

**Gaming mitigations** (the known weakness of line count): measure with `git diff -w`
(ignore whitespace), exclude generated/vendored paths (`package-lock.json`,
`coverage/**`, `missions/**`, `backlog/**`), and — critically — **do not count mission
bookkeeping** (see the confound below). With these, the residual gaming surface
(deliberately padding logic with dead code) is the kind of thing the escalated review
in §3 is designed to catch anyway.

### Methodological warning: the total-lines confound

The naïve metric — total commit size including everything — correlates *more* strongly
(+0.65). **This is an artifact, not a stronger signal.** Each review round writes
`review-events/*.md` files that land in the same squash commit, so more rounds
mechanically grow the line count (reverse causation). Any future gate must measure
**source** change only; counting the workflow's own bookkeeping would create a metric
that rises *because* the work was hard to review, which is circular. This is documented
so the implementing task does not accidentally use the inflated number.

---

## §2 — Measurement point: draft (predicted) vs handoff (actual)

**Recommendation: measure at handoff (actual size) as the gate signal; keep any
draft-time estimate as a non-binding advisory.**

### The trade-off, stated explicitly

- **Draft (predicted) — pro:** it is the *only* point early enough to decompose a
  mission cheaply, before work is done. **Con:** the prediction is unreliable (§5),
  so a gate built on it would fire on noise — both false alarms (mechanical large
  changes predicted "risky") and misses (small-but-hard changes predicted "safe").
- **Handoff (actual) — pro:** the number is exact, cheap, and tamper-evident (it is
  the real diff). **Con:** it arrives after the work is complete, so it is *too late
  to decompose cheaply* — re-cutting a finished mission into sub-missions throws away
  done work.

### Why handoff wins

The decomposition-timeliness advantage of draft measurement is only worth having if
the prediction is trustworthy enough to *act on by decomposing*. The evidence (§5)
says it is not. Acting on an unreliable draft estimate would routinely either block
legitimate work or wave through genuinely risky-but-small work. Measuring the **actual**
diff at handoff sidesteps the entire prediction-reliability problem.

The "too late to decompose" objection is **answered by the breach action chosen in §3**:
the recommended response is *not* decomposition (which would indeed need to happen early),
but **escalating review depth** — an action that is perfectly timed at handoff, because
handoff is exactly when review happens. Measurement point and breach action are
co-designed: handoff measurement + review escalation are mutually consistent; draft
measurement + decomposition would be the alternative coherent pairing, and it loses on
prediction reliability.

The draft-time estimate is not discarded entirely: keep it as an **advisory** surfaced
to the operator ("this mission predicts large; consider scoping"), with no gate teeth.
That captures the cheap-decomposition upside *when the human chooses to act* without
betting an automated gate on a number we have shown is unreliable.

---

## §3 — Breach action: what happens above the threshold

**Recommendation: escalate review depth** — on breach, require an additional independent
review pass (or raise the review budget / reviewer rigor) before the mission may be
approved. Graduated: first breach escalates review; only a *repeated* pattern of
oversized missions from the same source should prompt an operator conversation about
scoping.

### Why the other four options are rejected

1. **Hard block** — *rejected.* Too blunt and mis-timed. At handoff the work is already
   done, so a block strands completed work. Worse, the data contains clean large
   missions: **task-1360** (1106 src lines) and **task-1328** (559 src lines) were each
   approved on the **first round**. A hard wall would have blocked legitimate,
   low-risk work (e.g. mechanical refactors) — exactly the "too blunt given how variable
   mission shape is" failure the task description warns about.
2. **Warn + override** — *rejected.* A warning with an easy override adds a log line, not
   a quality control. It changes no behavior and does not strengthen the
   review/test/property guardrails, which is the whole point of the budget. It would
   give the *appearance* of a gate with none of the effect.
3. **Force decomposition into sub-missions** — *rejected at handoff.* Decomposition is
   only cheap *before* work starts; forcing it at handoff discards finished work and is
   expensive. It also mis-targets risk: it would not catch **task-1332** (105 src lines,
   5 rounds — small but hard), and it would needlessly fracture clean large missions
   (task-1360). Decomposition is a *planning-time* discipline, best served by the §2
   draft advisory, not an automated breach action.
4. **Do not implement** — *rejected on evidence.* The data shows a real, monotonic
   relationship (§4): large missions need rework 73% of the time vs 11% for small ones.
   There is genuine signal worth acting on; ignoring it leaves quality on the table.
   (This option would have been the honest deliverable had the correlation been absent —
   see Stop Rules — but it is present.)

### Why escalate-review-depth wins

It is **correctly timed** (review happens at handoff, where we measure), **graduated**
(adds rigor rather than blocking), **non-wasteful** (no completed work is thrown away),
and it **directly strengthens the existing guardrail** the budget is meant to support:
big diffs get more defects, so big diffs get more review. It also degrades gracefully on
the metric's known imprecision — a clean large diff (task-1360) simply passes a second
review quickly, while a genuinely risky one (task-1335: 1008 lines, 5 rounds) gets the
scrutiny it needed anyway.

---

## §4 — Threshold: data-driven calibration

**This repository contains enough archived mission data to find a correlation, and it
supports a quantitative finding.** Method and full table: [`data/dataset.md`](data/dataset.md).

### Quantitative findings (n=29 missions)

- Binning the 29 missions into terciles by net source lines and measuring the share
  that required rework (review `round ≥ 3`):

  | Bucket | net source lines | mean review rounds | % needing rework (rounds≥3) |
  |---|---|--:|--:|
  | small | 0–79 | 1.89 | **11%** |
  | medium | 92–235 | 2.00 | **22%** |
  | large | 270–1106 | 3.91 | **73%** |

- **Missions above ~270 net source lines needed rework 73% of the time, versus 11%
  below ~80 lines** — a ~6.6× higher rework rate in the large bucket. The jump is
  concentrated at the small→large transition; the medium bucket is intermediate.
- Net source lines correlates with review rounds at **Pearson +0.39 / Spearman +0.37**,
  the strongest of the non-confounded computable metrics.

### Recommended threshold (provisional)

Set the **advisory escalation trigger at ~300 net source lines**, sitting just above
the empirical inflection (the large/high-rework tercile begins at 270). This is
deliberately *well below* TASK-1267's proposed 1000-row ceiling: the data shows risk
rises around 300, not 1000, so a 1000-line wall would miss the bulk of the
elevated-risk band (every mission from 300–1000 lines).

**This threshold is explicitly provisional.** With n=29 and a single repo, the exact
number should be treated as a starting point and **re-tuned as missions accumulate**.
Because the recommended action is review escalation (not a block), an imperfect
threshold is low-cost: it can be set, observed, and adjusted without disrupting work.
Recommended data-collection step before hard-coding any number: once a complexity-delta
metric exists (§6), re-run this correlation with complexity alongside lines, and
re-tune the trigger on a larger sample.

---

## §5 — Why agent up-front size estimation is unreliable

The breach action and measurement point both turn on the fact that agents cannot
reliably predict change size *before* doing the work. Concrete reasons, two of them
grounded in this repo's own data:

1. **No calibration data even exists.** The workflow does not capture an agent's
   predicted line count at draft — `MISSION.md` records only a coarse "Estimated agent
   % usage limit: 25–50%" band, not a size estimate. There is therefore no historical
   prediction-vs-actual series to calibrate against, so any draft-time number would be
   uncalibrated by construction.
2. **The line/complexity confound makes size intrinsically hard to foresee.**
   **task-1360** produced 1106 source lines but approved in **1 round** (a mechanical
   ESLint cleanup), while **task-1332** produced only 105 lines but took **5 rounds**.
   Whether a mission turns out large or hard depends on facts discovered *during*
   implementation (how mechanical vs how branchy the change is). An up-front estimate
   cannot know this, so even an honest predictor has irreducible variance.
3. **Optimism bias and no grounding.** Without historical diff data to anchor on, agents
   default to optimistic, plan-shaped estimates ("this is a small change") that ignore
   the incidental edits real implementation requires — the classic planning fallacy.

Does **actual-at-handoff** measurement avoid this? **Yes — completely.** The handoff
number is the real diff, not a forecast, so it carries none of the prediction variance.
That is the core reason §2 puts the gate at handoff and demotes the draft number to a
non-binding advisory.

---

## §6 — Future enhancement (out of scope here, noted for the implementing task)

- Introduce a **cyclomatic-complexity-delta** metric once AST tooling lands in the gate;
  it is the theoretically superior signal (lowest game-ability, highest defect
  relevance) and should be evaluated alongside net source lines on a larger sample.
- **Capture the agent's draft-time size estimate** so prediction-vs-actual can finally be
  calibrated; this would let §2's advisory become evidence-based over time.
- **Re-run the §4 correlation** as the mission corpus grows; re-tune the ~300-line trigger.

---

## Mapping to success criteria

| SC | Where satisfied |
|---|---|
| SC1 — doc exists, all four areas | this file, §1–§4 |
| SC2 — exactly one metric, compared to other 3 | §1 (net source lines; comparison table) |
| SC3 — one measurement point, both trade-offs | §2 (handoff; reliability vs decomposition-timeliness) |
| SC4 — one breach action, other 4 rejected | §3 (escalate review depth; 4 rejections) |
| SC5 — agent estimation unreliability, concrete reason | §5 (3 reasons, 2 data-grounded) |
| SC6 — quantitative finding or stated data gap | §4 (73% vs 11% rework; data exists and is cited) |
