# CP-1 — CLI interface inventory

## Summary

Inventoried the six remaining CLI commands and the established interface-command pattern. `active`, `config`, `diff`, and `resolve-conflict` each currently contain their public argument handling and output/exit mapping in adapter-owned modules. `setup` and `verify` are bare forwarding exports to their adapter implementations. The composition root imports all six from adapter paths. The existing `rebase` interface demonstrates that parsing, rendering, typed request shapes, and exit-code delegation can move into `src/interfaces/cli/` while orchestration remains injected from composition/adapters. No application port or service change is needed for this separation.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Six commands and their present ownership were inventoried | `src/composition/create-cli.ts:11`, `src/composition/create-cli.ts:19`, `src/composition/create-cli.ts:20`, `src/composition/create-cli.ts:42`, `src/composition/create-cli.ts:44`, `src/composition/create-cli.ts:55` | PASS |
| `active` parsing and progress rendering identified | `src/adapters/cli/commands/active.ts:13`, `src/adapters/cli/commands/active.ts:25` | PASS |
| `config`, `diff`, and `resolve-conflict` parsing/rendering/exit mapping identified | `src/adapters/cli/commands/config.ts:18`, `src/adapters/cli/commands/diff.ts:8`, `src/adapters/cli/commands/resolve-conflict.ts:47` | PASS |
| `setup` and `verify` forwarding exports identified as migration targets | `src/adapters/cli/commands/setup.ts:1`, `src/adapters/cli/commands/verify.ts:1` | PASS |
| Established interface pattern confirms clean separation | `src/interfaces/cli/rebase.ts:22`, `src/interfaces/cli/rebase.ts:53` | PASS |

Next action: Create the six canonical interface modules, route the composition root through them, and run `./scripts/verify-local.sh all`.
