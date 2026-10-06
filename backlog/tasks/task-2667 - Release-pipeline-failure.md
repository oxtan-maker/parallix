---
id: TASK-2667
title: Release pipeline failure
status: backlog
assignee: []
created_date: '2026-10-06 11:36'
labels: []
dependencies: []
ordinal: 175008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Run npm ci
npm error code ERESOLVE
npm error ERESOLVE could not resolve
npm error
npm error While resolving: vite@8.3.2
npm error Found: esbuild@0.25.12
npm error node_modules/esbuild
npm error   dev esbuild@"^0.25.12" from the root project
npm error   esbuild@"~0.25.0" from tsx@4.20.6
npm error   node_modules/tsx
npm error     dev tsx@"4.20.6" from the root project
npm error     peerOptional tsx@"^4.8.1" from vite@8.3.2
npm error     node_modules/vite
npm error       dev vite@"^8.3.0" from the root project
npm error
npm error Could not resolve dependency:
npm error peerOptional esbuild@"^0.27.0 || ^0.28.0" from vite@8.3.2
npm error node_modules/vite
npm error   dev vite@"^8.3.0" from the root project
npm error
npm error Conflicting peer dependency: esbuild@0.28.2
npm error node_modules/esbuild
npm error   peerOptional esbuild@"^0.27.0 || ^0.28.0" from vite@8.3.2
npm error   node_modules/vite
npm error     dev vite@"^8.3.0" from the root project
npm error
npm error Fix the upstream dependency conflict, or retry
npm error this command with --force or --legacy-peer-deps
npm error to accept an incorrect (and potentially broken) dependency resolution.
npm error
npm error
npm error For a full report see:
npm error /home/runner/.npm/_logs/2026-10-04T19_44_54_893Z-eresolve-report.txt
npm error A complete log of this run can be found in: /home/runner/.npm/_logs/2026-10-04T19_44_54_893Z-debug-0.log
Error: Process completed with exit code 1.

https://github.com/oxtan-maker/parallix/actions/runs/37229431643/job/111515813121
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
