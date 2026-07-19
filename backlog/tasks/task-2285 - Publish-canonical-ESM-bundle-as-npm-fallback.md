---
id: TASK-2285
title: Publish canonical ESM bundle as npm fallback
status: backlog
assignee: []
created_date: '2026-07-19 00:00'
labels:
  - npm
  - distribution
  - esm
  - migration
dependencies:
  - TASK-2279
  - TASK-2282
  - TASK-2283
references:
  - docs/adr/0044-workflow-distribution-model.md
  - docs/adr/0046-npm-publish-process-and-security.md
  - package.json
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Change the npm fallback package to execute the canonical ESM bundle and complete the CLI-only package boundary for the next major release. The package includes the bundle, source map, assets represented by the generated manifest, licenses, README, and third-party notices, but no unbundled source tree or unrelated binary artifacts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 Package metadata uses `type: module`, the `px` bin, no `main`, no root export, no declarations, and `engines.node >=22.23.1`
- [ ] #2 `npm pack` contains only the declared bundle, map, metadata, license, README, notices, and required release materials
- [ ] #3 A temporary-prefix install runs version, help, representative headless JSON, explicit TUI non-TTY fallback, SQLite startup, and embedded asset smoke tests
- [ ] #4 Installed execution has no runtime dependency on package `node_modules` beyond the bundled payload
- [ ] #5 Vulnerability, license, third-party notice, SBOM, checksum, and package-content audits pass
- [ ] #6 The next-major compatibility and migration notes cover Node floor, ESM, root import removal, UI invocation, and SQLite import
- [ ] #7 The package executes the same `build/px.mjs` later used as SEA input
- [ ] #8 Rollback restores the prior CommonJS npm artifact while leaving source authority unchanged
<!-- AC:END -->

## Implementation Plan

1. Update package metadata and release content allowlist.
2. Add license, SBOM, notice, checksum, and content gates.
3. Pack and install in temporary prefixes across supported npm runtimes.
4. Record major-version compatibility and rollback instructions.

## Definition of Done

<!-- DOD:BEGIN -->
- [ ] #1 Package and install evidence is captured from a clean tree
- [ ] #2 Static analysis, source, bundle, and package tests pass
- [ ] #3 No publish to npm occurs without explicit release authorization
- [ ] #4 Prior package rollback remains documented and tested
<!-- DOD:END -->
