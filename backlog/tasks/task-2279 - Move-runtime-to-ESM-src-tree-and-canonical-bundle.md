---
id: TASK-2279
title: Move runtime to ESM src tree and canonical bundle
status: active
assignee: [codex]
created_date: '2026-07-19 00:00'
labels:
  - typescript
  - esm
  - migration
  - build
dependencies:
  - TASK-2278
  - TASK-2290
references:
  - docs/adr/0044-workflow-distribution-model.md
  - docs/adr/0051-ui-neutral-application-boundary.md
  - package.json
  - tsconfig.json
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Move authored runtime and build-tool source into the ADR 0044 ESM TypeScript structure, make `tsc` typecheck-only, and produce the canonical `build/px.mjs` bundle. Preserve the current CommonJS `dist/` runtime as an explicit rollback shim until bundle, npm, CLI compatibility, asset, and source-map gates pass.

This mission must consume the UI-neutral seams from ADR 0051. It must not let the bundle entry statically initialize Ink for headless commands.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 Runtime source is organized under the accepted `src/` domain/application/adapters/interfaces/platform/entry boundaries using `.ts` and `.tsx`
- [ ] #2 `tsc --noEmit` is the authoritative runtime typecheck and the bundler is the only production JavaScript emitter
- [ ] #3 A clean build produces only the declared canonical ESM bundle, source map, asset manifest, and sorted SHA-256 manifest under `build/`
- [ ] #4 Two clean builds from the same tree produce identical bundle manifests
- [ ] #5 Headless command compatibility tests prove existing commands, JSON output, and exit codes without importing Ink
- [ ] #6 Runtime assets resolve only through `AssetStore`; the canonical bundle has no first-party filesystem module lookup or runtime `node_modules` dependency
- [ ] #7 Source maps identify TypeScript files and lines in representative errors
- [ ] #8 The CommonJS rollback shim remains available until the npm package migration passes; its ownership and deletion gate are documented
- [ ] #9 Full tests and static analysis pass without introducing tracked generated JavaScript
- [ ] #10 Reverting the phase restores the current `dist/` runtime and package behavior
<!-- AC:END -->

## Implementation Plan

1. Establish the target source tree and composition root without behavior changes.
2. Move modules in dependency-order, preserving explicit `.js` source specifiers.
3. Add the asset manifest and canonical bundle pipeline.
4. Run clean-build, determinism, source-map, and CLI compatibility gates.

## Definition of Done

<!-- DOD:BEGIN -->
- [ ] #1 Verification evidence captures clean and repeated builds
- [ ] #2 Static analysis passes for all moved source
- [ ] #3 Unit tests remain source-level and hermetic
- [ ] #4 Generated output is ignored and confined to owned directories
<!-- DOD:END -->
