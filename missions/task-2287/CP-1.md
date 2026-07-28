# CP 1 — native evidence plan

## Summary

Defined the admissible initial matrix from ADR 0044: Linux x64, Linux arm64,
macOS x64, macOS arm64, and Windows x64.  A candidate becomes supported only
when its own native runner records its operating system/architecture, pinned
Node 25/26 runtime, source commit, successful `node scripts/build-sea.js`, and
successful execution of the complete TASK-2286 smoke suite.  A candidate
lacking any one of those facts is excluded from support claims and is never
represented by a cross-built artifact.

The evidence implementation in the following checkpoints will write one
target record per runner and derive support documentation and archives from
those records.  The current runner is Linux x64; the other four candidates are
planned records, not support claims, until their native runners execute the
same commands.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Initial candidate set is exactly the ADR 0044 executable matrix | ADR 0044; `docs/adr/0044-workflow-distribution-model.md:101` | PASS |
| A native build records a pinned Node runtime, platform, and source commit | `scripts/build-sea.js:375` | PASS |
| The target-local suite covers PTY, SIGTERM, SQLite, Git, paths, and shutdown | `test/task-2286-native-sea-smoke.test.ts`; "native SEA smoke: SIGTERM shuts the running executable down gracefully (SC3, ADR 0044 signals surface)" | PASS |
| Missing runner, toolchain, build, or smoke proof removes a candidate from support claims | `missions/task-2287/MISSION.md:85` | PASS |

Next action: implement the target-evidence recorder and execute the Linux x64 native build plus complete TASK-2286 suite.
