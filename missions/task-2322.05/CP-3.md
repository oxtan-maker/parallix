# CP-3: Covered CLI and shared UI paths rerouted through the use cases

## Summary

Pointed the covered production paths at the CP-2 use cases and put the
compatibility documents behind one adapter, without moving production authority.

**The compatibility authority** (`src/adapters/backlog/compatibility-mission-store.ts`)
is the single production implementation of the Mission repository port. It is the
only module that knows where compatibility Mission state lives: the Backlog task
document (lifecycle, assignee, title, labels), `CP-N.md` evidence, and
`nel-record.json`. It never touches SQLite, so there is no read-through,
fallback, or reconciliation to write. It refuses inserts, keeping task-record
creation with `px draft` rather than adding a second task writer. Its revision
token is the newest modification stamp across the documents that back the
aggregate, so a concurrent agent edit makes the caller's expected revision stale
and the write is refused instead of overwriting.

`src/adapters/backlog/checkpoint-document.ts` translates between `CheckpointData`
and the `CP-N.md` document handoff already validates — an `# CP-N:` heading, a
`## Goal Check` table, and a `Next action:` line. Markdown shape stays an adapter
concern; the `Status` column stays presentation, since `GoalCheckRow` is
criterion plus evidence.

**Rerouted paths.**

- `captureNelAtHandoff` still observes Git and the repository-owned mission
  documents, then hands domain values to `MissionHandoffService`
  (`src/platform/runtime/lib/commands/handoff.ts:1150`). The `primary..HEAD`
  range is passed as an `ArtifactReference`, so `nel-record.json` gains an
  `artifacts` array of locators while its legacy keys and their order are
  unchanged. `performHandoff` awaits the now-async capture; its PASS/WARN/stop
  branches are untouched.
- `LegacyActiveAdapter.recordLaunch` no longer calls `transitionTask`. It still
  decides *whether* synchronization is needed from the launch observation
  (`rebaseDeferred` or a task that is not yet active), then calls
  `MissionLifecycleService.activate`, which applies `decideMission` and writes
  through the port (`src/platform/runtime/lib/adapters/legacy-active-adapter.ts:128`).
  The fail-closed message is unchanged.
- `BoardCommandController` dispatches `mission:intake`, `checkpoint:record`, and
  `handoff:record` through the use cases when a host supplies them, and returns
  a typed unavailable result when it does not
  (`src/application/controller/board-controller.ts:99`). Payloads carry checked
  domain values only, so a board button cannot acquire filesystem or SQL
  authority.
- `createMissionApplicationServices` is the one construction point for the store
  and the four use cases, and it reports the selected authority
  (`src/platform/runtime/lib/composition/application-services.ts:102`).
- The Ink action bar now enables a row only when the interface can actually
  dispatch it, so integrating a capability in the application layer no longer
  lights up a row the board has no payload for
  (`src/interfaces/tui/action-bar.tsx:43`).

**Behavior changes, stated explicitly.** `nel-record.json` gains the `artifacts`
key; NEL capture now fails closed when the mission is not recorded, which moves
the same missing-task failure handoff already produced at its Backlog transition
step earlier in the run; the action bar's reason text for an integrated but
non-dispatchable command changed. The updated characterization tests pin all
three.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC2 — activation is routed through the Mission repository port | `src/platform/runtime/lib/adapters/legacy-active-adapter.ts:128`, `"legacy active adapter preserves the launch-synchronize-stats-handoff lifecycle order"` | PASS |
| SC2 — the rerouted activation fails closed on a refused write | `"legacy active adapter fails closed when the Mission authority refuses the activation"` | PASS |
| SC2 — the compatibility authority refuses a stale write and changes nothing | `"SC2: a concurrent edit invalidates the caller revision and refuses the write"`, `src/adapters/backlog/compatibility-mission-store.ts:173` | PASS |
| SC3 — checkpoint documents materialize as CheckpointData and are written back | `"SC3: the compatibility authority materializes CheckpointData from CP-N.md documents"`, `"SC3: recording a checkpoint writes a document the same parser reads back"` | PASS |
| SC3 — the document translation round-trips in both directions | `"SC3: the document translation is a faithful round trip in both directions"`, `src/adapters/backlog/checkpoint-document.ts:36` | PASS |
| SC4 — handoff records NEL through the boundary, keeping the legacy document shape | `"captureNelAtHandoff writes nel-record.json with predicted bucket, actual NEL, actual bucket, review rounds"`, `src/platform/runtime/lib/commands/handoff.ts:1150` | PASS |
| SC4 — a 5 MB artifact is recorded as a locator in a kilobyte-sized document | `"SC4: handoff writes the legacy NEL document shape with artifact references only"` | PASS |
| SC4 — a document write failure is a failed handoff, not a silent success | `"SC4: a document write failure is reported as a failed handoff, not a silent success"`, `"performHandoff stops before review transitions when NEL persistence fails"` | PASS |
| SC5 — the shared UI controller dispatches the covered commands through the use cases | `"SC5: the controller dispatches checkpoint:record through the checkpoint use case"`, `"SC5: intake dispatched from the board reaches the intake use case with its trace"` | PASS |
| SC5 — controller failure results preserved (stale, missing payload, unconfigured) | `"SC5: the controller rejects a stale board request before the use case runs"`, `"SC5: a Mission command without a payload or a configured authority is refused"`, `"controller rejects checkpoint:record without a payload"` | PASS |
| SC5 — CLI checkpoint ordering and handoff NEL ordering unchanged after rerouting | `"SC5 characterization: checkpoint runs the gate, then stages, then commits, in that order"`, `"SC5 characterization: NEL capture observes the primary branch first, then records the mission"` | PASS |
| SC5 — the board surface only claims commands it can dispatch | `src/interfaces/tui/action-bar.tsx:43`, `"action bar renders the declared command kinds with only active:execute enabled"` | PASS |
| SC6 — production selects exactly one compatibility authority, no dual write | `"SC6: production selects exactly one compatibility authority for every Mission use case"`, `src/platform/runtime/lib/composition/application-services.ts:102` | PASS |
| SC6 — intake through the compatibility authority does not create a task record | `"SC6: the compatibility authority refuses to create a task record at intake"` | PASS |
| SC7 — no filesystem or SQL persistence in the changed application/UI modules | `"SC7: the shared UI controller reaches the compatibility documents only through the port"`, `"SC7: no unclassified durable file read/write in src/application/ or src/interfaces/"` | PASS |
| SC7 — the new durable-IO adapter is registered in the ADR 0053 inventory | `src/platform/runtime/lib/core/durable-state-inventory.ts:128`, `"SC1 reverse: all durable-IO files under src/ are present in the inventory"` | PASS |
| Docs record the boundary and the behavior changes | `docs/adr/0053-operational-persistence-and-authority-boundaries.md:137`, `src/domain/README.md:122`, `CHANGELOG.md:36` | PASS |

Next action: Run the mission-declared gate on the final committed tree and record the success-criterion evidence map in CP-4.
