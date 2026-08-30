# CP-3: Source-fact identity settled

Collapsed source facts by their `(source, status, value)` tuple in the board projection and documented the same identity at both projection and transport boundaries. The subscription continues fingerprinting the settled projection value.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Source facts contain one tuple instance | `test/task-2444-attention-queue-repro.test.ts`, `"task-2444: source facts are deduplicated by source status and value"` | PASS |
| Projection documents tuple identity | `src/application/projections/board.ts` | PASS |
| Transport documents tuple identity without a shape change | `src/interfaces/web/transport.ts`, `test/web-transport.test.ts` | PASS |
| Subscription diffing still rebuilds and publishes correctly | `test/task-2373-refresh-performance.test.ts`, `"SC33 and SC34: each completed timer tick rebuilds the authority projection"` | PASS |

Next action: Run the declared all-project verification gate and record the final committed goal check.
