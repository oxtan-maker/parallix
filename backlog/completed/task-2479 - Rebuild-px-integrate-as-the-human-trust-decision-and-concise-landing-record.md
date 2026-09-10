---
id: TASK-2479
title: Rebuild px integrate as the human trust decision and concise landing record
status: done
assignee: [custom]
created_date: '2026-09-10 06:16'
labels: ["user_value"]
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Goal

Rebuild default px integrate output around the final operator decision:

what is being integrated → what trust evidence permits integration → what gates run now → what landed → what was cleaned up.

px integrate is the moment where Parallix's positioning becomes concrete:

agents may implement and review, but the human decides whether the work lands.

The command should reinforce that boundary rather than end the demo with an internal closeout dump.

Why Now

The current first-value recording's integration phase begins with useful facts but then expands into implementation-level preflight and reporting.

Current examples include:

[INFO] Integration preflight for parallix-adhoc-0001
[PASS] Mission branch: mission/parallix-adhoc-0001
[PASS] Mission doc: ...
[PASS] Backlog task: none — adhoc mission, Mission store is authoritative
[PASS] Mission classification: unknown
[PASS] Backlog status follows the Mission lifecycle ...
[INFO] Forgejo PR/approval checks skipped ...
[PASS] Integration checkout branch: ... is on main
[PASS] Integration checkout conflicts: no unresolved merge entries ...
[PASS] Integration checkout dirty state: clean

After integration it emits the full weekly stats/reporting payload into the hero path, including:

weekly agent performance;
spend by stage;
previous-week comparison;
full mission telemetry table.

The cast then returns to:

[INFO] Step 7: Cleaning up the local mission worktree...
[INFO] No existing graphify graph found...
[PASS] Integration completed successfully.
[INFO]
[INFO] Next: cd ...

This is the exact opposite of the desired information hierarchy.

Stats are useful.

They are not the primary result of px integrate.

Required operator experience

Before landing, the command should make the essential trust evidence obvious:

READY TO INTEGRATE

Mission       ...
Review        approved
Reviewer      custom
Independence  different agent family
Verification  passed
Target        main
Workspace     clean

Only show claims that Parallix can establish authoritatively.

Then show the actual landing operation and final result:

Integrating into main...

✓ integrated
  main  <before> → <after>

✓ mission worktree cleaned up

The exact layout is implementation-owned.

The user's invocation of px integrate itself represents the human decision. Do not fabricate a “human inspected diff” claim.

Mandatory replay feedback loop

As with the preceding missions, the implementing agent must use the real first-value recording as acceptance evidence.

It must inspect:

integration preflight;
gate execution;
squash/merge result;
post-integration persistence;
stats output;
cleanup;
final shell transition.

The agent must explicitly identify every piece of output that is:

needed for the human trust decision;
needed only for diagnostics;
genuine exceptional state;
unrelated reporting that belongs elsewhere.

Then implement, re-record, inspect raw cast and GIF, and iterate.

Specific defects to address from the current cast

At minimum investigate:

Full weekly statistics are dumped during integration.
Full mission phase telemetry is dumped during integration.
Mission classification: unknown is visually elevated despite not helping the integration decision.
DB/backlog authority wording is exposed to a first-time user.
Forgejo-disabled plumbing is exposed.
Preflight shows many PASS lines of equal priority rather than a concise readiness result.
Cleanup is narrated as Step 7.
Graphify absence is exposed.
There is an empty [INFO] line before Next: cd.
Final output does not prominently show the landed commit/revision transition.
Approval/reviewer evidence is less prominent than incidental implementation checks.
Stats behavior

Integration must still record required telemetry/statistics.

Successful recording should normally be silent or summarized minimally.

Do not weaken fail-closed behavior if statistics are currently an architectural requirement for completion.

If statistics recording failure legitimately aborts closeout, keep that failure visible.

But a successful integration should not automatically print the entire weekly report or mission telemetry table.

Those belong behind px stats, an explicit flag, DEBUG, or another existing analytical surface.

Scope
Default px integrate preflight presentation.
Integration gate presentation.
Landing/squash result presentation.
Post-integration stats success presentation.
Cleanup/final summary presentation.
Explicit review approval / verification evidence where already authoritative.
Re-record/re-render first-value demo.
Focused direct tests.
Out of Scope
Changing what conditions permit integration unless replay discovers an actual correctness bug.
Weakening mandatory integration gates.
Automatically merging without explicit px integrate.
Claiming the operator inspected the diff.
Redesigning px stats itself.
Review or act-on-review output.
Success Criteria
The first-value cast makes it obvious that px integrate is the human-triggered landing decision.
Before landing, the user sees concise authoritative evidence for review approval, verification and target readiness.
Incidental DB/backlog/provider implementation details do not dominate the happy path.
Full weekly reports are not printed by default during successful integration.
Full mission telemetry tables are not printed by default during successful integration.
Required telemetry/statistics are still recorded.
Stats recording failure retains its current required failure semantics.
Integration gates remain visible at the level needed to know what ran and whether they passed.
A failed gate remains loud and blocks landing.
Successful landing clearly identifies the destination branch and landed revision/SHA transition.
Successful cleanup is summarized without numbered internal steps.
Graphify absence is silent on an ordinary successful path.
No empty/malformed status lines remain.
The final cast and GIF are re-recorded/rendered and inspected.
## Demo Replay Findings records all findings and dispositions.
Focused integrate tests run directly and pass.
Full gate passes.
Agent-slop guardrails
Do not solve the task by hiding all preflight output.
Do not remove mandatory gates to make integration shorter.
Do not move stats recording out of the transaction/closeout semantics merely to silence it.
Do not claim “verified” unless the authoritative integration/review state supports it.
Do not claim “human reviewed diff”.
Do not keep weekly analytics in px integrate merely because they already exist there.
Do not treat classification, DB authority or provider-disabled notices as first-class trust evidence unless they materially affect this integration.
Do not hide integration failures or recovery instructions.
Do not optimize only the happy screenshot; replay failure-path focused tests separately.
Do not finish without replaying the real first-value integration phase.
Checkpoints
CP 1 — Integration replay inventory

Inspect the existing cast and classify every integration line as:

human decision evidence;
integration progress;
diagnostics;
analytics;
anomaly.
CP 2 — Readiness presentation

Recompose preflight into a concise evidence-based readiness view without weakening checks.

CP 3 — Landing and stats separation

Make landing the primary output; retain stats recording but remove automatic analytical report dumps.

CP 4 — Cleanup and final record

Produce a concise final landing record with destination revision and cleanup status.

CP 5 — Real replay closure

Re-record, inspect raw cast and GIF, fix all in-scope issues, run focused files directly and finally repository gates.

Shared checkpoint requirement for TASK-2476–2479

Each mission's final checkpoint must contain:

## Demo Replay Findings

with a table:

| Finding | How discovered | Action | Final evidence |
|---|---|---|---|

A mission may not close with outstanding in-scope findings.

The minimum acceptable final evidence is:

exact real recording command;
real .cast path;
rendered GIF path where applicable;
concrete observations from replay;
direct focused test commands;
repository gate command.

“Tests pass” and “output looks cleaner” are explicitly insufficient.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
