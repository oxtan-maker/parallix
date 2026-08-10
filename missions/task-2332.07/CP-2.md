# CP-2 — Integrate CLI boundary and workflow-use-case seam

## Summary

Added the CLI-owned parser for public `integrate` arguments and an explicit
application use-case entry point wired by the composition root. The use case
currently delegates to a workflow port backed by the legacy command
implementation. Consequently, the legacy integrate command still owns the
multi-adapter workflow sequencing; this checkpoint is intentionally partial.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Integrate parser is owned by the CLI interface | `src/interfaces/cli/integrate.ts:13`, `"integrate CLI interface parses the public flags without adapter dependencies"` | PASS |
| Composition creates an explicit integrate use case | `src/composition/create-cli.ts:119` | PASS |
| Integrate use-case seam is independently unit tested with an in-memory workflow port | `test/cli-command-use-cases.test.ts` | PASS |
| Integrate workflow sequencing is application-owned | `src/adapters/cli/commands/integrate.ts:847` | INCOMPLETE — the legacy command implementation still sequences the workflow. |
| Current partial-tree verification passed | `./scripts/verify-local.sh all` | PASS — 1,936 tests passed in 27.2 seconds. |

Next action: Move the complete integrate workflow body behind application ports, then replace the composition callback that currently invokes the legacy command module.
