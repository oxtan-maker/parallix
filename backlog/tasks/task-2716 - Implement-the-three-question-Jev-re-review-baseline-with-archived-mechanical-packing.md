---
id: TASK-2716
title: >-
  Implement the three-question Jev re-review baseline with archived mechanical
  packing
status: backlog
assignee: []
created_date: '2026-10-10 13:44'
updated_date: '2026-10-10 13:49'
labels:
  - ai_sdlc
  - enhancement
dependencies: []
references:
  - /mnt/data/code/parallix-research/jev-10-10/proposed-baseline.json
  - >-
    /mnt/data/code/parallix-research/jev-10-10/combination-validation-10/policy.json
  - /mnt/data/code/parallix-research/jev-10-10/combination-audit/REPORT.txt
  - >-
    /mnt/data/code/parallix-research/jev-10-10/combination-validation-10/REPORT.txt
  - /mnt/data/code/parallix-research/jev-10-10/packing-improvements/REPORT.txt
  - >-
    /mnt/data/code/parallix-research/jev-10-10/microsoft-decision-1/threshold-sweep.txt
priority: medium
ordinal: 217008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the frozen three-question Jev re-review baseline selected by the operator on 2026-10-10. The investigation is closed; this mission implements the chosen candidate rather than continuing prompt/model/context tuning. The operator will generate 10 genuinely new samples through regular Parallix development 1-2 days after implementation, then evaluate that cohort separately. Do not make delivery depend on historical data that has already been exhausted.

Problem and intended outcome
The current classifier usually defers to the general reviewer. Archived mechanical context plus complementary Jev questions produced additional supported decisions without observed errors on the fitted development set. Use the frozen decision policy below for eligible re-reviews, preserving the ordinary reviewer fallback. There is no promise of zero real-world error or 37% production coverage.

Frozen decision policy
- Use the existing configured Jev provider/model route (the research requested jev-latest and received typesafe/jev-1.13-20260917). Do not substitute Microsoft Decision 1: it failed the known unsafe-clear controls, and tuning did not establish a superior candidate.
- Build one immutable archived-mechanical state from the authoritative prior reviewer findings/comment, recorded implementer response and pinned candidate evidence. Send that SAME state through three separate decision requests, each with exactly one resolution question. These experiments used separate calls; do not silently combine them into a multi-question provider request or short-circuit on the first approval, because a later rejection must be able to veto it.
- V3: approval vote only when selected=addresses AND probabilities.addresses >= 0.51. Its does_not_address output NEVER votes to reject.
- V1: approval vote only when selected=addresses AND probabilities.addresses >= 0.80; rejection vote only when selected=does_not_address AND probabilities.does_not_address >= 0.89.
- Original: rejection vote only when selected=does_not_address AND probabilities.does_not_address >= 0.89. Its addresses output NEVER votes to approve.
- An insufficient_evidence choice, a below-threshold result, or a disabled decision channel contributes no vote. Use choice probability, not the separate confidence field. Comparisons are >=, without rounding model probabilities first.
- Aggregate all three: at least one approval and no rejection -> existing approval route; at least one rejection and no approval -> existing implementer-return route; both directions or neither direction -> general reviewer. Any packet/budget/provider/schema failure in any panel member defers the entire panel to the general reviewer. Never apply a partial-panel approval. Evaluate and apply at most one guarded workflow decision for the pinned revision/version after the panel completes.
- Preserve current first-review disablement, opt-out/availability checks, classifier-provenance guard on prior decisions, rebase/gate ordering, revision/version drift refusal, and existing typed ports/composition authority. Do not restore recursively classifying the classifier's own returns. The chosen panel thresholds replace tuned question-specific thresholds only for this eligible re-review panel; do not layer older gate-specific shortcuts or special case individual missions.

Archived mechanical packing to port
Reference executable: /mnt/data/code/parallix-research/jev-10-10/fresh-validation-10/pack.py; imported window algorithm: /mnt/data/code/parallix-research/parallix-artice-data/task-2650/task-2650-context-development/window-extract.py. The replay matched all 42 existing development states semantically; 38 matched exactly and four differed only in Git index-line blob-hash abbreviation. Port this repository-neutral algorithm to the existing evidence boundary, not its research paths or database access.
- State carries exact finding text, prior review comment, implementer response, candidate source excerpts, scoped repair diff, omission/coverage markers and existing recorded-validation authority. Do not serialize entire database rows or irrelevant null administrative fields. Claims remain claims; do not generate LLM summaries.
- Roots come from paths actually cited in prior review, findings/locations and implementer response. Resolve exact paths first, then unique basenames in the pinned candidate tree; ambiguous basenames do not resolve. Preserve deterministic reference order. No analyst-selected files, repository-specific bug rules, global inferred dependency expansion or arbitrary whole-repository context.
- Replay the archived base-window then unique-basename expansion and complete-files promotion, including their fallback rules. Small text files <=6000 UTF-8 bytes are whole; otherwise radius-30 line windows use cited line hints, changed-line anchors and bounded lexical symbol occurrences. Keep explicit omitted ranges and boundary claims. Use the retained executable for exact anchor/order limits rather than inventing a new selector.
- Use the archived cited-path unified-0 diff, retained only within its 15000-byte allowance, and the archived whole-packet 90000-byte ceiling (using the original question for that legacy packing calculation). Promote all referenced files to complete files together only when that packet fits; otherwise retain bounded excerpts. Validate EVERY final question request against <=32000 input tokens AND the existing production <=30000 state-plus-longest-question/context ceiling, byte ceiling and provider limits. Unknown budgets or unavailable revisions/source stay reviewer fallbacks. Do not silently truncate mandatory review obligations to make a packet fit.
- Existing research used Git blob abbreviations fixed at nine characters for the fresh replay. Cosmetic differences must be documented; material state/source-selection changes require rerunning the frozen comparison and are outside this mission's authority to retune.
- Do not adopt checkpoint enrichment, the omitted-changed-text/change-manifest expansion, or full-delta packing from rejected experiments. The changed-text arm restored unsafe TASK-2640 approvals. References to actual pinned source or historical records must not be replaced with later reviewer outcomes or current mutable checkpoint rows.

Evidence and limitations
On the 46 development samples, the selected channel combination yielded 10 supported approvals + 7 supported rejects, zero observed errors in the retained audit (17/46=37%). These include synthetic before/correction finding samples and correlated revisions; this is fitted evidence, not an independent coverage estimate. The plain union that retained V3 rejections still made the known wrong TASK-2500.05 reject, which is why V3 is approval-only.
On the next frozen 10-case cohort, the panel made one supported approval (TASK-2658 r2 via V1 at 86%), zero relative errors, and nine deferrals; V3 alone deferred all 10. Three packets could not be built, and all ten historical outcomes were approvals. This demonstrates one complementary decision, but no reliable improvement over the previous 10% headline coverage and no rejection-recall estimate. A further draw exhausted useful unseen families: eight preparation failures and two all-deferred runnable panels. Do not report these failures as model errors or claim that ten additional fresh model decisions were validated.
Historical general-review decisions are comparators, not absolute ground truth. For the future operator cohort, separately report relative agreement/improvement/shared error and source-supported correctness. A shared mistake remains an absolute error even if counted positive for relative parity. An unsafe clear is an unresolved prior obligation or a regression caused by its repair; unrelated new review findings do not automatically make a scoped repair clear wrong. Retain ambiguous cases explicitly.

Exact frozen question bodies (do not paraphrase)
```json
{
  "v3": {
    "resolution": {
      "type": "choice",
      "instructions": "Decide whether the repair resolves every prior finding and is safe across the directly affected change surface. The scope includes consequences introduced by the repair, not just the previously named failure mode. Evaluate two requirements together: (1) the requested correction is actually implemented; (2) the correction preserves consistency of affected producers, consumers, configuration and descriptions. Complete referenced files are NOT proof of a complete change surface, and a diff restricted to cited paths may hide other repair changes. For changes to user-facing meaning, classifications, quantities, precision, output formats or terminology, verify the affected consumer-facing descriptions/labels as well as the producing code. A corrected producer alone cannot establish that related descriptions remain accurate. For shared runners, verify argument/configuration composition under the supported invocation variants, not only the tested local path. Choose insufficient_evidence if these material counterparts or paths are absent; do not assume they are correct just because the original finding was narrower. Do not demand unrelated context or new runtime proof for self-contained document/test corrections. Choose does_not_address only for an evidenced unresolved obligation or evidenced related regression, never for an unproven possibility. Exclude unrelated pre-existing defects and improvements. Implementer claims and historical approvals are not authoritative proof.",
      "criteria": {
        "addresses": "Both requirements are supported: all prior findings resolved AND consistency/preservation established across materially affected paths and content. A local fix with missing material consumer/description evidence is not addresses.",
        "does_not_address": "Supplied evidence demonstrates an unresolved prior finding or a related regression from the repair.",
        "insufficient_evidence": "The local correction may work, but missing material change-surface, counterpart, supported-invocation or description evidence prevents establishing safe resolution."
      }
    }
  },
  "v1": {
    "resolution": {
      "type": "choice",
      "instructions": "Assess whether the candidate resolves all prior findings without introducing a related regression. Check the changed behavior and its directly affected callers, configuration, tests and documentation. A locally correct fix is incomplete if it breaks another supported use of that behavior or leaves related content inconsistent. Exclude unrelated pre-existing defects and unrelated new improvements. Do not exclude a defect merely because the previous reviewer did not mention it: regressions introduced by the repair are in scope. Treat implementer claims as claims; check them against supplied evidence. Match evidence to the obligation: document and checkpoint fixes can be established by document or record changes; executable fixes require tracing executable behavior. Do not require fresh test execution where prior findings permit carrying forward evidence. Choose insufficient_evidence for a specific material missing fact, not does_not_address. Judge the repair and its direct consequences, not unrelated whole-mission quality.",
      "criteria": {
        "addresses": "Every prior obligation is resolved, and supplied evidence supports preservation of directly affected behavior and content.",
        "does_not_address": "Evidence demonstrates an unresolved prior obligation or a related regression introduced by the repair.",
        "insufficient_evidence": "A specific missing fact prevents determining whether the prior obligations are resolved and directly affected behavior/content preserved."
      }
    }
  },
  "original": {
    "resolution": {
      "type": "choice",
      "instructions": "Assess whether candidate source addresses the entire specific review finding. Trace executable behavior and relevant dependencies. Comments and implementer claims are not proof. Do not approve the whole mission, demand unrelated improvements, or infer runtime tests passed. Select insufficient_evidence when omitted dependencies or ambiguous contracts prevent a reliable judgment. A repair must preserve required behavior on the repaired path: removing a symptom by preventing normal completion, suppressing required output, or introducing another failure does not resolve the finding. Treat implementer explanations as claims to check against source. If preservation cannot be established from supplied evidence, select insufficient_evidence.",
      "criteria": {
        "addresses": "The supplied executable source removes all failure modes described in the specific finding.",
        "does_not_address": "The supplied source demonstrates at least one described failure mode still exists, including an incomplete fix.",
        "insufficient_evidence": "The supplied source does not support a reliable resolution judgment."
      }
    }
  }
}
```

Scope and verification
Implement through the current evidence/classification/decision/telemetry boundaries. Follow AGENTS.md for architecture changes, owning suites, ADR 0057 test selection and file caps; this mission grants no architecture exception. Use existing owning suites rather than task-numbered executable files. Focused contract verification plus static analysis is required; Parallix owns the broader automatic gates. Manually demonstrate the composed three-call panel and workflow application in a disposable home/database/provider fixture or safe sandbox; never alter operator DB/stats or real historical PR verdicts to test this change.
Persist or retain enough bounded, reproducible measurement evidence through existing interfaces to collect the next 10 real samples: policy/question version, packing version and hash, pinned prior/candidate revisions, actual returned model, each selected choice/probability/vote, aggregation/fallback reason and per-panel calls/tokens/cost. Preserve existing deduplication and avoid counting three questions as three review rounds or three applied workflow decisions. The post-implementation ten-sample study is operator follow-up, not a fabricated test result or automatic success-criterion completion.

Sandbox access: Parallix Bubblewrap mounts the host root read-only, so the absolute research references above are readable from mission worktrees, including worktrees under /tmp. A Bubblewrap read probe verified the baseline policy and both packer source files. Resolve these references by absolute path, not relative to the mission worktree; no /tmp copy is required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Eligible re-reviews execute the exact three separate resolution questions on one identical immutable mechanically packed state; configured Jev route and actual returned model are retained. First reviews and prior-classifier decisions still go to the general reviewer.
- [ ] #2 Panel routing implements V3 approve>=0.51 only; V1 approve>=0.80/reject>=0.89; original reject>=0.89 only; selected-choice probabilities determine votes. Both/no directions, incomplete panel, invalid result or budget/provider failure defer to the general reviewer; revision/version guards prevent stale or duplicate application.
- [ ] #3 Archived packing is reproduced mechanically with pinned source, deterministic exact-path/unique-basename resolution, archived windows/diff/complete-file promotion and the stated budget/fallback behavior. No irrelevant DB/null-field dump, hand-selected context, checkpoint enrichment, changed-text expansion or full-delta substitution is introduced.
- [ ] #4 Owning contract suites cover inclusive threshold boundaries, disabled channels, insufficient evidence, conflicting votes, no votes, any-panel-member failure, over-budget/missing evidence, identical state across calls and exactly-once guarded application. Fixtures are isolated and existing first-review, provenance and stale-version protections remain green.
- [ ] #5 The retained scoped regression evidence reproduces the chosen policy: TASK-2586 and both TASK-2640 repair-regression samples cannot clear; TASK-2500.05 V3-only reject cannot return to the implementer; complementary TASK-2598/TASK-2637.03/TASK-2626 decisions and fresh TASK-2658 approval have faithful retained fixtures or reproducible bounded artifacts. Do not tune prompts/thresholds or curate per-case context to satisfy fixtures.
- [ ] #6 Telemetry records per-question votes and whole-panel outcome/fallback, actual model, policy/packing identity, revisions and bounded usage/cost through existing interfaces without double-counting workflow decisions. The next 10 operator-generated samples can be audited/replayed reproducibly without persisting credentials or writing synthetic production statistics.
- [ ] #7 Focused owning tests and ./scripts/verify-local.sh static-analysis pass; changed live behavior/rationale is documented and ./scripts/verify-local.sh docs passes when live docs change. Required final checkpoint evidence cites actual commands, tests and durable file references.
- [ ] #8 Implementer manually exercises the composed panel end to end in isolated disposable state, demonstrating approval, return, conflict/failure fallback and stale-result refusal with durable evidence. No real operator DB, stats or historical PR decisions are mutated for validation.
- [ ] #9 Delivery notes clearly identify this as the operator-chosen experimental baseline, report fitted 17/46 dev and 1/10 fresh coverage with limitations, and describe collection/evaluation of 10 new regular-development samples in 1-2 days. Future sample generation is not claimed completed and does not block this implementation mission.
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
