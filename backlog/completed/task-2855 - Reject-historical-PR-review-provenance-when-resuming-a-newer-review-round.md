---
id: TASK-2855
title: Reject historical PR review provenance when resuming a newer review round
status: done
assignee: [codex]
created_date: '2026-11-14 09:16'
labels:
  - bug
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Observed on 2026-11-14 while unblocking px-0054.02 at 2678b2d230608cc93ed6ea20416eb15a7b23dd69. Round 25 approved 2141f69ae5d97dee377ed48c102cd1278fd868b4. Integration repair withdrew that approval and opened round 26 on 2678b2d23. The stored round-26 request-changes comment instead says "Review of 2c4670276" and carries explicit "Review provenance: round 22; actor custom; revision 2c46702761f32a82f14bf2d09220da2aa0e16b15" plus the round-22 publication marker. Round 26 also shows decidedRevision 2141f69ae, not its start revision. Its implementer disputed stale F1 and recorded PUSHBACK_ALL; the mission remained active with orphaned review. This is a provenance mismatch observed in persisted state, not proof of which provider read or publication retry caused it.

Read-only evidence: px status px-0054.02 --json (version 606, rounds 25/26 and integrationRepair timeline); px history px-0054.02 show run:execute-codex-a1-mwg4zt1c:stdout@0+2048 records the implementer response and focused verification. PR #857: http://localhost:3300/magnus/parallix/pulls/857. Do not use the live mission or PR as test fixtures or rewrite historical operator records.

Investigate the existing owners src/application/review-loop/provider-observations.ts, src/adapters/review/review-provider-observations.ts, src/adapters/review/review-observation-recording.ts, src/adapters/review/review-workflow-posting.ts and provider polling. Trace submittedAt versus round provenance, revision attribution, recovered publication timestamps, and integration-repair handoff. Preserve valid current human feedback and existing source-of-authority rules. Reuse the owning suites with isolated state. This crosses provider observation and round authority; no speculative one-line timestamp filter, parallel ledger, new migration, new verification gate or budget change.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An isolated reproduction shows an old round-22 request-changes body/marker cannot become the round-26 decision after repair opens a newer revision; retain it red on the parent and green with the fix.
- [ ] #2 Provider observation and recovered publication preserve original round, actor and reviewed revision, rejecting or ignoring mismatches before decisions, findings, lifecycle or PR mutations.
- [ ] #3 A matching current review still applies, repeated recovery remains idempotent, and existing approval retention, human feedback and publication recovery assertions pass.
- [ ] #4 Manually exercise the public CLI with disposable mission/provider state and verify the later round resumes without stale findings; no live operator database, PR or statistics correction.
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
