---
id: TASK-2525
title: SonarQube baseline and progressive quality enforcement
status: backlog
assignee: []
created_date: '2026-09-16 10:31'
labels: []
dependencies: []
priority: high
ordinal: 84007
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Use the first Parallix SonarQube analysis as a baseline, repair the reliability and highest-severity maintainability debt in bounded batches, then make the server quality gate a required signal in both GitHub Actions and Parallix pre-integration. Keep legacy debt visible without making its initial inventory a blanket merge blocker.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 All child tasks are complete and a fresh SonarQube analysis has an accepted quality-gate result.
- [ ] #2 GitHub and local pre-integration invoke one shared repository SonarQube command with credentials supplied only by their execution environment.
- [ ] #3 The required check blocks a failed quality gate without exposing tokens.
- [ ] #4 New-code regressions fail immediately while legacy debt is remediated in bounded tasks.
<!-- DOD:END -->
