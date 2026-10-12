---
id: TASK-2732
title: >-
  Fix Jev re-review packet bugs: ignored rebase baseline, byte caps, space paths
  and mislabelled fallback
status: done
assignee: [codex]
created_date: '2026-10-12 12:30'
labels:
  - bug
  - ai_sdlc
dependencies: []
references:
  - ../parallix-research/px-0010/README.md
priority: high
ordinal: 230008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Bugs found by px-0010 research (../parallix-research/px-0010/README.md sections 3, 6, 7). The production re-review classifier packs evidence with buildArchivedEvidencePacket (src/application/review-classification/archived-packing.ts, introduced by TASK-2716). Packet sizing must use only the decision adapter tokenizer (requestBudget), never byte proxies.

1. Rebase baseline ignored: classify-review passes missionRange, but packArchivedState diffs the raw prior..candidate range, so rebased main changes appear as repair changes (17-100 files vs 1-7 mission files in px-0010 samples). TASK-2704's missionInterdiff in repair-evidence-packet.ts is no longer called in production. Use the mission interdiff when both subjects kept a baseline. Because a rebase-relative diff hides failures fixed by main, supply the rebase fact alongside it: prior and candidate main baselines and main commits touching paths named by the failure (px-0010 I10; task-2717 r6 was fixed by main 69a9419).
2. Byte caps: diff is replaced by 'Diff exceeds bounded allowance' above 15000 bytes (constant from 3f64ad9806 with no rationale), and packets over 90000 bytes fail. Replace with tokenizer-only admission; drop whole files largest-first only when the token budget refuses, and record the omissions.
3. stablePatch in src/adapters/review/review-evidence.ts matches headers with ^diff --git a/(\S+) b\/, so paths containing spaces (every backlog/tasks/task-NNNN - Title.md) are attributed to the previous file or dropped from interdiff paths.
4. Diff restricted to cited paths: packArchivedState only diffs paths literally named in the finding, comment or response, so repairs in uncited files (for example test/lib/test-cpu-budgets.json) produce an empty diff (6 of 15 reconstructed packets). Include the interdiff paths.
5. Telemetry mislabel: archived-window-preparation-fallback (no cited path exists in the candidate tree) is recorded as evidence-over-budget; all 7 px-0010 over-budget rows were this case. Record a distinct fallback reason.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each defect has a focused reproduction in its owning suite, red on the parent and green with the fix.
- [ ] #2 Re-review packets use the mission interdiff plus the rebase fact when both subjects kept a baseline, and include changed files not cited in the finding text.
- [ ] #3 No byte-based caps remain in re-review packet sizing; admission uses the decision adapter tokenizer and records token-budget omissions.
- [ ] #4 Interdiff path attribution is correct for paths containing spaces.
- [ ] #5 No-selectable-excerpt fallbacks are recorded under their own telemetry reason, distinct from evidence-over-budget.
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
