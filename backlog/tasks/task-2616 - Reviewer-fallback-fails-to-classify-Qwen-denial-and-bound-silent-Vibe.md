---
id: TASK-2616
title: Reviewer fallback fails to classify Qwen denial and bound silent Vibe
status: backlog
assignee: []
created_date: '2026-09-29 15:00'
updated_date: '2026-09-29 15:01'
labels:
  - bug
dependencies: []
priority: high
ordinal: 144008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
During TASK-2615 review on 2026-09-29, `npm run dev -- review --start` launched Qwen 0.21.9. Qwen exited 1 after `[API Error: 403 Access to model denied. Please make sure you are eligible for using the model.]`. Parallix logged `Skipping blocklist write for qwen; failure not positively classified as a provider availability/quota block` and fell back. Claude reached a session limit. Vibe 2.24.0 then produced no visible output for about five minutes, exited 1 with `Error: Rate limits exceeded. Please wait a moment before trying again.`, and Parallix again logged `Skipping blocklist write for vibe; failure not positively classified as a provider availability/quota block`. The review finally fell back to `custom (pi)`, the configured localAI family.

Investigate Qwen and Vibe CLI error formats and the paths through `src/application/services/agent-limit.ts`, `src/adapters/agents/agents.ts`, `src/adapters/agents/qwen.ts`, and `src/adapters/agents/vibe.ts`. Qwen's 403 may be model entitlement rather than a quota; distinguish that from provider-wide quota, bad credentials, transient transport, and generic crashes. Existing code intentionally avoids long family-wide blocks for deterministic setup errors; preserve that protection while preventing an unusable reviewer from being selected again on the next mission. Vibe's plural `Rate limits exceeded` wording appears unmatched by the current Vibe/Mistral patterns. Bound silent reviewer launches so fallback reaches `custom` without waiting indefinitely.
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
