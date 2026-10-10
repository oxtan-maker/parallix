---
id: TASK-2708
title: 'Fix misleading and leaking CLI log lines in draft, review and integrate output'
status: backlog
assignee: []
created_date: '2026-10-10 05:32'
labels:
  - ai-sdlc
  - logging
  - ux
dependencies: []
references:
  - src/application/rebase-workflow.ts
  - src/adapters/cli/commands/integrate-post.ts
  - src/adapters/git/merge-noise.ts
  - src/adapters/cli/commands/draft-setup.ts
  - src/adapters/review/review-loop-presentation.ts
  - test/e2e/lifecycle/mission-lifecycle.test.ts
priority: low
ordinal: 210008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
WHY: An observed e2e lifecycle run (test/e2e/lifecycle/mission-lifecycle.test.ts, primary-branch scenario, stub agents, captured px output on 2026-10-10) showed four log lines that mislead the operator or leak internals. Operators read this output to decide what to do next, so each line should say something true and actionable.

OUTCOME: The four lines below are corrected at their owning emit sites, each with a regression assertion in the suite that already owns that output. No behavior changes beyond log text and the data it reports.

THE FOUR FINDINGS (verify each against current code first; line numbers drift, find them by the quoted text):
1. "Next: <verification command>" printed during `px integrate` after the rebase (src/application/rebase-workflow.ts, the `Next: ${fmt.command(port.formatVerificationCommand(...))}` emit sites, one near the rebase success tail and one in the in-progress/continue path). In the e2e fixture the configured verification command is the no-op `:`, so it printed `Next: :`. That exact output is a fixture artifact, but the underlying problem is real: during an automated integrate the line says "Next:" as if the operator must run something, when the pipeline proceeds on its own. Decide per call site whether it is a real manual step (keep, make sure the command is non-empty and meaningful) or an automated step (reword as progress, e.g. "Verifying:"), and never print an empty/placeholder command as a next step.
2. "Workflow stats recorded: ... pr_fix_rounds=undefined" (src/adapters/cli/commands/integrate-post.ts, `formatRecordedStatsRow`). A literal `undefined` leaks into user output when the value is absent. Render absent values explicitly (for example `n/a`) consistent with how px stats renders unavailable values; do not change what is stored, only how the row is displayed. Check the other fields of the row for the same leak.
3. "[WARN] Skipping noise squash in <repo>: worktree is not clean." (src/adapters/git/merge-noise.ts, `squashTrailingBacklogNoiseIntoPreviousMission`, called from src/adapters/cli/commands/draft-setup.ts). It fires on every draft whenever the primary checkout has any untracked/modified file, and says neither which files nor whether that matters. On this repository main currently has an untracked `backlog/archive/`, so it may fire on every real draft; confirm that on a real checkout before deciding. Make the warning actionable (name the dirty paths, capped, and say the consequence), and if it is expected noise for untracked-only state, downgrade it to a debug-level line. Do not change the squash decision logic itself; if you believe it is wrong, report it as a finding instead of changing it.
4. First review round logs "Resuming persisted reviewer: <x> (round 1)" and "Selected reviewer: <x> (persisted)" for a mission that has never reviewed (src/adapters/review/review-loop-presentation.ts, events `reviewer-resumed` and the selected-reviewer line). Wording says "resuming/persisted" when the reviewer was merely recorded at activation or chosen for round 1. Make the wording true for round 1 versus a genuine resume (later round or --continue), without changing which reviewer is chosen or the event/source values other code depends on.

OUT OF SCOPE: the end-of-integrate stats report (accepted trade-off), `bash -lc` login-shell cost, pre-draft hook logging and the pnpm migration (TASK-2707), and any change to review, rebase or squash behavior.

RULES FROM THE REPOSITORY: read docs/doc-standards.md before editing Markdown; trace each changed message to its owning test suite and extend it (case names carry the task ID), create no new suite unless none owns the output; unit tests stay under 500 ms; production files stay at or under 500 lines; run the focused tests first, then `./scripts/verify-local.sh static-analysis`; user-facing text stays generic (no model or classifier product names). Changes to docs only if documented output text changes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each of the four findings is first reproduced against current code: the exact emitted text is captured (focused test or captured px output) and recorded as mission evidence before any change
- [ ] #2 Integrate no longer prints an empty or placeholder command as a Next: step, and Next: lines are used only for steps the operator must perform; automated steps are worded as progress. Covered in the suite that owns rebase/integrate output
- [ ] #3 The workflow stats line never contains the literal text undefined; absent values render explicitly and consistently with px stats, and the stored row is unchanged. Covered by a case for an absent pr_fix_rounds and for each other nullable field
- [ ] #4 The noise-squash skip message names the offending paths (capped), states its consequence, and is not emitted at warning level for state it considers expected; the squash decision logic is unchanged and a case proves the squash result is identical before and after for clean and dirty trees
- [ ] #5 Round 1 of a never-reviewed mission does not log resuming or persisted wording; a genuine resume (later round or --continue) still does. The chosen reviewer and the event/source values consumed elsewhere are unchanged, proved by existing review-loop suites staying green
- [ ] #6 No other log line changes; grep of tests asserting the old strings is updated in place (replace the assertions, do not add parallel ones)
- [ ] #7 Implementer re-runs the e2e lifecycle scenario with captured px output and records the before and after lines for all four findings, using a sandbox home and never the real parallix.db
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
