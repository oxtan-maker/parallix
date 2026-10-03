---
id: TASK-2637
title: "Finish application-boundary migration for review stats and active"
status: backlog
assignee: []
created_date: '2026-10-03 14:06'
labels: [architecture, refactor]
dependencies: []
references:
  - src/adapters/architecture/boundary-guards.ts
  - src/adapters/README.md
  - docs/adr/0057-verification-tiers-and-trust-model.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Finish the application-boundary migration for review, stats, and active. The goal is application-owned workflow sequencing, concrete adapter mechanisms, request/presentation boundaries, composition-owned assembly, and an executable structural invariant preventing the same responsibility leak. Smaller files alone do not establish success.

Known hotspots are src/adapters/review/review-loop.ts, src/adapters/cli/commands/stats.ts and src/adapters/cli/commands/active.ts. They are investigation candidates, not an exhaustive or already-proven inventory. Mission .01 inspects the live tree before implementation is partitioned. Creating this wave does not execute the investigation or authorize automatic execution, commit, push, or landing of its implementation.

### Provisional execution plan

- TASK-2637.01 — Map responsibility debt and refine the wave; no broad migration.
- TASK-2637.02 — Re-home review sequencing after .01.
- TASK-2637.03 — Re-home active sequencing after .01.
- TASK-2637.04 — Re-home stats sequencing and separate query from presentation after .01.
- TASK-2637.05 — Enforce the responsibility invariant, remove obsolete debt documentation and certify the wave after .02–.04.

Mission .01 must update these tasks with evidence-based owners, exact scope, ports, parity tests and dependency edges; change the partition or add bounded resolution missions if warranted. Tasks .02–.04 are not independently ready until that plan is recorded. Parallel execution is permissible only when the refined plan establishes disjoint responsibility/file ownership and satisfied dependencies.

### Non-negotiable model

Preserve domain → application → adapters/interfaces → composition → entry layering according to the canonical enforced dependency graph (arrows here indicate outward layers, not import direction). Application decides the sequence of loading state, reviewing, invoking agents, persisting outcomes, verifying and transitioning lifecycle state. Adapters may implement application-owned ports but must not coordinate multiple integrations as an implicit application layer. Interfaces parse/translate requests and present results. Composition assembles collaborators; it must not absorb workflow policy.

### Final checkpoint evidence

Provide before evidence naming sequencing modules, integrations coordinated and the missing architectural rule. Provide after evidence naming application use cases, boundary/mechanism modules, ports reused/introduced, production dependency exceptions, the structural invariant and its negative fixture, and behavioral parity suites. Include file:line references and test names, mutation proof, normal local/CI gate results, and exact names of any remaining sequencing debt. Report before/after hotspot sizes only as secondary evidence. Meaningful remaining debt prevents a complete architecture claim.

### Wave contract

Read parent TASK-2637 before work. This is an architecture migration, not product redesign. Preserve CLI syntax, lifecycle and persistence semantics, review, provider behavior, retries/recovery, relied-upon output, and verification unless a behavior is demonstrably a bug. Follow the existing integrate/handoff pattern and canonical dependency graph in src/adapters/architecture/boundary-guards.ts: domain business rules; application sequencing; adapters concrete mechanisms; interfaces request translation/presentation; composition object-graph assembly; entry invocation. Composition must not sequence workflows.

Move responsibilities and update consumers. Do not retain old implementations plus wrappers, duplicate workflows, permanent forwarding modules or compatibility exports without demonstrated consumers. Do not introduce generic workflow/command/DI frameworks, event buses, service locators, broad generic ports, any, mega-ports, or ports around pure functions merely for symmetry. Do not rename orchestration to a Service under adapters or move concrete Git/SQLite/Forgejo/process code into application. Reuse existing application services; do not mix features or rewrite unrelated stable code.

Do not weaken tests, assertions, mocks, coverage, quality gates, scans, timeouts, or exclusions to obtain green. Keep productionDependencyExceptions = []; no new architecture exceptions or allowlists. File size is secondary evidence, never the responsibility invariant. If code decides what happens next in the product workflow, application is the likely owner; if it decides how one external mechanism performs an operation, an adapter is the likely owner.

Preserve architecture principles and existing authorities. If a change requires altering those boundaries, stop dependent implementation and present measured evidence, alternatives, behavioral risks, and a proposed decision; obtain an explicit subsequent user decision. Stop and record an explicit resolution mission when structural responsibility cannot be distinguished, domain semantics would change, state has competing authorities, a new persistence source is needed, or behavior is too ambiguous for tests to establish its contract. Do not silently invent a design.

### Verification obligations

Before adding tests, trace behavior to its existing owning suite and nearby assertions; extend it. Characterize missing semantics before moving code. Keep task provenance in case names/comments, not suite names. Read ADR 0057 before selecting tests; choose the narrowest proving tier. Classify new integration tests in test/lib/test-categories.ts, recording missing hosted-runner dependencies for local-only cases. Fixtures must clean up on success, assertion failure, timeout, signal and child exit. Bug-labeled work requires a retained red-on-parent/green-with-fix reproduction.

Run focused contract checks first and ./scripts/verify-local.sh static-analysis for code changes. Check unit headroom with npm test -- --unit-test-headroom (500 ms alone); preserve the default 1,000 ms cap. Keep production src/ and web/ files <=500 lines and test files <=1,000 except existing explicit debt. Run graphify update . after code edits. Read docs/doc-standards.md before root/docs Markdown edits; run ./scripts/verify-local.sh docs after live documentation changes. Do not repeatedly run full gates when focused proof suffices; normal workflow gates and final wave certification remain mandatory. Push mission branches only to review, never origin.

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Review-loop, active, stats and all additional .01 sequencing violations have moved to visible application use cases; adapters/interfaces retain mechanisms and request/presentation concerns, and composition only assembles the graph.
- [ ] #2 Integrations are reached through typed application-owned ports or already-valid mechanism dependencies; productionDependencyExceptions remains [].
- [ ] #3 A responsibility-based executable invariant prevents the identified leak in production scans, with hermetic positive/negative fixtures and a mutation proof that the check detects regression.
- [ ] #4 Behavioral/regression suites remain green without weakening; CLI/lifecycle/persistence/review/provider/recovery/verification and stats authority/unknown/classification/history semantics are preserved.
- [ ] #5 No parallel old/new implementation, unnecessary compatibility sludge, generic framework or service locator remains; file-size reductions alone are not treated as success.
- [ ] #6 Adapters README and materially affected architecture docs describe actual enforcement and limitations; all five children and any investigation-added prerequisites are complete.
- [ ] #7 Normal local/CI gates pass and final checkpoint contains concrete Before/After evidence, ports, empty exceptions, negative fixture, parity test names, secondary hotspot sizes and exact remaining debt; meaningful debt blocks completion.
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
