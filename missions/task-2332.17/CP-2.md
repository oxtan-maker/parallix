# CP 2 — Application-port coverage

Confirmed that the audited workflow behaviour is already represented by
application-owned ports. The concrete adapter implementations are supplied by
the composition root, so this checkpoint introduces no duplicate port or
parallel wiring.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Handoff behaviour has an application-owned port and adapter implementation | `src/application/ports/handoff-workflow.ts`, `src/adapters/cli/commands/handoff.ts`, `src/composition/create-cli.ts` | PASS |
| Rebase behaviour has an application-owned port and adapter implementation | `src/application/ports/rebase-workflow.ts`, `src/adapters/rebase/rebase-workflow-adapter.ts`, `src/composition/create-cli.ts` | PASS |
| Review behaviour has an application-owned port and adapter implementation | `src/application/ports/review-workflow.ts`, `src/adapters/review/review-commands.ts`, `src/composition/create-cli.ts` | PASS |
| Dependency guard remains green before table reduction | `npm test -- test/dependency-graph.test.ts`, `"cross-adapter guard rejects a prohibited direct import between unnamed adapter packages"` | PASS |

Next action: remove only behaviour rules whose direct imports can be eliminated without changing product-facing command behaviour, then run the production dependency scan.
