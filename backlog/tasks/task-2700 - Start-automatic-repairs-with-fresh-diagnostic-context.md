---
id: TASK-2700
title: Start automatic repairs with fresh diagnostic context
status: backlog
assignee: []
created_date: '2026-10-09 13:44'
labels:
  - workflow
dependencies: []
priority: high
ordinal: 203008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Make fresh diagnostic context the default from the first automatic repair attempt. This is an operator-authorized policy change following the TASK-2697 first-repair pilot, not a claim that the complete recovery cascade has been experimentally validated.

Why: four paired first-repair replays consumed 66,878 versus 658,281 uncached input tokens, 1,936,469 versus 13,321,495 cached input tokens, and 31,155 versus 82,896 output tokens (fresh-first versus compact-instructed/resumed). Both produced contract-preserving patches for the same two cases; two resumed runs timed out. No new compaction record appeared. The pilot used selected historical snapshots, had dependency-wrapper issues, and stopped on green focused checks even after launch timeouts. It therefore does not establish full production policy success or savings. Implement the chosen policy with production launch and verification semantics, not the research harness stop rule.

Desired behavior: each agent-fixable rebound starts its dedicated fresh-diagnostic repair in a new ephemeral conversation, including attempt 1. If verification still fails and budget remains, the next repair also starts fresh, retaining valid repository work and receiving the original and latest failure evidence. Preserve the existing default two-attempt budget and its configuration semantics. Never retry a human-only or invalid-contract blocker merely because a fresh session is available. Exhaustion still escalates with actionable evidence.

Start by tracing the shared rebound policy, prompt composition and real launcher adapters on current main. Current selection is owned by src/domain/rebound-policy.ts and src/application/rebound-kernel.ts; use existing policy and session abstractions rather than adding a parallel recovery mechanism. The fresh worker must reload the locked mission scope, applicable repository rules, current revision, authorized repair/checkpoint obligations and durable failure evidence without inheriting the aborted conversation or an execute/review prompt that contradicts repair authority. A fresh session preserves the working tree and commits; it must not reset, clean away or silently recommit existing work.

Success remains a production decision: respect launch outcomes, committed-tree requirements and a successful rerun of the exact authorized check. A green dirty working tree or a timed-out launch must not be reported as a completed repair merely because an exploratory probe passes. Preserve the existing distinction between launch/session retries and spent repair attempts. Missing or incomplete evidence must be explicit; do not manufacture successful context retrieval.

Coordinate with TASK-2695, which owns dedicated repair checkpoints and structured invalid-contract escalation. Preserve its behavior if landed; do not duplicate that implementation or weaken contract locking to enable this change. Changes must stay within the existing architecture and adapter boundaries; repository architecture-decision rules still apply.

Evidence: resolve ../parallix-research from the primary checkout and read first-repair-context-20261009/REPORT.txt, manifest.json, classified-results.json and summary.json. Public derived rows and the article were committed on mission/task-2697 at cc25c7dcf0, with checksum correction 69f3d3969d; inspect those Git objects if not yet on main. Keep private sessions and credentials outside the repository. No additional benchmark or production-state experiment is required by this mission.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 First and subsequent agent-fixable automatic repair attempts select the fresh-diagnostic prompt and fresh-ephemeral session policy through the shared recovery policy; no first-attempt resume/compact-first path remains in those rebound launches.
- [ ] #2 Fresh repair receives locked scope, current revision, original/latest exact diagnostics and available durable evidence/checkpoint obligations, with missing evidence stated explicitly; previous conversation and conflicting execute/review instructions are absent.
- [ ] #3 Valid commits and working-tree changes survive between attempts. A failed first verification can launch a second independently fresh conversation with updated evidence, within the existing repair budget; exhaustion and human-only/invalid-contract escalation retain their authority.
- [ ] #4 Production launch outcomes, committed-tree checks and the exact authorized verifier own success. Cover launch timeout/failure, dirty-but-green work, verification failure, successful committed repair and stale evidence without importing the pilot stop-rule defect.
- [ ] #5 All supported real launcher adapters honor fresh-ephemeral on attempt 1 as well as later attempts; unsupported or failed launches remain explicit and never silently reuse historical context. Recovery telemetry records the actual strategy without rewriting historical statistics.
- [ ] #6 Extend the owning policy, rebound, prompt and launcher contract suites under ADR 0057, including a regression red against the previous resume-first behavior. Run focused checks and required static analysis; update live recovery guidance and run docs verification.
- [ ] #7 Manually demonstrate an isolated end-to-end flow through the real launcher boundary: seed recognizable prior-session content, verify it is absent from the first repair, force one failed required check, verify a second fresh attempt preserves valid work and original/latest evidence, then demonstrate success or bounded escalation. Use scratch repository/state and finite limits; do not modify the real operator database or production statistics.
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
