# CP-1 — CLI command ownership inventory

## Summary

Recorded the complete command inventory before extraction. The current composition root imports every command from `src/adapters/cli/commands/`; the heavy commands below still own workflow sequencing in that adapter layer. Existing application services are recorded where the command already uses them, so later checkpoints can replace only the orchestration seam and preserve the command contract.

| Registered command | Current inbound interface | Application use case / ownership state | Ports / concrete adapters currently involved | Composition wiring |
|---|---|---|---|---|
| active | `runtime.ts` dispatch → `active.ts` | `ExecuteMissionService` (partial; renderer and repair orchestration remain command-side) | execute ports; agents, assets, backlog, filesystem, git, review | `create-cli.ts` `withActiveService` |
| checkpoint | `runtime.ts` dispatch → `checkpoint.ts` | `MissionCheckpointService` (partial) | backlog, filesystem, git, verification | `create-cli.ts` direct command |
| config | `runtime.ts` dispatch → `config.ts` | single config-adapter delegation (compliant) | config | `create-cli.ts` direct command |
| diff | `runtime.ts` dispatch → `diff.ts` | single git-adapter delegation (compliant) | filesystem, git, child-process rendering | `create-cli.ts` direct command |
| draft | `runtime.ts` dispatch → `draft.ts` | command-side orchestration | agents, assets, backlog, config, filesystem, git, verification | `create-cli.ts` mission factory |
| handoff | `runtime.ts` dispatch → `handoff.ts` | `MissionHandoffService` (partial; complete handoff stays command-side) | agents, backlog, config, filesystem, Forgejo, git, review, storage, verification | `create-cli.ts` mission factory |
| integrate | `runtime.ts` dispatch → `integrate.ts` | `MissionIntegrationService` (partial; merge/retry/hook flow stays command-side) | agents, backlog, config, filesystem, Forgejo, git, process, review, verification | `create-cli.ts` mission factory |
| rebase | `runtime.ts` dispatch → `rebase.ts` | command-side orchestration | agents, backlog, config, filesystem, Forgejo, git, review, verification | `create-cli.ts` mission factory |
| resolve-conflict | `runtime.ts` dispatch → `resolve-conflict.ts` | single conflict-resolution delegation (compliant) | git / verification | `create-cli.ts` direct command |
| review | `runtime.ts` dispatch → `review.ts` | review command adapter delegation; composition supplies persistence | review adapter plus mission-store bindings | `create-cli.ts` review wrapper |
| setup-review | `runtime.ts` dispatch → `setup-review.ts` | single review-adapter delegation | review | `create-cli.ts` direct command |
| setup | `runtime.ts` dispatch → `setup.ts` | thin single review-adapter re-export (compliant) | review | `create-cli.ts` direct command |
| stats | `runtime.ts` dispatch → `stats.ts` | `StatisticsService` semantics only; orchestration remains command-side | backlog, config, Forgejo, git, sqlite, filesystem | `create-cli.ts` direct command |
| status | `runtime.ts` dispatch → `status.ts` | board projection is partial application use case | agents, backlog, Forgejo, git, measurement/history ports | `create-cli.ts` graph wrapper |
| verify | `runtime.ts` dispatch → `verify.ts` | thin single verification-adapter re-export (compliant) | verification | `create-cli.ts` direct command |

Shared non-command modules: `repair-handoff.ts` is consumed by `active.ts` and `review-loop.ts` and belongs with the future handoff/active workflow use cases; `stats-backfill.ts` is consumed by `LegacyStatsBackfillAdapter` and belongs with `StatsBackfillService`; `stats-report.ts` is consumed by `stats.ts` and is the future CLI stats renderer.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| All 15 registered commands are inventoried | `src/interfaces/cli/runtime.ts:19`, `src/composition/create-cli.ts:107` | PASS |
| Shared modules and their consumers are identified | `src/adapters/review/review-loop.ts:28`, `src/adapters/mission/stats-backfill-adapter.ts:1` | PASS |
| Existing partial application seams are identified | `src/composition/application-services.ts:89`, `src/application/services/statistics-service.ts:1` | PASS |
| Current command-to-composition wiring is reproducible | `src/composition/create-cli.ts:97` | PASS |

Next action: Extract the `integrate` and `handoff` workflow seams into application-owned use cases while preserving their tested exports and CLI outputs.
