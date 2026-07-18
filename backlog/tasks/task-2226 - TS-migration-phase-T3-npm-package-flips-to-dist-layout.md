---
id: TASK-2226
title: 'TS migration phase T3: npm package flips to dist/ layout'
status: backlog
assignee: [codex]
created_date: '2026-07-11 13:46'
labels:
  - typescript
  - migration
  - adr-0044
  - distribution
dependencies:
  - TASK-2225
references:
  - docs/adr/0044-workflow-distribution-model.md
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implements phase T3 of the repository-wide TypeScript model accepted in the 2026-07-11 update to ADR 0044 (docs/adr/0044-workflow-distribution-model.md, §4, §8, §9). Depends on T2 (task-2225). Flip the published artifact to the dist/ layout: add "type": "commonjs", point main/bin/exports at dist/, rewrite the files allowlist to the §8 inclusion/exclusion table, make prepack run npm run build, enable sourceMap emit, and enable source maps at the entries. Compatibility shim: the sibling .js layout and build:cjs remain the source-checkout dev/test runtime this phase; only the packed artifact changes. MINOR semver bump.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 package.json has type commonjs, main dist/index.js, bin px dist/px.js, and an exports field encapsulating lib/ internals
- [ ] #2 npm pack --dry-run output matches the ADR 0044 §8 inclusion/exclusion table (dist JS + maps + assets in; all .ts, tests, dev config, operator state out)
- [ ] #3 Tarball smoke: install into a temp prefix, px --version prints the executing px.js path, representative read-only commands succeed
- [ ] #4 Successors of the tarball tests in test/task-1424-post-integrate-publish-reinstall.test.js and test/package-persistent-data.test.js pass against the dist layout
- [ ] #5 CHANGELOG MINOR entry recorded and docs/authority-reference.md install steps updated
- [ ] #6 Rollback: reverting package.json/tsconfig.json restores the previous tarball shape
<!-- AC:END -->

## Codex Pre-Draft

Prepared while the supported Node runtime is temporarily unavailable. This is planning
material only: TASK-2226 remains `backlog` until TASK-2225 is integrated and the normal
`px draft` / `px active` workflow can create the mission branch and state records.

### Goal

Make the packed npm artifact run exclusively from `dist/` while retaining the current
source-checkout development/test runtime for this phase. The installed `px` CLI and the
package metadata must resolve only built JavaScript and packaged tool-owned assets; no
TypeScript source or test/development-only files may ship.

### Implementation Scope

- Update `package.json` to declare CommonJS, point `main`, `bin.px`, and the public
  `exports` surface at `dist/`, and retain only deliberately supported entry points.
- Update `tsconfig.json` to emit JavaScript and source maps into `dist/`; keep the
  source-checkout `build:cjs` compatibility path unchanged for T3.
- Replace the npm `files` allowlist with the ADR 0044 §8 artifact table: include
  `dist/`, package-owned assets required at runtime, license/readme/changelog, and
  package metadata; exclude TypeScript, tests, source-only configuration, mission
  history, operator state, and development tooling.
- Make `prepack` perform the production build and enable source-map support at each
  shipped CLI entry point.
- Add tarball-level tests that create a package, install it into a temporary prefix,
  invoke its installed `px`, verify its reported runtime path is under `dist/`, and
  run representative read-only commands from outside the source checkout.
- Update the existing publish/reinstall and persistent-data package tests rather than
  retaining tests that assume sibling source `.js` files in the packed artifact.
- Add the required MINOR changelog entry and update the canonical installation steps
  in `docs/authority-reference.md`.

### Non-Goals

- Do not delete or retire `build:cjs`, source-checkout runtime support, or freshness
  guards; those are TASK-2228 (T5).
- Do not move repository-runtime tests and verification scripts to `dist/`; that is
  TASK-2227 (T4).
- Do not add declaration files, convert tests to TypeScript, change the public CLI
  commands, or alter target-repository path resolution.

### Checkpoints

- CP 1: Inventory the current package metadata, TypeScript emit settings, and
  `npm pack --dry-run` contents; write the exact expected T3 inclusion/exclusion list
  from ADR 0044 §8 before changing configuration.
- CP 2: Implement the `dist/` metadata, compiler output, prepack, source-map, and
  files-allowlist changes; add tarball inspection coverage that checks both included
  and excluded paths.
- CP 3: Install the produced tarball in a temporary prefix and prove `px --version`
  identifies a `dist/px.js` runtime; run the selected read-only command coverage and
  the updated package persistence/reinstall tests.
- CP 4: Run all required gates, capture criterion-level evidence, and verify that the
  source-checkout compatibility runtime still works without moving T4/T5 scope forward.

### Risks and Stop Rules

- Stop if an existing consumer imports a `lib/` internal path that would be blocked by
  `exports`; inventory that consumer and request a compatibility decision instead of
  exporting all internals by default.
- Stop if the tarball can only pass by copying tests, TypeScript source, or operator
  state into the package.
- Stop if a source-checkout command stops working and its repair requires removing the
  T3 compatibility shim; preserve that work for T4/T5.
- Stop if a required runtime asset is absent from the ADR inclusion table; add a focused
  proof and update the packaging decision rather than silently broadening the allowlist.

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
