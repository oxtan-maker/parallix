---
id: TASK-2355
title: Add production-composition statistics fixture
status: refined
assignee: [codex]
created_date: 2026-08-10 00:00
labels: [ai_sdlc]
priority: high
dependencies: [TASK-2347]
---

## Description

Add one deterministic fixture that reaches `composeProductionCapabilities` and the BoardMetrics consumed by the board. Seed two repositories and a worktree, full/missing/incomplete telemetry, first completion plus later close, repeated review bounces, an offset completion timestamp, a zero-completion current week, historical states, and two canonical cohorts. Assert hand-computed BoardMetrics values and matching `px stats cohorts` values.

## Acceptance Criteria

- [ ] #1 One production-composition fixture asserts every SC11 statistic from deterministic source rows.
- [ ] #2 The fixture proves BoardMetrics and CLI cohort output agree for canonical labels and implementers.
- [ ] #3 `./scripts/verify-local.sh all` passes.
