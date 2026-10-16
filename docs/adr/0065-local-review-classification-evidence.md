# ADR 0065: Focused review decisions with classifiers

Status: Proposed
Date: 2026-10-06
Task: TASK-2650
Related: ADR 0048 (fail-closed harness), ADR 0053 (persistence authorities),
ADR 0057 (verification tiers and trust model)

## Context

Kev and Jev can classify reports, labels or bounded source questions faster than
an ordinary LLM review. The useful comparison is the complete workflow:
mechanical evidence collection, classification, errors and fallback work.
Compilation, linting, tests and measured delivered change size remain executable
checks. The general baseline is what historical agents actually decided.

Earlier manually selected source packets showed classifier capability, but did
not establish an automatic workflow. A reproducible mechanical builder now
collects the actual previous review and implementer response, pinned source and
diff, and explicit omissions without another LLM preparing the evidence.

[Evidence summary and fresh validation](../../backlog/docs/task-2650-evidence/summary.md)
remain in the repository. Detailed research and exact packets are archived at
the host-local external path `/mnt/data/code/parallix-artice-data/task-2650/`;
the compact [archive index](../../backlog/docs/task-2650-evidence/archive-index.json)
records its absolute location and integrity hashes.

## Decision

Create TASK-2658 for an opt-in pilot of finding-resolution routing (E), using the
mechanical builder and normal general review as fallback. No production workflow
changes in this mission. Keep executable checks and the existing review and
persistence authorities. Collect actual latency and shadow-review outcomes
before enabling autonomous routes. The pilot includes Parallix-owned decision
telemetry and weekly comparisons by agent family, with unobserved outcomes kept
separate from confirmed correct decisions.

A clear concerns the complete original finding set, not unseen changes or whole
PR correctness. Partial clears and new findings are decided by the general reviewer
when Jev abstains. Unresolved returns supply a likely-unresolved signal; the implementer
can make changes or request reviewer investigation. Jev supplies no repair
instructions. Its selected-choice scores are not correctness probabilities.

For TASK-2658, the operator chose availability-dependent opt-out routing through
the existing checked review authority. The subsequent frozen panel decision
below supersedes that rollout's single-question thresholds and degrading packet
selection. Classifier measurements remain local statistics inputs, with one
workflow attempt per panel and Forgejo as the publication adapter. Historical
measurements and policy interpretations remain readable.

Each reviewed subject retains its review baseline. The general review and agent
repair brief can compare baseline-relative mission diffs across a rebase; the
experimental classifier instead uses the retained archived cited-path packing
algorithm. Its omissions do not establish a complete change surface. Mandatory
source/revision or budget failures leave the round with the general reviewer,
and local statistics retain their fallback reason.

## Decision matrix

| Option | Use | Measured evidence | Position |
|---|---|---|---|
| A: Verification-content feedback | Active → code checks → Jev → general LLM review | On four historical reports, code accepts all references; Jev agrees on success, rejects failure/deferral and abstains on a missing result. Code takes 0.013–0.381 ms; Jev 229–264 ms. | Deterministic report rules compared and not implemented (see Deterministic report rules). Jev content feedback remains the candidate, retaining general review. |
| B: Delegate a bounded judgment | Narrow a specific part of general review | All 17 final reporting labels match for Kev, Jev and focused Claude. Kev median 0.150 s versus Claude 3.47 s; Jev median 0.271 s across 35 packets. Five final abstentions are correct report labels. | Fast classification observed; this does not prove execution or end-to-end savings. |
| C: Additional review guidance | Direct the normal reviewer toward suspicious source | Ornith and Qwen both miss the reproduced original defect guided and unguided. Qwen guidance avoids one source-contradicted control finding. | No demonstrated additional catch; retain as research. |
| D: Executable checks | Compilation, linting, tests and revision validation | No replacement experiment conducted. A citation-pattern recognizer matches only 8/17 report labels; that is not a compiler/test comparison. | Retain deterministic checks. |
| E: Finding-resolution routing | Mechanically package existing findings and candidate repairs | Development: 18/46 autonomous routes versus 13/46 before expansion, zero reference disagreements. Fresh: 3/20 clears, no returns, 17 escalations; all clears historically approved. Estimated net saving 14.7%. | Implement an opt-in pilot through TASK-2658; measure live safety and latency before rollout. |
| F: Mission labels and NEL | Predict cohort, bug status or delivered size | Operator rejects all four differing Jev mission classifications: three bug-status and two cohort errors. Historical size estimates match 5/10; neither classifier improves. | No demonstrated improvement. |

## What the results mean

The mechanical finding-resolution builder uses explicit paths or unique
basenames and supplies complete selected files when the packet fits, otherwise
bounded source windows with omissions. The rule is fixed at 51% selected
“resolved” score for a clear and 90% selected “unresolved” score for an implementer
return; everything else escalates. It uses no tactical LLM context preparation
or language-specific parser.

Development mixes 20 historical missions, two known routing failures and 24
original/corrected controls. Its 18/46 autonomous routes comprise 11 clears and
seven returns: 39% coverage, an 11-percentage-point gain. Both known TASK-2599
failures still escalate. Local Ornith packaging adds no autonomous decisions
in its four-case development probes.

Fresh validation locks 20 new mission families with both exact historical
revisions available. Fourteen Jev calls complete; six context fallbacks stay in
the denominator. Three finding sets clear, eleven classifier judgments escalate,
and no candidate returns directly to the implementer. The three clears agree
with historical approvals; all six historical rejections escalate.

Preparation and API work total 7.81 seconds. Against the operator-reported
two-minute median review lifecycle, three avoided rounds estimate 14.7% net
savings. This meets the agreed >10% pilot bar with zero observed reference
disagreements. It is an estimate, not measured end-to-end acceleration, and three
clears cannot establish an incorrect-pass probability below 5%.

The earlier 41-mission search must not disappear: 105 candidates produce eight
clears, one return and 96 reviewer routes, including 29 context fallbacks. Three
clears disagree with historical rejection: one genuinely incomplete repair, one
correct repair followed by a new finding, and one reviewer false alarm. Raising
the pass threshold from 51% to 60% does not prevent that bad repair. Adding the
actual review/response and preservation-aware question prevents its clear in
development; broader review remains necessary for new findings.

## Consequences

### Positive consequences

- A mechanical classifier path shows a modest fresh saving without observed
  automatic disagreements; an implementation pilot is justified.
- Verification-content feedback can occur earlier while executable checks and
  general review retain their responsibilities.
- The article archive preserves exact inputs, negative results and the distinction
  between genuine bad repairs, new findings and historical reviewer errors.

### Negative consequences

- Historical agreement is not independent bug truth. Source availability,
  analyst-labeled controls and related cases limit generalization.
- Most fresh cases still need general review. Local compute cost, live fallback
  labor and actual lifecycle savings remain unmeasured.
- Neither mission labeling, NEL prediction nor extra bug-review guidance has
  demonstrated an advantage sufficient for adoption.

## Deterministic report rules (option A)

A frozen deterministic rule reading Goal Check row text for reported failure,
deferral and missing outcomes was compared with the reference checker, recorded Jev
answers and independent labels (TASK-2659; evidence in
`backlog/docs/task-2659-evidence/`). On 276 stratified rows from 6,284 fresh
historical rows, deferral readings were appropriate 5 of 5 and failure readings 5 of
6, but missing-outcome readings only 17 of 25, and 15 of 39 sampled failure,
deferral or missing-outcome rows were silently missed. Mixed, quoted, negated and
contradictory text could not be warned on, since those warnings were mostly false.
Over the 35 recorded packets the rule matched 29 labels, the reference checker 13
and Jev 35, though the packets were contrast-selected. The rule cost microseconds
per row; Jev took about 10 s over the 35 packets.

Decision: the rule is not implemented. Its coverage is narrow, its advisory notes
gate nothing, and no end-to-end saving was shown, so it does not justify a new
reading path, persistence and statistics. Reference checks, executable gates and
general review are unchanged. Jev report-content feedback remains the candidate,
to be tested next on fresh rows with a configured provider.

## TASK-2658 threshold follow-up

The operator subsequently chose 52% resolved and 89% unresolved for the
implementation, replacing the historical 51%/90% policy. New decisions record
a new policy version; historical decisions retain their original interpretation.
This adjustment trades a borderline clear for general review and retains a
borderline unresolved return. Validation evaluates Jev decision counts and
agreement with historical judgments when Jev decides; general-reviewer
variability is excluded. Thresholds alone do not establish correctness or cover
new findings outside the classified original scope. The original evidence and
conclusions above remain historical results.

## First-review success-criteria evaluation

TASK-2703 retains its frozen first-review research and older repair-review cohorts
separately in the [compact conclusion](../../backlog/docs/task-2703-first-review-conclusion.md)
and [archive index](../../backlog/docs/task-2703-first-review-evidence.json).

Decision: first reviews require the general reviewer, with no Jev call or
classifier verdict. This restriction applies independently of operator mode.
Finding-resolution re-reviews retain their eligibility, thresholds and
publication authority. Integration repairs are decided by the recorded green gate
and the frozen V4 weakening question, followed by the measured-limit V5 question
only if V4 does not clear, rather than the resolution panel. Each clears only
when it selects `preserves` with probability >= 0.60; every other V5 outcome
retains the general reviewer and never returns a mission. Both questions reuse
the same state, with repair commit subjects and no commit bodies. V5 permits a
finite resource limit at most about twice a measured overrun in the failure lines,
only for the check that failed. Implementer claims cannot replace that measurement,
and removing limits or lowering quality bars remains weakening. Restored approvals
record the clearing question, probability and both question versions. Statistics show
only the classifier share of decided re-reviews; historical measurements stay
readable.

The research found useful first-review decisions alongside unsafe clears.
Satisfying every mission criterion did not establish complete PR approval:
a correct historical rejection could concern a broader documentation blocker.
Focused green tests also concealed fallback and interface-contract defects.
Limited-context first-review routing therefore lacks sufficient support for
production approval. This conclusion does not invalidate the narrower evidence
supporting re-reviews of known findings or withdrawn integration gates.

Future first-review adoption requires a new frozen evaluation with original
revision-bound criteria, adjudicated historical rejections and explicit operator
acceptance. False clears are quality failures; false returns belong in aggregate
repair/review cost. No matched workflow savings are established by this research.

## Frozen three-question re-review baseline

For TASK-2716 the operator selected an experimental panel: separate frozen V3,
V1 and original questions share one immutable archived-mechanical state.
V3 is approval-only at 0.51; V1 approves at 0.80 or rejects at 0.89; original
is rejection-only at 0.89. Selected-choice probabilities drive inclusive votes.
Both directions, neither direction or any failed member defer to general review.
First reviews and prior-classifier decisions remain ineligible; revision/version
guards precede publication through the existing review authority.

The fitted development result was 17/46 supported decisions (10 approvals and
7 rejects), including synthetic and correlated finding/correction samples.
The independent frozen ten-case cohort produced one supported approval, nine
deferrals and no observed relative errors; three packets could not be prepared,
and all historical comparators were approvals. Neither result establishes zero
real-world error, production coverage or rejection recall. Historical decisions
are comparators rather than absolute ground truth.

A separate operator study will collect ten new regular-development samples in
1–2 days. Keep policy and packing fixed, retain bounded per-question telemetry
and pinned evidence identity, and replay the votes before source adjudication.
Report relative agreement/improvement/shared error separately from absolute
source-supported correctness, retaining ambiguous cases and preparation failures.
An unsafe clear concerns unresolved prior obligations or repair regressions;
unrelated new findings do not alone invalidate a scoped clear. Future sample
collection is not claimed complete and does not block this implementation.

## Re-review packet and question experiments

Offline replays of historical re-reviews (research mission px-0010, Jev only,
labelled by the general reviewer's decision) set the current re-review design.

A classifier clear on a round the general reviewer sent back is a wrong approval
when the reviewer found a prior obligation unfixed or a new problem inside the
latest changes. A new finding outside the latest changes is an acceptable pass.
Returns of rounds the reviewer approved are tolerated as repair cost.

Decisions:

- Every packet is fitted to the decision budget by one repository-neutral
  omission order, and every omission is stated (TASK-2751). Size alone no
  longer sends a round to the general reviewer.
- Each decided round stores its decided revision (TASK-2752), so a re-review
  diff runs from the head the reviewer judged.
- Integration repairs use the weakening question at preserves >= 0.60 with or
  without a recorded gate re-run (TASK-2754). Without one, the question states
  that Parallix re-runs every integration gate before integrating. On 100
  repair rounds this cleared 35 of 81 approved rounds. All 4 cleared send-backs
  were new findings in old code, or the repair checkpoint dropping Goal Check
  rows. TASK-2755 removed that cause by carrying accepted rows into a new repair
  checkpoint.
- Re-reviews after a general-reviewer decision ask one question per
  obligation: the prior findings plus human notes since that decision
  (TASK-2753). The route clears at addresses >= 0.97 on every obligation and
  returns at does_not_address >= 0.97 on any. On 158 rounds it cleared 12
  rounds correctly and 1 wrongly. In task-2717 r3, the latest changes orphaned a
  fixture that reached the branch through a rebase. The route stays in shadow
  until 50 qualifying shadow rounds show no wrong approval and no return of an
  approved round.
- The classifier model is pinned to typesafe/jev-1.13-20260917 (TASK-2763).
  The provider moved the `jev-latest` alias to 1.14 on 2026-10-15. Pinned on
  identical packets, 1.14 cleared 12 of 43 gate-fact repairs against 24 for
  1.13. The best 1.14 threshold reached 19, and it gave no safety gain on any
  dataset. A new version is adopted only after the same pinned comparison.
- `px stats` counts classifier share from decided rounds and shows no
  per-question sections (TASK-2758).

Rejected:

- A general new-defect question to Jev blocked every send-back but dropped more
  than half of the correct clears, because its score follows diff size.
- A mechanical orphan-file guard was fitted to the single wrong clear. A guard
  needs a recurring class of failures, not one case.
- Cleaner commit subjects and relaxed resource-limit wording gave no gain.
- Reviewer-authored per-finding templates, repair interdiff with gate-failure
  extraction, and checkpoint-state evidence gave no routing gain.

Expected effect and test: the classifier should decide about 16% of decided
re-reviews while the per-obligation route is in shadow, and about 20% after it
acts. The current measured share is 2–7%. About 120 decided re-reviews, roughly
40 to 50 missions, separate the hypotheses: 14 or more classifier decisions
support at least 17%, and fewer support no change from about 7%. Each
conclusion has about a 4% error rate. All thresholds were
chosen on these historical rounds, so the live count is the validation.

## Reconsideration triggers

Evaluate the pilot against ordinary live re-review, retaining raw false passes,
false returns, new findings, escalation and total time. Keep thresholds fixed
for independent validation and measure evidence coverage separately. Narrow
other general-review duties only after their own evidence supports it.
