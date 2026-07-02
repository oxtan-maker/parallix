---
id: TASK-1398
title: mistral fails to launch
status: done
assignee:
  - claude
created_date: '2026-07-01 20:14'
updated_date: '2026-07-02 04:11'
labels:
  - bug
  - ai_sdlc
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
mistral is now unblocked (the usage block is lifted), but it still ends up in blocklist all the time so something is broken in the code handling mistral/vibe
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [x] #2 Lint and static analysis report clean on every changed file
- [x] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [x] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [x] #5 Docs updated to reflect any workflow or user-facing behavior change
- [x] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Root cause: `buildMistralInvocation` (lib/agents/mistral.ts:44) was the only agent-family launcher not passing a non-interactive tool-approval bypass — claude/opencode pass `--dangerously-skip-permissions`, codex sets `trust_level = "trusted"`, but mistral only passed `--trust` (which vibe's own `--help` documents as scoped to the working-directory trust prompt, not tool-call approval). Any non-interactive vibe run whose prompt needed a tool call failed with a generic error that matched none of the limit-hit or NON_BLOCKING_LAUNCH_ERROR_PATTERNS regexes, so `shouldPersistLaunchFailureBlock` (lib/agents/agents.ts:171-181) defaulted to writing a fresh 1-hour blocklist entry on every single launch — reproducing "unblocked, but ends up in blocklist all the time."

Explicitly ruled out the mission's originally drafted theory (importing `isHardOpencodeFailure` / expanding NON_BLOCKING_LAUNCH_ERROR_PATTERNS with resource-exhausted/auth patterns): those patterns don't match the reproduced failure text, and the resource-exhausted case is already handled correctly on the limit-hit path.

Fix: added `--yolo` to `buildMistralInvocation`'s args (lib/agents/mistral.ts:44), plus a doc update (docs/agents.md) reflecting the new invocation shape.

Evidence: test/agents.test.js:1939 (`mistral without a non-interactive tool-approval bypass gets re-blocklisted on every launch`) is a hermetic red→green reproduction — fails pre-fix with a persisted blocklist write, passes post-fix with zero block writes. test/mistral.test.js:58 pins the `--yolo` flag directly. `./scripts/verify-local.sh all` (1757/1779 pass, 0 fail) and `./scripts/verify-local.sh static-analysis` (ESLint 0 errors, tsc clean, test-hygiene clean) both pass on the final tree. Full checkpoint evidence in missions/task-1398/CP-1.md through CP-4.md.
<!-- SECTION:FINAL_SUMMARY:END -->
