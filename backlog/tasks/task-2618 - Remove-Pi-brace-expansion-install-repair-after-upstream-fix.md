---
id: TASK-2618
title: Remove Pi brace-expansion install repair after upstream fix
status: backlog
assignee: []
created_date: '2026-09-30 06:40'
labels:
  - maintenance
  - dependencies
dependencies: []
references:
  - 'https://github.com/earendil-works/pi/issues/6882'
modified_files:
  - package.json
  - package-lock.json
  - scripts/repair-pi-brace-expansion.mjs
priority: low
ordinal: 145008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Pi currently publishes an npm-shrinkwrap.json that pins vulnerable brace-expansion@5.0.9, including in pi-coding-agent@0.99.1. Parallix temporarily repairs the nested install and lock metadata through scripts/repair-pi-brace-expansion.mjs, the package.json prepare hook, and a direct brace-expansion@5.0.12 development dependency. Remove this workaround after a compatible Pi release installs a patched brace-expansion without local repair. Upstream context: https://github.com/earendil-works/pi/issues/6882
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Identify a compatible @earendil-works/pi-coding-agent release whose published shrinkwrap resolves brace-expansion to a version outside the current npm audit advisory ranges.
- [ ] #2 Upgrade Pi as needed, remove scripts/repair-pi-brace-expansion.mjs, the prepare hook, and the direct brace-expansion pin if no longer needed; regenerate package-lock.json without manually patching nested entries.
- [ ] #3 From a clean install, npm ls shows no vulnerable nested brace-expansion; npm audit --audit-level=high passes before and after npm ci, and npm ci leaves package-lock.json unchanged.
- [ ] #4 Run focused Pi integration tests and ./scripts/verify-local.sh static-analysis; confirm package build and optional Pi SDK behavior still work.
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
