# CP-3 — Metadata, fallback, rollback, and ADR decision

The Linux x64 native proof is complete on Node v26.5.0. The produced executable exposes its license, third-party notices, SBOM, canonical checksum manifest, embedded runtime version, source commit, SHA-256 digest, platform, and unsigned signature status. The canonical npm fallback remains `node build/px.mjs`; it passed the same headless smoke set. Rollback removes only `build/sea` and then rebuilds the native artifact for continued verification, leaving source and npm execution intact. Failure paths for Ink, SQLite, assets, signals, Git, and source maps are fail-closed through the ADR 0044 stop-and-reassess error — there is no runtime or authority fallback.

Decision: approve a follow-up platform-matrix phase, with the 150,867,200-byte Linux x64 binary size explicitly flagged for that phase. This mission makes no cross-platform support claim.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| License, NOTICES, SBOM, checksum, runtime, commit, and unsigned status are inspectable | `scripts/build-sea.js:313`, `test/task-2286-native-sea-smoke.test.ts:435`, `"native SEA smoke: license, notices, SBOM, checksum, runtime, commit, and signature status are inspectable (SC6)"` | PASS |
| npm canonical-bundle fallback remains supported and unchanged | `package.json:9`, `test/task-2286-native-sea-smoke.test.ts:470`, `"native SEA smoke: the npm fallback passes the same headless smoke set (SC8)"` | PASS |
| Rollback removes the native artifact without affecting source or npm execution | `scripts/build-sea.js:223`, `test/task-2286-native-sea-smoke.test.ts:521`, `"native SEA smoke: rollback withdraws the executable without affecting npm or source execution (SC9)"` | PASS |
| ADR 0044 runtime-surface failures are fail-closed and invoke stop-and-reassess | `scripts/sea-surfaces.js:47`, `test/task-2286-sea-stop-rules.test.ts:54`, ADR 0044 | PASS |
| One-platform decision and size follow-up are recorded without a cross-platform claim | `scripts/build-sea.js:317`, `scripts/build-sea.js:325`, `scripts/sea-surfaces.js:37` | PASS — Linux x64 only; 150,867,200-byte size flagged for platform matrix |
| Mission verification gate passes | `./scripts/verify-local.sh all` | PASS |

Next action: Commit this final checkpoint and leave the clean mission branch ready for Parallix's lifecycle handoff; carry the flagged Linux x64 binary-size result into the platform-matrix follow-up.
