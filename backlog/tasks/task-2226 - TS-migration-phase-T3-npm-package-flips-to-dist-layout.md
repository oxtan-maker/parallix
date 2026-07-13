---
id: TASK-2226
title: 'TS migration phase T3: npm package flips to dist/ layout'
status: backlog
assignee: []
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

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
