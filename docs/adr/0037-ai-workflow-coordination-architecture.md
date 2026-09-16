# ADR 0037: AI workflow coordination architecture

Status: Accepted Date: 2026-04-06 
Last updated: 2026-09-15 
Related: ADR 0048 (fail-closed harness), ADR 0051 (UI-neutral application boundary), ADR 0053 (persistence and authority)

## Context

AI-assisted missions need repeatable startup, checkpoint, handoff, review, and
integration coordination. Those operations combine task state, Git, durable
mission state, verification, and external providers; asking an agent to
reconstruct and sequence them from prose is not an adequate control surface.

The landed architecture has six production responsibilities: domain rules,
application workflows and ports, concrete adapters, interfaces, composition,
and the process entry point. The UI-neutral boundary in ADR 0051 requires
workflow ownership to remain with application use cases while interfaces
translate requests and render outcomes.

## Options considered

### Agent-followed procedures

Rejected for operations that mutate lifecycle or durable mission state. Prose
can explain the policy, but it cannot provide the executable boundary needed to
keep interfaces and concrete mechanisms from owning it.

### Adapter-owned command workflows

Rejected. Adapters may use named host mechanisms, but a multi-integration
workflow belongs in application and crosses application-owned ports.

## Decision

Coordinate missions through application-owned command use cases and ports.
The CLI and TUI translate requests, render results, and map process outcomes;
they do not own workflow sequencing or directly perform lifecycle mutations.
Concrete adapters provide Git, filesystem, task, review, agent, persistence,
and verification mechanisms. Composition supplies those adapters to the
application use cases, and `src/entry/px.ts` hosts the process only.

Checkpoint, status, review, rebase, handoff, integration, and related command
workflows use the same rule: policy and sequencing belong in application;
request translation belongs in interfaces; concrete effects belong in adapters.
An adapter that needs behaviour from another integration receives an
application-owned port rather than taking workflow ownership through a direct
cross-adapter dependency.

Persistence and authority for Mission state, external task material, Git facts,
review state, and other operational data are defined by ADR 0053. Coordination
code consumes those authorities through application-owned ports rather than
deciding their storage inside the workflow.

Checkpoint evidence represents a completed coordination step. Its persistence
or presentation format is likewise governed by ADR 0053 rather than by this ADR.

Agent-facing context and evidence exchange are application surfaces: workflow use cases decide what context a step requires and what evidence a step may record, while persistence remains outside this decision.


## Consequences

- Coordination behavior is callable from more than one interface without
  duplicating lifecycle policy.
- Unit tests can exercise workflow policy with ports rather than real Git,
  providers, agents, or subprocesses.
- Adding a command requires an application use case only when it sequences
  policy across mechanisms; simple rendering and parsing remain interface work.
- Composition becomes the sole location that assembles the complete object
  graph.


## Links

- `docs/adr/0051-ui-neutral-application-boundary.md`
- `docs/adr/0053-operational-persistence-and-authority-boundaries.md`
