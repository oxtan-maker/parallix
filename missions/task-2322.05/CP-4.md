# CP-4: Gate run and success-criterion evidence map

## Summary

Ran the mission-declared gate on the committed tree and mapped every success
criterion to code and test proof.

**Gate result.** `./scripts/verify-local.sh all` — exit 0, 1560 tests, 0 fail.
The default suite excludes files that cross a real Git/process boundary, so the
integration suite was also run for the changed handoff, SQLite, and adapter
files: `npm run test:integration` — exit 0, 1435 tests, 0 fail, 25 skipped
(pre-existing skips). One flake was observed and is not a regression:
`"build/px.mjs status still exits 0 (headless path unchanged)"` hit its 30 s
`spawnSync` timeout in one full-suite run and passes in 3.6 s when
`test/tui-spawn.test.ts` runs alone; the rerun of the same commit was clean.

**Lint.** `npx eslint src/ test/task-2322-05-*.ts scripts/build-test-runtime.ts`
reports one pre-existing error in `src/application/services/agent-block-service.ts`
(untouched by this mission). Per-file counts for every test file this mission
edited are identical before and after the change (`test/handoff.test.ts` 34,
`test/sqlite-adapter-cp1.test.ts` 1, `test/sqlite-recovery-cp5.test.ts` 2,
others 0), so no new lint error was introduced. `npx tsc --noEmit` and
`npx tsc --noEmit --project tsconfig.test.json` are clean.

**Graph context.** `graphify-out/` exists but holds no `graph.json`, so there is
no graph index to update.

**No focused or bare-skipped tests were added**; every new test is an ordinary
`test(...)`/`it(...)`.

**Scope boundaries respected.** Production still selects the compatibility
authority (`createMissionApplicationServices(...).authority === 'compatibility'`);
the SQLite Mission adapter is reachable only from test fixtures; no command
dual-writes, reconciles, or falls back; external task material is carried as one
`ExternalTaskRef` value and never as a task-catalog aggregate; generated
artifacts are stored as locators. One deliberate limitation: intake through the
compatibility authority refuses to create the task record, because creating it
belongs to `px draft` and adding a second task writer is a restricted area. The
intake use case is fully exercised against fake ports and isolated SQLite rows,
and the board path returns an explicit failure rather than a silent one.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 — intake creates a checked `Mission` with its `RepositoryId` and any supplied external-task trace | `src/domain/mission.ts:109`, `src/application/mission-intake-service.ts:47`, `"SC1: intake materializes a Mission with its RepositoryId and external trace, writing one aggregate"` | PASS |
| SC1 — no task-catalog aggregate is written by that flow | `"SC1/SC6: intake writes one Mission aggregate and its external trace, and no task catalog"`, `"SC6: the compatibility authority refuses to create a task record at intake"`, `src/domain/external-task.ts:1` | PASS |
| SC2 — activation and each changed transition invoke a Mission repository port | `src/platform/runtime/lib/adapters/legacy-active-adapter.ts:128`, `src/application/mission-lifecycle-service.ts:87`, `"SC2: activation loads, decides, and commits the transition with its lane event"` | PASS |
| SC2 — invalid domain transitions are rejected | `"SC2: an invalid domain transition is refused and nothing is written"`, `src/domain/mission-workflow.ts:69` | PASS |
| SC2 — stale expected versions are rejected in both stores | `"SC2: a stale expected version is refused before the domain decides"`, `"SC2: a second writer holding the old revision is refused and changes nothing"`, `"SC2: a concurrent edit invalidates the caller revision and refuses the write"` | PASS |
| SC3 — checkpoint data round-trips through `Mission.CheckpointData` including `GoalCheckRow` | `"SC3: checkpoint data round-trips through the boundary with GoalCheckRow semantics"`, `"SC3: checkpoint data and Goal Check rows round-trip through real rows"`, `"SC3: the compatibility authority materializes CheckpointData from CP-N.md documents"` | PASS |
| SC3 — the checkpoint use case has no persistence file-path or SQL-schema input | `src/application/mission-checkpoint-service.ts:32`, `"SC3: the checkpoint request carries no persistence path or SQL input"` | PASS |
| SC4 — handoff records structured NEL data through the checked Mission boundary | `src/platform/runtime/lib/commands/handoff.ts:1150`, `src/application/mission-handoff-service.ts:67`, `"SC4: handoff records NEL through the boundary and reports the derived record"` | PASS |
| SC4 — large generated artifacts are stored as references, not SQLite blob payloads | `src/domain/net-engineering-lines.ts:60`, `"SC4: a large generated artifact is carried as a locator, never as content"`, `"SC4: handoff stores the NEL number and keeps large artifacts as references, not blobs"`, `"SC4: handoff writes the legacy NEL document shape with artifact references only"` | PASS |
| SC5 — each changed CLI operation is characterized, with failures and external-effect ordering | `"SC5 characterization: checkpoint runs the gate, then stages, then commits, in that order"`, `"SC5 characterization: a failed gate stops checkpoint before any Git effect"`, `"SC5 characterization: NEL capture observes the primary branch first, then records the mission"`, `"SC5 characterization: a refused Mission write makes NEL capture fail closed"`, `"SC5 characterization: an undetectable primary branch is a skipped capture, not a failure"` | PASS |
| SC5 — each changed shared UI command-controller operation is characterized | `"SC5: the controller dispatches checkpoint:record through the checkpoint use case"`, `"SC5: the controller rejects a stale board request before the use case runs"`, `"SC5: a Mission command without a payload or a configured authority is refused"`, `"SC5: intake dispatched from the board reaches the intake use case with its trace"`, `test/board-controller.test.ts` | PASS |
| SC5 — activation effect ordering preserved (launch → safety → status → port write → stats → handoff) | `"legacy active adapter preserves the launch-synchronize-stats-handoff lifecycle order"`, `"legacy active adapter fails closed when the Mission authority refuses the activation"` | PASS |
| SC6 — SQLite-backed tests use isolated fixtures | `test/task-2322-05-mission-sqlite-fixture.test.ts:44`, `"SC1/SC6: intake writes one Mission aggregate and its external trace, and no task catalog"` | PASS |
| SC6 — production selects one compatibility authority with no dual-write, reconcile, or fallback path | `src/platform/runtime/lib/composition/application-services.ts:102`, `"SC6: production selects exactly one compatibility authority for every Mission use case"`, ADR 0053 | PASS |
| SC7 — the changed application and UI modules contain no direct filesystem persistence or SQL | `"SC7: the Mission use cases reach persistence only through the application ports"`, `"SC7: the shared UI controller reaches the compatibility documents only through the port"`, `"SC2: no src/application/ file imports node:sqlite directly"`, `"SC7: no unclassified durable file read/write in src/application/ or src/interfaces/"` | PASS |
| SC7 — persistence is reached through the port, and the new adapter is inventoried | `src/adapters/backlog/compatibility-mission-store.ts:91`, `src/platform/runtime/lib/core/durable-state-inventory.ts:128`, `"SC1 reverse: all durable-IO files under src/ are present in the inventory"` | PASS |
| Declared gate passed on the committed tree | `./scripts/verify-local.sh all`, `test/task-2322-05-mission-use-cases.test.ts`, `test/task-2322-05-cli-characterization.test.ts`, `test/handoff.test.ts` | PASS |
| Mandatory integration gate ran | `./scripts/verify-local.sh integrate`, `config/integration-pipelines.json` | PASS |
| Changed integration-suite files verified | `npm run test:integration`, `test/task-2322-05-mission-sqlite-fixture.test.ts` | PASS |
| Docs updated for the boundary and the two behavior changes | `docs/adr/0053-operational-persistence-and-authority-boundaries.md:137`, `src/domain/README.md:122`, `CHANGELOG.md:36` | PASS |

Next action: Hand off task-2322.05 for review, flagging the two behavior changes (`nel-record.json` gains an `artifacts` locator array; NEL capture fails closed for an unrecorded mission) and the deliberate compatibility-intake limitation for reviewer confirmation.
