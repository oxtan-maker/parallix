# Parallix Use Cases

This is a capability guide, not a test catalog. Confidence labels communicate
the current product boundary; executable details remain with their canonical
commands, configuration, source, and tests.

## Confirmed capabilities

### UC-1 — Run multiple missions without shared-worktree collisions

For a maintainer coordinating several agents, Parallix creates an isolated
mission workspace for each piece of work. The practical outcome is that agents
can progress independently instead of competing for one branch and index.

**Confidence:** Confirmed for isolated mission execution. Throughput gains vary
with task mix, review coverage, and operator overhead; isolation is a workflow
control, not a promise of a fixed productivity multiplier.

### UC-2 — Continue after an agent usage limit

For an operator using metered providers, Parallix can recognize a temporary
limit, preserve the mission state, and try another eligible agent family. If no
eligible family remains, it reports that condition clearly.

**Confidence:** Confirmed for configured families. It depends on accurate
provider signals and an available eligible fallback.

### UC-3 — Resume a long-running mission

For work that crosses a session or context boundary, checkpoint records state
what was completed and what must happen next. A later agent continues from
committed evidence instead of reconstructing intent from a partial workspace.

**Confidence:** Confirmed for missions that follow the checkpoint contract.

### UC-4 — Add a second review pass before integration

For teams concerned that an author is grading its own change, Parallix separates
implementation from review and prefers a different reviewer family where the
configured pool allows it.

**Confidence:** Partial. The workflow can fall back to the same family when no
different reviewer is runnable, so it does not guarantee independent-family
coverage.

### UC-5 — Use an existing verification gate

For a repository with established checks, Parallix invokes the configured gate
rather than asking an agent to invent a substitute validation story.

**Confidence:** Confirmed for declared gates. The strength of the result is the
strength of the repository's configured verification, not the workflow alone.

### UC-6 — Compare operational outcomes across missions

For an operator deciding where agent effort pays off, the workflow can retain
mission measurements in an operator-owned store and expose them as reports.

**Confidence:** Partial. Comparison quality is bounded by the completeness and
consistency of the available measurements.

### UC-7 — Review a whole mission diff in familiar tools

For a reviewer who wants the actual mission change rather than a transcript,
Parallix resolves the mission comparison for a local diff tool and can publish a
review surface when the optional provider is configured.

**Confidence:** Confirmed for local diff preparation; provider-backed browser
review is conditional on a reachable, configured provider.

### UC-9 — Start from the branch that contains the work

For a developer already working on a feature branch, a new mission can retain
that branch as its recorded base rather than silently assuming the primary
branch.

**Confidence:** Confirmed. The normal primary-branch behavior remains the
fallback when no feature base is in use.

### UC-8 — Measure mission throughput honestly

For an operator assessing capacity, Parallix can report mission outcomes from
its configured measurement store without converting a local observation into a
universal productivity promise.

**Confidence:** Partial. Any comparison must retain its metric, time window,
and operational caveats; a report is not proof that every team will see the
same result.

### UC-10 — Catch mechanical errors with configured QA

For a maintainer who wants mechanical defects found before review, Parallix
runs the repository's configured validation gate at the relevant mission
checkpoint.

**Confidence:** Confirmed for declared gates. Coverage is bounded by what the
repository chooses to verify.

### UC-11 — Work down the attention queue without watching it yourself

Command-local recovery repairs a failure inside the command that saw it. Missions
that stop *between* commands have nothing running to bounce them, and they pile
up on the board's needs-attention queue. A supervisor run works that queue: it
presses the action each item already advertises, and gives an item that survives
it a fresh agent in that mission's worktree to diagnose and repair. Whatever is
still stuck comes back with the evidence behind it.

**Confidence:** Confirmed. The queue is the board's own, so a mission with a live
agent is never touched; attempts are bounded per failure; an item counts as
cleared only when the board stops asking about it. Integration items are left for
the operator, and defects that belong to the primary branch are escalated rather
than repaired.

## Agent-facing capabilities

The use cases above are written for the operator. These are for the other user
of Parallix: an agent picking up a mission with no memory of the stage before it.

### UC-12 — Find the mission surface from nothing

As an agent given only a mission slug, I want to discover how to read the
mission and how to record my work from `px --help` alone, so that I never have
to go looking through the repository to find out what I am allowed to do.

**Confidence:** Confirmed. Every read and write is named in `px --help` and
prints its own flags under `--help`.

### UC-13 — Know what the mission is before acting

As an agent starting a stage, I want one command to tell me the mission's brief,
its declared gates, the last checkpoint and where the review stands, so that I
begin from recorded fact rather than reconstructing intent from a workspace.

**Confidence:** Confirmed for recorded state. A mission with nothing recorded
says so rather than inventing it.

### UC-14 — Record what the mission is for

As a drafting agent, I want to record the goal, the reason, the scope, what is
out of scope and the gates as mission state, so that the contract I agree to is
the same one the reviewer later judges, and neither of us is reading a document
that has drifted.

**Confidence:** Confirmed. Every write is versioned and rejects a stale one, and
a mission whose goal, scope or verification gate is missing cannot be activated.

### UC-15 — Leave evidence the next agent can resume from

As an executing agent, I want to record each checkpoint's Goal Check evidence
and a concrete next action, so that whoever continues this mission — including a
different agent family — starts from committed facts instead of guessing.

**Confidence:** Confirmed. Re-recording a checkpoint replaces its evidence and
leaves the others untouched.

### UC-16 — Answer a review without losing the thread

As a reviewer I want to record a verdict with named findings, and as an
implementer I want to answer each one, so that a later agent of either role can
read the whole exchange back rather than starting the argument again.

**Confidence:** Partial. Findings and resolutions recorded through `px` are read
back in full. Reviews submitted directly on the pull request by a human do not
yet reach the mission; TASK-2543 covers that.

### UC-17 — Fail instead of overwriting someone else's work

As an agent holding a mission another agent is also touching, I want my write to
be refused when the mission has moved on, so that I re-read and decide again
rather than silently discarding a change I never saw.

**Confidence:** Confirmed for the versioned mission writes. The review verbs
record against the open round rather than a caller-supplied version.

### UC-18 — Work on tasks without owning them

As an agent doing task-level work — creating, finding and editing tasks,
assignment, dependencies, follow-up work — I want one place a task's state
lives, so that Parallix never becomes a second one.

**Confidence:** Confirmed, with one record rather than a provider contract. The
Mission aggregate is the only self-hosted task record: there is no task source,
task table or task command beside it. A predecessor is a Mission-to-Mission
dependency recorded with `px depends` and reported by `px status`; nothing
enforces it, so it informs whoever reads the mission next rather than gating
anything.

Legacy Backlog records enter through the explicit one-way `px import-legacy`.
Historical refined and completed lanes retain their recorded status without
inventing a current contract or review. Each imported Mission traces a pinned
source artifact, and `px status <slug>` includes its full task body after the
repository file is removed. The Mission aggregate remains the authority for
current scope, criteria, evidence, labels, and lifecycle state. The explicit
migration also copies checkpoint Goal Check rows when the repository document
adds evidence without contradicting a recorded checkpoint.

The migration audit inventories retired workflow files and refuses cleanup
while any file lacks a verified destination, required Mission context is
missing, or normal commands still depend on retired paths.
Unstarted Backlog inputs remain in place until the operator chooses to draft
them; they need no Mission record and are outside migration deletion scope.
Backlog remains a supported external task view: descriptive titles may be read
from it, and lifecycle status and assignment are mirrored for its users.
These retained provider reads and writes do not block retirement of Mission
and checkpoint documents. Started Missions and their checkpoint evidence come
from Mission state; completed catalogs are not reconstructed from task files.
Delivery statistics credit the final implementer recorded in the Mission's
Review. Historical completed Missions without Review history use their recorded
assignee. Attempt telemetry preserves resource consumption without granting
completed-mission credit to earlier implementers or inferred model owners.
Refreshing imported Missions can preserve newer committed task bodies without
ingesting those future inputs. Refreshed preservation artifacts must be committed
before they authorize cleanup.


## Positioning boundaries

Parallix is a local-first workflow harness, not a coding model, IDE, or
guaranteed autonomous engineer. It improves isolation, continuity, and
verification discipline; it does not remove the need for operator judgment,
meaningful tests, or honest review.

When describing these capabilities elsewhere, preserve their limitations. Do
not turn a configured fallback into a guarantee, a measurement into a universal
benchmark, or a passing gate into proof of product value.
