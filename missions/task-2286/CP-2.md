# CP-2 — Native executable smoke and measurements

Built and smoke-tested the Linux x64 executable using the pinned Node v26.5.0 runtime. The complete native suite exercised version/help, headless JSON, a real Ink PTY, SIGTERM handling, SQLite migration/write/read, declared assets, temporary Git plus subprocess execution, source-mapped diagnostics, and execution with an empty `PATH`. Measurements from the fresh-run probe were 150,867,200 bytes, 102.5 ms cold start, 98.1 MB idle RSS, and 66 ms shutdown. The executable size exceeds the mission's 100 MiB flag-only threshold; the other measurements are within their hard thresholds.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Native version/help, headless JSON, PTY, signal, SQLite, assets, Git/subprocess, and source-map surfaces pass | `test/task-2286-native-sea-smoke.test.ts:186`, `test/task-2286-native-sea-smoke.test.ts:205`, `test/task-2286-native-sea-smoke.test.ts:251`, `test/task-2286-native-sea-smoke.test.ts:353` | PASS |
| Native process uses embedded Node and has no runtime `node_modules` | `test/task-2286-native-sea-smoke.test.ts:373`, `"native SEA smoke: the executable runs with no Node on PATH and no node_modules in its payload (SC4)"` | PASS |
| Measurements are collected and compared to explicit thresholds | `scripts/sea-surfaces.js:37`, `test/task-2286-native-sea-smoke.test.ts:390`, `"native SEA smoke: binary size, cold start, idle memory, and shutdown time are measured against the stop thresholds (SC5)"` | PASS — 150,867,200 bytes (flagged >104,857,600); 102.5 ms cold start; 98.1 MB idle RSS; 66 ms shutdown |
| Native smoke suite completed against the pinned Node v26.5.0 artifact | `PARALLIX_SEA_NODE="$HOME/.nvm/versions/node/v26.5.0/bin/node" "$HOME/.nvm/versions/node/v26.5.0/bin/node" --import tsx --test test/task-2286-native-sea-smoke.test.ts` | PASS |

Next action: Run and record the metadata, npm-fallback, rollback, and ADR 0044 stop-and-reassess checks for CP-3, then execute the mission gate from the committed tree.
