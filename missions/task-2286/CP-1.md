# CP-1 — Native SEA adapter

Implemented the narrow Node SEA adapter in `scripts/build-sea.js`. It resolves and records an explicitly pinned Node 25+ runtime, refuses unsupported Node 22/24 before creating an artifact, copies the canonical `build/px.mjs` unchanged into an ESM SEA configuration with snapshots and code cache disabled, injects the SEA blob, and writes inspectable artifact metadata. The run on Linux x64 used Node v26.5.0 and produced `build/sea/px`; its 150,867,200-byte size is above the mission's flag-only 100 MiB threshold and is carried into CP-2 measurement evidence.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Node 25+ SEA runtime is pinned and Node 22/24 fails before artifact creation | `scripts/build-sea.js:112`, `scripts/sea-surfaces.js:101`, `"SEA runtime gate: Node 25 and newer are accepted, Node 22/24 are refused before artifact creation (SC1)"` | PASS |
| SEA configuration uses canonical ESM input with snapshot and code cache disabled | `scripts/build-sea.js:54`, `scripts/build-sea.js:249`, `scripts/build-sea.js:259` | PASS |
| Adapter produces a local-platform executable and records its provenance | `scripts/build-sea.js:313`, `scripts/build-sea.js:337`, `PARALLIX_SEA_NODE="$HOME/.nvm/versions/node/v26.5.0/bin/node" node scripts/build-sea.js` | PASS |
| Adapter preserves npm bin and canonical builder boundaries | `test/task-2286-sea-stop-rules.test.ts:93`, `package.json:9` | PASS |
| Fast SEA contract verification passes | `node --test test/task-2286-sea-stop-rules.test.ts` | PASS |

Next action: Execute `test/task-2286-native-sea-smoke.test.ts` against the Node v26.5.0-built Linux x64 executable, resolve any real native-surface failure, and record its measurements in CP-2.
