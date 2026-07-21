---
id: TASK-2293
title: Harden legacy TypeScript test mock shapes
status: review
assignee: [codex]
created_date: '2026-07-19 00:00'
labels:
  - typescript
  - tests
  - tech-debt
dependencies:
  - TASK-2276
---

## Description

TASK-2276 renamed the 158 mission-base `test/**/*.test.js` suites to `.test.ts` without changing their CommonJS assertions, mocks, isolation, or execution tiers. Their legacy dynamic mock shapes generate widespread and inconsistent TypeScript diagnostics (including obsolete `@ts-expect-error` directives and inferred empty-object properties). Every converted suite therefore carries a file-level `@ts-nocheck -- TASK-2277` directive as a temporary, behavior-preserving compatibility boundary.

## Scope

- Replace each converted suite's file-level suppression with narrow types, `@ts-expect-error` directives with reasons, or justified `@ts-ignore` directives.
- Preserve mock isolation: unit tests must not call real Forgejo, agents, network services, or expensive CLI operations.
- Work in small suites or mock-helper groups so each removal is independently typechecked and executed.

## Verification Plan

1. For each changed suite, run `npx tsc --noEmit --project tsconfig.test.json`.
2. Run the focused suite through `node --import tsx --test <test-path>.test.ts` and retain its existing mocks.
3. Before completion, run `./scripts/verify-local.sh static-analysis` and `./scripts/verify-local.sh all`.
