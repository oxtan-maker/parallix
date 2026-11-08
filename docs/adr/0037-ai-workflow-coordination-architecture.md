# ADR 0037: AI workflow coordination architecture

Status: Accepted; review-policy amendment approved, implementation pending PX-0046
Date: 2026-04-06
Last updated: 2026-11-08
Related: ADR 0048 (fail-closed harness), ADR 0051 (UI-neutral application boundary), ADR 0053 (persistence and authority), ADR 0064 (terminal ownership), ADR 0066 (context)

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

## Decision

Coordinate missions through application-owned use cases and ports. Interfaces
translate and render; adapters perform effects; composition wires them; the
entry point hosts the process. Policy, sequencing and context selection remain
application concerns. ADR 0053 owns operational authority and persistence.

PX-0033 replayed nine historical changes; eight targets were evaluable:

| Question | Evidence | Adopted policy |
| --- | --- | --- |
| Review coverage | Counterexample union: 4/8 targets versus control 3/8; serious targets 3/6 in both (`p = 1`). Bonus findings: 62/7 P1 versus 19/5 P1; new-prompt Codex found all seven P1s. | PX-0046: counterexample pass; two fresh independent approvals when available, one when only one reviewer is available, fresh same-agent/model fallback otherwise. Human review stays optional. |
| Custom effort | `xhigh`: 4/8 targets, 47 bonus/6 P1, 65.2 minutes. `medium`: 3/8, 38/4 P1, 59.2 minutes. | PX-0047: configurable effort, default and self-development request `high`; retain requested and effective backend levels. |

The selected misses do not isolate freshness, repeat effort or model diversity;
the sole target gain was non-serious P3 TASK-2369. PX-0033 retains the full
methods and limitations. Reviewer policy stays application-owned; ADR 0053 owns
evidence, ADR 0064 presentation and ADR 0066 fresh-context reconstruction.


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
