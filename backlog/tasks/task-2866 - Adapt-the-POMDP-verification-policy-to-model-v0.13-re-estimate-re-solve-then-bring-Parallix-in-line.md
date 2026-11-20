---
id: TASK-2866
title: >-
  Adapt the POMDP verification policy to model v0.13: re-estimate, re-solve,
  then bring Parallix in line
status: backlog
assignee: []
created_date: '2026-11-20 20:11'
labels:
  - enhancement
  - research
dependencies: []
references:
  - TASK-2859
  - px-0060
  - ../parallix-research/research/verification-pomdp/README.md
  - /home/magnus/Downloads/parallix_stochastic_model_v13 (2).pdf
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Wave 2859 was built on *Verification, Rework, and Scheduling in Parallix* v0.11 (27-state solver form, three combined check-and-repair actions). The theory was since cleaned up and generalized (v0.12, v0.13). Determine what changed, estimate the inputs that are new or changed, recompute policy and saving, and adapt Parallix where the new model needs runtime behavior it lacks. This parent is a planning container and is Large by construction: refine it into a wave with `px split`, one child per stage below, in order. Do not execute the umbrella.

State at start (main, 2026-11-20): `verificationPolicy.mode` is `pilot` with `config/verification-policy/money-policy.json` (v0.11 solver, reported $34.60 vs $41.76 per change, 0.49% gap). Whether the pilot keeps running on it during this wave or returns to `shadow` is an operator decision recorded in stage 0.

## References

- **Model v0.13:** `../parallix-research/research/verification-pomdp/parallix_stochastic_model_v13.pdf` (PDF only; no LaTeX or LyX source exists). Section numbers below are v0.13 sections. The v0.11 `.tex` stays until the solver form and artifact contract v1 that read its Table 3 are replaced.
- **px-0060** and its frozen source cut and data under `../parallix-research/px-0060`: reuse its extraction owners and cut; do not re-extract what is frozen unless a new estimand needs it.
- `../parallix-research/research/verification-pomdp/` (solver, parameters, provenance, artifact emission, cross-checks); wave 2859 (artifact contract v1, `src/application/verification-policy/`, guardrails W1–W20, corner cases); `AGENTS.md`, `docs/doc-standards.md`, ADR 0047, ADR 0057.

## What changed from v0.11 to v0.13 (both PDFs read)

**v0.12:** 27-state solver form, horizon, terminal penalty, 40-action limit and human-integrate shortcut removed from the model (the last two stay operational rules outside it). Observations reduced to fail/pass; repairs and merge emit a constant observation. New Lemma 1 (the belief carries the record). Merge rule becomes a cost (`c(i,7) = M`); "repair only after a failure" becomes the permitted set `U(pi)`.

**v0.13:**
- **Flaky tests in the base model:** new parameter `beta_1`. A test pass is conclusive, a failure is not (belief keeps A1 states scaled by `beta_1`); 92 free numbers instead of 91. The repair rule for tests then lives on the record, not the belief.
- **Rebuttals** are an outcome of reviewer repair attempts (code unchanged, reviewer may be persuaded); no new parameter, but a repair attempt may leave the commit unchanged.
- **New §3:** primitive capabilities, most general policy class, assumptions A1–A5. A1 reworded (verdict = function of revision plus review history; reviewer randomness is drawn once per revision and absorbed in prior and repair rows). A3 one finding type per attempt; A4 independent concurrent checks; A5 no capacity effects (agent caps, CPU congestion, human context switching), flagged as the larger practical risk.
- **Address-immediately is optional:** deferred repair attempts allowed at no parameter cost.
- **New §5, concurrency for wall time (problem T):** event-driven semi-Markov decisions, non-anticipative rules, duration distributions (not means), human wait `W` plus review `R`. For money, serial is never worse, so the serial model is general.
- **New §9.2, exact order-per-round method:** policy choosing the check order per round from the last attempt type is a Markov chain on 8 x 4 states, cost = one 32-unknown linear system; 6 orders, 64 policies, all evaluable; upper and lower bound on the gap; independent cross-check of SARSOP and a lookup-table policy Parallix can run. The current policy's value is computed this way.
- **SARSOP form:** 8 states, 7 actions; solve unrestricted, simulate, check the rules on every history, and only on violation solve with the verdict record in the state (a few hundred states).
- **Estimation §8:** E1–E4 count attempts (including rebuttals) and are also split by round and number of findings (A2 test). E5 per-run records with the human `W`/`R` split and a presence signal. E7 adds restart point per repair type and which approvals survive. E8 adds action counts. E9 adds `beta_1` (re-runs, CI retries) and agent agreement. New E11 (rebuttal share, approval after rebuttal). Deliverables: revision table with verdict source (recorded, replayed, missing), action log, count tables by source, empty cells listed; replay missing test/agent verdicts, never impute human verdicts; flag multi-check attempts, differing verdicts on one revision, environment changes, abandoned/backstopped missions, retained approvals, declared-gate failures.
- **Saving §7:** per generalization, as a function of unidentified cells and the value where the saving vanishes; bootstrap or split; re-estimate after deployment.
- **Discount:** `rho = (1 + r)^(-h/8760)`, `r` = 8%, `h` from E8 (cycle time over actions), instead of the solver's fixed 18.9/22 h.

## Operator decision (2026-11-20)

**TASK-2859 is not edited by this wave.** It is already drafted and nearly complete. Every change below, including to behavior or contracts that wave 2859 delivered, is made by this wave's own children; this wave may depend on 2859 missions or the reverse, by reference only.

**Separate agent-repair and human-repair actions are not an implementation requirement.** All findings arrive through the same PR and the implementer picks up whatever is pending when any repair starts. Parallix keeps one repair mechanism; A3 (one finding type per attempt) stays in the calculation as an approximation. The repair is started by the action the policy chose, and it addresses every failed check pending on the revision. When agent and human findings are both pending (for example the agent review round, which may be two agents, arrives last), one physical attempt counts as a repair attempt of both the agent and the human type. Therefore:
- The runtime adds no targeted repair actions and no choice of which check's findings to address. Which checks' findings an attempt addressed is derived from the checks that had failed on the pre-attempt revision, not chosen.
- **Calculation ignores the joint effect (operator, 2026-11-20).** Estimation counts such an attempt in both the agent and the human repair cells (E3 and E4) with the same observed pre- and post-attempt state and flags the count (v0.13 §8.5); it builds no joint-attempt rows. The recalculation uses the model as written (A3) and adds no joint-attempt sensitivity.
- **Implementation takes it into account.**
- Corner case 21 of wave 2859 does not hold for this wave's code: a repair that addresses the findings of several checks is no longer an unmodelled change. The history adapter records it as a repair of each failed check, and the belief applies exactly one transition per physical attempt, never one per check. The repair row that transition uses is decided in stage 3 (the draft's reading: the row of the check whose verdict arrived last); the calculation does not model it. A rebound that changes the revision outside such an attempt stays an unmodelled change.
- Deferred repairs and concurrency with a choice of findings are evaluated in the calculation only, implemented only after a later operator decision.

## Stages (the drafter splits and sizes each Small or Medium, ADR 0047)

**0. Source and decisions (done manually, no child mission).** The v0.13 PDF is committed next to the v0.11 `.tex` (kept, because contract v1 and its test read v0.11 Table 3 until stage 3 replaces them), and the research README records the v0.13-versus-solver differences. Pilot mode during the wave is unchanged (pilot on the v0.11 artifact) unless the operator returns it to `shadow`.

**1. Estimation (research only, like px-0060).** Produce the parameter file for what is new or changed, reusing px-0060's cut and re-deriving E1–E4 as attempt counts with round/findings splits (a joint agent-and-human attempt counts in both E3 and E4 and is flagged; no joint-effect modelling): `beta_1` and agent agreement (note where replay was needed and in what environment); rebuttal share and approval-after-rebuttal; per-run duration records with `W`/`R` split and presence signal; E6 per attempt; E7 restart points and surviving approvals; E8 with action counts and mean step duration for `rho`; count tables by verdict source with empty cells (including cells the fixed order never visits, which go to sensitivity, never imputed). Unknown stays unknown; assumptions are labelled. The operator-owned parameter file is the only input later stages read.

**2. Recalculation (research only, after 1).** Build the v0.13 model in the research solver: 8 states, 7 actions, `beta_1`, `M`, `rho` from E8, SARSOP with the rule check and record-in-state fallback; the exact order-per-round method with all 64 policies and bounds as independent cross-check; current-policy value computed both ways and compared with observed totals (E8). Report T and C, savings with and without discounting, sensitivity to empty cells, bootstrap or split, and what depends on extreme values. Compare with the v0.11 result and say what moved and why. Operator gate: choose the artifact(s) to deploy and which v0.13 capabilities are worth implementing.

**3. Implementation wave (after the stage 2 gate; scoped from its result; wave 2859 guardrails W1–W20 apply).** Candidate children, kept only if stage 2 needs them:
- Artifact contract v2 for the v0.13 model, replacing v1 in place (8-state/record form or order lookup table, decided from stage 2 evidence); the 27-state parser and tests removed once the replacement is wired to every production caller (AGENTS.md "Implementation").
- Belief/record derivation for `beta_1 > 0` (a test failure is inconclusive, the history carries the record); history adapter covers rebuttals (repair without a new commit, renewed review of the same revision), retained approvals and joint repairs (one attempt addressing several failed checks, one belief transition; supersedes the corner-case-21 behavior the code has from wave 2859; TASK-2859 itself is not edited).
- A "re-run tests after failure without repair" action, only if the stage 2 policy uses it, via existing gate and rebound owners (W7, W12, W17).
- Recording what the next estimation round needs: per-run durations, human wait versus review, same-revision re-runs, rebuttal outcome, findings per attempt, verdict source, through existing owners, unknown left unknown (W13, W16).
- Statistics and docs updated to the new model; existing metrics unchanged.
- Re-selection of the pinned artifact and a disposable-environment check before ordinary missions are evaluated; PX-0073 states which artifact and model version it ran under.

## Out of scope

Separate agent/human repair actions, deferred repairs and runtime concurrency (unless decided after stage 2); human presence (§6.1) and extended Markov states (§6.2) unless stage 1 shows they are needed; changes to operator-owned gates or CPU budgets; a solver in the runtime (SARSOP stays offline); estimating, rounding or filling in parameters outside stage 1 (wave 2859 hard rule).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Stage 0 done: the v0.13 document is in ../parallix-research/research/verification-pomdp and the README lists its differences from the solver.
- [ ] #2 Stage 1 delivered the v0.13 estimand set (beta_1, rebuttal share, per-run durations with W/R split, E7 restart points, E8 with step duration for rho, count tables by verdict source with empty cells), unknown values unknown, assumptions labelled.
- [ ] #3 Stage 2 produced SARSOP and exact order-per-round values that agree within the stated bounds, the current policy's value agrees with observed totals or the gap is reported, and the saving is reported with sensitivity to empty cells.
- [ ] #4 Stage 3 changes only what the stage 2 operator gate asked for, leaves missions unchanged with the switch off (W1), and removes superseded contract-v1 code and tests after the replacement is wired to every production caller.
- [ ] #5 Before ordinary missions are evaluated, the pilot runs on an artifact consistent with v0.13, or the evaluation states which artifact and model version it ran under.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
