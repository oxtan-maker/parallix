# Parallix Authority Reference

This reference explains the durable operating model for the Parallix mission
lifecycle. It is not an implementation index: executable behavior, command
metadata, schemas, configuration, and tests remain their own authorities.

For a public product overview, see [README.md](../README.md). For writing
standards, see [Documentation Standard](doc-standards.md).

## Workflow model

A mission moves through `backlog → draft → ready → active → review → approved
→ done`. A blocking review finding returns the same mission to `active`; it is
repaired and reviewed again rather than silently bypassed.

Each mission has an isolated branch and worktree. The primary checkout is held
for deliberate human integration. This separation makes parallel work possible
without treating the source tree as a shared scratch space.

The common modes are:

| Mode | Durable purpose |
|---|---|
| `portfolio` | Choose and prioritize useful work |
| `draft` | Turn one selected task into a locked mission contract |
| `execute` | Fulfil that contract checkpoint by checkpoint |
| `review` | Independently examine the mission result |
| `act-on-review` | Resolve concrete review findings |
| `integrate` | Land approved work and complete closeout |

## Authority model

Different information has different owners. A conflict is resolved by asking
the owner, rather than synchronizing a second prose copy.

| Authority | Owns |
|---|---|
| `AGENTS.md` | Repository-wide hard rules, verification entrypoints, and autonomy boundaries |
| Locked `MISSION.md` | Mission scope, checkpoints, risks, gates, and stop rules |
| `workflow.config.json` and schemas | Configurable workflow behavior and defaults |
| Commands, source, and tests | Current executable behavior and regression coverage |
| Authored documentation | User-facing concepts, invariants, constraints, and rationale |

Authored docs must describe what remains meaningful when internal modules move.
They can point readers to a stable command, schema, configuration identity, or
ADR, but do not duplicate a source inventory or test catalog.

## Agent continuity and review

The workflow can select from configured agent families. When one family is
temporarily unavailable, the workflow records the block and can continue with
another eligible family; exhaustion fails clearly instead of disguising a
partial result as completion.

Checkpoint documents make execution resumable. They record completed work,
verifiable goal evidence, and a specific next action. Checkpoint evidence is
mission history, not a new authority for live documentation.

Review is a separate phase. The workflow prefers a reviewer distinct from the
implementer when one is available, while preserving an explicit fallback when
the configured pool cannot provide that separation. This is a meaningful second
review attempt, not a guarantee of independent-family coverage.

## Verification model

Verification is layered: an agent claim is never sufficient by itself. Each
repository can declare its own gate through `workflow.config.json`; a locked
mission may add stricter gates appropriate to its scope. A passing gate is
evidence for that tree and time, not a replacement for review.

Integration uses the repository's configured integration pipeline after the
target tree is exact. A repository may also opt into a post-integration command
for local operational work. Those extension points are intentionally generic so
the workflow does not hardcode one host repository's tooling.

## Backlog integrity

A completed or archived task must not reappear as an active backlog task. The
workflow treats the completed or archived record as canonical and prevents a
board mutation from recreating an active duplicate. This preserves a truthful
portfolio view and prevents previously delivered work from being selected again.

## Measurement and limitations

Operational measurements are owned by the configured measurement store, not by
an exported report. Reports are useful views, but unavailable measurement data
is an error to surface rather than a reason to infer or fabricate a value.

Parallix remains local-first and operator-controlled. Its workflow can improve
continuity, isolation, and review discipline, but it does not make a model
reliable by assertion, guarantee review coverage, or replace the operator's
judgment about what should be integrated.
