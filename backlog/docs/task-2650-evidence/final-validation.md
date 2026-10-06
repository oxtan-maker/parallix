# Final fresh validation: improved mechanical packets

Twenty unqueried mission families were selected in fixed seed order after both historical revisions were verified extractable. One actual re-review per mission; historical verdicts did not select the sample. Packets were frozen before calls. No LLM prepared the evidence.

Builder: literal paths/unique explicit basenames, complete selected files if the whole packet fits, otherwise the frozen parser-free windows. Actual previous review and implementer response included; missing source and omissions stay explicit. Fixed selected-choice thresholds: resolved ≥51%, unresolved ≥90%; otherwise general reviewer.

**Result:** three clears, zero returns, 17 escalations (11 Jev abstentions and six context fallbacks). All three clears agree with historical approvals; all six historical rejections escalate. Fourteen Jev calls completed.

Packet preparation and API work: **7.81 seconds** total. Three avoided two-minute rounds gives **14.7% estimated net time savings**. The two-minute figure is the operator's median, not measured per-case review duration. Source screening/archive work is excluded; corpus collection is experimental work, not runtime packet preparation.

| Mission | PR | Historical review | Jev choice / selected score | Route |
|---|---:|---|---|---|
| task-2544 | 476 | REQUEST_CHANGES | insufficient_evidence / 51% | General reviewer |
| task-2485 | 409 | APPROVED | Context fallback: no structural excerpts | General reviewer |
| task-2551 | 482 | REQUEST_CHANGES | insufficient_evidence / 96% | General reviewer |
| task-2460 | 395 | APPROVED | insufficient_evidence / 75% | General reviewer |
| task-2506 | 435 | APPROVED | insufficient_evidence / 72% | General reviewer |
| task-2457 | 386 | REQUEST_CHANGES | insufficient_evidence / 77% | General reviewer |
| task-2497 | 426 | APPROVED | addresses / 60% | Clear prior findings |
| task-2546 | 478 | REQUEST_CHANGES | Context fallback: no structural excerpts | General reviewer |
| task-2524 | 453 | APPROVED | insufficient_evidence / 94% | General reviewer |
| task-2443 | 362 | APPROVED | Context fallback: oversize | General reviewer |
| task-2431 | 351 | APPROVED | Context fallback: oversize | General reviewer |
| task-2502 | 424 | REQUEST_CHANGES | insufficient_evidence / 66% | General reviewer |
| task-2429 | 361 | APPROVED | addresses / 51% | Clear prior findings |
| task-2509 | 441 | APPROVED | Context fallback: no structural excerpts | General reviewer |
| task-2490 | 417 | REQUEST_CHANGES | Context fallback: oversize | General reviewer |
| task-2437 | 374 | APPROVED | insufficient_evidence / 54% | General reviewer |
| task-2498 | 425 | APPROVED | addresses / 57% | Clear prior findings |
| task-2533 | 462 | APPROVED | insufficient_evidence / 60% | General reviewer |
| task-2569 | 492 | APPROVED | insufficient_evidence / 64% | General reviewer |
| task-2515 | 440 | APPROVED | insufficient_evidence / 91% | General reviewer |

Pass inspections: TASK-2497 replaces ancestry detection with existing squash-payload detection and adds fixture-git coverage; TASK-2429 turns non-zero workflow exits into board failures; TASK-2498 restricts assignee fallback to review sessions. Source changes and actual historical approval comments agree on these fixes. No runtime tests were re-enacted.

TASK-2498 review metadata pins the tested fix commit, which its body explicitly confirms. The body also mentions another short HEAD that could not be retrieved; this provenance limitation is retained. Exact revisions, review/comment IDs, source inputs, request hashes, responses, screening exclusions and inspections are in the external archive.

This measures agreement with historical reviewers, not universal bug correctness. No disagreements required filtering for new findings or reviewer errors. Three clears are insufficient to establish a false-pass rate below 5%. The result meets the agreed pilot criterion and prompted TASK-2658, with opt-in routing and shadow comparison before autonomous rollout.
