---
id: TASK-2405
title: Retire the completed Mission compatibility importer
status: backlog
assignee: []
created_date: '2026-08-23'
labels: [ai_sdlc]
dependencies: []
---

## Description

Retire `MissionCompatibilityImporter` after confirming every supported operator
database has completed the TASK-2322 cutover. Remove its parser, tests, and only
the provenance schema no remaining importer owns; preserve shared import history
used by the blocklist and statistics importers.

## Acceptance Criteria

- [ ] The importer has no production or test caller, and its migration/schema ownership is either removed or explicitly reassigned.
- [ ] A migration-safe verification proves existing operator databases remain usable without the importer.
- [ ] Static analysis and focused SQLite migration tests pass.
