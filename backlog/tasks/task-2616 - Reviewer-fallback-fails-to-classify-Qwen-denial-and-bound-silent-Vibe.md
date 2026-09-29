---
id: TASK-2616
title: Reviewer fallback fails to classify Qwen denial and bound silent Vibe
status: backlog
assignee: []
created_date: '2026-09-29 15:00'
labels:
  - bug
dependencies: []
priority: high
ordinal: 144008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
During TASK-2615 review on 2026-09-29, the repository CLI `npm run dev -- review --start` launched Qwen 0.21.9. Qwen exited 1 after `[API Error: 403 Access to model denied. Please make sure you are eligible for using the model.]`. Parallix logged `Skipping blocklist write for qwen; failure not positively classified as a provider availability/quota block` and fell back. Claude then reached a session limit. Vibe 2.24.0 was selected and stayed silent for more than four minutes while the review launcher only reported observational no-output notices; this may be a usage cap or a CLI/reporting change, but the cause is not yet proven. The expected final fallback is the configured `custom` family (localAI).

Investigate the exact current Qwen and Vibe exit, stderr, stdout, and session-log formats and the paths through `src/application/services/agent-limit.ts`, `src/adapters/agents/agents.ts`, `src/adapters/agents/qwen.ts`, and `src/adapters/agents/vibe.ts`. Distinguish provider quota or availability from model entitlement, bad credentials, transient transport, and generic crashes. Existing code intentionally avoids long family-wide blocks for deterministic setup errors; preserve that protection while preventing the same unusable reviewer from being selected repeatedly on subsequent missions. Bound a silent Vibe launch so review can reach the next eligible family, including `custom`, without operator intervention.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Capture sanitized current Qwen 403 and Vibe failure or silent-run fixtures; add red-to-green tests for classification, block or retry scope, expiry, and review fallback.
- [ ] #2 Provider-wide quota and availability failures persist a checked runtime block; model entitlement or credential failures receive actionable, scoped handling without falsely poisoning a healthy family.
- [ ] #3 A reviewer with no useful output has a finite, configurable liveness outcome and can fall back to the next eligible family, including custom; cancellation and descendant cleanup remain correct.
- [ ] #4 Quoted error text in a successful agent run, a generic exit 1, and transient transport failures do not create an inappropriate long block.
- [ ] #5 Verify the fix through focused tests and the required static-analysis and review gates; document any changed operator-facing behavior.
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
