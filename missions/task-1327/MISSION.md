# Mission: Make backlog review state and review artifacts reconcile cleanly (task-1327)

## Goal
Fix the workflow paths where a mission has already reached review approval semantics but the local backlog task file still reports the wrong actual state, and where review-generated mission artifacts are left uncommitted in the worktree after review/push flows. The result must be that review, approval, push, and integrate preflight all observe one consistent task state from the task file itself, and routine review automation must not strand `missions/<slug>/review-events/*` as leftover local dirt.

## Why Now
Task-1327 documents two real operator failures on 2026-06-21 and 2026-06-22:

- `px integrate` rejected task-1322 because the task file still said `active`, even though the mission had already gone through review and a human had approved the PR.
- review automation on task-1330 reported success and transitioned the task, but left `missions/task-1330/review-events/*.md` untracked in the worktree, which then interfered with later workflow commands.

The current code already treats `review` plus an approved Forgejo review as integration-eligible (`test/integrate.test.js`), and `transitionTask()` is supposed to update both YAML `status:` and rendered `Status:` lines in the task file (`lib/tools/backlog.js`). That means this mission is not inventing a new lifecycle; it is closing a mismatch between the intended state model and what the repo actually leaves behind on disk.

## Refinement Signals
- Estimated agent % usage limit: 25-50%
- Confidence: High
- Selection note: activate as-is
- Main drivers: reproduce the task-file state mismatch from real review/integrate transcripts; ensure review-event persistence does not leave dirty mission artifacts behind after successful workflow steps

## Scope
- Trace the code paths that move a task into `review` and `approved` / `ready-for-integration`, including the autonomous review loop, review submission helpers, and handoff/integrate preflight readers.
- Fix the bug so the authoritative backlog task file for the current slug ends in the correct actual status after the relevant workflow path completes.
- Fix the review-artifact flow so files created under `missions/<slug>/review-events/` are either committed by the workflow step that creates them or otherwise handled so the worktree is clean for subsequent workflow commands.
- Add or update regression tests that cover both the task-state symptom and the dirty-artifact symptom using the real mission/backlog path layout.
- Keep the backlog task for task-1327 classified with exactly one label: `ai_sdlc`.

## Out of Scope
- Changing the overall lifecycle states (`backlog`, `ready`, `active`, `review`, `approved`, `done`) or the state-map design.
- Broad cleanup of unrelated dirty-worktree handling outside review/backlog mission artifacts.
- Reworking Forgejo approval semantics beyond what is needed so local task-file state and integration preflight agree.
- Manual repair of historical task files for already-finished missions, except where a test fixture intentionally models the failure.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- A regression test reproduces the task-1322 symptom with a task file that entered review/approval flow and previously remained `active`; after the fix, the same flow leaves the task file in the expected actual status (`review` or `ready-for-integration`, depending on the path under test), and both the YAML `status:` field and rendered `Status:` line agree.
- A regression test for integration preflight proves that when the workflow has already produced an integration-eligible approval state, `evaluateTaskStatusForIntegration` or the higher-level preflight path no longer fails because the local backlog task file was left in a stale `active` state by the workflow itself.
- A regression test reproduces the task-1330 symptom where reviewer artifacts are persisted to `missions/<slug>/review-events/` and the command otherwise reports success; after the fix, the command leaves no uncommitted or untracked `review-events` files in the worktree at exit.
- The fix preserves the existing accepted integration behavior for a task that is still in `review` while the latest formal review is `APPROVED`; this mission must not narrow integration acceptance to `ready-for-integration` only.
- The fix preserves the existing implementation-phase behavior in review startup/handoff paths: a mission that is truly still `active` must not be silently promoted to a later state just to satisfy this bug fix.
- `npm test` passes with the new regression coverage included.

## Risks and Assumptions
- The state mismatch may come from one of several transition surfaces (`review-loop`, review submission helpers, handoff, or backlog-file write logic). The mission assumes one bounded fix can cover the real failure without redesigning the full review state machine.
- Review-event files are mission artifacts, so auto-committing them is acceptable only when the workflow step has already decided they are durable outputs. If the correct fix is to prevent creating duplicate/ephemeral files instead, that is acceptable as long as the worktree-cleanliness criterion is met.
- Integration preflight intentionally accepts `review` plus approved review evidence; the mission assumes the bug is stale local task-file state, not that this policy should be removed.

## Checkpoints
- CP 1: Identify and document the exact state-transition path that can leave the backlog task file stale; add a failing regression test for the task-state symptom.
- CP 2: Fix the transition/write path so the task file lands in the correct actual state and update tests covering review/integrate agreement.
- CP 3: Add a failing regression test for dirty `review-events` outputs; fix the producing workflow path so successful review/push flows leave the mission worktree clean.
- CP 4: Run the full test suite, update any contract text or fixtures that changed as part of the bounded fix, and confirm the task-1327 backlog file still has exactly the `ai_sdlc` classification label.

## Gates
- [ ] ./scripts/verify-local.sh docs
- [ ] npm test

## Restricted Areas
- Do not change backlog task `assignee` semantics or rewrite the ownership model.
- Do not broaden this into a general-purpose dirty-worktree sweep across unrelated files outside mission artifacts and the current task file.
- Do not change completed mission history or mass-edit existing backlog task files as a data migration.
- Do not weaken integration preflight by bypassing task-status checks entirely; the fix must make the workflow leave correct state, not merely ignore bad state.

## Stop Rules
- Stop if the only viable fix requires changing the fundamental workflow lifecycle or state-map contract rather than correcting a bounded state-write/cleanup bug.
- Stop if reproducing the dirty-artifact symptom shows the files are intentionally left uncommitted for a downstream workflow that would break if they were committed or cleaned up here.
- Stop if the stale-state symptom depends on external Backlog/Forgejo data that is not represented in the local task file or existing tests, and the repo lacks a deterministic way to cover it with regression tests.
