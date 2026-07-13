---
id: TASK-2223
title: Update the distribution ADR with a repository-wide TypeScript model
status: review
assignee: [custom]
created_date: '2026-07-11 00:00'
labels:
  - adr
  - typescript
  - architecture
  - distribution
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The repository currently has TypeScript sources beside tracked CommonJS output, compiles back into the source tree for tests and publication, uses a separate `dist/` setting in the default `tsconfig`, excludes tests from typechecking, and relies on mtime-based build-freshness checks to prevent source/runtime drift. This hybrid model works, but it creates noisy diffs, incomplete type coverage, two apparent build layouts, and recurring stale-artifact machinery.

Update ADR 0044 with a dated decision for a best-in-class TypeScript development, test, and package model across the entire repository. The decision must cover source layout, module system, compiler configurations, test typing/execution, package exports, CLI shebang/runtime entry, declaration/source-map policy, assets, clean builds, publication contents, and migration from tracked sibling JavaScript. It must produce a phased implementation plan with compatibility and rollback gates; this mission changes the ADR and backlog only, not the runtime build.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Add a dated update to `docs/adr/0044-workflow-distribution-model.md` and update `docs/adr/index.md` so the current TypeScript/build/package decision is easy to find
- [ ] #2 Inventory the current model with evidence from `package.json`, all TypeScript configurations, ESLint, test runners, build-freshness guards, package-content tests, mutation testing, executable entry points, and tracked generated JavaScript
- [ ] #3 Define measurable “best in class” goals: one authoritative source tree, reproducible clean builds, no generated runtime artifacts mixed with source, full intended type coverage, explicit public API boundaries, correct npm artifact contents, debuggable stack traces, and fast local feedback
- [ ] #4 Evaluate at least three coherent target models, including: NodeNext ESM emitted to `dist/`, CommonJS emitted to `dist/`, and a dual-package or bundled alternative; explicitly assess the dual-package hazard and reject it unless a real consumer requires it
- [ ] #5 Decide the repository layout, module format, import-specifier convention, `package.json` `type`/`main`/`bin`/`exports` contract, compiler project structure, and whether declarations and source maps are published
- [ ] #6 Decide how all tests become part of the TypeScript quality model: conversion versus checked JavaScript, unit/e2e runner choice, test-only compiler configuration, coverage, mutation tests, and direct source execution during development
- [ ] #7 Define how non-code assets (`prompts/`, `templates/`, `config/`, docs, and executable scripts) are copied/resolved from both source development and installed `dist/` layouts without CWD assumptions
- [ ] #8 Replace mtime freshness as the target architecture with clean-build and package-content verification based on reproducible outputs; document any temporary compatibility guard required during migration
- [ ] #9 Specify publication proof: build from a clean checkout, `npm pack --dry-run`/tarball inspection, install into a temporary directory, run `px --version` and representative commands, and prove TypeScript sources/tests/operator state are included or excluded intentionally
- [ ] #10 Provide phased implementation missions sized for reviewability, including dependency order, compatibility shims, deletion of tracked generated JavaScript, CI/integration gates, documentation updates, and a rollback point after each phase
- [ ] #11 Reconcile or supersede conflicting statements in ADR 0037, ADR 0044, ADR 0046, ADR 0049, README development instructions, and build-freshness documentation without rewriting historical context
- [ ] #12 Base ecosystem claims on current official Node.js, TypeScript, and npm documentation captured during the mission; distinguish stable requirements from preferences
- [ ] #13 Do not modify runtime code, package scripts, compiler configuration, or tracked generated JavaScript in this ADR mission
- [ ] #14 Run `./scripts/verify-local.sh docs` and documentation link/consistency checks successfully
<!-- AC:END -->

## Required Decision Outputs

- Current-state architecture diagram and pain-point inventory
- Alternatives and scored decision matrix
- Accepted end-state repository tree
- Development, test, build, pack, install, and publish command contract
- Compatibility and semver impact
- Phased migration backlog with acceptance gates and rollback points

## Out of Scope

- Implementing the selected TypeScript migration
- Converting source or tests in this mission
- Changing package format before the ADR is accepted
- Adding runtime dependencies solely to make the architecture appear modern

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
