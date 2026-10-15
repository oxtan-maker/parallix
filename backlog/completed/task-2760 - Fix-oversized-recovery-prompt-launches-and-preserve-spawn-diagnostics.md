---
id: TASK-2760
title: Fix oversized recovery prompt launches and preserve spawn diagnostics
status: done
assignee: [claude]
created_date: '2026-10-15 10:14'
labels:
  - bug
dependencies: []
priority: high
ordinal: 248008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-2746 is blocked resuming review after a successful static-analysis repair. Fix oversized Codex recovery prompt transport and preserve actionable launch errors; investigate retained incident selection so continuation does not unnecessarily inflate prompts with superseded failure output.

Observed evidence (2026-10-15): tmux session task-2746 and its retained transcript /run/user/1000/parallix-terminal/233bbddb32ac/task-2746.sock.log show a Codex repair launch with a 41,366-character prompt, a successful exact static-analysis rerun, then “not approved in re-review” with guidance to run px review task-2746 --continue. No E2BIG diagnostic is exposed there. A subsequent direct --continue using installed px 1.5.374 launched prompts of 188,583 and 155,871 characters; both failed immediately with ambiguous null exit status, before reviewer execution. The recovery dossier selected an older integration-ci failure (incident 2489860f29d34de9a26052ab3b052351b8b68183213dfd75af8d32da93fd6c9c, captured revision unresolved), even though current review round 5 remained pending without findings and retained integrationRepair named the Sonar quality gate. Determine whether these are legitimate outstanding obligations or stale selection; do not clear genuine obligations by assumption.

Safe local reproduction on Node v24.21.0/Linux: spawnSync(process.execPath, ["-e", "process.exit(0)", "x".repeat(size)]) succeeds for size 100000; sizes 155871 and 188583 return status:null, signal:null, error.code:E2BIG. This strongly supports an OS argument-size failure, but the exact failed agent spawn error was not retained in the visible diagnostic. Reproduce through the actual adapter with an isolated fake provider to establish causality without model calls.

At main 06e3e67d8 and TASK-2746 f8d8999d8, Codex passes the entire prompt as one argv element for fresh and resumed exec. Main already contains the same generic null-exit diagnostic in rebound-kernel.ts; TASK-2746 extracts it to rebound-launch-result.ts. Thus the prompt transport and loss of error detail predate this mission; do not claim a TASK-2746 regression without additional evidence. Check its launcher and prompt-building refactors against base nevertheless.

Use the provider-supported stdin prompt interface for headless Codex fresh/resume launches, verified against the installed CLI. Preserve exact prompt bytes, EOF, output capture, confinement, cancellation, session policy and terminal hosting. Keep provider syntax in adapters and thread transport through typed ports. Audit other provider launch paths for the same limit, bounding scope to demonstrated failures. Preserve error code/message and signal in structured recovery evidence and operator diagnostics; null must remain failure, never success. Avoid retries of the same deterministic oversized argv payload.

TASK-2759 (currently integration lane) covers direct operator acknowledgment of retained invalid-contract blockers, not oversized prompt transport or proof that an old incident is superseded. Coordinate without duplicating its acknowledgment policy. No gate bypass, truncation of mission contracts, synthetic approval, automatic integration or real operator database mutation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An owning regression is red on parent and green with the fix: an isolated real child receives an exact recovery prompt larger than 188583 UTF-8 bytes through the Codex adapter without E2BIG; cover fresh and resumed launches, multibyte content, EOF and cleanup.
- [ ] #2 Headless prompt transport preserves output/history capture, confinement, cancellation and existing session semantics through typed application ports and provider-owned adapter syntax.
- [ ] #3 Spawn failures expose actionable error code/message and signal in retained recovery evidence and CLI diagnostics; E2BIG is not collapsed to an ambiguous null exit and deterministic transport failure is not retried unchanged.
- [ ] #4 Trace TASK-2746 retained incident selection against current revision, verified repairs and pending review obligations. Retain an owning regression for any proven stale replay, or document evidence that selection is correct and file a separately scoped follow-up if necessary; preserve genuinely outstanding checks.
- [ ] #5 Compare implicated TASK-2746 launcher/prompt refactors with base and record evidence distinguishing pre-existing defects from introduced regressions.
- [ ] #6 Run focused owning checks through npm test and required static analysis; manually exercise fresh/resume CLI recovery using disposable state and a fake provider, with no paid model calls or live mission mutation. Update live operator guidance for changed launch diagnostics.
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
