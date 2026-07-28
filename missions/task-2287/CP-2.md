# CP 2 — Linux x64 native build and smoke evidence

## Summary

Executed the native evidence recorder on the Linux x64 runner. It built the
canonical bundle, invoked `node scripts/build-sea.js` with the pinned Node
26.5.0 runtime, and ran all 15 TASK-2286 shipped-artifact tests successfully.
The resulting Linux x64 record names the source commit, runner, runtime,
executable digest, unsigned status, and required behavioral surfaces.

Linux arm64, macOS x64, macOS arm64, and Windows x64 have no native-runner
record and therefore remain omitted from support claims. No cross-built
artifact was produced or accepted as evidence.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Linux x64 native runner, source commit, pinned Node 26 runtime, build command, and smoke command are recorded together | `release-evidence/linux-x64/native-evidence.json:3`; `release-evidence/linux-x64/native-evidence.json:9`; `release-evidence/linux-x64/native-evidence.json:16`; `release-evidence/linux-x64/native-evidence.json:21` | PASS |
| The complete shipped-artifact suite passed on the same native target | `test/task-2286-native-sea-smoke.test.ts`; "native SEA smoke: the npm fallback passes the same headless smoke set (SC8)" | PASS |
| Signal, asset path, PTY, SQLite, Git, and graceful-shutdown observations are required in target evidence | `scripts/native-release-evidence.js:67` | PASS |
| Unattested matrix candidates are not support claims | `docs/native-release-evidence.md:18` | PASS |

Next action: package and audit the Linux x64 executable archive from its native evidence record, including checksums, SBOM, notices, metadata, and unsigned status.
