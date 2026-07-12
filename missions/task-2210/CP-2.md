# CP 2 — Implementer-help correction

Updated only the top-level help contract and its corresponding agent documentation. `px --help` now shows `draft [<slug>] [--agent <family>]` and `active [<slug>] [--implementer <family>]`, with descriptions that state each flag selects the relevant implementer family. Added a focused automated assertion for all four required help fragments. The command parsers and selection behavior remain untouched.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `px --help` exposes a discoverable path to implementer selection for draft and active | `index.ts:232`, `index.ts:233`, `docs/agents.md:112` | PASS |
| Draft and active help uses the parser-supported spelling and value syntax | `index.ts:232`, `index.ts:233`, `lib/commands/draft.ts:151`, `lib/commands/active.ts:62` | PASS |
| Automated tests assert the corrected help contract without focused or unannotated skipped tests | `test/index.test.js:233`, `"printUsage documents draft and active implementer-selection syntax"` | PASS |
| Existing implementer-selection behavior remains unchanged apart from help and documentation | `lib/commands/draft.ts:278`, `lib/commands/active.ts:186` | PASS |
| Final verification will be recorded with the required command | `./scripts/verify-local.sh all` | PLANNED |

Next action: run the full required verification gate, inspect the built `px --help` output, and record final line-specific evidence in CP-3.
