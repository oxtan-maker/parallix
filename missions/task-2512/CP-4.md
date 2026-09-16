# CP-4: Guard the thin adapter and verify the final tree

Landed the regression guards for the invariants this mission establishes and
ran both declared gates on the final tree.

- `test/dependency-graph.test.ts` asserts the exception list is empty; that
  `src/adapters/cli/commands/integrate.ts` stays a port binding (≤450 lines, no
  `node:child_process` import); and that the application integrate modules stay
  split (each ≤500 lines, none `@ts-nocheck`). A repopulated allowlist, a
  regrown adapter, or a re-merged workflow monolith fails the suite.
- `src/adapters/README.md` "Known outstanding debt" already states the
  post-mission truth: `handoff.ts` and `integrate.ts` bind ports and delegate,
  and the remaining sequencers are named (`review/review-loop.ts`,
  `cli/commands/stats.ts`, `cli/commands/active.ts`). The step split changes no
  user-facing behavior, so no other authored documentation changes.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC8: regression guards are asserted and fail when violated | `npm test -- test/dependency-graph.test.ts`, `"production dependency exceptions are retired"`, `"integrate CLI adapter stays a port binding rather than a workflow sequencer"`, `"integrate workflow stays split into step modules rather than one relocated monolith"` | PASS |
| SC9: declared gates pass on the final tree | `./scripts/verify-local.sh all` (exit 0, 2628 tests, 2628 pass, 0 fail) and `./scripts/verify-local.sh static-analysis` (exit 0: ESLint, typecheck, test-hygiene, test typecheck) | PASS |
| SC10: adapter debt section states the post-mission truth | `src/adapters/README.md` "Known outstanding debt" | PASS |
| SC1: exception list empty, production scan clean | `npm test -- test/dependency-graph.test.ts`, `"dependency graph production scan has no violation outside the owned allowlist"` | PASS |
| SC2/SC3: handoff use case adapter-free, review evidence exports intact | `npm test -- test/review-static-evidence.test.ts`, `test/application-boundaries.test.ts` | PASS |
| SC4–SC7: adapter surface, seams, and suites preserved after the split | see `missions/task-2512/CP-3.md`; `npm test -- test/integrate.test.ts test/task-2377.05-kernel-only-bounce.test.ts test/forgejo-independence.test.ts` | PASS |

Next action: hand off for review; no follow-up edit is pending in
`src/application/integrate/` or `src/adapters/cli/commands/integrate.ts`.
