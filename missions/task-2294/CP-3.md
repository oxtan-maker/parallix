# CP-3: Application ports, selection seam, and final verification

## Summary

Moved persistence interfaces out of the domain and into the application layer.
`AgentSelectionSnapshotPort` asynchronously materializes config, block,
and launcher-availability facts once; `PreparedAgentSelection` then performs
synchronous selections through pure domain policy. Rewrote ADR 0044 as a
compact statement of the current long-term direction, amended ADR 0051 to
reference that decision, and rewrote the living design note with the model,
authority, access patterns, and modeling-decisions audit.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Async port boundary with synchronous hot-path selection | `src/application/services/agent-selection.ts:6`, `src/domain/agents.ts:81`, `"async port is crossed once while prepared selection stays synchronous"` | PASS |
| Unweighted selection is unbiased by eligible-array order; preference and weighting are explicit | `src/domain/agents.ts:23`, `"unweighted selection is random rather than biased by eligible order"`, `config/agents.json` | PASS |
| Task authority remains a swappable application adapter seam with typed conflict results | `src/application/ports/domain.ts`, `src/adapters/backlog/mission-materialization.ts`, `docs/adr/0051-ui-neutral-application-boundary.md` | PASS |
| ADR 0044 records the database-authority direction and materialized snapshot seam | `docs/adr/0044-workflow-distribution-model.md:107`, `:169` | PASS |
| ADR 0051 keeps ports application-owned and domain store-agnostic without duplicating ADR 0044's persistence decision | `docs/adr/0051-ui-neutral-application-boundary.md:342` | PASS |
| Living model note documents evidence, authority, queries, and rejected alternatives | `src/domain/README.md:1` | PASS |
| No SQLite adapter, migration, or existing runtime behavior changed | `src/application/ports/domain.ts:1`, `src/platform/runtime/lib/core/durable-state-inventory.ts:17` remains unchanged | PASS |
| Static analysis passes | `./scripts/verify-local.sh static-analysis` | PASS |
| Full local verification passes | `./scripts/verify-local.sh all` | PASS |

Next action: Commit the corrected model and publish the new round to Forgejo PR #152 for human review.
