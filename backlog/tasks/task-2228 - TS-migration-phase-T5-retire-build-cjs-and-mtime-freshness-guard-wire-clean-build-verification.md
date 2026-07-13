---
id: TASK-2228
title: >-
  TS migration phase T5: retire build:cjs and mtime freshness guard; wire
  clean-build verification
status: backlog
assignee: []
created_date: '2026-07-11 13:46'
labels:
  - typescript
  - migration
  - adr-0044
  - distribution
dependencies:
  - TASK-2227
references:
  - docs/adr/0044-workflow-distribution-model.md
  - docs/authority-reference.md
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implements phase T5 of the repository-wide TypeScript model accepted in the 2026-07-11 update to ADR 0044 (docs/adr/0044-workflow-distribution-model.md, §7, §8, §9). Depends on T4 (task-2227) and on the V1–V4 replacement checks being wired and passing as gates (§7 removal gate — deleting the guard before its replacements are enforced is a stop-the-phase condition). Delete build:cjs, publish:guard, the prepack/prepublishOnly freshness wiring, lib/core/build-freshness.ts and its tests, and the PARALLIX_SKIP_BUILD_CHECK bypass; add the V3 package-content audit script and the V2 reproducible-output check as named gates; add npm run dev (tsx px.ts) as the direct-source path; update README Development (node index.js -> node dist/index.js / npm run dev) and supersede the freshness narrative in docs/authority-reference.md §Public distribution. MINOR semver bump.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 build:cjs, publish:guard, prepack/prepublishOnly freshness wiring, lib/core/build-freshness.ts, its tests, and PARALLIX_SKIP_BUILD_CHECK are all removed
- [ ] #2 A named content-audit gate checks npm pack --dry-run against the ADR 0044 §8 inclusion/exclusion table
- [ ] #3 A reproducible-output check proves two clean builds of the same commit emit identical dist/ file lists
- [ ] #4 npm run dev runs px.ts directly via tsx
- [ ] #5 Full integration pipeline (px integrate gate plan) and tarball-install smoke pass
- [ ] #6 README Development section and docs/authority-reference.md §Public distribution reflect the dist/ model; CHANGELOG MINOR entry recorded
- [ ] #7 Rollback: reverting the phase commit restores the guard and build:cjs intact
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
