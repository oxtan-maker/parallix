# CP-4: Document lifecycle safeguards

## Summary

Added the missing defense-in-depth explanation to the configuration reference.
It now distinguishes the optional post-integration maintenance hook from the
mandatory checks that protect handoff, review, and integration.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Review-requested lifecycle safeguards are documented without presenting them as configuration overrides | `docs/config.md` | PASS |
| Documentation verification passes | `./scripts/verify-local.sh docs` | PASS |

Next action: Obtain renewed reviewer approval before integration.
