---
id: PX-0056
title: Stop stage statistics from fabricating model, provider and zero usage. Small mission, not a wave: do not split.
status: active
assignee: [codex]
created_date: '2026-11-10 18:04'
labels: [unknown]
dependencies: []
source: synthetic
---

## Description

Stop stage statistics from fabricating model, provider and zero usage. Small mission, not a wave: do not split.

Problem: statistics work for the common case. Remaining bugs are narrow. telemetryToStatsFields in src/application/stats-recording-use-case.ts falls back from observed provider and model to the configured model and then the agent family, and writes missing usage as the string 0. The string-typed StatsRow bridge (measurementToStatsRow and statsRowToMeasurement in src/adapters/cli/commands/stats.ts; num, cost and totals in src/adapters/cli/commands/stats-report.ts) turns NULL back into 0. usage_statistics columns are already nullable (migration 0001) and SqliteMeasurementStore already maps undefined to NULL, so no schema, run identity, review model or ADR change is needed. TASK-2363 fixed the same class for pr_fix_rounds and openai_usage_after: copy that pattern and extend its suite test/integration/stats/measurement-review-fix-nullability.test.ts.

Owners to edit in place: src/application/stats-recording-use-case.ts (telemetryToStatsFields, telemetryUsageFields, stageRow, recordReview, mergeStageRows); src/application/services/statistics-row.ts; src/adapters/cli/commands/stats.ts; src/adapters/cli/commands/stats-report.ts and stats-report-rendering.ts; src/adapters/review/review-agent-fallback.ts (recordStageStatsSafe, stageMeasurements); src/adapters/review/review-loop.ts (recordStage passes the configured model from resolveAgentModel); src/adapters/cli/commands/draft-telemetry.ts and src/adapters/mission/execute-mission-adapters.ts (other recordStageStats callers). Read-only reference: stage-telemetry.ts, run-session.ts and RunRecord already hold observed provider, model, tokens and cost.

Hard rules the mission must state: zero migrations, zero edits under src/adapters/sqlite/, no new columns, no run id, round, revision, accounting-state or cause fields; no edits to src/domain/**, Review, ReviewerResult, RunRecord, AgentLaunchResult, board or status projections, ADR files, consumer-domain-requirements.ts, domain-architecture-guards.test.ts, migration-checksums.ts or tools/verification/**; no new src file, no new test file, no reviewer-only branch or second recording path, no new type mirroring StageTelemetry, StatsRow, MeasurementRecord or UsageRecord; at most 10 production files and 150 added production lines, stop and report instead of exceeding; tests only in the owning suites stats-command-use-case.test.ts, stats-report.test.ts, stats-report-rendering-pure.test.ts and measurement-review-fix-nullability.test.ts, red on the parent first. All exercises use a disposable PARALLIX_HOME; an earlier attempt reportedly migrated the live database.

Known bug classes needing a case each: accumulating two rounds must keep unavailable provider and usage unavailable, never the text undefined or zero; a legacy aggregate row must never absorb another row; px stats mission-phase report must print unavailable not 0 and totals must skip unavailable; an observed zero still prints 0; list every consumer of the changed StatsRow usage fields and show none yields NaN. Bounded hardcoding audit only at: the model argument from resolveAgentModel through recordStage, recordStageStatsSafe and draft-telemetry into telemetryToStatsFields; the family fallbacks in telemetryToStatsFields and stageRow; recordReview substituting reviewer as implementer. Remove each only with a red case, delete unused parameters end to end.

Out of scope: per-run, per-round and reviewed-revision attribution, deciding-run linkage, durable accounting causes and reviewer-run read models (separate follow-up); provider shutdown and IPC (px-0036.01); historical or live database correction (px-0036.03); routing, supported families, operator policy, ADR 0053, approval validity, migrations.

Why this text is so strict: two earlier attempts at this (PR 842, mission px-0036.02, backups backup/px-0036.02-trial1-20261110 and backup/px-0036.02-trial2-20261110) were rejected for duplicated owners: new migrations, a ReviewerRun domain, AgentLaunchObservation duplicating RunRecord, fake verdict rows, ADR guard edits. Read them only for bug classes, never copy structure.

Mission relations: prerequisite px-0036.01 (done). px-0036.03 must depend on this mission instead of px-0036.02. Gate: ./scripts/verify-local.sh all.
