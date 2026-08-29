# Mission: Make board capability availability match the wired production graph (task-2426)


## Goal
Make the board's executable-capability reporting truthful per production controller instance: the shared `BoardCommandController` composed by production must carry the already-existing `MissionIntakeService`/`MissionCheckpointService`/`MissionHandoffService` whenever Mission authority is available, and every controller instance must expose one application-owned query answering "can *this* instance execute kind X" (static integration set ∩ services actually wired). The TUI and any future projection must derive advertised action availability from that instance query composed with workflow eligibility — never from the static `INTEGRATED_CAPABILITIES` set alone. Missing services mean not runnable and not advertised; `draft:create`, `review:submit`, `review:act-on-findings`, `approve:review`, and `integrate:merge` stay unavailable.

## Why Now
`INTEGRATED_CAPABILITIES` (`src/application/controller/board-command.ts`) lists `mission:intake`, `checkpoint:record`, and `handoff:record` as integrated, but the production composition (`composeProductionCapabilities` in `src/composition/production-capabilities.ts`) builds the shared `BoardCommandController` with an empty `missionServices` object, so all three dispatches reject with `no Mission authority is configured for this interface`. The TUI's `commandControllerFactory` (`src/composition/board-projection.ts`) additionally constructs controllers with the same empty object, so the TUI's real dispatch path is untruthful even where the shared instance would be fixed. This must be corrected before the web board (ADR 0054) relies on projected action availability: composition and availability must agree, or the browser will advertise actions its dispatcher rejects. TASK-2425 (stale-command authority) already made dispatch *guard* truthfulness; this mission makes *advertised* truthfulness match the same shared instance.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: one capability query method added to `BoardCommandController` + `BoardCommandDispatcher`; service wiring at two composition sites (`production-capabilities.ts`, `board-projection.ts` factory path); one TUI gating/display change in `shell.tsx`/`action-bar.tsx`; one new regression test file (wired + read-only graphs) plus small updates to existing dispatcher fakes. No new adapters, no new services, no new persistence.

## Scope
- `src/composition/production-capabilities.ts`: when the injected `missionStore` is non-null, construct (or receive) the three existing Mission services from that exact store and pass them to the shared `BoardCommandController`; `missionStore` null ⇒ no services (read-only instance, no implicit database open).
- `src/composition/board-projection.ts` (`composeTuiCapabilities`): thread the same services into both the shared controller fallback and the controller created by `commandControllerFactory`, since `src/interfaces/tui/shell.tsx` dispatches through the factory-built controller.
- `src/application/controller/board-controller.ts`: add the instance capability query (`canExecute(kind: BoardCommandKind): boolean` — integrated per `INTEGRATED_CAPABILITIES` AND, for the three Mission kinds, the corresponding service is present). Existing dispatch guards and typed unavailable results unchanged.
- `src/application/controller/board-command.ts` + `src/application/tui-capabilities.ts`: expose the query on `BoardCommandDispatcher`/`TuiCapabilities` using application-layer types only (no concrete adapter in the interface).
- `src/interfaces/tui/shell.tsx` + `src/interfaces/tui/action-bar.tsx`: availability display (`run ▶` / `unavailable` / action-bar rows) and dispatch gating derive from instance capability composed with workflow eligibility (`canDispatchAction`); on a read-only instance the three Mission kinds surface the truthful unavailable reason instead of lighting up as runnable.
- `test/task-2426-repro.test.ts` (new): production-shaped composition with an isolated temp SQLite mission store (pattern of `test/task-2322-05-mission-sqlite-fixture.test.ts` + fakes from `test/production-composition-capabilities.test.ts`); covers the full wired graph and a deliberately incomplete/read-only graph. Updates to existing suites/fakes broken by the `BoardCommandDispatcher` signature (e.g. `test/board-controller.test.ts`, `test/tui-command-flow.test.ts`, `test/production-composition-capabilities.test.ts`) without weakening behavior assertions.

## Out of Scope
- Making `draft:create`, `review:submit`, `review:act-on-findings`, `approve:review`, or `integrate:merge` available in any form — no stubs, no fake successes; they stay in `UNAVAILABLE_CAPABILITIES` with their existing reasons.
- Web/browser board adapter work (ADR 0054); this mission only makes the shared instance truthful for the future consumer.
- New DI container/framework, new database handles, new adapters, or new Mission services — the three services are reused exactly as `createMissionApplicationServices` builds them (each from the `MissionTransitionStore`/`MissionStore`).
- Changes to `INTEGRATED_CAPABILITIES`/`UNAVAILABLE_CAPABILITIES` contents, dispatch result shapes, or `active:execute` behavior (cancellation, detached default, TASK-2425 stale guard).
- New TUI command vocabulary beyond the existing `BoardCommandKind` values, and re-enabling non-`active:execute` rows in the action bar as clickable commands (availability *display* truthfulness is in scope; the action bar still dispatches `active:execute` only).
- Authored documentation changes: no live doc currently claims the three board actions are runnable, and this is an internal wiring/truthfulness fix.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- **SC1 (red):** `test/task-2426-repro.test.ts` fails on the mission's parent commit: a production-shaped `composeProductionCapabilities` call with a non-null isolated SQLite mission store yields a shared `commandController` whose `mission:intake` dispatch returns a `capability`-kind rejection (`no Mission authority is configured for this interface`) even though `isIntegratedCapability('mission:intake')` is true.
- **SC2 (green, wiring):** After the fix the same dispatch executes: intake materializes the mission row in the store, and `checkpoint:record` and `handoff:record` dispatched for that row also return no `capability`-kind rejection. `createProductionApplicationServices` (the real production entry point) with Mission authority available exposes `presentationCapabilities.commandController` instances for which all three kinds execute; with `includeOperatorState: false` (or a null store) the same three kinds return the typed unavailable result.
- **SC3 (truthful query):** Every `BoardCommandController` instance exposes the capability query on `BoardCommandDispatcher`; a kind is reported executable iff it is in `INTEGRATED_CAPABILITIES` AND (for `mission:intake`/`checkpoint:record`/`handoff:record`) its service is wired on that instance. A controller constructed without Mission services reports all three false, and dispatching any of them returns the existing typed unavailable capability result.
- **SC4 (no over-advertisement, UI-neutral):** In `src/interfaces/**`, "runnable" display and dispatch gating for the three Mission kinds derive from the instance capability query composed with workflow eligibility (`canDispatchAction`); no interface file decides runnability from `INTEGRATED_CAPABILITIES` alone for those kinds. `TuiCapabilities` and `BoardCommandDispatcher` reference no concrete adapter (application-layer types only), per ADR 0051.
- **SC5 (unimplemented kinds unchanged):** `draft:create`, `review:submit`, `review:act-on-findings`, `approve:review`, `integrate:merge` remain in `UNAVAILABLE_CAPABILITIES` with their existing five reasons, report false from the instance query on every graph (wired and read-only), and dispatch with the same typed unavailable results as today.
- **SC6 (active unchanged, single instance):** `active:execute` dispatch behavior is byte-identical in outcomes (detached default, cancellation outcomes, TASK-2425 stale-guard conflict behavior); CLI and TUI share the single `commandController` instance, and the existing identity assertions in `test/production-composition-capabilities.test.ts` still hold.
- **SC7 (both graphs tested):** `test/task-2426-repro.test.ts` (or the suite extending it at the same path) contains passing tests for (a) the full wired production graph — all four integrated kinds executable via the shared controller and the factory-constructed controller — and (b) the deliberately incomplete/read-only graph — the three Mission kinds not executable, not advertised, dispatch typed-unavailable, while `active:execute` remains executable.
- **SC8 (no regressions):** `test/board-controller.test.ts`, `test/command-dispatch-convergence.test.ts`, `test/tui-command-flow.test.ts`, `test/task-2387-board-current-work.test.ts`, `test/board-progress-events.test.ts`, and `test/production-composition-capabilities.test.ts` pass (signature updates to dispatcher fakes allowed; behavior assertions not weakened).

## Risks and Assumptions
- **Assumption:** the three services construct from the mission store alone (`new MissionIntakeService(store)`, `new MissionCheckpointService(store)`, `new MissionHandoffService(store, store)` — exactly as `createMissionApplicationServices` builds them), so deriving them from the store the composition already injects adds no new authority and opens no new database handle (ADR 0053). If a constructor actually needs a port the composition does not hold, stop (see Stop rules) rather than opening a second authority.
- **Risk — factory path:** `composeTuiCapabilities` is called with the shared controller, but `shell.tsx` dispatches through `commandControllerFactory`'s freshly built controller. Wiring only the shared instance leaves the TUI's real path untruthful. Mitigated by SC2/SC3 (factory-constructed controller must report and dispatch the same capabilities) and by the SC7(b) test dispatching via the factory-built instance.
- **Risk — interface churn:** adding `canExecute` to `BoardCommandDispatcher` breaks test doubles/fakes. Mitigated by SC8: update fakes, keep every existing behavior assertion intact.
- **Risk — read-only shell:** with operator state unavailable the composition passes `missionStore: null`; it must stay service-free and must not construct services or open SQLite in that path (fail-closed per ADR 0053). Covered by SC2/SC7(b).
- **Assumption — future web board:** ADR 0054's adapter will reuse `commandController.canExecute` composed with workflow eligibility; this mission ships the instance query it needs but no web endpoint.
- **Risk — registry drift:** `INTEGRATED_CAPABILITIES` (implemented) and per-instance wiring (wired) are now two facts; a future mission that wires more services must keep the UI on the instance query, never the static set. SC4 is the standing guard.

## Checkpoints
Reproduction-Test: test/task-2426-repro.test.ts

- **CP 1 — Lock the mismatch (red):** Author `test/task-2426-repro.test.ts` before any fix. Scenario: build an isolated temp SQLite mission store (`SqliteDatabaseAdapter` + `loadDefaultMigrations` + `SqliteMissionStore`, pattern of `test/task-2322-05-mission-sqlite-fixture.test.ts`) plus the fake repositories and `makeExecutePorts()` from `test/production-composition-capabilities.test.ts`. Call `composeProductionCapabilities(rootDir, repositoryId, repositories, ports, store, NO_CURRENT_WORK_PORT)` — the exact production call shape used when Mission authority is available — and dispatch `mission:intake` (valid intake payload) through `capabilities.commandController`. Assert the result is **not** a `capability`-kind rejection. This test MUST fail on the mission's parent commit (the shared controller is composed with an empty `missionServices`, so dispatch rejects with `no Mission authority is configured for this interface`) and pass after CP 2. Use only APIs that exist on the parent commit so the red failure is an assertion failure. Do not write any fix in this checkpoint.
- **CP 2 — Truthful wiring + instance capability query:** (a) In `composeProductionCapabilities`, construct the three existing Mission services from the injected non-null `missionStore` and pass them to the shared `BoardCommandController` (null store ⇒ no services). (b) Thread the same services through `composeTuiCapabilities` so both the shared-controller fallback and the `commandControllerFactory`-built controller carry them. (c) Add `canExecute(kind)` to `BoardCommandController` (integrated ∧ service present) and to `BoardCommandDispatcher`; keep dispatch guards and typed unavailable results unchanged. (d) Update `src/interfaces/tui/shell.tsx` (`dispatchMissionAction`, `dispatchLifecycle`, attention-rail `run ▶`/`unavailable` display) and `src/interfaces/tui/action-bar.tsx` so runnability for the three Mission kinds comes from the instance query composed with `canDispatchAction`; a read-only instance shows the truthful unavailable reason. (e) Extend `test/task-2426-repro.test.ts` with the deliberately incomplete/read-only graph tests (null store: all three kinds report false, dispatch typed-unavailable, `active:execute` still executable) and the wired-graph assertion that the factory-built controller agrees with the shared instance; add `canExecute` coverage for the five unimplemented kinds on both graphs. CP 1's test is green at the end of this checkpoint. Update dispatcher fakes in existing suites as required by the interface change, without weakening assertions.
- **CP 3 — Full production proof + gates:** Prove the real production entry point end to end: `createProductionApplicationServices` with Mission authority available yields a `presentationCapabilities.commandController` that executes all four integrated kinds (intake materializes the row; checkpoint and handoff record against it), and the operator-state-off path yields typed unavailable results for the three Mission kinds — this final checkpoint carries both "services wired" and "services absent" evidence. Run the full gate set and record results. No behavior changes to `active:execute` or existing dispatch outcomes at this checkpoint.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST lead its evidence with durable, verifiable references: exact test names, ADR references, test file paths, and recognized repository commands/paths such as `` `npm ...` ``, `` `node ...` ``, `` `git ...` ``, `` `px ...` ``, or `` `./...` ``. File:line references are accepted when needed but discouraged because line numbers rot.

Every checkpoint document MUST include:
- A summary of work done
- An exact `## Goal Check` heading
- A 3-column pipe-delimited markdown table: `| Criterion | Evidence | Status |`
- At least one durable evidence row per criterion
- A non-generic `Next action:` line at the bottom

Raw `stat`/`ls` output or generic prose alone is not sufficient evidence; when included, pair it with one of the accepted references above.

Mission-specific evidence for this mission: cite the exact test names in `test/task-2426-repro.test.ts` for SC1–SC7 rows (e.g. the wired-graph and read-only-graph tests), `test/production-composition-capabilities.test.ts` for the single-shared-instance assertion, and `ADR 0051` / `ADR 0053` for the UI-neutral and single-authority rows. The CP-3 document MUST include one evidence row proving "services wired" (wired-graph test names passing) and one proving "services absent" (read-only-graph test names passing), each paired with a recognized command such as `./scripts/verify-local.sh all`.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all
- [ ] ./scripts/verify-local.sh static-analysis

## Restricted Areas
- `src/adapters/**` — no new adapters; SQLite stays the sole Mission authority (ADR 0053), no second database handle.
- `src/application/mission-intake-service.ts`, `src/application/mission-checkpoint-service.ts`, `src/application/mission-handoff-service.ts` — reuse as-is; no new service logic or constructor changes.
- `src/application/execute-mission-service.ts` and the `active:execute` dispatch path — behavior must not change.
- `config/integration-pipelines.json`, `workflow.config.json`, `scripts/**` — gate and pipeline plumbing untouched.
- `docs/**` — no authored documentation impact for this internal wiring/truthfulness fix.
- Backlog task file — do not edit the `assignee` field; do not rename, move, or delete the task.

## Stop Rules
- Stop and report if making the three kinds truthful requires any constructor port the composition does not already hold — wiring must come from the injected `missionStore` only, not from opening a new authority.
- Stop if `test/task-2426-repro.test.ts` would need real Forgejo, a real operator home directory, or the operator's live SQLite database — use isolated temp fixtures only (unit tests stay fast and mocked).
- Stop if any `active:execute`, cancellation, or stale-guard behavior change is needed to make the repro green — that is a second mission, not this fix.
- Stop if the UI truthfulness fix would require adding command kinds beyond the existing `BoardCommandKind` values or making any unimplemented kind dispatchable.
- Stop if `BoardCommandDispatcher` consumers outside the enumerated files (`shell.tsx`, composition, tests) surface during the interface change — widen scope deliberately instead of silently touching them.
