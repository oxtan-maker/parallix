# CP 7: Startup repair and complete legacy session-module retirement

## Summary

Repaired the operator-local startup failure caused by an empty database carrying
the obsolete `0001-initial-schema` checksum, preserving that database as a
recoverable backup before initializing the current schema through migration
`0004-session-markers`.

The final verification audit also found that the retired worktree session-file
module remained reachable through the runtime barrel export. Removed that
module, its legacy-only tests, and the barrel export; retained legacy files only
as explicit one-way input to `session-marker-import.ts`. Refreshed the checked
consumer, persistence, and resume-capability citations and corrected the stale
current-migration assertion.

During the review-transition defense, the real-PTY confirmation test missed one
Enter event. Five isolated reruns, the exact integration suite, and the final
general verifier all passed the PTY test, so no production TUI behavior or
assertion was weakened. The integration rerun exposed five deterministic
SessionMarker test defects behind that flake: four launch tests still supplied
the retired `sessionsModule` fake instead of the checked `SessionMarkerPort`,
and one recovery test hard-coded the pre-`0004` migration count. The tests now
inject the checked port, dead legacy session mocks are removed, and migration
coverage follows the loaded migration set.

Review then found two production-only wiring defects. Runtime callers supplied
participant identities (`implementer` and `reviewer`) to a checked domain port
that accepts workflow roles (`execute`, `draft`, and `review`), so the database
rejected a successfully completed reviewer launch. The coordinator also failed
to forward its resolved `SessionMarkerPort` into provider launchers, preventing
stale-session cleanup in production. The launch boundary now maps participant
identities to checked roles, rejects unknown values before launch, and passes
the same checked port and canonical role through lookup, provider cleanup, and
save.

The final defense-suite report exposed an incomplete transitional test-runtime
graph: the provider launchers had acquired new runtime imports of checked domain
constructors, but that compatibility graph does not own the domain tree. The
repair does not expand or endorse the CommonJS compatibility runtime. Instead,
the launch coordinator retains the already-selected mission and agent
identities as branded values, provider options require those typed identities,
and the authoritative SessionMarker adapter continues to validate every
persistence operation. This removes the failing runtime edges while preserving
the ESM production bundle and the checked database boundary.

The integration custom-agent smoke then exposed a distribution defect outside
the SessionMarker repository itself: `build/px.mjs` resolved migrations beside
the bundle, but the canonical npm payload did not stage the SQL files there.
A fresh isolated operator home therefore contained an empty database and the
first SessionMarker lookup failed with `no such table: session_markers`. The
canonical bundle now stages every immutable migration through its runtime asset
and checksum manifests. The SEA consumes that same payload instead of maintaining
an independent migration copy, and package gates require the migration directory.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Operator database initializes through the current SessionMarker migration | `src/adapters/sqlite/migrations/0004-session-markers.sql`; test `"getCurrentVersion returns highest applied migration ID"` in `test/sqlite-adapter-cp1.test.ts:298` | PASS |
| Production runtime no longer exposes the retired session-file module | `src/platform/runtime/lib/index.ts:70`; deleted `src/platform/runtime/lib/tools/sessions.ts`; `rg "tools/sessions" src --glob "*.ts"` returns no production matches | PASS |
| Legacy worktree markers remain explicit one-way import input only | `src/platform/runtime/lib/core/durable-state-inventory.ts:375`; `src/adapters/sqlite/session-marker-import.ts:154`; test `"SC1 reverse: all durable-IO files under src/ are present in the inventory"` | PASS |
| Launch resume and marker replacement citations describe the checked port | `src/application/consumer-domain-requirements.ts:148`, `src/application/consumer-domain-requirements.ts:159`; test `"SC3: every consumer citation points at a line containing its anchor"` | PASS |
| Resume-capable launcher coverage follows the moved capability declaration | `test/task-1124-integrate.test.ts:48`; test `"SC 6: resume-capable agents use session persistence via startAgent"` | PASS |
| SessionMarker documentation reflects database authority | `src/domain/session.ts:1`; `src/domain/README.md` | PASS |
| Agent launch tests isolate SessionMarker persistence through the checked port | `test/agents.test.ts:1234`; tests `"startAgent passes resume:false to claude on the first launch and writes a marker"`, `"startAgent rejects instead of reporting launch success when session persistence fails"`, and resume/family-isolation cases | PASS |
| Runtime participant roles map to checked SessionRole values without unsafe role casts | `src/platform/runtime/lib/agents/agents.ts:165`, `src/platform/runtime/lib/agents/agents.ts:356`, `src/platform/runtime/lib/agents/agents.ts:565`; tests `"startAgent maps reviewer to review and forwards the checked port to the launcher"` and `"startAgent rejects unsupported session marker roles before launching"` | PASS |
| Production role mapping crosses the real SQLite constraint with mocked provider dependencies | `test/session-marker-repository.test.ts:539`; test `"persists implementer and reviewer launches using checked SessionRole values"` | PASS |
| Provider stale-session handling receives the coordinator's checked port and canonical role | `src/platform/runtime/lib/agents/agents.ts:400`; test `"startAgent maps reviewer to review and forwards the checked port to the launcher"` | PASS |
| Recovery coverage follows the current migration ledger | `test/sqlite-recovery-cp5.test.ts:93`; test `"interrupted migration: failed migration is rolled back and can be retried"` | PASS |
| Legacy session test options are absent | `rg "sessionsModule" test src` returns no matches; `test/task-1416-repro.test.ts` launch fixtures pass without persistence access | PASS |
| Review-transition integration defense passes | `npm run test:integration` — 1,416 tests, 1,391 passed, 25 annotated skips, 0 failed | PASS |
| Real PTY behavior passes under isolated and suite load | five isolated `test/tui-pty-smoke.test.ts` runs; `npm run test:integration`; `./scripts/verify-local.sh all` | PASS |
| Static-analysis gate passes | `./scripts/verify-local.sh static-analysis` | PASS |
| Focused SessionMarker and provider-launch regression suite passes | `./node_modules/.bin/tsx --test test/agents.test.ts test/session-marker-repository.test.ts test/claude.test.ts test/codex.test.ts test/opencode.test.ts` — 194 passed, 1 annotated skip, 0 failed | PASS |
| Full mission verification gate passes | `./scripts/verify-local.sh all` | PASS |
| Provider launchers do not add runtime domain-constructor edges to the transitional test graph | `src/platform/runtime/lib/agents/codex.ts:6`, `src/platform/runtime/lib/agents/claude.ts:3`, `src/platform/runtime/lib/agents/opencode.ts:9`; emitted launcher scan `rg "../../../../domain" .test-runtime/lib/agents/{agents,claude,codex,opencode}.js` returns no matches | PASS |
| Session identities remain canonical through coordinator lookup and replacement | `src/platform/runtime/lib/agents/agents.ts:172`, `src/platform/runtime/lib/agents/agents.ts:380`, `src/platform/runtime/lib/agents/agents.ts:589`; provider stale cleanup at `src/platform/runtime/lib/agents/codex.ts:145`, `src/platform/runtime/lib/agents/claude.ts:139`, and `src/platform/runtime/lib/agents/opencode.ts:397` | PASS |
| Reported defense failures pass together | `npm test -- test/task-1396-repro.test.ts ... test/task_1004.test.ts` — 64 passed, 0 failed | PASS |
| Final launcher and checked SessionMarker coverage passes | `npm test -- test/agents.test.ts test/claude.test.ts test/codex.test.ts test/opencode.test.ts test/session-marker-repository.test.ts test/task-1124-integrate.test.ts` — 206 passed, 1 annotated skip, 0 failed | PASS |
| Final checked citation maps pass | `npm test -- test/domain-consumer-requirements.test.ts test/persistence-domain-mapping.test.ts test/task-1124-integrate.test.ts` — 34 passed, 0 failed | PASS |
| Final static-analysis gate passes after defense repair | `./scripts/verify-local.sh static-analysis` — ESLint, source typecheck, test hygiene, and test typecheck all passed | PASS |
| Canonical npm and SEA payloads share the complete immutable migration set | `scripts/build-canonical-bundle.ts`; `scripts/build-sea.ts`; test `"task-2285 build/ stages every canonical SQLite migration byte-for-byte"` | PASS |
| Published package cannot omit SQLite migrations | `scripts/package-content-audit.ts`; `npm run test:package-content` — 25 files with checksums verified | PASS |
| SessionMarker authority exists before the bundled CLI reads it | test `"real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` — passed against fresh isolated `PARALLIX_HOME`; active phase 174,190 ms | PASS |
| Final complete fast verifier passes after integration defense repair | `./scripts/verify-local.sh all` — 1,561 passed, 0 failed, 0 skipped | PASS |
| Code graph reflects the final source | `graphify update .` — 14,909 nodes, 17,667 edges, 1,768 communities | PASS |

Next action: checkpoint the repair locally and retry integration.
