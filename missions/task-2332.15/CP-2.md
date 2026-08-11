# CP-2 — Canonical CLI interfaces and composition cutover

## Summary

Created the six canonical CLI interface modules with typed request parsing and rendering exports. The composition root now resolves `active`, `setup`, `verify`, `config`, `diff`, and `resolve-conflict` through `src/interfaces/cli/`. The interface modules delegate execution to their existing adapter-backed workflows, preserving command behavior and injected test seams. Deleted the two bare command forwarding modules for setup and verify. The full verification gate passed.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `active.ts`, `setup.ts`, and `verify.ts` export parse and render functions | `src/interfaces/cli/active.ts:8`, `src/interfaces/cli/active.ts:15`, `src/interfaces/cli/setup.ts:5`, `src/interfaces/cli/setup.ts:9`, `src/interfaces/cli/verify.ts:5`, `src/interfaces/cli/verify.ts:9` | PASS |
| `config.ts`, `diff.ts`, and `resolve-conflict.ts` export parse and render functions | `src/interfaces/cli/config.ts:5`, `src/interfaces/cli/config.ts:9`, `src/interfaces/cli/diff.ts:5`, `src/interfaces/cli/diff.ts:9`, `src/interfaces/cli/resolve-conflict.ts:5`, `src/interfaces/cli/resolve-conflict.ts:9` | PASS |
| Composition imports all six command entrypoints from interfaces | `src/composition/create-cli.ts:11`, `src/composition/create-cli.ts:19`, `src/composition/create-cli.ts:20`, `src/composition/create-cli.ts:42`, `src/composition/create-cli.ts:44`, `src/composition/create-cli.ts:54` | PASS |
| Bare setup and verify command re-exports were removed | `src/interfaces/cli/setup.ts:1`, `src/interfaces/cli/verify.ts:1` | PASS |
| Required fast verification gate passed | `./scripts/verify-local.sh all` | PASS |

Next action: Remove remaining migration-specific command facades and transitional re-exports, update layer documentation with ADR 0051, and run `./scripts/verify-local.sh static-analysis`.
