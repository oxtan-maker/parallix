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

## Positioning boundaries

Parallix is a local-first workflow harness, not a coding model, IDE, or
guaranteed autonomous engineer. It improves isolation, continuity, and
verification discipline; it does not remove the need for operator judgment,
meaningful tests, or honest review.

When describing these capabilities elsewhere, preserve their limitations. Do
not turn a configured fallback into a guarantee, a measurement into a universal
benchmark, or a passing gate into proof of product value.
