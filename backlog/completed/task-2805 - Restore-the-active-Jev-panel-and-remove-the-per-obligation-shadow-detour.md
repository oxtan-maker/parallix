---
id: TASK-2805
title: Restore the active Jev panel and remove the per-obligation shadow detour
status: done
assignee: [codex]
created_date: '2026-10-21 12:44'
labels:
  - bug
  - ai_sdlc
dependencies: []
priority: high
ordinal: 284008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Outcome and locked operator decision

Remove the TASK-2753 per-obligation shadow route and restore the existing active three-question panel for the ordinary re-reviews it displaced. This is an authorized restoration, not a new classifier research mission. The operator explicitly rejects keeping the successful path disabled behind a new validation quota, activation flag, inferred safety requirement, or additional permission step.

TASK-2753 dispatches qualifying prior findings and human/operator requests into its per-obligation route before the existing panel. That route defaults to shadow and returns directly to the general reviewer, so the active panel never receives those cases. In the article's 114-round cohort, 42 rounds took that detour. Replaying only the dispatch bypass with frozen production code, the existing questions/thresholds and pinned Jev 1.13 cleared 4/42; all four were general-reviewer approved at the same revision. Four existing production packet hashes matched reconstruction exactly. Raw packets and 126 responses are retained privately.

## Implementation boundary

Restore the existing routing through tryClassifyReview. Remove the separate per-obligation dispatch, production shadow calls and its activation setting; do not merely add another opt-in around the panel. Preserve historical measurement/provenance decoding and stored research evidence. Keep the integration-repair V4/V5 path, first-review general reviewer, explicit global classifier shadow/opt-out, fallback rules, required human review and integration gates. Use the existing ports and composition; no architecture redesign is needed.

## Major agent guardrails: no policy invention

- Preserve the existing panel question bodies, prompt versions, thresholds and aggregation byte-for-byte. V3 approval stays 0.51; V1 approval stays 0.80; V1/original rejection stays 0.89. The original arm cannot approve and V3 cannot reject. Preserve existing conflict, invalid-response and provider-failure fallbacks.
- Preserve Jev 1.13 pinning, integration-repair questions and 0.60 threshold, evidence packing, omission handling and token budgets. Do not change these to obtain a preferred result.
- Do not add a general new-defect question, orphan-file guard, mandatory gate-rerun fact, whole-mission approval judgment, new evidence field requirement, calibration quota, higher confidence bar, new eligibility restriction or permanent shadow default. None is requested by this mission. Existing mechanical gates own execution checks.
- The previous prospective-shadow activation requirement is explicitly superseded for this restoration. Do not cite the old ADR or TASK-2753 as authority to reintroduce it. Update the current decision in documentation while preserving historical evidence.
- Do not silently route a previously eligible case to the general reviewer as a purported safety fix. Any proposed new blocker or policy change needs a separate, explicit operator decision. Report an unrelated problem with its concrete evidence; do not expand this mission to redesign Jev.
- Success must be demonstrated through the production review entry point and outcome persistence/publication boundary. A helper-only test, a mocked routing result, or wording claiming the panel is enabled does not establish restoration.

## Evidence and verification

Replay source: c95e5189fde1d2c647346d81c14a5474172852fb with only the TASK-2753 eligibility dispatch bypassed. Positive cases: px-0012 r2 (V3 addresses 0.53), px-0014 r7 (0.71), task-2762 r8 (0.58), task-2762 r12 (0.53). Preserve their raw responses and expected routing; do not retune or relabel them. Summary and controls: ../parallix-research/jev-article-2026-10-21/panel-replay-2753/{protocol.json,summary.json,control-parity.json,prepared/,results/,transport/}.

Extend the existing repeat-review and composition contracts and lifecycle E2E owner. Keep sanitized, self-contained recorded-response fixtures in the repository; CI must not depend on private research paths or fresh model calls. Reproduce the current diversion red on the parent, then green after restoration, including an existing 0.53 V3 clear that the shadow detour currently suppresses. Retain genuine failure fallbacks and first-review authority. Manually exercise the complete review path in an isolated repository/operator store using the existing E2E harness and recorded pinned responses, including the published/persisted classifier decision. Do not create production votes, mutate the real operator DB or contaminate px stats.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Ordinary qualifying re-reviews with prior findings or human/operator requests reach the existing active three-question panel by default; the TASK-2753 per-obligation/shadow dispatch and separate activation setting are removed.
- [ ] #2 An existing 0.53 V3 clear is reproduced as a routing failure on the parent and succeeds through the production review entry point after the fix, with classifier approval published/persisted through the existing boundaries.
- [ ] #3 All four recorded positive replay cases retain their expected clear through the restored route using self-contained frozen-response fixtures; the existing production-control packet hashes remain reproducible.
- [ ] #4 The panel question bodies, prompt versions, approval/rejection thresholds and aggregation, pinned model, integration-repair policy and packet fitting are unchanged; before/after diffs or hashes prove this.
- [ ] #5 First reviews still use the general reviewer; explicit global shadow/opt-out and existing malformed/missing/over-budget/provider-failure/conflict fallbacks retain their current behavior.
- [ ] #6 The repair path does not acquire a new eligibility blocker, mandatory gate fact, safety question, calibration quota or activation permission; human review and integration checks retain their existing authority.
- [ ] #7 Historical classifier measurements, observations and provenance remain readable; current docs remove the retired per-obligation activation advice and state the restored routing.
- [ ] #8 Focused red-to-green, composition and lifecycle checks pass; manual isolated E2E proves the restored decision without production votes or real-statistics writes; required documentation and static-analysis gates pass.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Protected source baseline at c95e5189fd: panel-questions.ts sha256 2bd44b2ff7b62022b0b0d9fc89a847beec8ab8d7acf28d456649fa1059d97975; panel.ts b1b5ee4c0a189abd08383b021f643a99315aacc55242908e666d840c6ae7b6c2; weakening-policy.ts e7a13986ab30201deec89a57c84e8d05b35c359806ca5b07fe5e18464c203f32; archived-packing.ts a3cc5d993faf42617aa33e80af7976907a5dcb7b7093596e257370f3b5083f2e; fit-packet.ts ff9367df3ba4e2f4c276a10b9de2551950854f325f34e99c19d3b128e350cc3d. Existing owners: test/unit/application/review-classification/repeat-review.test.ts, repeat-review-obligations.cases.ts, test/unit/composition/review-classification.test.ts, test/e2e/lifecycle/repeat-review-classification.test.ts; frozen-panel-regressions.json is the current fixture owner. Task IDs belong in cases/comments, not new suite filenames.
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
