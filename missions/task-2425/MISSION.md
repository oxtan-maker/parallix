# Mission: Make board stale-command protection authoritative (task-2425)

## Goal
Make the board stale-command guard authoritative: `BoardCommandController` must resolve the mission's current status/version itself from an application-owned read port injected by composition, immediately before a board command effect is accepted. The TUI (and any UI caller) supplies only the user's observed precondition (`missionStatusAtRequest`); it must no longer be able to supply — or be relied upon to supply — the "current" value. A mission that changes state after the confirmation opens must be rejected with a typed `conflict` outcome and the effect port must not be called.

## Why Now
Today `BoardCommandController.dispatchWithStatus(request, currentMissionStatus)` compares `request.missionStatusAtRequest` against a value the *caller* passes in, and the TUI confirmation path (`src/interfaces/tui/shell.tsx` `confirmAction`) passes the pending card's own projection snapshot to both sides, so the comparison is always equal and never rejects. The guard is therefore decorative for every real race. This must be fixed before any browser mutation endpoint exists (ADR 0054), because the web board will reuse the same dispatcher and would otherwise inherit a trust-the-UI boundary that violates ADR 0051 (UI-neutral application boundary) and ADR 0053 (operational persistence/authority boundaries).

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: one controller class + one dispatcher interface changed; composition wiring passes an already-available `MissionStore`-style read port; one TUI call site updated; one new regression test plus small updates to 4 existing test files.

## Scope
- New authoritative precondition check inside the command boundary in `src/application/controller/board-controller.ts`: resolve the mission's current status (and version where the request carries `expectedVersion`) via a read port the controller holds, at dispatch time, before the effect is accepted.
- A minimal application-owned read port for the authoritative status/version (reuse the existing `MissionStore.load` result shape from `src/application/domain-ports.ts` or a narrow read-only port — implementer's choice), declared in the application layer, not the interface layer.
- Composition wiring: `src/composition/board-projection.ts` (`composeTuiCapabilities`), `src/composition/production-capabilities.ts` (`composeProductionCapabilities`, which already receives `missionStore`), and `src/composition/create-cli.ts` pass the authoritative read port into the controller.
- `BoardCommandDispatcher` interface update in `src/application/controller/board-command.ts` and `src/application/tui-capabilities.ts` so no dispatch entry point accepts a caller-supplied "current" mission status.
- TUI update in `src/interfaces/tui/shell.tsx` (`confirmAction`): use the corrected API; on `conflict`, refresh the projection and re-open confirmation; no auto-retry of the mutation.
- Fail-closed behavior: an authoritative-read failure (store `unavailable`/error) returns a typed failure/unavailable outcome and never dispatches.
- Regression test `test/task-2425-repro.test.ts` (red on parent commit, green after fix), plus updates to existing tests broken by the signature change: `test/board-controller.test.ts`, `test/tui-command-flow.test.ts`, `test/task-2387-board-current-work.test.ts`, `test/board-progress-events.test.ts`.

## Out of Scope
- Browser/web board mutation endpoints (ADR 0054 adapter work) — none exist yet; this mission only fixes the shared dispatcher they will reuse.
- Lifecycle transition policy changes: which statuses may move where, WIP limits, capability sets (`INTEGRATED_CAPABILITIES`/`UNAVAILABLE_CAPABILITIES`) stay as-is.
- New mission-status caches, new database readers, or new persistence adapters in the interface layer.
- Operation history / lane event schema changes.
- Retrying, queuing, or automatic re-dispatch semantics beyond the existing TUI refresh-and-reconfirm behavior.
- Documentation changes beyond any user-visible conflict wording that the change itself alters.

## Success Criteria
- **SC1 (red):** `test/task-2425-repro.test.ts` fails on the mission's parent commit when a command is constructed from status A, the authoritative store is changed to B before dispatch, and the confirmation is sent: with today's caller-supplied comparison the dispatch proceeds and the effect port is called.
- **SC2 (green):** After the fix, the same scenario returns a typed `conflict` outcome (same shape as `staleConflict` in `src/application/controller/board-command.ts`) and the effect port call count is exactly 0 — asserted by call count/spy, not by matching an error string.
- **SC3 (authority):** The current status/version used for the comparison is read through a port instance supplied at composition (injected into the controller constructor or an equivalent application seam); no dispatch entry point in `BoardCommandDispatcher` accepts a current-status argument, and no `src/interfaces/**` code passes a mission status into the dispatch API as the "current" value.
- **SC4 (precondition preserved):** `BoardCommandRequest` still carries `missionStatusAtRequest`, and `checkpoint:record`/`handoff:record` payloads still carry `expectedVersion`; the request's observed precondition is what gets compared, never a value from an interface.
- **SC5 (TUI):** `src/interfaces/tui/shell.tsx` calls the corrected API; on `conflict` it refreshes the projection and re-opens the confirmation for the refreshed card, and performs no second dispatch in the same confirmation cycle.
- **SC6 (no-change path):** A confirmation with unchanged authoritative state dispatches the effect exactly once (effect port call count 1) and returns the same typed outcome kinds as before.
- **SC7 (fail closed):** When the authoritative read fails or returns unavailable, the controller returns a typed failure/unavailable outcome, does not dispatch, and does not throw out of the async dispatch.
- **SC8 (no regressions):** `active:execute`, `mission:intake`, `checkpoint:record`, `handoff:record`, cancellation, and unavailable-capability behaviors are preserved; the existing suites `test/board-controller.test.ts`, `test/command-dispatch-convergence.test.ts`, `test/tui-command-flow.test.ts`, `test/task-2387-board-current-work.test.ts`, `test/board-progress-events.test.ts` pass (signature updates allowed, behavior assertions not weakened).

## Risks and Assumptions
- **Assumption:** the composition roots already have (or can cheaply get) an authoritative mission read: `composeProductionCapabilities` already receives `missionStore: MissionStore | null`; a null/absent store must degrade to a typed unavailable outcome for guarded dispatch, not silently trust the caller.
- **Race window:** the authoritative read and the effect acceptance are two steps; the fix narrows the window to inside the command boundary but does not make dispatch atomic with the downstream write. Accepted for now: the mission's own use cases (`checkpoint:record`, `handoff:record`) already re-check `expectedVersion` at write time, and `active:execute` reads the same store.
- **Signature churn:** changing `BoardCommandDispatcher` touches 4 existing test files; risk of behavior-assertion drift when updating them — mitigated by SC8 (no weakened assertions).
- **Dual status sources:** board projection (read model) and mission store (authority) can differ briefly; the guard must compare against the store, and the TUI must treat `conflict` as "re-read and reconfirm", never as a retry.
- **Read-failure semantics:** a store error mid-dispatch is a real production state (e.g., lock/IO); choosing the wrong typed kind would either mask outages or spam the user. Mitigated by SC7 and the guardrail "fail closed with a typed failure/unavailable outcome".

## Checkpoints
Reproduction-Test: test/task-2425-repro.test.ts

- **CP 1 — Lock the bug (red):** Author `test/task-2425-repro.test.ts` before any fix. Scenario: construct a `BoardCommandController` with a fake in-memory authoritative read port and a fake effect port (spy on the `ExecuteMissionService`-level effect or the dispatched use case). Build a `BoardCommandRequest` with `missionStatusAtRequest: 'backlog'` (status A), then flip the authoritative store to `'ready'` (status B), then perform the confirmation dispatch. Assert: (a) outcome is the typed `conflict` kind, and (b) the effect port call count is exactly 0. This test MUST fail on the mission's parent commit (current caller-supplied comparison lets the dispatch through, so the effect is called / no conflict is returned) and pass after CP 2. Do not write the fix in this checkpoint.
- **CP 2 — Authoritative guard:** Add the application-owned read port, inject it at composition (`board-projection.ts`, `production-capabilities.ts`, `create-cli.ts`), move the stale/precondition comparison into `BoardCommandController` at dispatch time (immediately before the effect is accepted), compare `request.missionStatusAtRequest` (and `expectedVersion` where applicable) against the freshly read authoritative value, return `staleConflict` on mismatch, fail closed on read failure, and update the `BoardCommandDispatcher`/`tui-capabilities.ts` types so no current-status argument survives. Update `src/interfaces/tui/shell.tsx` `confirmAction` to the corrected API, keeping refresh-and-reconfirm on conflict with no auto-retry. Update the 4 existing test files for the new signature without weakening behavior assertions. CP 1's test is green at the end of this checkpoint.
- **CP 3 — Harden and verify:** Add/confirm fail-closed coverage for authoritative-read failure (SC7) and the exactly-once no-change dispatch (SC6), run the full gate set, and write the checkpoint document citing the authoritative precondition path and the negative "effect not called" test.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `npm test -- test/repair-handoff.test.ts` ``, `` `px review <slug> --verify` ``, or `` `./scripts/verify-local.sh all` ``
  2. **Test names** — e.g., `"real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/e2e-real-agent-smoke.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0048` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Mission-specific evidence requirements for this contract:
- CP 1 evidence MUST cite `test/task-2425-repro.test.ts` and a command that shows it red on the parent commit (e.g., `` `npm test -- test/task-2425-repro.test.ts` ``) plus the specific test name used to lock the bug.
- CP 2 evidence MUST cite the authoritative read path (the port type and the composition wiring site, e.g. `src/composition/production-capabilities.ts`), the `conflict`-on-mismatch and effect-not-called test names, and `ADR 0051` / `ADR 0053` as the boundary rationale.
- CP 3 evidence MUST cite the fail-closed and exactly-once test names and the final gate command.
- Remember: a bare `stat`/`ls` dump or prose like "the controller now reads the store" is NOT sufficient evidence — every row needs one of the accepted reference forms above.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh all`
- [ ] `./scripts/verify-local.sh static-analysis`

## Restricted Areas
- `src/domain/**` — lifecycle policy and mission status semantics are frozen for this mission; only add a narrow read port to `src/application/**` if one is needed.
- `src/adapters/sqlite/**` — no new readers, no schema changes; the existing `MissionStore` implementation is the only sanctioned authority.
- `src/application/ports/execute-mission.ts` and the use-case services (`mission-checkpoint-service.ts`, `mission-handoff-service.ts`, `mission-intake-service.ts`) — their `expectedVersion` write-time checks stay untouched; only the dispatcher-level guard changes.
- `INTEGRATED_CAPABILITIES` / `UNAVAILABLE_CAPABILITIES` sets and their messages in `src/application/controller/board-command.ts`.
- Any other mission's test fixtures or e2e suites beyond the four listed test files plus the new repro test.

## Stop Rules
- Stop and report if the authoritative read cannot be reached from any existing composition root without adding a new database reader or a new status cache — that indicates a boundary violation (ADR 0051/0053), not a mission-sized fix.
- Stop and report if making the guard authoritative requires changing which statuses may transition or any use-case write-time `expectedVersion` behavior.
- Stop and report if the repro test (CP 1) does not go red on the parent commit — the reproduction does not lock the real bug and the scenario must be re-derived, not force-fit.
- Stop and report if the `conflict` outcome would require converting into a retry, success, or silently-swallowed failure anywhere in the TUI or controller.
- Stop and report if an authoritative-read failure cannot be represented with an existing typed outcome kind without inventing a new outcome semantics.
- Stop if the change starts touching browser/web board code (ADR 0054) — that work is a separate mission.
