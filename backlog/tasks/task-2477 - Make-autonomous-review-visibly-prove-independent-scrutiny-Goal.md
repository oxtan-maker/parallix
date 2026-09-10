---
id: TASK-2477
title: Make autonomous review visibly prove independent scrutiny Goal
status: backlog
assignee: []
created_date: '2026-09-10 06:14'
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Rebuild the autonomous-review presentation so the user can immediately see:

who implemented the change → who is reviewing it → whether the review is actually independent → what the reviewer concluded → what findings matter.

The key product value is not that Parallix “runs a review loop.”

The value is:

another agent inspected the implementation before the human is asked to integrate it.

The default output must make that fact unmistakable.

Why Now

The current first-value cast makes review look like a workflow engine trace.

Examples include:

Starting autonomous review loop (implementer: claude)...

[INFO] Resuming persisted reviewer: custom (round 1)
[INFO] Selected reviewer: custom (persisted)
[INFO] Selected reviewer: custom (persisted)
[INFO] Starting autonomous review loop for mission: parallix-adhoc-0001
[INFO] Branch: mission/parallix-adhoc-0001
[INFO] Implementer: claude | Reviewer: custom (persisted)
[INFO] Focus: all | Max attempts: 5
[INFO] Poll interval: 10s | Poll timeout: 600s

[INFO] ========== Round 1 / 5 ==========
...
[PASS] Pre-review gate passed...
[PASS] Pre-review gate passed...
[INFO] Round 1: launching reviewer (custom)...

Several defects are visible:

reviewer selection is printed twice;
pre-review gate success is printed twice;
review-loop configuration (poll interval, timeout, max attempts) is given the same visual priority as the actual review;
provider-disabled/internal persistence messages dominate;
the independent-review relationship is not the primary framing;
review findings are persisted as implementation artifacts and then summarized later as reviewer outcome = REQUEST_CHANGES, rather than presented first as the user-value event;
custom may represent a local model but its relationship to the implementer family is not clearly framed as independent/different-family versus self-review fallback.
Required operator experience

The normal review presentation should answer:

Who reviewed whom?

For example conceptually:

REVIEW

Implementer   claude
Reviewer      custom
Independence  different agent family

If the reviewer is same-family fallback:

Independence  same-family fallback

Never imply independent-family review when it did not happen.

What did the reviewer conclude?

The main event is one of:

APPROVED

or:

CHANGES REQUESTED
What findings matter?

For CHANGES REQUESTED, show a concise set of blocking findings before launching the implementer again.

Do not force the user to find those facts by reading persisted artifact filenames.

The reviewer agent's real stream remains visible and may be accelerated in asciinema.

Mandatory demo feedback loop

Use the exact same hard feedback loop as TASK-2476.

The implementation agent must replay the actual demo, inspect the raw cast and GIF, re-record with real agents, inspect every visible review defect, fix it, and iterate.

In particular, the agent must actively search for:

duplicated reviewer selection;
duplicated verification lines;
internal persistence artifact chatter;
provider-disabled/no-Forgejo chatter;
misleading claims about independence;
review round banners that obscure the actual conclusion;
decisions that appear without their findings;
findings that cannot be understood without opening internal files;
malformed status prefixes;
warnings that happen routinely on the happy path;
contradictions between persisted review state and terminal output.
Demo scenario

The normal first-value README mission may be approved immediately.

That is acceptable for demonstrating the happy review path.

TASK-2477 should optimize that immediate-approval path:

implementation
→ different reviewer
→ reviewer visibly works
→ APPROVED
→ human inspects diff

Do not force an artificial rejection into the hero demo merely to exercise review rounds.

The rejection/correction flow belongs in TASK-2478 with a deterministic scenario designed to trigger a meaningful finding.

Scope
Autonomous reviewer-selection presentation.
Review-loop happy-path presentation.
Reviewer live-stream framing.
Review outcome presentation.
Concise finding presentation.
Explicit independent-family versus fallback/self-review status.
Removal of duplicate happy-path presentation at the source.
Re-record/re-render first-value demo for the review phase.
Focused direct tests.
Out of Scope
Implementer response to review findings — TASK-2478.
Integration output — TASK-2479.
Changing reviewer-selection semantics except to correct a genuine bug uncovered by the real replay.
Forcing reviewers to reject correct code.
Faking findings in the demo.
Success Criteria
The real cast clearly identifies implementer and reviewer.
Different-family review is explicitly recognizable as such.
Same-family/self-review fallback, when it occurs, is explicitly labeled and never presented as stronger independence.
Reviewer selection appears once on the happy path.
Pre-review verification success appears once.
Poll configuration, provider plumbing and persistence filenames do not dominate default output.
Reviewer live output remains visible.
The final review verdict is visually prominent.
APPROVED is not buried behind task transitions or persistence messages.
CHANGES REQUESTED is accompanied by useful blocking findings.
The user does not need to inspect review-events/*.md to know why review passed or failed.
Genuine review infrastructure failures remain visible.
The first-value cast is re-recorded and inspected.
Final GIF is inspected.
## Demo Replay Findings records every discovered defect and action.
Focused review tests run directly and pass.
Full repository gate passes.
Agent-slop guardrails
Do not just hide review-events log lines and declare the UX solved.
Do not collapse independent review and self-review into one generic “review passed”.
Do not print APPROVED if the persisted authoritative review state is not approved.
Do not infer independence only from display names; use actual family identity.
Do not manufacture a rejection to make the demo interesting.
Do not hide reviewer output.
Do not keep duplicate messages and compensate by speeding through them in the cast.
Do not treat persisted artifact creation as the user-facing review result.
Do not satisfy tests with snapshots that never execute the real review path.
Do not complete without real replay inspection.
Checkpoints
CP 1 — Replay and defect inventory

Inspect existing review phase and capture all duplicate/internal/misleading output.

CP 2 — Independent-review framing

Recompose review start around implementer, reviewer, independence level and live reviewer work.

CP 3 — Verdict and findings

Make verdict/finding presentation first-class while preserving persisted review artifacts behind the scenes.

CP 4 — Real replay closure

Re-record, inspect raw cast and GIF, fix all in-scope findings, run focused tests directly, then full gates.
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
