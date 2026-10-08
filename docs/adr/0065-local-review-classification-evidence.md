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

For TASK-2658, the operator subsequently chose availability-dependent opt-out
routing instead of the proposed opt-in rollout. Jev is called on every
review round, first review or re-review, while the provider is available, with thin evidence sent bounded
and its omissions declared; only opt-out, an unavailable provider or a prior
classifier decision skip the call, and each records a reason. Autonomous decisions
are attributed to the dedicated Jev review identity; Parallix applies them
through its existing checked review authority. A finding-resolution signal
concerns only the prior findings, and Jev abstains through insufficient_evidence
when the supplied evidence cannot support a judgment. Classifier measurements remain
local statistics inputs, recorded once per review round and reported per round, split by first review and re-review, and Forgejo remains the review publication adapter.
This follow-up choice does not change the historical research results or turn
the estimated saving into a measured whole-workflow improvement.

## Decision matrix

| Option | Use | Measured evidence | Position |
|---|---|---|---|
| A: Verification-content feedback | Active → code checks → Jev → general LLM review | On four historical reports, code accepts all references; Jev agrees on success, rejects failure/deferral and abstains on a missing result. Code takes 0.013–0.381 ms; Jev 229–264 ms. | Shift-left candidate, retaining general review. Compare and implement cheaper deterministic report rules through TASK-2659. |
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

## Reconsideration triggers

Evaluate the pilot against ordinary live re-review, retaining raw false passes,
false returns, new findings, escalation and total time. Keep thresholds fixed
for independent validation and measure evidence coverage separately. Narrow
other general-review duties only after their own evidence supports it.
