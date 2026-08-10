# CP-3: Compose the stats use case

Moved the stats command construction into the composition root. The adapter now
exports a command factory and its infrastructure port factory; its default
export remains available for existing named/default consumers. The composition
registry instantiates the application use case with that port.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Composition root constructs the stats use case with the adapter port | `src/composition/create-cli.ts:160` | PASS |
| Adapter retains its default export and existing named export surface | `src/adapters/cli/commands/stats.ts:2374` | PASS |
| Command factory keeps parsing and rendering in the adapter | `src/adapters/cli/commands/stats.ts:2177` | PASS |
| Full project verifier passes after composition wiring | `./scripts/verify-local.sh all` | PASS |
| Existing stats report routing remains characterized | `"stats command routes a positional mission slug to the phase report"` in `test/stats-command-routing.test.ts` | PASS |

Next action: add isolated mocked-port tests for the application use case’s weekly, range, empty-store, and Forgejo-unavailable outcomes.
