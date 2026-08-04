# CP-2 — infrastructure re-homed as adapters

Moved filesystem, Git, process, configuration, verification, persistence, and
packaged-asset mechanisms from the legacy runtime into named adapter packages.
Application-owned contracts remain above those implementations.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Filesystem and Git mechanisms live under adapters | `src/adapters/filesystem/mission-utils.ts`; `src/adapters/git/git.ts` | PASS |
| Verification mechanisms live under adapters | `src/adapters/verification/verification.ts`; `src/adapters/verification/mutation-gate.ts` | PASS |
| Packaged assets are adapter-owned | `src/adapters/assets/runtime-assets.ts`; `src/adapters/assets/asset-store.ts` | PASS |
| SQLite implements application-owned persistence ports | `src/application/domain-ports.ts`; `src/adapters/sqlite/mission-store.ts` | PASS |
| Re-homing preserves focused behavior | `./scripts/verify-local.sh all` — 1,703 passed, 0 failed, 0 skipped on the corrected final tree | PASS |

Next action: re-home agent launchers and review workflow mechanisms, injecting Mission persistence instead of resolving composition from adapters.
