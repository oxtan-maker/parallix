---
id: TASK-2622
title: "Refactor tests around behavior and cut verification CPU while preserving coverage"
status: backlog
assignee: []
created_date: '2026-09-30 15:05'
labels:
  - testing
  - performance
  - refactor
dependencies: []
references:
  - "backlog/docs/task-2622-test-wave-schedule.md"
  - "backlog/docs/task-2622-test-wave-inventory.md"
  - "backlog/docs/task-2622-test-wave-inventory.json"
  - "docs/adr/0057-verification-tiers-and-trust-model.md"
  - "docs/adr/0062-native-test-coverage-replaces-c8.md"
  - "docs/adr/0063-self-hosted-verification-performance.md"
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace accumulated task-local regression suites with behavior-owned tests and remove measured repeated execution/dependency cost. Preserve executable line coverage, distinct behavioral guarantees, historical regression provenance, all verification tiers, and human-owned integration trust.

This is a planned implementation wave created after investigation. No test/runner/production changes have been made. Current snapshot: 610 files (397 unit, 203 integration-ci, 8 integration-local, 2 agent/lifecycle E2E), of which 340 use task-specific filenames. Full file-to-owner routing, direct runtime references, fixture references, potential transitive dependency counts and hashes are in the linked inventory. It is a dated planning artifact, not a second test-selection/cache authority.

Learning from TASK-2615: shared execution materially reduced repeated setup but did not prove identical coverage/isolation; coarse Nx keys invalidate on changed candidates; selective keys previously omitted transitive common-runner inputs. Existing lawful architecture dependencies may still impose excessive runtime loading. The bootstrap's launcher-selection import is a concrete eager fan-out candidate; broad application composition imports are another. Profile first, refactor only measured edges.

Compare and combine behavior consolidation, compile-once native ESM execution, fixture/bootstrap reuse, explicit typed dependency boundaries, and conditional feature-scoped reuse. Keep stateful tests isolated unless a separately justified change proves boundaries. Do not simply rename files, merge into huge suites, replace tests with mocks of their own implementation, change the coverage denominator, or adopt caching to preserve stale proof.

Execution order: .01 baseline -> .02 profiling -> .04 fixture foundation -> .03 compile evaluation and .05 bounded dependency work. .06 pilots after .05; .10 persistence, .11 agents, .16 verification (also waits for .03), and .19 authoring policy then form the foundation lanes. .07 lifecycle waits for persistence and agents; .08 review follows lifecycle. .13 metrics follows lifecycle; .12 recovery and .09 integration (also waits for verification) follow review. .14 CLI waits for recovery and metrics; .15 presentation follows CLI. .17 distribution/E2E waits for integration and presentation; .18 optional reuse waits for distribution/E2E and policy; .20 finally certifies parity/throughput. Transitive dependencies ensure final certification includes every child. Dependencies are encoded in child frontmatter; optional evaluation rejection is a valid disposition, not permission to skip parity or fresh checks.

Target: at least 50% less combined unit-plus-CI-integration CPU including compilation/reporting. A claim of massively improved whole-workflow throughput additionally requires at least 50% less total local verification CPU per completed candidate and representative concurrent latency/resource evidence under ADR 0063. Targets are requirements for success, not promised measurements.

All children inherit the constraints below. Review per-assertion ownership before migration; mixed suites may span owners. Preserve exact original source/executable-line inventory and positive-hit sets for unchanged source. Intentional production refactors require a reviewed executable-statement mapping, retained coverage of all mapped baseline paths, transparent denominator changes, and a nondecreasing comparable line-coverage rate; do not hide executable code or weaken new-code coverage. Maintain a distinct behavior ledger using matched tools. Resolve the known native coverage concurrency attribution instability; an unexplained discrepancy does not satisfy parity. Keep tier/category/partition authorities current when moving paths, with complete runtime discovery. New tests go in owning behavior suites with TASK provenance. Required static analysis, focused verification, plain 500ms headroom, file caps, graph update after code edits and docs checks after live docs changes continue to apply. No automatic implementation, commit, push or landing is implied by creating this wave.

### Architecture constraint

Preserve the existing ports-and-adapters architecture, dependency direction, typed application ports, composition authority, and adapter boundaries. Performance work must fit those boundaries; a speedup does not justify bypassing ports, importing concrete adapters into application/domain code, adding service location, weakening architecture guards, or creating parallel production composition for tests.

Cohesive implementation changes inside existing boundaries are in scope when supported by measured evidence. If investigation shows that the general architecture itself causes a material bottleneck and a solution requires changing its principles or boundaries, stop that dependent implementation and bring the evidence, alternatives, behavioral risks, and proposed architectural decision to the user for a broader discussion. Continue independent work that preserves the architecture. This wave does not authorize an architectural exception or rewrite; any such change needs an explicit subsequent decision before implementation.

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All twenty children have completed implementation or explicit evaluation disposition; all 610 initial files and distinct regression guarantees have reviewed migration outcomes.
- [ ] #2 Normalized original-source executable-line inventory and covered-line sets satisfy the pinned baseline parity contract, including reviewed statement mappings for intentional production refactors; distinct historical failure modes remain asserted independently.
- [ ] #3 Combined unit-plus-CI-integration CPU falls by at least 50% including compilation/reporting against a matched refreshed baseline; unsupported speed claims are not accepted.
- [ ] #4 Total-local-verification throughput claims meet the separate 50% CPU and concurrent latency/resource criteria; final actual mandatory gates, fresh checks, E2E and trust/cleanup/performance contracts pass.
- [ ] #5 Behavior ownership and authoring policy prevent recurring task-local organization debt without giant suites or duplicate executable membership authorities.
- [ ] #6 Existing ports-and-adapters architecture and dependency guards remain intact. Any proposal to change architectural principles or boundaries is escalated with measured evidence for a broader user discussion and explicit subsequent decision before dependent implementation.
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
