---
id: TASK-2277
title: Prove ADR 0044 local runtime, bundle, Ink, and SQLite feasibility
status: backlog
assignee: []
created_date: '2026-07-19 00:00'
labels:
  - architecture
  - migration
  - typescript
  - spike
dependencies:
  - TASK-2276
references:
  - docs/adr/0044-workflow-distribution-model.md
  - package.json
  - tsconfig.json
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Run the local proof phase required by ADR 0044 on the available Node.js 22.23.1 runtime. Prove that an ESM TypeScript/TSX entry can be source-run, bundled as one ESM payload, render a minimal Ink component, use `node:sqlite`, embed logical assets, preserve source maps, and spawn a mocked or harmless subprocess without runtime filesystem module loading.

This mission is evidence gathering, not the product migration. It must not introduce permanent UI, persistence, or workflow behavior. Node 22.23.1 cannot prove the final ESM SEA entry; record that proof as deferred to TASK-2286 rather than introducing a production CommonJS wrapper.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 A disposable TypeScript/TSX spike proves one ESM bundle can load React/Ink, `node:sqlite`, a logical embedded asset, a built-in Node module, and a harmless subprocess on Node 22.23.1
- [ ] #2 The bundle runs without loading first-party code or third-party packages from `node_modules` at runtime
- [ ] #3 A forced error produces a source-mapped TypeScript filename and line
- [ ] #4 Non-TTY execution proves the headless path does not initialize Ink
- [ ] #5 The report records bundle size, cold-start timing from at least 10 runs, dependency inventory, and any bundler warnings without converting those measurements into unsupported release claims
- [ ] #6 ESM SEA is explicitly recorded as unproven on Node 22.23.1 and deferred to TASK-2286; no production CommonJS SEA design is accepted
- [ ] #7 Spike files are removed or confined to a clearly non-production proof directory, and reverting this mission leaves the current CommonJS `dist/` runtime unchanged
<!-- AC:END -->

## Implementation Plan

1. Select no more than two candidate bundlers and document the selection criteria from ADR 0044.
2. Build the smallest proof covering Ink, SQLite, assets, subprocesses, source maps, and non-TTY isolation.
3. Inspect runtime file access and bundle contents, then record measurements and limitations.
4. Remove disposable output and create follow-up blockers for any failed proof.

## Definition of Done

<!-- DOD:BEGIN -->
- [ ] #1 Verification evidence cites exact commands, files, and measured results
- [ ] #2 Static analysis passes on every retained TypeScript file
- [ ] #3 Unit tests remain fast, mocked, and isolated from real Forgejo and agents
- [ ] #4 No package publishing, SEA release, or production behavior change occurs
<!-- DOD:END -->
