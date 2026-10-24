---
id: TASK-2810
title: Make px review infer workflow state and remove redundant mode flags
status: done
assignee: [codex]
created_date: '2026-10-22 13:05'
labels:
  - bug
  - ai_sdlc
dependencies: []
priority: high
ordinal: 289008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Make px review [slug] the single operator entry for review. Start, resume, interrupted handoff and retained repair recovery must follow durable Mission/Review state instead of requiring operators to choose --start or --continue. Task-2807 exposed a loop: --continue requires a Review that does not exist, while --start does not acknowledge stale repair authorization and then misleadingly recommends pushing a PR.

Audit every review --parameter and its production callers. Remove meaningless mode selectors and redundant workflow switches, including --start and --continue, rather than adding another compatibility layer. Keep only options with a concrete independent operator purpose; move distinct record/write operations to their existing owning commands where appropriate. Preserve explicit agent selection and operator authority, independent review, evidence and verification requirements, returning failure semantics, and nested/automatic invocation boundaries. Do not conflate review with integration or silently grant approval.

Scope includes parser/help, application orchestration, board/lead and automatic callers, recovery guidance, owning tests and concise live documentation. No architecture principle changes, gate changes, budget increases, retries to mask failures, or live Mission/database/statistics mutations during verification.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Bare px review with inferred or explicit slug creates the first Review for a known Mission or resumes existing review/repair work from durable state; operators never need --start or --continue.
- [ ] #2 Audit remaining review flags against real callers and independent user intent; remove redundant mode selectors and migrate production callers/help together. Record the rationale for retained options in mission evidence, not a second live inventory.
- [ ] #3 Retain a focused reproduction of task-2807: no Review plus an explicitly acknowledged criteria correction reaches normal handoff/recovery without the missing-Review/stale-authorization loop or misleading push guidance.
- [ ] #4 Operator recovery retains diagnostics and correction provenance, supplies no proof or approval, and still stops on missing evidence, failing original checks and newly reported blockers. Nested/automatic invocations cannot acquire operator acknowledgment authority.
- [ ] #5 Preserve valid existing review progression, independent reviewer selection, explicit agent overrides, dry-run semantics, concurrency ownership and failure cleanup; no review command implicitly integrates or merges.
- [ ] #6 Extend owning suites with parent-red/fixed-green cases and manually exercise production CLI composition end to end using isolated state and safe boundary doubles; leave real Mission statistics, providers and database untouched.
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
