---
id: TASK-2288
title: Retire transitional CommonJS and reconcile dependent ADRs
status: backlog
assignee: []
created_date: '2026-07-19 00:00'
labels:
  - migration
  - cleanup
  - documentation
dependencies:
  - TASK-2284
  - TASK-2285
  - TASK-2287
references:
  - docs/adr/0037-ai-workflow-coordination-architecture.md
  - docs/adr/0042-workflow-cli-color-rendering-approach.md
  - docs/adr/0044-workflow-distribution-model.md
  - docs/adr/0046-npm-publish-process-and-security.md
  - docs/adr/0049-diff-scoped-mutation-testing-with-ratchet-enforcement.md
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
After all replacement gates pass, remove the transitional CommonJS `dist/` architecture and compatibility shims, make binary-first distribution authoritative, and reconcile every dependent ADR and authority document. This mission removes only mechanisms whose replacements are already enforced.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 No authored runtime, test, or build-tool JavaScript remains; tool-required configuration exceptions are inventoried explicitly
- [ ] #2 The CommonJS `dist/` emitter, package entry, compatibility re-exports, test shims, and obsolete asset/package-root assumptions are removed
- [ ] #3 Source, canonical bundle, npm fallback, Ink, web board, SQLite, binary matrix, and CLI compatibility gates all pass before deletion
- [ ] #4 ADRs 0037, 0042, 0046, and 0049 receive dated reconciliation updates without rewriting their history
- [ ] #5 Authority documentation describes CLI, TUI, web board, task catalog, operator SQLite, repository state, assets, npm, and binary distribution consistently
- [ ] #6 Mutation and coverage gates target the accepted TypeScript source or canonical bundle without stale `dist/` assumptions
- [ ] #7 Release documentation makes supported binary targets primary and npm fallback explicit
- [ ] #8 A clean checkout has no generated output, produces deterministic release artifacts, and remains clean after verification
- [ ] #9 Rollback restores the transitional shims as one coherent phase
<!-- AC:END -->

## Implementation Plan

1. Audit every transition mechanism and its replacement proof.
2. Remove obsolete CommonJS/build/test/package paths together.
3. Reconcile ADRs, authority docs, release docs, mutation, and coverage.
4. Run the full clean-checkout and release verification plan.

## Definition of Done

<!-- DOD:BEGIN -->
- [ ] #1 Full verification evidence is captured from a clean checkout
- [ ] #2 Static analysis and all integration/release gates pass
- [ ] #3 No compatibility mechanism is removed before its replacement proof
- [ ] #4 Documentation and implementation describe one consistent end state
<!-- DOD:END -->
