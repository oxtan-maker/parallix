---
id: TASK-2867
title: >-
  Generalize the verification policy runtime to model v0.13, independent of the
  estimated parameters
status: backlog
assignee: []
created_date: '2026-11-20 20:35'
labels:
  - enhancement
  - research
dependencies: []
references:
  - TASK-2866
  - TASK-2859
  - ../parallix-research/research/verification-pomdp/parallix_stochastic_model_v13.tex
  - ../parallix-research/research/verification-pomdp/README.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Make the policy runtime serve any artifact of model v0.13 (`../parallix-research/research/verification-pomdp/parallix_stochastic_model_v13.tex`), whatever parameters the re-estimation of TASK-2866 later produces. It runs in parallel with TASK-2866 stages 1 and 2. Only the last slice, selecting the pinned artifact, waits for the recalculation (task-2866.03). This parent is a planning container and is Large by construction: refine it into a wave with `px split`. TASK-2859 is not edited; this wave changes code that 2859 delivered through its own children and may depend on 2859 missions by reference.

Why parallel: the runtime must not be fitted to the numbers of one solve. Its contract is the model, not a parameter set. Tests use small synthetic artifacts, labelled synthetic, never estimates (2859 hard rule: the runtime contains no parameter values, `src/` and `web/` read one artifact from `verificationPolicy.artifact` and nothing under `research/`).

## What the runtime must cover (from v0.13, independent of parameter values)

- **Artifact contract v2** replaces v1 in place: dimension-generic matrices, costs, prior and vectors with action names; the model's 8 states and its 7 actions (read tests, agent, human; repair per type; merge) with the rule-check outcome recorded; parameter hash and solver version as today. The 27-state v1 parser, its fixtures and tests are removed after v2 is wired to every production caller (AGENTS.md "Implementation"). Whether an artifact carries the record in the state is a property of the artifact, not a runtime assumption. An order-per-round lookup artifact (v0.13 §9.2) is not required; add it only if the stage 2 gate asks for it.
- **Belief and record for any flake rate** `0 <= beta_1 < 1`: a test pass is conclusive, a test failure is inconclusive when `beta_1 > 0`, so the history carries the record and the permitted-action set `U(pi)` is evaluated on it (v0.13 §4.7–§4.8, Lemma 1). The same code serves `beta_1 = 0`.
- **History adapter:**
  - rebuttals: a repair attempt with no new commit and a renewed review of the same revision, with the reviewer's renewed verdict;
  - joint repairs: one attempt addressing the findings of several failed checks is recorded as a repair of each failed check and applies exactly one belief transition (the row of the check whose verdict arrived last, unless the stage 2 evidence or an operator decision says otherwise); this supersedes the corner-case-21 behavior of wave 2859 in code, without editing TASK-2859;
  - retained approvals across an attempt, clean versus identity-changing rebases, and every other unmodelled change as today.
- **Re-run tests after a failure without repair:** a policy action when the artifact contains it, through the existing gate and rebound owners (2859 W7, W12, W17). A policy that never chooses it behaves as today. No parameter decides whether it exists.
- **Repair stays one mechanism** (operator decision, 2026-11-20): no targeted repair actions and no deferred repairs at runtime; the policy keeps address-immediately. The artifact's repair actions are forced by the rules, never chosen.
- **Recording for the next estimation round** through existing owners, unknown left unknown (2859 W13, W16): per-run durations, human wait versus review time, same-revision re-runs, rebuttal outcome, number of findings per attempt, verdict source.
- **Statistics and documentation** updated to the model: calibration per check, the saving formula, `docs/` for changed behavior only. Existing metrics keep their meaning.

## Slices (the drafter splits and sizes Small or Medium; each leaves main working with the switch off)

1. Artifact contract v2: emitter in `../parallix-research/research/verification-pomdp/`, parser in `src/application/verification-policy/`, synthetic fixtures; v1 removed after migration.
2. Belief and record for any `beta_1`, with the permitted set from the record.
3. History adapter: rebuttals and renewed reviews.
4. History adapter: joint repairs and retained approvals under the one-transition rule.
5. Re-run tests as a policy action.
6. Recording for re-estimation.
7. Statistics and docs.
8. Select and pin the artifact from the recalculation (depends on task-2866.03 and its operator gate); disposable-environment check; PX-0073 states which artifact and model version ran.

Slices 1–7 depend only on each other and on the v0.13 document; they do not read the parameter file of TASK-2866.

## Rules

2859 hard rules and W1–W20 apply to every slice. In particular: safe fallback to the fixed policy on any policy failure, one next-action owner, no new tables or columns without operator approval, no fabricated statistics, SARSOP never in the runtime, replace guards in place.

## Out of scope

Separate agent/human repair actions, deferred repairs, runtime concurrency, human presence, extended Markov states, choosing or changing parameters, edits to TASK-2859, changes to operator-owned gates or CPU budgets.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every slice 1-7 lands without reading the TASK-2866 parameter file and with synthetic fixtures labelled synthetic; main runs missions unchanged with the switch off after each (W1).
- [ ] #2 The runtime accepts a valid v2 artifact for beta_1 = 0 and beta_1 > 0, rejects invalid ones with a typed reason, and falls back to the fixed policy on any policy failure.
- [ ] #3 Joint repairs, rebuttals, retained approvals and test re-runs each have a named test or a recorded manual exercise.
- [ ] #4 Contract v1 code, fixtures and tests are removed after v2 is wired to every production caller.
- [ ] #5 Slice 8 pins the artifact from the recalculation and records which model version and hash the pilot ran under.
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
