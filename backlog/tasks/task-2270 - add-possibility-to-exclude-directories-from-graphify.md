---
id: TASK-2270
title: add possibility to exclude directories from graphify
status: active
assignee: [codex]
created_date: '2026-07-11 05:03'
labels: [user_value]
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
problem: when parallix develops itselv it generates a lot of task documents that pollutes the graphify graph. Add configuration to exclude directories from graphify and configure parallix to exclude all mission documents from graphify
<!-- SECTION:DESCRIPTION:END -->

## Codex Pre-Draft

**Goal:** allow Parallix to configure Graphify exclusions so generated mission artifacts do not dominate the self-hosting knowledge graph.

**Scope and proof:** identify Graphify's supported exclusion configuration and the Parallix invocation/configuration seam; exclude mission-document directories from this repository's graph build without excluding source relationships; add a small fixture proving excluded files are absent while source nodes and cross-file links remain.

**Checkpoints:** (1) configuration/API inventory and graph fixture; (2) exclusion wiring and repository configuration; (3) graph update plus focused verification.

**Stop rule:** do not filter graph output after indexing or exclude `missions/` wholesale if it contains code-relevant artifacts; use the narrowest supported source-level exclusion and document it.

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
