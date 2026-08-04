# CP-4 — one composed CLI and pure inbound TUI

Collapsed command registration into the top-level composition package. The
entry module now only starts the composed CLI and assigns its exit code. The TUI
receives application capabilities and constructs no concrete adapter.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Process host is minimal | `src/entry/px.ts` | PASS |
| One composition module owns command registration | `src/composition/create-cli.ts` | PASS |
| CLI runtime is an inbound dispatcher | `src/interfaces/cli/runtime.ts` | PASS |
| TUI receives capabilities and imports no adapter or composition module | `src/interfaces/tui/ui-command.ts`; `test/tui-command-flow.test.ts` | PASS |
| Rebasing mission 2329 preserved its board behavior | `test/tui-characterization-cp1.test.ts`; `test/tui-command-flow.test.ts`; full integration gate | PASS |

Next action: delete the legacy platform tree, transitional entry points, and the dependency allowlist, then update documentation to the final layout.
