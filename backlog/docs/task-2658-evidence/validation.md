# TASK-2658 delivery evidence

## Delivered behavior

Jev handles eligible complete original finding sets by default when the existing decision adapter and dedicated review identity are available. Selected resolved scores of at least 52% clear; selected unresolved scores of at least 89% return the original findings without invented repair instructions. Other judgments retain general review. Opt-out, shadow, missing evidence, broader obligations, drift and provider/publication failures retain existing safeguards and executable gates.

Policy repeat-findings-52-89-v2 replaces 51%/90% for new decisions. Historical repeat-findings-51-90-v1 decisions remain readable under their original policy. Packets use the original mechanical builder and preservation-aware prompt; the threshold adjustment did not change the input context. Review owns applied verdicts; decision-owned bounded measurements live in operator-local SQLite. Weekly px stats counts actual PR decisions, classifier clears/returns and their share, including open missions, without querying Forgejo.

The operator accepted the 52%/89% coverage tradeoff and repeated-call variability. Acceptance evaluates Jev decision counts and historical agreement when Jev decides; new general-reviewer variability and matched general-reviewer latency are excluded. Missing TASK-2451 source remains a fallback in the denominator and was waived as a standalone blocker. No universal correctness or speedup claim follows from this bounded validation.

## Goal Check

| Criterion | Evidence | Result |
| --- | --- | --- |
| Mechanical pinned actual review/response and source packet | src/application/review-classification/evidence-packet.ts:77; test/unit/application/review-classification/evidence-packet.test.ts:1 | Complete-finding, basename, omission, byte-cap and missing-evidence contracts pass |
| Available default, operator opt-out and fixed routing | src/application/review-classification/repeat-review.ts:9; src/domain/classifier-review.ts:4; test/unit/composition/review-classification.test.ts:1; test/unit/application/review-classification/repeat-review.test.ts:1 | 52%/89% boundaries, drift, publication, broader-scope and human-intervention contracts pass |
| Bounded typed local measurements, precise costs and retry deduplication | src/adapters/sqlite/review-classification-store.ts:5; test/integration/stats/metrics-review-fix-observations.test.ts:1 | Retry costs retained; unavailable stays distinct from zero; Review remains verdict authority |
| Completed-cohort full-history comparisons and same-scope observations | src/application/review-classification/statistics.ts:80; test/unit/application/services/statistics-contract.test.ts:1 | Shadow disagreement, unobserved outcomes, new findings and full-history contracts pass |
| Weekly real PR totals/classifier share including open missions | src/adapters/sqlite/classifier-statistics-reader.ts:7; src/application/review-classification/statistics.ts:20; test/integration/stats/metrics-review-fix-observations.test.ts:1 | Matching UTC windows and decision identities; calls/retries/fallbacks excluded from verdict counts |
| Jev decision counts and correctness evaluation | tools/review-classification/replicate.ts:1; tools/review-classification/validate-cases.ts:1; results below | Historical cases retained; observed count variability and new-finding scope difference recorded |
| Repeated-request variability and low-threshold counterexamples | tools/review-classification/repeat-request.ts:1; test/unit/application/review-classification/evidence-packet.test.ts:67 | Ten identical requests retained; incorrect archived 88%/80% returns remain screened at 89% |
| Balanced README and operator documentation | README.md:87; docs/config.md:449; docs/adr/0065-local-review-classification-evidence.md:1 | Existing review paragraph updated; deeper configuration guide; original ADR research preserved |

## Verification

Final focused unit/headroom checks: 43 passed. Owning review-loop/review-adapter/repository checks: 214 passed. Focused Forgejo/SQLite/review-mapping checks: 83 passed. No failures or skipped tests in successful runs. Build, documentation, static analysis, production/test typechecking, test hygiene and layout checks pass. Newly introduced production/test files remain within source-size caps.

A SQLite integration case initially used 101 ms CPU against its 100 ms budget. Moving cold imports outside the timed case reduced it to 33.809 ms; the finite budget was unchanged. CPU profiles are retained externally. A focused red/green mapping check also confirms flattened review state preserves the actual prior reviewer comment for context collection.

The built CLI snapshot on 2026-10-06 reports 256 real PR decisions for 2026-09-30 through 2026-10-06 UTC, classifier 0, share 0.0%. Timing is unavailable where no measurements exist. No experimental classifier responses were inserted into operational statistics. Jev was provisioned as a dedicated non-agent Forgejo identity with repository write permission and a protected local review token; raw credentials are excluded from evidence.

## Jev replication under the delivered policy

| Sample and packet arm | Cases | Jev decisions | Clears | Returns | Historical/reference agreement |
| --- | --- | --- | --- | --- | --- |
| TASK-2650 recorded development, original 51%/90% | 46 | 18 | 11 | 7 | 18/18 |
| TASK-2650 recorded fresh, original 51%/90% | 20 | 3 | 3 | 0 | 3/3 |
| New 52%/89%, frozen development packets | 46 | 18 | 11 | 7 | 18/18 |
| New 52%/89%, regenerated development packets | 46 | 17 | 11 | 6 | 17/17 |
| New 52%/89%, frozen fresh packets | 20 | 3 | 3 | 0 | 3/3 |
| New 52%/89%, regenerated fresh packets | 20 | 3 | 3 | 0 | 3/3 |

All three fresh clears agree with historical approvals; all six historical rejections escalate. Both TASK-2599 safety cases escalate. Development references include archived original/corrected finding labels, rather than exclusively whole-PR verdicts. TASK-2580 F5 original accounts for the one missing regenerated return: same context, unresolved score 84% in that run. No changed cutoff or hand-selected packet was used to recover it. The original frozen replay still uses its original policy. Original and resolved revisions, request hashes, raw responses and missing inputs remain in external production-replication-52-89.json.

TASK-2451's unavailable prior commit remains one of all 46 cases. It was already an abstention in the original recorded reference, so it does not explain the missing return. Local and Forgejo bare-repository searches found no object; no replacement revision was invented.

## Held-out validation

Selection was the first 20 chronological repeat-review decisions since 2026-10-01 from local Review authority, excluding every mission in the original 66 cases and TASK-2650/TASK-2658. Selection preceded model calls; labels never enter the request. Each usable packet was called three times, with all failures and fallbacks retained.

Each run has 15 calls, 7 clears, 0 returns, 8 abstentions and 5 context fallbacks. Six of seven clears agree with historical whole-PR approvals. The seventh, TASK-2625 round 2, is a retained whole-PR disagreement: its historical reviewer explicitly confirms original F1 was fixed, then requests a new F2 repair. Jev clears F1 at 67%. The repair also changes an uncited test file, so the production broader-scope guard retains general review for the PR. The finding-level clear agrees with the historical F1 assessment and is not a whole-PR approval. No threshold was retuned after this observation. Inputs and every raw response remain in holdout-inputs.json and holdout-validation-52-89.json.

## Ten identical TASK-2580 requests

Scores for does_not_address were 89, 87, 87, 88, 89, 89, 87, 86, 87, 88 percent. All ten selected unresolved, actual model typesafe/jev-1.13-20260917, with no failures. Mean is 87.7%. The same saved packet hash a77b10713eec95a853d14b40b4c75986e23825ebe798a8a4cb806e05a0a6d912 was verified before calling.

| Unresolved cutoff | Returns among ten identical requests |
| --- | --- |
| 90% | 0/10 |
| 89% | 3/10 |
| 88% | 5/10 |
| 80% | 10/10 |

The archived research confirms incorrect returns at lower cutoffs. finding-resolution-expanded.json case task-2641-r2-F2-correction incorrectly selected unresolved at 88% for a resolved durable-feedback-consumption fix (request hash 68c0cf5c43d22ac420dc262bcfcd825bae8eec1773b2f3b6a392c46a75c42c38). Its companion Markdown explicitly says lowering the cutoff to 80% would act on this wrong rejection. finding-resolution-validation-51.json also selected unresolved at 80% for the resolved task-2580-r7-F4-correction (request hash ec6781685123480aeea88a71bc0690678dd1a3d00bab8c07e4d92623e18ff180). The current 89% cutoff screens both recorded scores, with only a one-point margin over the 88% error. Earlier context/prompt preparation differed; these are concrete counterexamples, not a universal safe boundary. The policy was unchanged during the ten runs. No session search was needed because raw archived evidence was recovered.

## Retained earlier experiments and limitations

The earlier 51%/90% frozen-request live run incorrectly cleared TASK-2544 at 51%; its regenerated run abstained at 49%. The error remains in production-replication.json and jev-decision-evaluation.json. Raising the clear cutoff to 52% screens that recorded result; the new 52%/89% live runs have 3/3 fresh agreement. Neither errors nor earlier negative packaging experiments were discarded.

All historical production whole-PR routes remain conservative: uncited changes or missing context retain general review. The classification results above describe original-finding judgments, not a claim that those historical PRs skipped general review. The historical (3*120 - 7.813459)/(20*120) = 14.6744% estimate is preserved with its assumed 120-second reviewer baseline. It is not measured whole-workflow savings.

The supplementary matched source-review experiment completed all 20 cases in each arm without execution failures, with three paired general-reviewer verdict differences. Its 1680.574 s ordinary total versus 1433.911 s fallback total excludes executable gates and Forgejo publication. No reviews were skipped, so the 14.68% timing difference cannot be credited to Jev. These reviewer differences are excluded from acceptance by explicit operator instruction; raw outcomes remain external, including the incorrect TASK-2485 configuration claim, the TASK-2431 shell-argument bug and the TASK-2502 documentation contradiction.

## Artifact location and repeat commands

Detailed evidence is outside the repository at /mnt/data/code/parallix-artice-data/task-2658/. artifact-manifest.json records SHA-256 hashes. evaluation-52-89-summary.json retains the delivered-policy aggregates; task-2580-ten-runs.json and task-2580-variability-summary.json retain repeated-call data. Earlier experiments remain in earlier-experiments/ and matched-ordinary/ or matched-production/. TASK-2650's original scripts and packets remain at /mnt/data/code/parallix-artice-data/task-2650/.

Run tools/review-classification/replicate.ts with --archive, external --output and --live for the original 66 cases. Run validate-cases.ts with held-out --input, external --output and --repeats for a frozen independent sample. Run repeat-request.ts with replication --input, --case, external --output and --repeats 10 for identical-request variability. All experiments retain raw failures and never publish reviews or alter operational statistics.
