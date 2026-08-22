# Mission: Make board-launched agents publish current work (task-2387)

Base-Branch: friday-08-21

## Goal
Wire the TUI board's `active:execute` dispatch through the **same production `CurrentWorkPort`** that CLI execution uses, so a agent launched from the board records its running/ended/blocked current-work fact on the operational-history authority. Today the board builds `BoardCommandController(executePorts, progressPort)` → `new ExecuteMissionService(executePorts, progressPort)`, and the service's `_currentWork` falls back to `NO_CURRENT_WORK_PORT`. Board-launched agents run, but the board never records their state; because the host process is `px ui`, the legacy process scan cannot recover the missing fact. The fix threads the production recorder from `createProductionApplicationServices` down to the board's `ExecuteMissionService` and proves the full board launch lifecycle through the real controller boundary.

## Why Now
- The production composition in `src/composition/application-services.ts` builds the CLI `ExecuteMissionService` with the real `currentWork` recorder (line 252: `new ExecuteMissionService(executePorts, activeProgress, currentWork)`), but `composeTuiCapabilities` in `src/composition/board-projection.ts` (line 116) builds the board's `BoardCommandController` with **no** current-work argument, so `ExecuteMissionService._currentWork` defaults to `NO_CURRENT_WORK_PORT`.
- The board's read side (`ConcreteCurrentWorkReadAdapter`) only recovers a live fact from a *different* `px` process via the OS-process scan; a `px ui`-hosted launch is the same process, so the scan yields nothing and the board reports the mission as idle while an agent is actively working it.
- This is a correctness/regression gap in operator situational awareness, not a new feature: CLI `px active`, `px review`, and `px integrate` all publish current work; only the board path silently drops it.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: composition wiring gap between CLI and board execution paths; single root cause (missing `CurrentWorkPort` thread); no new ports or behaviors, only reconnecting an existing publisher.

## Scope
- Thread `currentWork: CurrentWorkPort` from `createProductionApplicationServices` → `composeProductionCapabilities` → `composeTuiCapabilities` → `TuiCapabilities.commandControllerFactory` → `BoardCommandController` → `ExecuteMissionService`.
- Update the `BoardCommandController` constructor to accept the production `CurrentWorkPort` and forward it to `new ExecuteMissionService(executePorts, progressPort, currentWork)` (never leave the `NO_CURRENT_WORK_PORT` default reachable in the production board path).
- Update the `TuiCapabilities.commandControllerFactory` type and the `commandControllerFactory` producer in `composeTuiCapabilities` so the wired port survives composition.
- Ensure every board `active:execute` terminal outcome publishes the same fact CLI execution does:
  - launch → `running` (execute phase),
  - successful completion → `ended`,
  - execution failure / no eligible family → `blocked` with reason,
  - cancellation → `ended`.
- Preserve the CP-4 fire-and-forget ownership rule: the board's `dispatchActive` keeps `detached: true` and the launched child stays unref'd; current-work publication is best-effort and must not block `q`/`Ctrl+C` exit.
- Add a controller/composition test that drives the full board launch lifecycle through the real `BoardCommandController` boundary.

## Out of Scope
- Any change to the CLI execution path (`createProductionApplicationServices` CLI `ExecuteMissionService`, `px active`, `px review`, `px integrate`) — already publishes correctly.
- The legacy OS-process scan in `ConcreteAgentReadAdapter` / `processLivenessProbe` — left as bounded recovery only.
- Current-work publication for the web board projection or non-TUI hosts.
- New ports, new domain concepts, or changes to ADR 0053 authority boundaries (`Mission.status` stays the sole lifecycle authority; current work stays write-side operational history).
- Review-loop or integrate-command current-work wiring beyond what the shared `ExecuteMissionService` already handles.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion is falsifiable and metric-backed.

- SC1: A board `dispatch` of `active:execute` calls `CurrentWorkPort.running` exactly once with `phase: 'execute'` and `state: 'running'` before the agent launch completes. Falsified if the wired port is `NO_CURRENT_WORK_PORT` or `running` is not called.
- SC2: Board `active:execute` terminal outcomes publish the same `(phase, state)` set as CLI execution — `ended` on completion and cancellation, `blocked` on failure — verified by asserting the spy port received the matching call for each outcome in a composition test. Falsified if any terminal state is unrecorded or mislabeled.
- SC3: `composeTuiCapabilities` / `composeProductionCapabilities` cannot construct a board dispatcher that uses `NO_CURRENT_WORK_PORT` when operator-local repositories are present. Falsified by a composition test that asserts the factory's execute publishes to a non-no-op port (a spy records the call).
- SC4: A red-to-green controller/composition test proves a board-launched agent appears in the `WORKING` current-work projection and later clears (`ended`) or blocks (`blocked`) correctly through the real `BoardCommandController` boundary.
- SC5: `./scripts/verify-local.sh static-analysis` passes (ESLint, `npm run typecheck`, test-hygiene, test typecheck).

## Risks and Assumptions
- **Risk:** Reordering publication vs. the CP-4 unref. The board must await the `running` write before the child is unref'd, but must not block process exit. Mitigation: keep publication best-effort (`bestEffort` wrapper) and ordered before the unref, matching the CLI service pattern.
- **Risk:** Changing the `BoardCommandController` constructor signature breaks existing test call sites (`test/board-controller.test.ts` constructs `new BoardCommandController(ports)`). Mitigation: make the new `currentWork` parameter optional with the `NO_CURRENT_WORK_PORT` default so existing unit tests typecheck; production wiring supplies the real port.
- **Assumption:** Production `px ui` always runs with operator-local repositories available, so the production recorder (not `NO_CURRENT_WORK_PORT`) is the value wired in.
- **Assumption:** `NO_CURRENT_WORK_PORT` remains the correct fallback for read-only shells / test fixtures without operator state — do not remove it.
- **Assumption:** The operational-history table stays the sole current-work authority (ADR 0053); this change only reconnects the write side.

## Checkpoints
- CP 1: Author the failing reproduction test that locks the board current-work gap (red at parent commit) — see below.

### Bug: Red→Green Reproduction Test (task-2387)

This is a `bug`-labeled mission. The **first checkpoint** is authoring a failing reproduction test that locks the bug **before** any fix is written. Do not write the fix in CP 1 — the red test is the deliverable.

- **Test file:** `test/task-2387-board-current-work.test.ts` (new; under `test/`).
- **Reproduction scenario:** Build a `BoardCommandController` with in-memory execute ports (`test/fixtures/execute-mission-ports.ts` `makeExecutePorts`) and a spy `CurrentWorkPort` that records `running`/`blocked`/`ended` calls, then `dispatch` an `active:execute` request for a `task-*` slug and assert the spy recorded the launch as `running` (`phase: 'execute'`, `state: 'running'`), and that a completed run records `ended`.
- **Red at parent commit:** the board path wires `NO_CURRENT_WORK_PORT`, so the spy records **zero** current-work calls and the assertion fails.
- **Green after fix:** the wired production `CurrentWorkPort` receives the `running`/`ended` calls and the assertion passes.
- **Assertion shape:** `assert.ok(spy.calls.some(c => c.phase === 'execute' && c.state === 'running'))` (and the analogous `ended` check). Keep the spy in the test file or a fixture; do not touch real storage or a real `px` process.
- CP 2: Thread the production `CurrentWorkPort` through composition and the board controller; existing tests still pass.
- CP 3: Add the green controller/composition lifecycle test proving SC1–SC4 through the real boundary.
- CP 4: Run the verification gate and capture proof.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `npm test -- test/task-2387-board-current-work.test.ts` ``, `` `./scripts/verify-local.sh static-analysis` ``, or `` `node --test` ``
  2. **Test names** — must match a real `test(...)` name in the repo (quote them exactly)
  3. **Test file paths** — must be an existing test file, e.g., `test/task-2387-board-current-work.test.ts`, `test/board-controller.test.ts`, `test/production-composition-capabilities.test.ts`
  4. **ADR references** — e.g., `ADR 0051`, `ADR 0053` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- **Weak-agent failure mode (call this out explicitly):** raw `stat`/`ls` output or generic prose such as "the test passes" is **not** sufficient evidence. Pair any shell output with at least one accepted reference above — e.g., quote the exact failing/passing `node --test` line *and* cite the test file path and test name, or cite the ADR and command. A checkpoint that only shows `ls` of `test/` or says "verified" without a recognizable reference will be rejected.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh static-analysis`
- [ ] `./scripts/verify-local.sh all`

## Restricted Areas
- Do not modify the CLI `ExecuteMissionService` construction in `createProductionApplicationServices` beyond supplying the port it already receives.
- Do not touch the legacy OS-process scan (`processLivenessProbe`, `ConcreteAgentReadAdapter` session attribution).
- Do not alter ADR 0053 authority boundaries: no write to `Mission.status`, no new durable per-launch entity.
- Do not add new ports or change the `CurrentWorkPort` interface shape; only reconnect the existing publisher.
- Do not introduce `.only` or bare `.skip` tests (test-hygiene gate).

## Stop Rules
- Stop if the fix requires changing the `CurrentWorkPort` interface or adding a new port — escalate (out of scope).
- Stop if wiring the board port breaks the CP-4 fire-and-forget / unref contract for `q`/`Ctrl+C` exit.
- Stop if existing `test/board-controller.test.ts` unit tests fail to typecheck after the constructor change without a justified, minimal signature update.
- Stop after the verification gate passes and the Goal Check table is populated with accepted evidence; do not continue polishing beyond the mission scope.

---
Reproduction-Test: test/task-2387-board-current-work.test.ts
