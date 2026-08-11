# CP-3: Durable-citation documentation guard

Added the durable-citation rule to documentation standards and made the docs gate reject new file-and-line citations in live root documentation, ADRs, and prompt templates. A scoped legacy exclusion list records pre-existing documents with historical citations; all unexcluded live guidance is checked. The guard was exercised with a temporary prompt citation and rejected it as expected before the prompt was restored.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Documentation standard prohibits new rotting line-number citations | `./scripts/verify-local.sh docs` | PASS |
| Docs gate scans live docs, ADRs, and prompts for the citation pattern | `./scripts/verify-local.sh docs` | PASS |
| Guard rejects a newly introduced prompt citation | `./scripts/verify-local.sh docs` (expected failure exercised with a temporary prompt fixture) | PASS |
| Restored tree passes documentation verification | `./scripts/verify-local.sh docs` | PASS |

Next action: Parallix can resume handoff using this committed, command-backed final checkpoint.
