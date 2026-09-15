# Mission: Keep board action wire vocabulary in sync (task-2518)

## Goal
Remove the invented `recover:mission` board action from the board projection, the board command vocabulary, and the web transport, and route a stranded active mission (status `active`, no current-work fact, no failed gate) through the existing `active:execute` lifecycle action. After the change, every action kind the board producer can emit is accepted by `validateWebBoardSnapshot`, and a regression test enumerates the producer's action kinds so the producer and the validator cannot drift apart again.

Reproduction-Test: test/task-2518-board-action-vocabulary-repro.test.ts

## Why Now
`attentionAction` in `src/application/projections/board.ts` returns `{ kind: 'recover:mission' }` for every `orphaned-active` attention item, and the `recover` card command maps to `recover:mission` in `BOARD_COMMAND_KINDS` (`src/interfaces/web/transport.ts`). The snapshot validator's `COMMAND_KINDS` list does not contain `recover:mission`, so any repository with a single stranded active mission produces a snapshot that fails closed and the browser board shows no data at all. Stranded active missions are common (an interrupted agent leaves one behind), so the web board is currently unusable exactly when an operator most needs it. `recover:mission` is also not a lifecycle transition: `px recover` only repairs the `active` task / `done` aggregate split in `recoverMissionLifecycle`. It does nothing for a mission that is merely stranded in `active`, so the advertised action was wrong as well as unrepresentable.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: deleting one literal from four vocabularies (`BoardCommand`, `BoardCommandKind`, `WebBoardCommandKind`, transport maps) and `UNAVAILABLE_CAPABILITIES`; widening the `active` command availability in `mission-board.ts` to stranded active missions; retargeting `attentionAction`; updating three existing tests that pin `recover:mission`; one new repro/drift test

## Scope
- `src/application/projections/board.ts`: `attentionAction` maps `orphaned-active` to `{ kind: 'active:execute', display: 'px active <id>' }`; the `attentionReason` comment stops pointing operators at `px recover`.
- `src/application/projections/mission-board.ts`: remove `'recover'` from the `BoardCommand` union and delete the `recover` availability entry; the `active` availability becomes enabled for a stranded active mission (status `active`, no current-work fact, gate not failed) with its own label and reason, alongside the existing refined / findings / failed-gate cases, targeting lane `active`.
- `src/application/controller/board-command.ts`: remove `'recover:mission'` from `BoardCommandKind` and from `UNAVAILABLE_CAPABILITIES`.
- `src/interfaces/web/transport.ts`: remove `'recover:mission'` from `WebBoardCommandKind`, `BOARD_COMMAND_KINDS`, and `ATTENTION_KIND_COMMANDS`. The `orphaned-active` attention reason kind stays.
- Existing tests that pin the removed action are updated to the replacement action: `test/attention-orphaned-active-observable.test.ts`, `test/board-readers.test.ts` (stranded item assertion), and `test/board-controller.test.ts` (unavailable-kind loop).
- New reproduction and drift test `test/task-2518-board-action-vocabulary-repro.test.ts`.

## Out of Scope
- The `px recover` CLI command, `src/interfaces/cli/recover.ts`, and `recoverMissionLifecycle` in `src/application/mission-lifecycle-recovery.ts`. These still own the `active` task / `done` aggregate repair and are unchanged.
- `recoverMissionForIntegration` in `src/adapters/cli/commands/integrate.ts`.
- The `orphaned-active` attention reason, its ranking, and its `mission-store` source mapping in `attentionSources`.
- Changing the `activate` domain transition in `src/domain/mission-workflow.ts` (it already accepts `refined` and `active`) or `ExecuteMissionService` behaviour.
- Adding `active:execute` handling changes to the web client (`web/src/board.tsx` already treats `active:execute` as a request kind).
- Bumping `WEB_TRANSPORT_VERSION`: removing a value the validator never accepted does not change the accepted wire format.
- Any new board action, new lifecycle trigger, or new attention reason.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: `git grep -n "recover:mission" -- src web test` returns no matches other than the new repro test's own negative assertion strings, and `git grep -nE "'recover'" -- src/application/projections src/interfaces/web src/application/controller` returns no matches.
- SC2: For a board projection containing a mission with status `active`, no current-work fact, and no failed gate, the `orphaned-active` attention item's action is `{ kind: 'active:execute', display: 'px active <id>' }`, and the card's `active` command availability is `enabled: true` with `targetLane: 'active'`.
- SC3: `toWebBoardSnapshot` for that projection, passed through `JSON.parse(JSON.stringify(...))`, is accepted by `validateWebBoardSnapshot` (`ok` result, no problems), and the attention item's wire action has `state: 'enabled'`. At the mission's parent commit this same assertion fails because the validator rejects `recover:mission` (red); it passes after the fix (green).
- SC4: The drift test builds projections that cover every lane (`backlog`, `refined`, `active` stranded, `active` with failed gate, `active` with live work, `review`, `integration`, `done`). It asserts that the set of emitted card action kinds plus attention action kinds equals every value of `BOARD_COMMAND_KINDS`, which proves no producer kind is missing from the exercised set. It also asserts that each JSON-round-tripped snapshot passes `validateWebBoardSnapshot`.
- SC5: A stranded active mission dispatched through `BoardController` with kind `active:execute` reaches `ExecuteMissionService.execute` (the existing `dispatchActive` path). No `recover`-specific branch exists in `src/application/controller/board-controller.ts`.
- SC6: The existing gate-failed resume (`resume ▸`) and review-findings resume (`findings ↩`) labels and enablement asserted in `test/board-readers.test.ts` still pass unchanged. A live-work active mission still does not get an enabled `active` command, and `test/attention-orphaned-active-observable.test.ts` still proves that a mission with live work surfaces no `orphaned-active` item.
- SC7: `./scripts/verify-local.sh static-analysis` and `./scripts/verify-local.sh all` exit 0, and the diff adds no `test.only`, `.skip`, or `todo` markers.

## Risks and Assumptions
- Assumption: re-running `px active` on a stranded active mission goes through the `activate` transition (`requireStatus(mission, ['refined', 'active'])`). That transition records the normal lifecycle state and needs no new trigger. The implementer confirms this in CP 2 before widening availability.
- Risk: widening `active` availability could also enable it for an active mission with live work. The guard must reuse the exact `strandedActive` predicate (no current-work fact, gate not failed) so that a live mission stays ineligible. SC6 locks this.
- Risk: the drift test could hard-code a kind list that goes stale. It must derive the expected set from the exported producer mapping or the `BoardCommand` availability output, not from a copied literal array.
- Risk: other code may name the card command `'recover'` (TUI renderers, command-dispatch convergence tests). Run `git grep -n "'recover'"` across `src` and `test` in CP 2 and handle every hit that belongs to the board vocabulary.
- Assumption: the new repro test is a hermetic unit test (in-memory `MissionStore` double, as in `test/attention-orphaned-active-observable.test.ts`), finishes under 500 ms, and needs no `test/lib/test-categories.ts` registration.

## Checkpoints
- CP 1: Lock the bug. Author `test/task-2518-board-action-vocabulary-repro.test.ts` before touching production code. Scenario: compose a board projection (reuse the hermetic `composeBoardProjection` harness pattern from `test/attention-orphaned-active-observable.test.ts`) with one mission in status `active`, no current-work events, and no failed gate. Convert it with `toWebBoardSnapshot`, round-trip it through `JSON.parse(JSON.stringify(...))`, and call `validateWebBoardSnapshot`. Assertions: the validation result is ok; the `orphaned-active` attention item's action kind is `active:execute` with display `px active <id>`; no card action or attention action has kind `recover:mission`. Run `npm test -- test/task-2518-board-action-vocabulary-repro.test.ts` at the parent commit and record the red failure (validator problem naming `recover:mission`, or kind mismatch) in CP-1.md.
- CP 2: Inventory and fix. List every `recover:mission` and board `'recover'` reference in `src` and `test`. Remove the kind from `BoardCommand`, `BoardCommandKind`, `WebBoardCommandKind`, `BOARD_COMMAND_KINDS`, `ATTENTION_KIND_COMMANDS`, and `UNAVAILABLE_CAPABILITIES`. Retarget `attentionAction`, and enable the `active` availability for the stranded predicate. Update the three existing tests named in Scope. The repro test turns green.
- CP 3: Drift guard and final verification. Add the all-lanes drift test described in SC4 to the repro file. Confirm SC5 by exercising `BoardController` dispatch of `active:execute` for the stranded mission with a stub `ExecuteMissionService`. Run both gates and record the Goal Check for SC1–SC7.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A section with the exact heading `## Goal Check`
- A 3-column pipe-delimited markdown table with the exact header `| Criterion | Evidence | Status |`, one row per success criterion (SC1–SC7) touched by that checkpoint
- At least one evidence row per criterion using durable, verifiable references. Parallix verifies these forms today, so lead with them:
  1. **Exact test names** — e.g., `"attention orphaned-active mission surfaces recover item"` renamed to its replacement, or the new test names in `test/task-2518-board-action-vocabulary-repro.test.ts` (must match a test name in the repo)
  2. **Test file paths** — e.g., `test/task-2518-board-action-vocabulary-repro.test.ts`, `test/web-transport.test.ts`, `test/board-readers.test.ts` (must be existing test files)
  3. **ADR references** — e.g., `ADR 0053` for the mission-store lane authority behind `orphaned-active`, `ADR 0039` for criterion falsifiability (must correspond to a file under `docs/adr/`)
  4. **Recognized repo commands or paths**, backticked — e.g., `` `npm test -- test/task-2518-board-action-vocabulary-repro.test.ts` ``, `` `git grep -n "recover:mission" -- src web test` ``, `` `./scripts/verify-local.sh static-analysis` ``, `` `./scripts/verify-local.sh all` ``
  5. File:line references are accepted but discouraged, because line numbers rot. Prefer the forms above.
- CP-1.md must record the red run: the exact command, the parent commit SHA, and the failing assertion message.
- Weak evidence is not enough. Raw `stat`/`ls` output, pasted terminal output, or prose such as "verified the board works" does not satisfy a row by itself. Always pair shell output with one of the accepted references above, such as the command that produced it plus the test name it proves.
- A non-generic `Next action:` line at the bottom naming the next concrete step (e.g., "Next action: CP 3 — add the all-lanes drift test to test/task-2518-board-action-vocabulary-repro.test.ts").

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| SC1 no `recover:mission` in board vocabulary | `git grep -n "recover:mission" -- src web test` | PASS |
| SC3 stranded snapshot validates after JSON round trip | `test/task-2518-board-action-vocabulary-repro.test.ts`, `npm test -- test/task-2518-board-action-vocabulary-repro.test.ts` | PASS |
| SC7 static analysis gate | `./scripts/verify-local.sh static-analysis` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh static-analysis
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- `src/domain/mission-workflow.ts`: do not add a recovery trigger or change `activate` preconditions.
- `src/application/mission-lifecycle-recovery.ts`, `src/interfaces/cli/recover.ts`, `src/composition/create-cli.ts` recover wiring: the CLI recovery path stays as-is.
- `src/adapters/cli/commands/integrate.ts`: integration recovery is unrelated.
- `WEB_TRANSPORT_VERSION` and `SUPPORTED_WEB_TRANSPORT_VERSIONS` in `src/interfaces/web/transport.ts`.
- Do not loosen `validateWebBoardSnapshot` by adding `recover:mission` to `COMMAND_KINDS`. The fix removes the producer value; it does not accept it.
- `docs/` and `docs/adr/`: no authored documentation change is expected. If one becomes necessary, follow `docs/doc-standards.md`.

## Stop Rules
- Stop and report if CP 1's repro test passes at the parent commit, because that means the bug is not reproduced as described.
- Stop and report if dispatching `active:execute` for an `active` mission is rejected by the domain `activate` transition or by `BoardController.checkStaleCommand`. The replacement action would then need a lifecycle change, which is out of scope.
- Stop and report if removing `recover:mission` needs changes in any Restricted Area or a transport version bump.
- Stop if the diff grows beyond the Medium NEL bucket (more than 235 net engineering lines). That signals scope creep beyond vocabulary removal.
- Stop after two consecutive failed runs of the same gate with the same root cause, and record the failure output in the current CP document.
