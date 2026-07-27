---
id: TASK-2287
title: Build native binary platform matrix and release evidence
status: refined
assignee: [codex]
created_date: '2026-07-19 00:00'
labels:
  - binary
  - release
  - supply-chain
  - user_value
dependencies:
  - TASK-2286
references:
  - docs/adr/0044-workflow-distribution-model.md
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Extend the proven one-platform SEA build to the candidate platform matrix using native build and smoke execution on every claimed target. Add archives, checksums, signatures or explicit unsigned status, SBOM, notices, and installation documentation. Cross-produced binaries without native execution do not count as supported.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 Each claimed target has a native build and the complete TASK-2286 smoke suite executed on that target
- [ ] #2 Archives follow ADR 0044 naming and contain only declared installable release materials
- [ ] #3 Checksums, SBOM, licenses, third-party notices, build metadata, and signature status are generated and audited per target
- [ ] #4 Platform-specific signal, path, terminal, SQLite, Git, and shutdown behavior has regression evidence
- [ ] #5 Unsupported candidates are omitted from documentation rather than represented by unexecuted cross-build output
- [ ] #6 npm remains a supported fallback
- [ ] #7 Installation and uninstall instructions are tested on clean environments
- [ ] #8 Rollback can withdraw one target without withdrawing proven targets or npm
<!-- AC:END -->

## Implementation Plan

1. Establish native runners and pinned toolchains per candidate target.
2. Build, smoke, audit, and archive one target at a time.
3. Publish support documentation only for passing targets.
4. Exercise per-target withdrawal and rollback procedures.

## Definition of Done

<!-- DOD:BEGIN -->
- [ ] #1 Every support claim links to native evidence
- [ ] #2 Release-content and supply-chain gates pass
- [ ] #3 No mission branch is pushed to `origin`
- [ ] #4 Publication remains separately authorized
<!-- DOD:END -->
