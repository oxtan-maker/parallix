# CP-6: Document the GitHub-native release contract and finalize verification

Updated ADR 0046, its index entry, and the directly affected distribution
guidance after consulting `docs/doc-standards.md`. The supported path now keeps
version allocation local, releases only the verified main SHA through npm Trusted
Publishing, and binds npm, tag, and GitHub Release to that SHA without a stored
credential or manual post-publish tag.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| One-commit local allocation and matching metadata | `test/task-2509-local-version-allocation.test.ts`, test `task-2509: local allocation is staged into the landed squash commit, not committed by the refresh hook` | PASS |
| GitHub releases only the verified triggering main SHA with least privilege | `.github/workflows/ci-required.yml`, test `task-2509: release trusts only the successful main-push SHA with release-only OIDC permissions` | PASS |
| Metadata, freshness, collision, lifecycle, provenance, tag, and rerun handling fail closed | `test/task-2509-release-publish.test.ts`, tests `task-2509: release metadata accepts only matching normal SemVer versions`, `task-2509: tag collision and another SHA publication fail closed`, and `task-2509: rerun accepts publication and tag only for the same trusted SHA` | PASS |
| Supported release guidance no longer uses manual/token publication | ADR 0046, `docs/designs/reposition-as-trust-layer.md` | PASS |
| Final repository gates pass | `./scripts/verify-local.sh all`, `./scripts/verify-local.sh static-analysis`, `./scripts/verify-local.sh docs` | PASS |

Next action: No further implementation action; all declared checkpoints are committed and the final tree is ready for Parallix lifecycle handling.
