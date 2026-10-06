---
id: TASK-2674
title: >-
  Attempt Jev before reviewer after repair and restore credentials for
  retained-console commands
status: done
assignee: [codex]
created_date: '2026-10-06 18:52'
labels:
  - bug
dependencies: []
priority: high
ordinal: 188008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Observed 2026-10-06 during TASK-2670 round 5 on Forgejo PR #608: after pre-review verification, the loop refreshed graphify and launched custom/pi, then waited for custom capacity. No Jev attempt or fallback reason appeared. Operator requires Jev to be attempted before the general reviewer, including after integration repair.

Confirmed environment defect: live px review --continue PID 1375823 was a direct child of retained console /bin/sh -i PID 3974828, under mission tmux server PID 3974825. All three initial environments lacked JEV_*, TYPESAFE_*, OPENROUTER_* and AI_GATEWAY_* variables. Operator OPENROUTER_API_KEY export is in ~/.bashrc (value was never printed). tmux-host.ts hostScript starts server using env -i with a small allowlist and creates retained console as /bin/sh -i, which does not load ~/.bashrc. Fresh externally launched operations transport their caller environment through pane.env, but a command typed into the retained console bypasses that transport. Preserve credential isolation of server/console and resolve an operator-authorized credential source for subsequent CLI commands rather than blindly retaining secrets.

Independent routing blockers: tryRepeatReview excludes round.integrationRepair before provider availability or telemetry. It also requires prior decision.kind === changes-requested plus an implementer response. TASK-2670 round 4 had an approved decision revoked by integration-gate-failure, no resulting_revision or response; round 5 was reviewing. Existing repeat-finding evidence contract therefore cannot classify this repair. Design suitable verified repair evidence and safe fallback before extending eligibility; do not reinterpret a revoked approval as ordinary reviewer findings.

Observability defect: early eligibility exits, unavailable provider, packet fallback and classifier exceptions are silent; only an applied Jev decision logs. No classifier measurement for TASK-2670 was found in operator SQLite state at diagnosis. Missing credentials did not cause this specific early exit, but would prevent a provider call after routing is repaired.

Relevant source: src/adapters/process/tmux-host.ts (hostScript, paneScript, writeEnvFile); src/composition/mission-terminal.ts (hostMissionCommand); src/application/review-classification/repeat-review.ts; src/application/review-loop/reviewer-phase.ts; src/adapters/decision/provider.ts. Preserve ports/adapters and composition authority; any boundary change requires the explicit architecture decision mandated by AGENTS.md.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Retained mission console commands resolve configured operator Jev credentials without exposing values or storing operation secrets in the tmux server/console environment.
- [ ] #2 After a verified integration repair, Jev is attempted before custom reviewer launch using an explicit evidence contract; insufficient evidence falls back safely with a visible reason.
- [ ] #3 Every classification attempt, eligibility skip, provider setup failure and fallback reports a concise reason before general reviewer launch; secret values never appear in logs.
- [ ] #4 Retain focused red-on-parent/green-with-fix reproductions in owning suites for real retained-console credential resolution and revoked-approval integration repair routing; verify ordinary repeat-review behavior remains valid.
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
