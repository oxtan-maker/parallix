# CP-3: Thin the integrate adapter

Moved the integrate sequencing out of the adapter layer and split it into
cohesive application step modules behind a typed port contract.

An earlier pass at this checkpoint relocated the 2,108-line command body into
one 2,011-line `src/application/integrate-workflow.ts` marked `@ts-nocheck`,
with ports typed as `Record<string, any>` module namespaces. That moved the
monolith without decomposing it and gave the application no real contract
(ADR 0037, ADR 0051). This checkpoint replaces it:

- `src/application/ports/integrate-workflow.ts` declares one typed port per
  mechanism (`git`, `backlog`, `forgejo`, `missionPaths`, `verification`,
  `agents`, `review`, `rebase`, `gates`, `checkout`, `landing`, …), each naming
  only the operations the workflow performs.
- `src/application/integrate-workflow.ts` owns the run order only: argument
  parsing, the authoritative Mission load, recovery, preflight, rebase, gates,
  readiness, and dispatch to the mode's landing.
- `src/application/integrate/` holds the steps: `support.ts` (flag contract,
  task-path containment, bounce implementer), `approval.ts`, `context.ts`,
  `recovery.ts`, `preflight.ts` with `preflight-review.ts` and
  `preflight-checkout.ts`, `rebase.ts`, `gates.ts`, `readiness.ts`,
  `github-pr.ts`, `landing.ts` (probe merge, backlog-only retry, resume) and
  `squash.ts` (squash, closeout, hook-bounced commit, finish, tree proof). The
  largest module is 274 lines; none uses `@ts-nocheck`.
- `src/adapters/cli/commands/integrate.ts` (319 lines) binds each port method
  to its concrete module at call time (the `createHandoffPorts` pattern) and
  keeps the re-export barrel. The bindings must live in this module:
  `test/lib/module-mock.ts` re-links only the declared module, so bindings in a
  sibling file would not observe the suites' module doubles.
- `src/interfaces/cli/integrate.ts` no longer duplicates flag parsing; it
  delegates to the application's `parseIntegrateArgs`.
- Two source-scan assertions in `test/forgejo-independence.test.ts` now read
  the application modules where the Forgejo gates live; the assertions are
  unchanged. `test/task-2377.05-kernel-only-bounce.test.ts` names
  `integrate.ts::createIntegratePorts` as port wiring, matching the existing
  `handoff.ts::createHandoffPorts` entry.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC4: adapter is ≤450 lines, has no `child_process` import, and sequences nothing | `wc -l src/adapters/cli/commands/integrate.ts` reports 319; asserted by `test/dependency-graph.test.ts`, `"integrate CLI adapter stays a port binding rather than a workflow sequencer"` | PASS |
| SC4: sequencing is application-owned, adapter-free, and not a relocated monolith | `npm test -- test/application-boundaries.test.ts`, `"application import guard accepts every file under src/application/"`; `test/dependency-graph.test.ts`, `"integrate workflow stays split into step modules rather than one relocated monolith"` (≤500 lines per module, no `@ts-nocheck`) | PASS |
| SC7: integrate characterization suites pass | `npm test -- test/integrate.test.ts test/integrate-guard.test.ts test/task-2242-backlog-drift.test.ts test/task-2204-integrate-no-variant-a.test.ts test/task-1039-integrate.test.ts` and every other suite importing the adapter — 406 tests, 396 pass, 10 skipped, 0 fail (identical to the pre-change baseline) | PASS |
| SC5/SC6 still hold after the move | `test/integrate.test.ts` (`missionServicesFn`, `exitFn`, `startAgentFn`, `transitionTaskFn`, `applyAgentFallbackFn`, `selectAgentFn`, `workflowLauncherStatusFn`, `routeIntegrationGateFailureFn` seams), `npm test -- test/integrate.test.ts` | PASS |

Next action: record the final gate evidence for SC8–SC10 in `missions/task-2512/CP-4.md`.
