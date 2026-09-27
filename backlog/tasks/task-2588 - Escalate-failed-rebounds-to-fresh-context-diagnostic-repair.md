---
id: TASK-2588
title: Escalate failed rebounds to fresh-context diagnostic repair
status: backlog
assignee: []
created_date: '2026-09-27 06:08'
labels: []
dependencies: []
ordinal: 119008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Make Parallix reliably recover when an implementer produced incorrect work, automated verification later exposes the defect, and the first targeted repair attempt does not fix it.

A failed first repair MUST cause a change of recovery strategy rather than another attempt from the same failed reasoning trajectory.

The intended recovery ladder is:

**targeted repair → verify → fresh-context diagnostic repair → verify → escalate**

A successful agent exit is never proof of repair. Only the authoritative failing check turning green is proof.

## Why

Today Parallix has two different repair models.

The rebound kernel handles known failures locally. It classifies the failure, constructs a stage-specific prompt, launches an implementer, and reruns the failing verification. This is appropriate for a first repair attempt.

However, a same-family rebound may resume the implementer's existing session. If that implementer created the defect or has already misunderstood the problem, the repair attempt can preserve the same incorrect assumptions. A second narrowly classified prompt can therefore repeat the same reasoning failure.

Parallix already has a stronger second-line recovery model in ADR 0059: a fresh agent context is anchored in durable mission/repository state, diagnostics are explicitly treated as evidence rather than diagnosis, and the recovery worker is asked to determine the actual problem while preserving the mission and repository.

Operator experience confirms the same pattern: when normal automatic repair fails, a fresh/general instruction of the form:

> There are errors: <diagnostics>. Fix the mission without breaking the repository.

usually succeeds.

Make this an intentional harness capability rather than requiring operator intervention.

## Design principle

Do not make the repair prompt increasingly clever after failure.

Change the **reasoning context and strategy**.

The first attempt may exploit the harness's diagnosis.

The second attempt must distrust the failed diagnosis enough to independently inspect the mission, branch, code and evidence.

Do not introduce another lifecycle state machine or a third recovery subsystem. Extend the existing rebound kernel and reuse the fresh-context semantics already established by ADR 0059.

## Scope

Change autonomous recovery for relaunchable failures handled through the rebound kernel.

The change must cover rebound consumers consistently rather than special-casing only pre-review gates. Relevant current consumers include handoff verification, verification/gate failures, hook failures and other existing `ReboundReason` paths where an implementer is allowed to repair the working tree.

Preserve ADR 0048 classification for dispatch decisions. A genuinely human-only infrastructure/state-machine failure must remain human-only.

The new fresh-context escalation applies after an **agent-fixable repair attempt has run and authoritative verification still fails**.

## Recovery strategy

### Attempt 1 — targeted repair

Keep the current behaviour substantially intact.

Provide:

* structured failure type/classification;
* exact command/check that failed;
* captured stdout/stderr;
* original mission identity and worktree;
* current mission contract;
* instructions appropriate to that failure type.

The harness reruns the exact authoritative failing check after the agent returns.

If it passes, recovery is complete.

### Attempt 2 — fresh diagnostic repair

If attempt 1 completes but authoritative verification remains red, do NOT simply produce another targeted prompt in the same session.

Launch attempt 2 with a fresh, ephemeral agent context:

* same mission branch and worktree;
* preserve all valid committed work from attempt 1;
* no repository hard reset;
* do not resume the previous implementer conversation;
* do not overwrite the implementer's normal resumable session marker with the recovery session;
* use the assigned implementer family when available, with normal launcher fallback semantics, while preserving reviewer/implementer separation of duties.

The second prompt must deliberately be less diagnostic and more outcome-oriented.

It must convey:

```
Parallix has verified that this mission is still incorrect after an automatic
repair attempt.

The diagnostics below are evidence of the problem, not necessarily its root
cause. Do not assume the previous repair diagnosis was correct.

Inspect the current mission contract, px status, repository instructions,
current branch/diff, relevant code and tests, and determine what is actually
wrong.

Fix the mission so the reported failure is resolved without:
- changing the mission's goal or scope;
- weakening, deleting, skipping or bypassing tests/gates;
- reverting unrelated valid mission work;
- breaking unrelated repository behaviour;
- manufacturing workflow/review/database state.

Preserve existing correct work. Make whatever mission-scoped implementation or
test changes are genuinely required. Commit the repair.

Do the repair now; do not stop at diagnosis or a proposed plan.

Original failure:
<original diagnostic>

Failure after the previous repair attempt:
<latest diagnostic>

The harness will rerun the authoritative failing check after you finish.
Your own claim that the issue is fixed is not completion evidence.
```

This wording may be factored through the existing recovery-instruction concepts rather than duplicated literally.

The important properties are:

1. fresh context;
2. raw evidence;
3. explicit permission to re-diagnose;
4. mission/repository invariants;
5. preservation of current valid branch state;
6. externally verified completion.

## Session semantics

Do not make the application/rebound kernel depend directly on SQLite session-marker implementation details.

Add a semantic launcher policy for session handling, for example:

* `resume` — existing normal behaviour;
* `fresh-ephemeral` — never resume an existing session and do not replace the durable normal-session marker when the launch ends.

Name this according to existing architecture conventions; the exact API above is illustrative.

ADR 0059's `FRESH_SESSION_MARKER_PORT` behaviour is the reference semantics.

The rebound kernel should request semantic fresh-context execution. Composition/adapters own how that maps to session-marker persistence.

There must remain one session authority.

## Detecting failed strategy, not just failed process

The transition from attempt 1 to attempt 2 is caused by the verifier remaining red after a completed repair attempt.

Capture enough facts around each attempt to distinguish useful progress from repetition:

* HEAD before repair;
* HEAD after repair;
* normalized failure fingerprint before repair;
* normalized failure fingerprint after verification;
* repair strategy;
* actual agent family;
* whether the launch resumed or was fresh;
* authoritative verifier identity/command;
* verifier result.

An unchanged HEAD plus the same failure fingerprint is explicit **no progress**.

A changed HEAD with the same failing verifier is still a failed targeted strategy and therefore also escalates to fresh-context repair.

A changed diagnostic must be retained as useful evidence but MUST NOT reset the repair budget indefinitely.

Do not create an unbounded “new error means new two-attempt loop” inside one operation.

## Verification authority

Preserve the strongest existing rebound property:

**agent completion is not repair completion.**

After every repair attempt, rerun the exact check whose failure caused the rebound, through the existing verifier callback.

Do not allow the repair worker to substitute:

* a smaller test;
* a different test suite;
* its own prose assertion;
* a checkpoint claim;
* a green unrelated gate.

If the original verifier is legitimately no longer applicable because authoritative mission state changed, that decision must come from the harness's typed workflow logic, not from the repair agent.

## Review integrity

Fresh repair is implementation work, not review.

If a repair changes code after a reviewer has inspected an earlier revision, that revision's approval must not authorize the repaired revision.

Use the existing review-round/revision machinery to ensure the resulting revision receives whatever independent review the normal lifecycle requires.

The fresh repair agent MUST NOT:

* approve its own work;
* manufacture a reviewer decision;
* use reviewer identity as implementer merely to obtain a fresh context;
* bypass a new review round when the reviewed revision changed.

## Failure budget

Keep recovery bounded.

Default agent-fixable repair budget:

* attempt 1: targeted;
* attempt 2: fresh-context diagnostic;
* then escalate.

Do not increase the budget merely because the strategy is improved.

Launch failures/capacity rerouting remain a separate currency from completed repair attempts, matching current rebound semantics.

Explicit transient verifier retries remain separate and happen before consuming an implementer repair attempt.

## Escalation dossier

If fresh-context repair also fails, emit one concise operator dossier containing:

* mission;
* lifecycle/review phase;
* original failure;
* latest failure;
* verifier command/identity;
* repair strategies attempted;
* actual agent family per attempt;
* whether each context was resumed or fresh;
* HEAD before/after each attempt;
* normalized failure fingerprint progression;
* any checks known to have passed;
* exact reason automation stopped;
* supported manual next action.

The operator should not need to reconstruct the failure from interleaved logs.

## Reuse ADR 0059; do not fork it

ADR 0059 already establishes important recovery semantics:

* fresh context rather than the stuck transcript;
* diagnostic as evidence, not diagnosis;
* repository/mission state as durable context;
* preserve scope and gates;
* no self-review;
* external observation proves recovery.

Refactor shared concepts if useful.

Do NOT create two subtly different definitions of “fresh recovery agent” or duplicate prompt/guardrail text in rebound and fleet supervision without an explicit shared abstraction.

If this change materially expands ADR 0059 or ADR 0048's decision boundary, update the relevant ADR rather than introducing a competing ADR whose distinction is only implementation location.

## Required regression scenarios

Add deterministic tests proving at least these behaviours.

### Targeted repair succeeds

Verifier fails → targeted attempt runs → verifier passes.

Assert:

* one repair launch;
* existing targeted prompt;
* no fresh recovery launch;
* normal workflow continues.

### Targeted repair fails, fresh repair succeeds

Verifier fails → targeted repair → verifier remains red → fresh repair → verifier passes.

Assert:

* exactly two completed repair attempts;
* attempt 1 may resume according to normal policy;
* attempt 2 MUST be fresh;
* attempt 2 receives original and current diagnostic;
* attempt 2 prompt says evidence is not necessarily root cause;
* worktree/commits from attempt 1 remain present;
* exact verifier runs after both attempts;
* workflow continues only after second verification passes.

This is the primary regression test for this mission.

### First repair makes no change

Attempt 1 returns status 0 but HEAD is unchanged and verifier has the same failure.

Assert:

* success exit is not treated as progress;
* attempt 2 is fresh-context diagnostic recovery;
* the same narrow prompt is not simply sent again.

### First repair changes code but keeps same failure

Assert fresh-context escalation still occurs.

Do not interpret “agent changed something” as reason to repeat the same strategy.

### Failure changes after attempt 1

Attempt 1 removes error A but verifier now exposes error B.

Assert:

* original A and current B are both available to fresh recovery;
* attempt budget remains bounded;
* fresh repair is allowed to diagnose the current tree rather than being forced to continue the original classification.

### Fresh repair fails

Assert:

* no third implementer repair is launched under the default budget;
* escalation dossier contains both attempts and verifier evidence;
* no false PASS/APPROVED lifecycle state is written.

### Session-marker integrity

Seed an existing resumable implementer session.

Assert:

* targeted attempt follows normal resume policy;
* fresh attempt does not resume it;
* fresh attempt does not replace/delete the durable normal implementer marker;
* a later ordinary implementer launch still sees the correct normal session identity.

### Reviewer separation

Seed an active/current reviewer family.

Assert a fresh repair cannot silently become implementation by that reviewer in a way that violates existing separation-of-duties rules.

### Human-only failure

Use a typed infrastructure or state-machine HumanOnly failure.

Assert:

* no fresh implementation recovery is launched;
* existing human escalation behaviour remains intact.

## Observability

Expose enough telemetry to answer, from real Parallix usage:

* percentage of targeted rebounds that pass;
* percentage that advance to fresh recovery;
* percentage of fresh recoveries that rescue the mission;
* percentage that still escalate;
* same-fingerprint/no-HEAD-change rate after targeted repair;
* token/runtime cost by repair strategy.

Use stable strategy identifiers such as:

`targeted`
`fresh-diagnostic`

Do not infer them later from prompt text.

This data should let us decide later whether some failure classes should skip targeted repair entirely and go straight to fresh recovery.

## Non-goals

Do not:

* redesign the reviewer;
* increase the default retry count;
* add an LLM supervisor inside the rebound kernel;
* hard-reset the mission worktree between attempts;
* discard valid implementation work simply to get fresh context;
* make the classifier responsible for diagnosing root cause;
* automatically integrate a recovered mission;
* weaken existing gates or approval boundaries;
* introduce a second persistent retry/state authority.

## Architecture guardrails

Keep policy in the application layer and launch/session mechanics in adapters/composition.

The application layer may decide:

“the next repair strategy requires fresh ephemeral context.”

It should not need to know:

“supply this particular SQLite SessionMarkerPort implementation.”

Reuse the existing `startAgent` launcher path rather than creating a recovery-specific process launcher.

Keep the exact verifier callback as the completion authority.

Prefer extending existing typed `ReboundReason`, attempt state and recovery dossier structures over adding parallel ad-hoc records.

Do not add string matching when the relevant failure/session/review state is already typed.

Do not make `px lead` responsible for fixing failures that the command-local rebound already has enough evidence to repair. `px lead` remains the outer safety net for genuinely stranded missions.

## Success criteria

The mission is complete when:

1. A failed targeted automatic repair no longer results in another equivalent same-context targeted attempt.
2. The second repair attempt uses a demonstrably fresh ephemeral context while preserving the mission worktree.
3. The fresh repair receives both the actual failure evidence and the locked mission/repository constraints without being forced into the previous root-cause diagnosis.
4. The exact authoritative failing check is the only evidence that an automatic repair succeeded.
5. Two failed repair strategies terminate in a useful escalation rather than another retry.
6. Existing human-only, transient-verifier, review-separation, session-marker and integration boundaries remain intact.
7. Existing rebound and ADR 0059 recovery tests remain green.
8. New regression coverage proves the full targeted-fail → fresh-repair → verified-green path.
9. Telemetry distinguishes targeted and fresh diagnostic repair so their real rescue rates can be measured.
10. The implementation removes or factors duplicated recovery semantics rather than creating a third recovery system.

## Gates

Run the normal repository unit/integration gates applicable to the touched rebound, agent-launch/session and review lifecycle paths.

In addition, the implementation must explicitly exercise the regression test for:

**targeted repair fails → fresh-context repair changes the mission → exact verifier passes → independent workflow continues.**

Do not declare completion based only on prompt snapshot tests. The test must prove the session policy and verifier loop behaviour.
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
