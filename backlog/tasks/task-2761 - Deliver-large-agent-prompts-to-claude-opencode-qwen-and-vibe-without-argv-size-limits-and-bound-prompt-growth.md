---
id: TASK-2761
title: >-
  Deliver large agent prompts to claude, opencode, qwen and vibe without argv
  size limits, and bound prompt growth
status: backlog
assignee: []
created_date: '2026-10-15 10:50'
labels:
  - bug
dependencies:
  - TASK-2760
references:
  - >-
    backlog/tasks/task-2760 -
    Fix-oversized-recovery-prompt-launches-and-preserve-spawn-diagnostics.md
  - src/adapters/agents/claude.ts
  - src/adapters/agents/opencode.ts
  - src/adapters/agents/qwen.ts
  - src/adapters/agents/vibe.ts
  - src/adapters/process/bubblewrap.ts
  - src/adapters/process/tmux-host.ts
priority: high
ordinal: 249008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Every agent family that receives its whole prompt as one argv element fails to launch once the prompt exceeds Linux MAX_ARG_STRLEN (131072 bytes per argument). TASK-2760 (in flight) fixes Codex; this mission fixes the remaining argv-prompt providers so they handle realistic prompt sizes, and bounds unnecessary prompt growth.

Observed evidence (2026-10-15), transcript /run/user/1000/parallix-terminal/233bbddb32ac/task-2746.sock.log:
- review round 5: claude launched with a 131100-char prompt (just over the limit) and failed with `command.sh: 4: exec: bwrap: Argument list too long`, exit 126. Fallback then picked custom (pi).
- act-on-review: qwen (187635 chars) failed the same way, exit 126 (codex too; TASK-2760 covers it).
- Skipping blocklist write is correct (not a quota block), but the next agent gets the same oversized payload, so every argv provider fails in turn until pi.
- pi is unaffected: pi.ts hands the prompt to an SDK/worker, not argv. claude.ts (`args.push('-p', prompt)`) and opencode.ts (`args.push(prompt)`) pass the prompt as argv; audit qwen.ts and vibe.ts. wrapWithBubblewrap in bubblewrap.ts prepends bwrap, so the failing exec is bwrap inside tmux-host command.sh.
- Prompt sizes in TASK-2746 grew across rounds: 74926, 109791, 187556/187635, 131179/131100 chars. Only task-2746 hits the error among retained transcripts, so it surfaces only when prompts grow.

Part 1, transport (primary): for claude, opencode, qwen and vibe (whichever pass the prompt as argv), deliver the prompt through the provider-supported stdin or provider-documented file interface, verified against the installed CLI, for fresh and resumed launches. Reuse the typed transport port and diagnostics that TASK-2760 introduces for Codex; do not build a parallel mechanism. Preserve exact prompt bytes, EOF, output/stream-json capture, confinement (bwrap), cancellation, session/resume policy and tmux terminal hosting. Provider syntax stays in adapters.

Part 2, prompt size (secondary): measure review and act-on-review prompt composition per section across rounds (contract, diff, prior-round history, incident/recovery dossier, verification output). Remove redundant or superseded content, or replace inlined artifacts with on-disk references the agent can read. Do not break delivery of TASK-2746, the mission that exposed this: mission contract, current findings and genuine outstanding obligations must stay. No truncation of contracts or silent drop of required context. Transport must work for arbitrarily large prompts regardless of size reduction.

Out of scope: Codex transport, retained incident selection and spawn-diagnostic structure (TASK-2760); operator acknowledgment of invalid-contract blockers (TASK-2759). No gate bypass, synthetic approval or real operator database mutation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Owning regression red on parent and green with the fix: for each of claude, opencode, qwen and vibe that passed the prompt as argv, an isolated fake provider child receives an exact prompt larger than 188583 UTF-8 bytes (multibyte included) without E2BIG, for fresh and resumed launches, with EOF and cleanup.
- [ ] #2 The regression covers the bwrap-wrapped tmux-hosted launch path (command.sh) that previously failed with exit 126 'Argument list too long'.
- [ ] #3 Each provider's stdin/file prompt interface is verified against its installed CLI; output capture, confinement, cancellation and session semantics are unchanged; transport goes through the typed port from TASK-2760 with provider syntax in adapters.
- [ ] #4 Review and act-on-review prompt composition is measured per section across rounds; redundant or superseded content is removed or referenced from disk, with a regression bounding growth across rounds, while contract, current findings and outstanding obligations stay intact.
- [ ] #5 Manual e2e: with disposable state and fake providers (no paid model calls, no live mission mutation), a review and an act-on-review launch with a >188 KB prompt succeed for claude, opencode and qwen without falling back to pi.
- [ ] #6 Focused owning checks pass via npm test, ./scripts/verify-local.sh static-analysis is clean, and live operator docs are updated if launch behavior visible to operators changes.
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
