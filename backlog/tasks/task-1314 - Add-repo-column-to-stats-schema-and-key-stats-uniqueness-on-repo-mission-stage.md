---
id: TASK-1314
title: >-
  Add repo column to stats schema and key stats uniqueness on (repo, mission,
  stage)
status: backlog
assignee: []
created_date: '2026-06-15 07:00'
updated_date: '2026-06-16 04:32'
labels:
  - ai_sdlc
dependencies: []
priority: high
ordinal: 43000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The parallix stats module writes mission telemetry to one operator-global `<PARALLIX_HOME>/stats.csv` shared across every repo on the machine (task-1301). The current schema (`parallix/lib/commands/stats.js` `STATS_HEADERS`) has no `repo` column, and uniqueness keys on `(mission, stage)` for upserts and on `mission` alone for dedup/counts. Once a second repo (the standalone parallix repo, task-1302) shares the same global file, missions/tasks with the same name in different repos collide: e.g. `task-1400` in visualBoard and `task-1400` in the parallix repo are different work but the stats module treats them as one row, corrupting upserts and throughput counts.

Add a `repo` column to the stats schema and weave it into the module's uniqueness so rows are identified per repo:
- add `repo` to `STATS_HEADERS` with a one-time, in-memory legacy-header migration (same pattern as the existing legacy-header upgrade) so existing rows gain `repo` defaulted to a sensible value (e.g. the home/originating repo) without losing data
- make the upsert key `(repo, mission, stage)` and the dedup/count key `(repo, mission)`
- populate `repo` on write from the repo the runtime is operating in (resolved like other repo-scoped config, not hardcoded)
- update `px stats` grouping/reporting and any callers (review-loop stats writer, stats-backfill) to be repo-aware
- add tests proving two same-named missions in different repos stay distinct rows and that legacy rows migrate without duplication or row loss

This is a prerequisite for task-1302: the standalone parallix repo must not collide with visualBoard in the shared global stats file.
<!-- SECTION:DESCRIPTION:END -->
