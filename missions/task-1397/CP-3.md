# CP-3: Wire the repo and document the layered validation path

## Summary

Configured Parallix itself to use the repo-local verification dispatcher for all phases and to opt into a stricter integration-time workflow gate. Documented the split between the fast general verifier used in draft/active/review and the exact-tree lifecycle defense used before integrate lands.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Repo verification is routed through `./scripts/verify-local.sh {{area}}` | `workflow.config.json:9-15` | PASS |
| Integration config opts this repo into both static-analysis and workflow lifecycle gates | `config/integration-pipelines.json:2-12` | PASS |
| `verify-local.sh` now has two validation levels: fast general verification and integrate-time gate resolution | `scripts/verify-local.sh:20-22`, `scripts/verify-local.sh:60-175`, `scripts/verify-local.sh:202-215` | PASS |
| README explains the real worktree flow and the fact that integrate runs the stricter configured gate path | `README.md:69-70`, `README.md:146-155` | PASS |
| Authority docs explain the generic config boundary and the integration-only workflow gate layer | `docs/authority-reference.md:60-76`, `docs/authority-reference.md:150-178` | PASS |
| Repo operator guidance records the same layered validation model for future missions | `AGENTS.md:16-20` | PASS |

Next action: Land and verify the deterministic lifecycle suite that exercises the real CLI flow with only the agent stubbed.
