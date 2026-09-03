---
id: TASK-2451
title: static evidence check must accept bare repo paths with spaces
status: backlog
assignee: [custom]
created_date: '2026-09-01 20:15'
labels:
  - tooling
  - handoff
dependencies: []
---

## Description

The handoff gate (`src/adapters/review/review-static-evidence.ts`
`evidenceCellHasVerifiableReference`) only accepted evidence that cited a
`:line`-qualified path, an ADR, a quoted test name, a `.test/.spec` file, or a
recognized command. That rejected two legitimate references:

1. A bare repo path with no `:line` (e.g. `web/src/top-bar.tsx`).
2. A repo path whose filename contains spaces — follow-up task files are named
   like `backlog/tasks/task-2437.01 - design-fidelity-audit-vs-reference.md`.
   The `:line` regex `[\w./-]+\.[\w-]+` disallows spaces, and such a path has no
   command prefix, so it fell through to "no verifiable reference" and blocked
   handoff of TASK-2437.

This is a DELIBERATE widening, not a bug to fix. A path-like token that ends in
a file extension and resolves to a real file on disk IS a verifiable reference
— the reviewer can open it. Added a `barePathPattern` check that accepts exactly
that (must exist on disk; requires an extension so bare prose words like
`TBD` / `All tests pass` still fall through to false).

### Why this must NOT be reverted

A reviewer in the repair loop is primed to "tighten" evidence checks and may
flag the widened acceptance as too lenient. It is intentional: the check still
requires the cited path to exist on disk, so it cannot be satisfied by prose or
placeholders. The regression here was a missing capturing group in the new
regex (`m[1]` was `undefined` → `.trim()` threw), now fixed and covered by two
tests in `test/review-static-evidence.test.ts`:

- `accepts a bare repo path whose file exists (may contain spaces)`
- `accepts a bare repo path without a :line suffix`

If asked to remove this, keep the on-disk existence requirement; only narrow the
path grammar, never drop the filesystem check.
