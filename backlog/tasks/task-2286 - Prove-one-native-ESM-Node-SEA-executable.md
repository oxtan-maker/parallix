---
id: TASK-2286
title: Prove one native ESM Node SEA executable
status: backlog
assignee: [custom]
created_date: '2026-07-19 00:00'
updated_date: '2026-07-24 04:36'
labels:
  - binary
  - sea
  - distribution
  - spike
dependencies:
  - TASK-2295
  - TASK-2305
  - TASK-2285
references:
  - docs/adr/0044-workflow-distribution-model.md
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On a machine with an ESM-capable Node 25/26-or-newer SEA toolchain, build and natively test one standalone executable from the exact canonical ESM bundle used by npm. This mission is intentionally blocked by toolchain availability on the current Node 22.23.1 computer and may wait for the main development machine.

DEPENDENCY CORRECTION: this mission previously depended on TASK-2280, TASK-2282, and TASK-2283. TASK-2280 was superseded by the completed TASK-2295 (bounded SQLite operator state re-homed onto the canonical domain model), so the SQLite precondition is now TASK-2295. The native smoke needs a working TUI *PTY launch*, which the wave-1 shell does not provide — the reusable PTY harness lands in TASK-2305 (Ink TUI wave 3), so that is the correct TUI precondition. The local web board (TASK-2283) is unprioritized and its launch/shutdown smoke has been removed from AC#3 rather than left as a phantom blocker on native distribution; if a web board ships later, adding its native smoke is an additive follow-up.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The build pins and records an ESM-SEA-capable Node version and fails before artifact creation on an unsupported runtime
- [ ] #2 SEA input is exactly the canonical npm `build/px.mjs` payload with snapshot and code cache disabled initially
- [ ] #3 Native smoke covers version, help, headless JSON, TUI PTY launch, SQLite create/write/read, asset access, temporary Git operation, subprocess, signals, and source-mapped diagnostics (web-board smoke is out of scope while TASK-2283 is unprioritized)
- [ ] #4 The executable runs without separately installed Node or runtime `node_modules`
- [ ] #5 Binary size, cold start, idle memory, and shutdown time are measured and compared with documented stop thresholds
- [ ] #6 License, third-party notice, SBOM, checksum, executing runtime, source commit, and unsigned/signature status are inspectable
- [ ] #7 Failure of Ink, SQLite, assets, signals, Git, or source maps triggers ADR 0044 stop-and-reassess rather than a silent runtime substitution
- [ ] #8 npm fallback remains supported and unchanged
- [ ] #9 Rollback withdraws the binary artifact without affecting npm or source execution
<!-- AC:END -->



## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Pin the native Node toolchain and implement the narrow SEA build adapter.
2. Build one native target from the canonical bundle.
3. Run binary, UI, persistence, signal, Git, and diagnostic smoke tests.
4. Record measurements and either approve the platform-matrix phase or invoke stop-and-reassess.
<!-- SECTION:PLAN:END -->

## Definition of Done

<!-- DOD:BEGIN -->
- [ ] #1 Native evidence identifies machine, platform, runtime, and exact artifact digest
- [ ] #2 All binary smoke tests pass without external state
- [ ] #3 No cross-platform support claim is made from one native proof
- [ ] #4 No release publication occurs without explicit authorization
<!-- DOD:END -->
