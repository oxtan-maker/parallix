# CP-2: Add the integration-time workflow gate seam

## Summary

Extended the integration gate path so workflow-owned surfaces can trigger a repo-configured lifecycle gate at `px integrate` time without hardcoding Parallix-repo specifics into generic workflow behavior. The repo-level dispatcher still owns the command; missing or empty integration config remains a clean skip.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Workflow-owned directories and root files resolve to the `workflow` area | `lib/commands/integrate.ts:272-287`, `lib/commands/integrate.ts:289-308` | PASS |
| The workflow gate also runs for `lib` changes so lifecycle regressions are defended when core code changes | `lib/commands/integrate.ts:327-337` | PASS |
| Integration gates are still repo-configured and ordered generically rather than hardcoded to repo paths in product logic | `lib/commands/integrate.ts:311-325`, `lib/commands/integrate.ts:364-394` | PASS |
| `verify-local.sh integrate` skips cleanly when integration config is missing | `scripts/verify-local.sh:121-131`, `test/verify-local-integrate.test.js:38-50` | PASS |
| `verify-local.sh integrate` exposes the resolved workflow gate plan for dry-run debugging | `scripts/verify-local.sh:148-153`, `test/verify-local-integrate.test.js:53-78` | PASS |

Next action: Opt this repo into the layered validation model and document the chosen path.
