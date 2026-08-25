---
id: TASK-2414
title: Require test typecheck in every integration gate
status: backlog
assignee: []
created_date: '2026-08-24'
labels: [bug, ai_sdlc]
dependencies: []
priority: high
---

## Description

The static-analysis command correctly runs `tsc --noEmit --project tsconfig.test.json`, but TASK-2413 reached late handoff work with test TypeScript errors that its earlier checks had not blocked. This demonstrates that the integration pipeline can omit the static-analysis gate for a changed mission, or otherwise fail to make its result merge-blocking; it does not assume those errors were present on `main`.

Make static analysis mandatory for every `./scripts/verify-local.sh integrate` plan, regardless of the changed-area classification. A non-zero test typecheck must stop integration before any later gate or merge action. Do not rely on a mission's claimed local verification, and do not add a second TypeScript checker: reuse the existing static-analysis command.

## Acceptance Criteria

- [ ] #1 Every resolved integration plan includes `./scripts/verify-local.sh static-analysis` exactly once and runs it before merge/publication work, including test-only, docs-only, mixed-area, and no-diff plans.
- [ ] #2 A hermetic integration-pipeline regression test proves that a failing static-analysis command stops the plan and prevents subsequent gates from running.
- [ ] #3 A regression test proves that a test-only mission change resolves a plan containing the static-analysis gate.
- [ ] #4 The existing test-project typecheck remains the authority for test TypeScript errors; no duplicate checker or allowlist is introduced.
- [ ] #5 Existing integration-plan ordering and the workflow E2E gate remain intact.

## Scope

- Update the integration-plan resolver and its focused tests only as needed.
- Do not weaken or skip `tsconfig.test.json` checking.
- Do not change TypeScript diagnostics into warnings.

## Checkpoints

### CP-1 — Reproduce the integration omission

Show the current resolved plan for a test-only change and the command path that permits static analysis to be absent or non-blocking.

### CP-2 — Make static analysis unconditional and blocking

Reuse the existing static-analysis command in every integration plan and add the red-to-green resolver/execution regressions.

### CP-3 — Verify integration behavior

Run focused integration-plan tests and the canonical integration verifier; record that a simulated test typecheck failure prevents later gates.

## Definition of Done

- [ ] #1 Static analysis is an unconditional, merge-blocking integration gate.
- [ ] #2 Test-only changes cannot bypass test TypeScript checking.
- [ ] #3 Focused regressions and the integration verifier pass.
