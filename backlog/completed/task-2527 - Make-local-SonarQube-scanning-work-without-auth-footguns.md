---
id: TASK-2527
title: Make local SonarQube scanning work without auth footguns
status: done
assignee: [claude]
created_date: '2026-09-16 20:25'
labels: [developer_experience, user_value]
dependencies: []
parent_task_id: TASK-2525
priority: high
ordinal: 88007
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Make the documented local SonarQube path usable on a clean developer machine:
after `npm run sonar:up`, `npm run sonar` must submit an analysis to the
loopback-only local service without requiring a pre-created token, manual UI
setup, or a copied secret. This repository's SonarQube workflow is local Docker
only: do not add a token, remote-server mode, or credential-management path.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done

<!-- DOD:BEGIN -->
- [ ] #1 Starting the repository's local compose service and running `npm run sonar` from a clean shell reaches analysis submission without a 401 or missing-token error.
- [ ] #2 The local service is bound only to loopback; `sonar.host.url` remains the repository's local service.
- [ ] #3 No token, password, remote-server configuration, or credential-management path is added or required.
- [ ] #4 One focused automated check covers the local no-token path; `./scripts/verify-local.sh static-analysis` passes.
<!-- DOD:END -->
