---
id: TASK-2478
title: Make REQUEST_CHANGES → act-on-review → re-review a first-class trust loop
status: backlog
assignee: []
created_date: '2026-09-10 06:15'
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Goal

Create a deterministic demonstration and operator presentation for the case where the reviewer finds a real problem and the implementing agent must act on it.

The user should be able to see this causal chain without reconstructing it from internal state transitions:

Reviewer finds problem
→ CHANGES REQUESTED
→ concrete finding
→ implementer acts on that finding
→ actual change made
→ verification reruns
→ reviewer reviews the revised tree
→ APPROVED

This is one of the strongest proofs of Parallix's value.

A second agent merely saying “approved” is useful.

A second agent catching a defect and causing the implementation to improve before integration is substantially stronger evidence that the review layer is real.

Why Now

The current first-value recording happened to produce a request-changes loop, but it is not suitable as a stable demonstration.

The current recording contains lines such as:

[INFO] Round 1: reviewer outcome = REQUEST_CHANGES

[PASS] Task ... transitioned to active ...
[INFO] Round 1: launching implementer (claude) for act-on-review...
[INFO] Selected agent for step "act-on-review": claude
[INFO] No prior claude session ... launching fresh.

The implementer then reads internal review artifacts, eventually reports its own interpretation, and Parallix later prints:

[INFO] Round 1: implementer disposition = CHANGES_MADE
[INFO] Round 1: implementer made changes. Continuing to round 2.

This tells us what the state machine did.

It does not cleanly tell the operator:

what the reviewer objected to;
what the implementer changed in response;
whether that change actually addressed the finding;
whether verification passed afterward;
whether the second review approved the revised code.

The current Hello World task is also unsuitable as a deliberate act-on-review showcase because strong agents usually solve it correctly in one pass. A demo that depends on an agent randomly making a mistake is not reproducible.

Required deterministic demonstration scenario

Create a small but nontrivial demo problem that is likely to produce a meaningful review finding even when the implementation is superficially plausible.

Do not sabotage the implementation agent or inject a fake reviewer finding.

Preferred shape:

tiny enough for the README/supporting demo;
behavior has at least one edge case;
mission acceptance criteria make the edge case objectively reviewable;
an implementer can plausibly satisfy the obvious path while overlooking the edge case;
reviewer can detect it from code/tests/contract;
fix remains easy to understand in a terminal diff.

A good candidate is a tiny CLI/string utility rather than Hello World.

Example category:

implement normalizeName(input) such that it trims outer whitespace, collapses repeated internal whitespace, preserves Unicode characters, and rejects an empty-after-trim name with non-zero exit.

Or:

add a tiny CLI that parses an integer and doubles it, but must reject non-integers and preserve negative values.

The exact scenario is implementation-owned, but it must not rely on random agent failure.

If no naturally reproducible task can reliably exercise REQUEST_CHANGES, add a deterministic review fixture/integration scenario separate from the hero Hello World demo. It still must run through the real Parallix review and act-on-review path; do not inject the result at the state layer.

Operator contract

For a finding:

CHANGES REQUESTED

Reviewer found 1 blocking issue

  F1  Empty input exits successfully instead of returning an error.

Then:

ACTING ON REVIEW

Implementer  claude
Finding      F1

<real agent stream>

Then a concise result:

✓ F1 addressed
✓ verification passed

Re-reviewing revised implementation...

And finally:

APPROVED · round 2

The exact syntax is flexible; the causal relationship is not.

Mandatory replay feedback loop

This mission has two real-run acceptance artifacts:

the ordinary first-value demo, which must remain clean;
the deterministic review-correction scenario.

The implementing agent must run both.

For the correction scenario, it must inspect the raw transcript and verify manually from the transcript that:

the reviewer finding was visible before the implementer started;
the implementer responded to that exact finding;
the code actually changed after the finding;
verification reran against the changed tree;
the second reviewer decision occurred after the fix;
final approval was for the revised revision, not stale review state.

Any discrepancy must be investigated before completion.

Scope
act-on-review presentation.
Relationship between reviewer finding and implementer correction.
Revised-tree verification presentation.
Round transition presentation.
Deterministic real integration/demo scenario for request-changes.
Tests proving stale approval/revision mixups cannot masquerade as a successful correction.
Re-recording any supporting cast/GIF added for this use case.
Out of Scope
Forcing the main README Hello World demo to fail review.
Injecting reviewer findings directly into SQLite/state files for acceptance.
Making reviewer prompts intentionally hostile or incorrect.
Broad review-loop redesign unrelated to the correction path.
Integration output.
Success Criteria
A real Parallix run deterministically reaches REQUEST_CHANGES in the chosen correction scenario.
The reviewer finding is concrete and visible before act-on-review starts.
The finding comes from the real reviewer path, not an injected fixture decision.
The implementing agent's live response remains visible.
The operator can tell which finding the implementer is addressing.
The resulting implementation tree changes after the finding.
Verification reruns against the revised tree.
Failed verification cannot silently advance to re-review.
Re-review evaluates the revised revision.
Final approval is clearly associated with the later round/revised tree.
The terminal does not force the user to inspect internal artifact filenames to understand the loop.
The ordinary first-value Hello World demo remains able to take the immediate-approval path.
Real correction-flow cast/transcript is inspected by the implementing agent.
All replay defects are documented under ## Demo Replay Findings.
Focused act-on-review/review tests run directly and pass.
Full repository gate passes.
Agent-slop guardrails
Do not fake REQUEST_CHANGES.
Do not intentionally make the implementer use a weaker model solely to cause a mistake.
Do not inject a reviewer outcome directly into persistence as demo setup.
Do not choose a scenario whose only purpose is obscure trickery.
Do not claim a finding was fixed solely because the implementer says so.
Do not skip rerunning verification after correction.
Do not allow approval from an earlier revision to satisfy the later round.
Do not collapse “implementer disposition = CHANGES_MADE” into proof that the finding was actually resolved.
Do not hide the real implementer or reviewer streams.
Do not stop at mocked unit tests; run the actual correction loop and inspect it.
Checkpoints
CP 1 — Design deterministic correction scenario

Choose and prove a small real task that reliably exercises the correction path without fake state injection.

CP 2 — Finding-first presentation

Make REQUEST_CHANGES and concrete findings the visible cause for act-on-review.

CP 3 — Correction and revised verification

Show implementer correction, actual revision change and post-fix verification.

CP 4 — Re-review and revision integrity

Prove the second decision evaluates the revised tree and cannot reuse stale approval.

CP 5 — Replay closure

Run and inspect the deterministic correction scenario plus regression-run the ordinary first-value demo.
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
