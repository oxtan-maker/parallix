---
id: TASK-2647
title: >-
  Finish the review architecture migration — application must own the review
  loop
status: done
assignee: [custom]
created_date: '2026-10-04 15:02'
labels: []
dependencies: []
ordinal: 164008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The previous architecture wave did not complete its stated objective for autonomous review.

TASK-2637.05 said that review-round control flow should move from:

```text
src/adapters/review/review-loop.ts
```

into an application-owned review use case with narrow mechanism ports.

The current implementation does not meet that architectural intent.

`ReviewRoundUseCase` currently owns only entry-level decisions and ultimately delegates the real workflow through a broad port:

```ts
workflow.runRound(...)
```

Meanwhile `src/adapters/review/review-loop.ts` remains roughly 100 KB and still coordinates the autonomous review workflow:

- review-round attempt iteration;
- reviewer selection;
- agent launch and fallback;
- pre-review gates;
- provider polling;
- finding/disposition handling;
- artifact consumption;
- repair/rebound;
- rebase;
- persistence;
- task/lifecycle transitions;
- retry limits;
- human escalation;
- deciding what happens next.

The adapter therefore still acts as an application service.

The existing `adapter-owned-workflow-control` guard does not prove otherwise. In particular, dependency injection/aliasing such as:

```ts
startAgentFn = startAgent
transitionTaskFn = transitionTask
runPreReviewGateFn = runPreReviewGate
```

can hide workflow decisions from a lexical guard that recognizes the imported operation names rather than ownership of the decision.

## Goal

Make the architectural statement actually true:

> Application owns autonomous review sequencing. Adapters implement mechanisms.

At the end of this mission, there must be no broad `runRound()` port behind which the existing adapter-owned workflow is hidden.

The application layer must visibly own:

```text
start review
    ↓
prepare/validate round
    ↓
run pre-review prerequisites
    ↓
choose reviewer
    ↓
launch reviewer
    ↓
observe result
    ↓
interpret result
    ├─ approve
    ├─ request changes → repair/retry
    ├─ infrastructure recovery
    └─ human escalation
    ↓
persist authoritative outcome
    ↓
decide whether another round happens
```

Concrete provider/process/filesystem/Git/storage operations remain behind narrow ports.

---

# Architectural definition of success

Do not use file size as the definition.

The key question for every branch in the autonomous review process is:

> Which layer decides what happens next?

If the answer is `src/adapters/review/...`, the migration is not complete.

The application layer must decide:

- whether another review attempt happens;
- whether a gate failure is repairable;
- whether repair is launched;
- whether a reviewer is retried/fallback-selected;
- whether an artifact failure causes recovery, retry, or escalation;
- whether an approval/request-changes outcome changes lifecycle state;
- when retry/rebound budgets are consumed;
- when autonomous processing stops;
- when human intervention is required.

Adapters may return facts.

Adapters must not interpret those facts into product workflow.

---

# Start with a control-flow inventory

Before modifying code, inspect the complete current review path.

At minimum inspect:

```text
src/adapters/review/review-loop.ts
src/adapters/review/review-commands.ts
src/adapters/review/review-artifacts.ts
src/adapters/review/review-agent-fallback.ts
src/adapters/review/review-gate-handling.ts
src/adapters/review/review-state.ts
src/adapters/review/rebase.ts

src/application/review-round-use-case.ts
src/application/review-command-use-case.ts
src/application/review-repair-lifecycle.ts
src/application/integration-repair-review.ts
src/application/rebound-kernel.ts

src/application/ports/review-round-workflow.ts
src/application/ports/review-workflow.ts

src/composition/create-cli.ts
src/composition/review-persistence.ts
src/composition/application-services.ts
```

Trace one complete successful review plus at least these failure paths:

1. reviewer approves first round;
2. reviewer requests changes;
3. repair succeeds and review repeats;
4. reviewer/provider times out;
5. agent hits capacity and another family is selected;
6. gate fails and is repaired;
7. artifact processing fails and rebounds;
8. retry/rebound budget is exhausted;
9. human intervention stops automation;
10. process resumes after `--continue`.

Produce a short ownership table before implementation:

```text
Decision / effect
Current owner
Correct owner
Port/mechanism needed
Existing test(s)
```

Do not begin by creating new abstractions.

---

# Remove the broad workflow escape hatch

The current shape:

```ts
interface ReviewRoundWorkflowPort {
    ...
    runRound(request): Promise<void>
}
```

is too broad if `runRound()` contains the autonomous review workflow.

A port must represent an external mechanism or bounded capability, not:

> “do everything below this architecture boundary.”

Remove or narrow this escape hatch.

Do not replace it with aliases such as:

```text
executeReviewWorkflow()
performRound()
runAutonomousReview()
reviewEngine.run()
reviewCoordinator.execute()
```

when they still encapsulate the same adapter-owned policy.

Renaming the escape hatch is not architecture.

---

# Desired shape

Prefer application-owned orchestration approximately like:

```text
ReviewRoundUseCase
    │
    ├─ review state port
    ├─ reviewer selection port
    ├─ reviewer launch port
    ├─ provider observation port
    ├─ verification/gate port
    ├─ artifact port
    ├─ rebase/git preparation port
    ├─ lifecycle port
    ├─ telemetry/current-work port
    └─ operator-output port
```

These are examples, not a requirement to create ten interfaces.

Reuse existing focused ports where they already express the right contract.

Create new ports only for actual external/mechanism boundaries.

Do not create a port for every private function.

---

# Port design rule

A mechanism port should answer questions such as:

```text
launch this selected reviewer and report what happened
run this configured gate and return the observed result
poll this review provider and return the observed disposition
consume these reviewer artifacts and return the observed artifact result
rebase this review branch and report the Git result
persist this already-decided review transition
```

It should not answer:

```text
handle a failed gate
retry review
continue review workflow
recover the round
process the reviewer result
decide the next phase
run the review loop
```

Those names usually encode application policy.

---

# Keep domain decisions where they belong

Do not move domain rules into orchestration just because application now owns the sequence.

Existing domain concepts such as:

- current review round;
- review status;
- reviewer eligibility;
- findings/dispositions;
- review independence constraints;

should remain domain-owned where appropriate.

Application coordinates them.

Adapters do not decide them.

---

# Reviewer selection

Separate these two concepts:

### Application policy

- exclude implementer where required;
- prefer another eligible family;
- determine fallback eligibility;
- determine when another selection attempt is allowed;
- consume retry/fallback budget.

### Adapter/mechanism

- report which configured families are currently runnable;
- provide provider/model capabilities;
- launch the selected family.

Do not hide policy inside `selectPreparedReviewer`, `selectAgent`, or a new adapter helper.

---

# Retry / rebound ownership

This area is especially vulnerable to accidental adapter orchestration.

For each existing rebound/retry path identify:

```text
observed failure
classification
policy decision
effect
budget consumed
next state
```

Application must own at least the policy decision and next state.

Mechanisms may:

- execute the retry/recovery operation;
- report failure details;
- persist the result after the application decides.

Do not duplicate `rebound-kernel` policy in the review adapter.

Do not create a second retry model.

---

# Human escalation

Human escalation is a product workflow outcome, not an adapter fallback.

Application must decide when the autonomous path is exhausted or explicitly stopped.

Adapter/interface code may render:

```text
Human review required
```

and provider adapters may publish the message.

They must not independently decide to abandon automation.

---

# Provider-none behavior

Preserve the supported provider-optional review path.

Do not accidentally make Forgejo or another review provider mandatory simply because provider polling is being extracted behind a port.

The application must be capable of sequencing review using the capabilities actually available for the configured review mode.

---

# Preserve concurrency / stale-controller defenses

The current review implementation contains meaningful protections against:

- overlapping local review controllers;
- stale review state;
- later authoritative rounds superseding an older controller;
- delayed stale writes.

Do not lose these merely because they live inside the existing large module.

Explicitly decide which aspects are:

```text
application concurrency policy
```

versus:

```text
process-local locking mechanism
```

A process-local mutex/set can remain a mechanism.

The decision that a stale round must stop rather than mutate authoritative state belongs above it.

Add characterization coverage before movement if ownership is unclear.

---

# `review-loop.ts`

It is acceptable for `review-loop.ts` to survive if it has a coherent adapter responsibility.

It is not acceptable for it to remain the autonomous review workflow under a smaller facade.

At completion, inspect the file independently and answer:

> If I read only this adapter, can I reconstruct most of the product's review state machine and its decisions about what happens next?

If yes, this mission is not complete.

A large file is allowed if it implements one genuinely complex mechanism.

A large orchestration adapter is not.

---

# Architecture enforcement

After the real re-homing is complete, update the architecture guard.

Do not first make the guard accept the intended solution and then shape production code around passing it.

The production architecture is the primary proof.

The guard is regression protection.

## Required adversarial fixture

The new/updated architecture tests must include a fixture structurally similar to the failure we have today:

```ts
import { startAgent } from '../agents/agents.js';

async function runRound(opts = {}) {
    const startAgentFn = opts.startAgentFn ?? startAgent;

    for (...) {
        if (...) {
            await startAgentFn(...);
        }
    }
}
```

or the equivalent dependency-injected callback form.

The guard must not incorrectly declare that pattern application-owned merely because the direct import is aliased.

Also add a fixture showing the intended architecture passes:

```text
application decides branch/retry
        ↓
typed mechanism port method invoked
```

Do not build a full TypeScript semantic analyzer unless genuinely necessary.

If a reliable static invariant cannot distinguish the two structures:

**STOP.**

Document that limitation honestly and enforce a narrower invariant that is actually sound.

Do not claim stronger enforcement than exists.

---

# No architecture exceptions

Keep:

```ts
productionDependencyExceptions = []
```

empty.

Do not solve this mission by:

- new allowlists;
- path exceptions;
- magic comments;
- ignored files;
- naming conventions that exempt review;
- excluding injected callbacks from checks.

---

# Behavioral parity requirements

Preserve at minimum:

- start vs continue semantics;
- review independence preference;
- same-family fallback where supported;
- self-approval protection;
- provider-disabled mode;
- provider polling;
- review comments/dispositions;
- blocking findings;
- finding resolution;
- artifact ingestion;
- pre-review gate behavior;
- gate repair;
- integration repair review;
- rebase behavior;
- agent quota/fallback behavior;
- retry limits;
- rebound limits;
- stale-controller protection;
- durable review round persistence;
- human escalation;
- current-work reporting;
- telemetry/statistics;
- Backlog mirror behavior where still supported;
- resume/recovery semantics;
- dry-run;
- operator-visible output.

Do not declare architectural success if behavior was simplified by dropping an awkward path.

---

# Tests

Before changing each complex path, locate existing characterization coverage.

Add characterization only where behavior is not already pinned.

After migration:

- application tests should directly exercise workflow decisions without real provider/Git/process mechanisms;
- adapter tests should exercise mechanism translation;
- integration tests should prove assembled behavior;
- architecture tests should prove ownership boundaries.

Avoid giant mocks containing the entire old review-loop dependency object.

That recreates the old architecture in test form.

Prefer focused fake ports describing observable mechanism outcomes.

---

# Delete obsolete seams

The old review loop has accumulated a very large injectable options object.

After application ownership is established, remove dependency-injection seams that existed only to unit-test adapter-owned orchestration.

Do not retain dozens of `*Fn` injection options “for compatibility” when no production caller requires them.

Production composition should bind explicit ports.

Tests should fake those ports.

This cleanup is part of the architecture migration.

---

# Agent-slop guardrails

## Do not confuse delegation with ownership

This is NOT sufficient:

```ts
class ReviewRoundUseCase {
    run() {
        return port.runRound();
    }
}
```

This is NOT sufficient:

```ts
return adapter.executeReviewWorkflow();
```

This is NOT sufficient:

```ts
return reviewCoordinator.run();
```

Application must contain the decisions that determine workflow progression.

---

## Do not file-split the monolith

Do not transform:

```text
review-loop.ts 105 KB
```

into:

```text
review-loop.ts               20 KB
review-loop-runner.ts        25 KB
review-loop-recovery.ts      20 KB
review-loop-attempt.ts       20 KB
review-loop-helpers.ts       20 KB
```

all under adapters while preserving the same control flow.

That fails this mission.

---

## Do not create a god port

Reject designs such as:

```ts
interface ReviewInfrastructure {
  loadEverything()
  startEverything()
  transitionEverything()
  recoverEverything()
  finishEverything()
}
```

or a port with dozens of unrelated operations just because it makes the use case compile.

Group ports around real external/mechanism responsibilities.

---

## Do not create an anemic application facade

The application use case must contain meaningful branching/state progression.

If nearly every method is:

```ts
return this.port.someMethod(...)
```

inspect whether the real workflow was actually moved.

---

## Do not move infrastructure into application

Application must not directly import:

```text
node:fs
child_process
Git adapter
Forgejo adapter
SQLite adapter
agent CLI launcher
filesystem paths
provider tokens
```

Use ports.

---

## Do not move presentation into application

Application outcomes should be structured.

Do not solve adapter complexity by moving:

```text
fmt.status(...)
console output
terminal styling
CLI usage strings
```

into application.

---

## Do not create generic abstractions

No:

```text
WorkflowEngine
StepRunner
PipelineManager
GenericOrchestrator
ActionGraph
StateMachineFramework
```

unless an existing architecture already requires one.

Implement the review use case explicitly.

Boring explicit code is preferred.

---

## Do not redesign the product

No new review behavior.

No new retry policy.

No new provider.

No new state model.

No UX redesign.

This is an ownership migration.

If an actual bug is discovered, record it separately unless fixing it is required to preserve the existing contract.

---

## Do not weaken verification

No skipped tests.

No increased retry budgets to hide races.

No enlarged architecture exceptions.

No reduced assertions.

No deleting edge-case tests because the new design makes them inconvenient.

---

## Do not retain dead migration scaffolding

After all callers use the new application workflow:

- delete obsolete broad ports;
- delete dead wrappers;
- delete old helper paths;
- remove stale comments claiming adapters orchestrate review;
- remove test-only injection machinery no longer justified.

Do not leave “new architecture” beside “legacy review loop.”

---

# Completion test

Before declaring success, answer these questions with exact file references:

1. Where is the autonomous review attempt loop now?
2. Where is the decision to retry a reviewer?
3. Where is the decision to repair after a failed gate?
4. Where is the decision to escalate to a human?
5. Where is the decision to start another review round?
6. Where is reviewer fallback policy owned?
7. What does `src/adapters/review/review-loop.ts` own now?
8. Which concrete mechanisms remain in adapters?
9. What architecture test would fail if an adapter recreated today's injected-callback orchestration?
10. Are there any broad workflow ports remaining?

For questions 1–6, the answer must principally be an application-layer module.

If not, the stated objective is not complete.

---

# Final evidence

Final checkpoint must contain:

```text
BEFORE
- application entry/use case
- broad workflow port(s)
- adapter modules owning sequencing
- representative workflow decisions in adapters
- relevant sizes

AFTER
- application module(s) owning review progression
- narrow mechanism ports
- adapter responsibilities
- broad workflow port removed
- obsolete DI seams removed
- architecture fixtures added
- production exceptions: 0
```

Also include a compact control-flow comparison:

```text
Before:
application → adapter.runRound() → whole workflow

After:
application → decision → narrow mechanism
            → decision → narrow mechanism
            → decision → outcome
```

Do not report file-size reduction as the primary result.

The primary result is:

> A reader can understand the review state machine from the application layer without reading provider/process adapters.
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
