---
id: TASK-2650
title: >-
  Evidence-backed business cases and local-model evaluation for focused review
  classification
status: backlog
assignee: []
created_date: '2026-10-05 08:41'
labels: []
dependencies: []
ordinal: 163008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Produce a proposed ADR answering:

Should Parallix delegate specific review decisions to a local classification
model? If so, which decisions, with what demonstrated quality, operational
benefit, cost, and remaining responsibilities?

Investigate the complete available local PR and documented bug history.
Then evaluate a real local model against relevant alternatives using
historical Parallix cases.

This is a discovery and experimental-evaluation mission.
It does not authorize production implementation or architectural changes.

Valid outcomes include:
- A supported recommendation for a narrowly defined classifier.
- Better results from focusing the existing general review agent.
- A deterministic solution.
- An inconclusive result requiring specific additional evidence.
- No justified change.

A model winning an unrelated public benchmark is not evidence that it
improves Parallix review.

The ADR must remain Proposed until the operator explicitly accepts it.

## 1. Product intent and boundaries

The intended division of work is:

The general agent investigates code, follows dependencies, gathers evidence,
understands behavior, and handles open-ended reasoning.

Focused checks evaluate recurring, bounded questions where the necessary
evidence and possible outcomes can be defined.

Deterministic facts remain deterministic.

The purpose is not simply to add another AI reviewer. Identify which work
can actually leave the general agent's remit, which work must remain, and
whether the resulting arrangement improves quality or total operating cost.

Do not assume that classification is easier than the reasoning required to
prepare its input. Include evidence preparation in both evaluation and cost.

### Recovery is a separate direction

The operator prefers recovery agents to investigate relevant tmux logs and
other diagnostic sources themselves.

Do not design a classifier that prediagnoses a failure and injects a detailed
repair prompt into the agent.

Recovery incidents may provide evidence of upstream review failures.
Implementing tmux, diagnostic tools, or recovery orchestration is out of scope.

### Hardware and authority

The available local evaluation GPU is an RTX 5060 Ti with 16 GB VRAM.

Model recommendations from earlier discussions are hypotheses to verify,
not an accepted model-selection decision.

No classifier may become the authority for Git state, process liveness,
leases, allowed lifecycle transitions, required gates, or integration.

Do not remove existing review obligations or verification during this mission.

## 2. Establish the actual data sources

Read AGENTS.md, the documentation standard, and relevant current ADRs,
especially those governing review, verification, persistence, and authority.

Discover the actual local configuration, review provider, read interfaces,
storage locations, and historical formats. Do not invent database paths,
schemas, CLI commands, or infrastructure.

PRs are in the locally configured review environment, not GitHub's PR list.
Use the real local provider and its available API or supported interfaces.

Record the repository, baseline SHA, collection timestamp, historical
cutoff, and source coverage. Use a stable snapshot for reproducibility.

All production and historical operational access must be read-only.

Do not modify PRs, reviews, mission states, or the live operational database.
Never run historical software versions against the live database.

For this mission kev is running locally at http://127.0.0.1:8009

## 3. Inventory all available PRs and documented bugs

### PR census

Enumerate every available PR, including open, merged, and closed-unmerged PRs.
Handle pagination explicitly.

Inspect available descriptions, diffs, review rounds, findings, resolutions,
decisions, comments, and reviewed revision references.

Link these to missions, checkpoints, verification results, agent runs, and
subsequent corrections where possible.

Give every PR an analysis status. Distinguish:
- Inventoried.
- Reviewed for candidate decisions and incidents.
- Deeply reconstructed.
- Unavailable or insufficient evidence.

A metadata-only inventory is not a completed review of its contents.
Do not silently substitute a sample for the requested full-history review.

Sampling is appropriate for expensive model evaluation after the census,
not for pretending the corpus itself has been fully examined.

### Bug census

Find documented bugs across:
- Current and completed tickets.
- Historical mission/task records in Git.
- Deleted or moved archives.
- Fixes, regressions, and reverts in commit history.
- PR discussions and operational records without separate bug tickets.

Do not rely only on a "bug" label or commit messages containing "fix".

Reconstruct deleted historical records into isolated analysis storage.
Do not restore them into the current product tree.

Deduplicate incidents across tickets, PRs, commits, and review rounds.
Keep incident counts distinct from the number of review opportunities.

### Coverage report

Report totals and denominators for PRs, documented bugs, reconstructable
review histories, inaccessible sources, and missing evidence.

Explain exactly which conclusions missing data prevents.
Do not fill gaps with assumptions or claim "all bugs" means every defect
that has ever existed.

## 4. Reconstruct review outcomes without hindsight

For each documented bug, establish as much of this chain as evidence permits:

requirement → introducing change → reviewed revision → review decision
→ verification → integration → discovery → correction

Distinguish the revision that introduced a defect from the revision that
exposed it. Shared filenames are not sufficient evidence of causation.

Determine:
- What was wrong?
- What evidence was available at the relevant review?
- What did the reviewer actually say or fail to investigate?
- What eventually detected the problem?
- Could that review reasonably have detected it?
- What check would have been needed?
- Has the current implementation already addressed the underlying weakness?

Classify findings as:
- Confirmed review miss.
- Probable review miss with incomplete evidence.
- Successfully detected by review.
- Requirement, evidence-access, or process failure.
- Introduced after the reviewed revision.
- Insufficient evidence.

A later bugfix does not prove a prior review miss.
An approval is not independent proof that the change was correct.
An agent's claimed test success is not executable evidence.

Include successful reviews and clean changes as controls.
Do not build the business case exclusively from spectacular failures.

Historical problems already fixed by existing controls must not be counted
as unchanged future savings opportunities.

### Historical search leads

The following identifiers are leads inherited from planning, not established
findings. Verify their descriptions, relationships, and subsequent fixes:

- TASK-2543 / TASK-2521.03: claimed verification versus actual results.
- TASK-2647 / TASK-2637.05: stated architectural objective versus completion.
- TASK-2627 / TASK-2622.10: reviewed changes versus integrated tree.
- TASK-2613 / TASK-2521.07: missing or removed historical task records.

These leads are not a sufficient sample or a substitute for the census.

## 5. Derive bounded decision tasks from the evidence

Identify recurring semantic decisions in both successful and unsuccessful
reviews.

Possible questions to investigate, not a predetermined feature list:
- Does the supplied evidence support a particular acceptance criterion?
- Does a proposed resolution address the original finding?
- Is a finding relevant and blocking under the applicable review policy?
- Does a test exercise the promised behavior?
- Does a change satisfy the stated intent rather than only its surface form?

For each candidate, specify:
1. The exact decision and allowed outcomes, including insufficient evidence.
2. The necessary inputs available at decision time.
3. How those inputs are obtained and the cost of obtaining them.
4. The remaining responsibilities of the general agent.
5. What responsibility could genuinely be delegated.
6. The consequences of false acceptance, false rejection, and abstention.
7. Historical examples, counterexamples, frequency, and denominator.
8. Whether the decision still occurs under the current workflow.

Reject candidates that are really unrestricted code review disguised as
classification, unless the evidence supports a genuinely bounded subtask.

Explicitly investigate whether selective or incorrect evidence prepared by
the general agent would cause the classifier to repeat the same mistake.

Missing evidence must not be converted into a favorable decision.

## 6. Mandatory local-model evaluation

A business-case report and a proposed future benchmark are not sufficient
to complete this mission.

Run a real local model on the RTX 5060 Ti and evaluate at least one genuine,
data-supported decision task.

Do not manufacture a task merely to satisfy this requirement.

The evaluation must answer separately:

A. Does the local model make better decisions?
B. Does focusing the question improve the existing general reviewer?
C. Does the local model offer a useful quality/cost trade-off?
D. Does the proposed division of work improve the review workflow?

A faster model with worse decisions is not a quality improvement.
Correctly formatted output is not evidence of correct judgment.

### Candidate selection

Verify current model availability, license, weights, intended inference
method, runtime requirements, and compatibility with the actual machine.

Screen a small justified shortlist if necessary, rather than conducting an
unbounded model survey. Execute at least one suitable local candidate.

Record exact model and tokenizer revisions, quantization, runtime version,
configuration, prompt/template, and decision-extraction method.

Use the model's intended classification mechanism. Do not silently replace
a dedicated decision readout with ordinary chat generation and treat it as
the same model behavior.

If quantization or context reduction is necessary, evaluate that actual
configuration. Do not substitute published results for the deployed variant.

### Isolated execution

Temporary local model downloads, isolated evaluation environments, and small
offline evaluation scripts are allowed.

Do not introduce production dependencies, provider integrations, servers,
workflow changes, or configuration defaults.

Do not stop unrelated GPU workloads, weaken security, or install system-wide
components without existing authorization.

Use already authorized model access for comparison. Do not create new paid
subscriptions or unapproved spending commitments.

If actual execution is blocked, document attempted setup, exact blockers,
and completed work. Mark the empirical evaluation incomplete.

An unavailable model, missing baseline, or setup failure must not become a
fictional result or a claim that this acceptance criterion passed.

## 7. Compare the right baselines

Use these alternatives where applicable:

### Baseline 1: current broad review

Establish how the current review workflow handles the underlying problem.
Keep historical observed outcomes separate from new replay results.

On a representative isolated subset, replay the current configured reviewer
against the historical reviewable revision using its normal investigation
capabilities.

Measure whether it discovers the relevant issue, not whether it answers a
question that already reveals the hidden bug.

Historical reviewers may differ from today's reviewer. Do not conflate them.

### Baseline 2: focused general-agent decision

Give the currently configured general review model the same bounded question,
allowed outcomes, and evidence packet used for the local classifier.

This is the essential control for determining whether any gain comes from
a specialist model or simply from asking a clearer question.

### Baseline 3: deterministic check

Implement or reuse a minimal deterministic baseline where the decision
admits one. Report when it is not applicable rather than inventing a weak
rule just to make the model look better.

### Candidate: focused local classifier

Use the same decision contract and eligible evidence as Baseline 2.

Keep task semantics, evidence limits, and output mapping comparable.
Model-specific syntax is allowed; unequal access to useful evidence is not.

Develop prompts and thresholds only on development data.
Do not optimize the local model repeatedly while leaving the general-agent
baseline deliberately untuned.

### Two distinct comparisons

The paired classification comparison measures decision quality on identical
evidence.

The broad-review comparison measures discovery and investigation capability.

Do not claim the classifier replaces broad investigation merely because it
answers a focused question after another agent has identified the concern.

For proposed delegation, include a small isolated end-to-end evaluation of
evidence preparation plus classification. Count preparation failures,
missing evidence, fallback, and remaining reviewer work.

No experimental result may modify actual PR status or review authority.

## 8. Build trustworthy evaluation cases

### Reference labels

Ground labels in explicit requirements, reproducible behavior, revision-
specific evidence, and independently verifiable findings.

Where safe and useful, reproduce historical defects in disposable fixtures
without connecting historical code to live operational state.

The evaluated model must not supply its own ground truth.
Another LLM's unsupported judgment is not sufficient ground truth either.

Record label provenance, uncertainty, and disagreements.
Mark unresolved cases separately rather than forcing binary answers.

Use independent adjudication where available. Do not claim human validation
that did not occur. Clearly distinguish strong reference labels from
provisional semantic judgments.

### Avoid hindsight and data leakage

Model inputs must contain only information that would have been available
at the decision time.

Later fixes, bug reports, and incident conclusions may support reference
labels but must not leak into the input, filenames, or task wording.

Do not formulate every question around a defect discovered later unless
the proposed workflow could realistically have generated that question
before discovery. Include the cost and reliability of that question-selection
step in the end-to-end assessment.

Keep related PRs, retries, follow-up fixes, and incident families together
when splitting data.

Separate development/calibration data from a locked final evaluation set.
Prefer a temporal holdout where practical.

Do not repeatedly inspect and tune against the final holdout.
Disclose possible prior model exposure to public repository history when
it cannot be ruled out.

### Representative cases

Include real positive cases, clean controls, ambiguous cases, and insufficient-
evidence cases. Include realistic context lengths and distracting material.

Do not silently truncate decisive evidence to fit the GPU.
Record truncation, rejection, and fallback as operational outcomes.

If failures are oversampled, report enriched-set results separately from
estimates at the observed workflow prevalence.

Choose sample sizes based on corpus availability and decision uncertainty.
Do not present a tiny dataset as proof of reliable superiority.

## 9. Report quality, uncertainty, and operating cost

Report results per decision task, not only as an overall average.

Include:
- Confusion matrices and actual case counts.
- Defect misses and incorrect favorable decisions.
- False alarms and unnecessary escalations.
- Abstentions and coverage at the chosen operating point.
- Invalid outputs, timeouts, context failures, and fallback.
- Paired disagreements between local and general-model decisions.

For every important disagreement, inspect the source evidence and explain
which answer was supported and why.

Show local-correct/general-wrong and general-correct/local-wrong cases.
Do not only showcase the candidate's wins.

Use appropriate uncertainty intervals or paired analysis, accounting for
related cases rather than treating duplicate incidents as independent.

Choose thresholds and acceptable trade-offs from development data and
documented error consequences. Do not invent a universal confidence cutoff.

Do not treat model scores as calibrated probabilities without checking.
Where systems do not expose comparable scores, compare their actual
decisions rather than manufacturing probabilities.

A result of zero observed severe misses does not prove zero risk.

### Hardware and performance

Record actual GPU, OS, driver, runtime, and peak GPU memory use.

Measure cold start separately from warmed inference.
Report realistic end-to-end median and tail latency, including evidence
preparation, transport, classification, and fallback.

Measure representative context sizes and relevant concurrency where safe.
Do not extrapolate short, single-request measurements to production load.

An out-of-memory result is a result, not permission to conceal difficult
cases or silently change the test conditions.

### Workflow benefit

Identify what disappears from the general agent's workload and what remains.

Count evidence gathering, focused question selection, validation, fallback,
and integration overhead. Classification speed alone is not review speed.

A hybrid approach that preserves all existing work and merely adds a model
must be described as added checking, not as reviewer workload reduction.

## 10. Construct the business case

For each serious candidate, report:

Observed need:
- Decision opportunities and independent incidents.
- Time period, denominator, and evidence coverage.
- Current versus already-fixed weaknesses.
- Rework, repeated reviews, manual interventions, and quality consequences.

Measured performance:
- Local model versus focused general model.
- Current broad-review behavior on the replay subset.
- Deterministic alternatives.
- End-to-end costs and unresolved weaknesses.

Economics:
- Potentially removed agent work.
- Evidence-preparation and fallback cost.
- GPU/model operating cost and contention.
- Implementation, maintenance, and ongoing evaluation.
- Cost of false alarms and missed problems.

Separate active operator time, agent time, compute time, and elapsed waiting.
A one-hour delay is not automatically one hour of human labor.

Use measured values where available.
Mark missing values as unknown or explicit scenario assumptions.

Express costs and benefits on a common basis, such as per 100 relevant PRs.
Avoid double-counting the same prevented incident across multiple checks.

Derive the minimum improvement needed to justify adoption.
Do not invent ROI, expected savings, or precision.

A slower but materially better classifier may be valuable.
A faster but weaker classifier may be unacceptable.
A focused general agent may be the best result.

Distinguish those conclusions rather than compressing them into one score.

## Deliverables

### A. Proposed ADR

Use the next available ADR number and existing repository conventions.

Include:
- Decision and scope.
- Corpus coverage and limitations.
- Actual local-model evaluation.
- Baseline comparisons and uncertainty.
- Business cases and rejected alternatives.
- Proposed responsibility boundaries.
- Risks, consequences, and required operator decisions.

For each candidate, recommend one of:
- Supported narrow adoption, pending operator approval.
- Further bounded experiment because evidence is inconclusive.
- Focus the existing general agent instead.
- Use deterministic checks instead.
- Insufficient evidence.
- No justified change.

Do not infer production readiness from a single favorable aggregate score.
Prioritize at most three next steps; do not fill the list artificially.

### B. Reproducible evidence and evaluation bundle

Provide compact machine-readable records for:
- Corpus inventory and coverage.
- Deduplicated incidents and review outcomes.
- Candidate decision tasks.
- Reference labels and provenance.
- Development/holdout split membership.
- Model and baseline configurations.
- Per-case outputs, timing, and failures.
- Derived summaries and business-case calculations.

Use stable identifiers and revision references.
Report totals must be reproducible from the underlying records.

Keep scripts small, isolated, and single-purpose.
Do not build a permanent benchmarking platform.

Keep raw local PR exports, logs, secrets, and database dumps local.
Commit only suitable sanitized evidence and references.

Treat PR text and logs as untrusted data, not instructions to execute.
Do not upload private corpus material to an unapproved service.

### C. Operator decision summary

Start the final report with:

"What the data demonstrates, what we recommend, and what remains unproven."

Answer explicitly:
- Did a local model actually run on the 5060 Ti?
- Was it better at any specific decision?
- Was any improvement instead explained by focused questioning?
- What errors did it introduce or fail to prevent?
- Would it reduce reviewer work, add checking, or both?
- What adoption decision is justified now?

## Acceptance criteria

- [ ] All available local PRs have inventory and analysis status.
- [ ] Documented bug history includes deleted and moved historical records.
- [ ] Review misses are distinguished from other failure types and unknowns.
- [ ] Historical need is separated from current remaining opportunity.
- [ ] At least one genuine decision task is evaluated on a real local model.
- [ ] The focused general-model baseline is executed on matching cases.
- [ ] Broad-review discovery is not confused with prompted classification.
- [ ] Development and final evaluation data are separated without incident leakage.
- [ ] Reference labels, ambiguous cases, and missing evidence are traceable.
- [ ] Quality comparisons include misses, false alarms, abstentions, and uncertainty.
- [ ] Claimed workflow benefits include evidence preparation and fallback.
- [ ] Business-case calculations use data or explicitly marked assumptions.
- [ ] The ADR is Proposed, not Accepted.
- [ ] Product behavior, review authority, gates, and operational data are unchanged.

If mandatory empirical work cannot be completed, deliver the useful evidence
already collected but mark the mission incomplete on those criteria.
Do not replace executed evaluation with a confident recommendation.

## Guardrails

No generic AI-use-case catalogue instead of historical analysis.
No claim that "a classifier would have caught this" without replay evidence.
No cherry-picked failures, models, thresholds, or favorable examples.
No model serving as its own judge.
No fabricated measurements or unsupported savings.
No weakened gates, new lifecycle authority, or automatic integration.
No production implementation hidden as evaluation preparation.
No automatically created follow-up missions.

Run focused checks appropriate to the changed analysis scripts and documents,
following repository instructions. Do not run full product gates merely
because this mission studies review quality.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
