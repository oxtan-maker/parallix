# CP-2 — Inventory and fix

## Summary

Removed `recover:mission` from every board vocabulary and routed the stranded
active mission through `active:execute`:

- `src/application/projections/board.ts`: `attentionAction` no longer has an
  `orphaned-active` branch, so the stranded item falls through to
  `{ kind: 'active:execute', display: 'px active <id>' }`. The
  `attentionReason` comment now points at re-running `px active`.
- `src/application/projections/mission-board.ts`: `'recover'` is gone from the
  `BoardCommand` union and its availability entry is deleted. The `active`
  availability is enabled for the unchanged `strandedActive` predicate
  (status `active`, no current-work fact, gate not `failed`) with label
  `restart ▸`; the disabled reason for an active mission reads
  "Resuming an active mission requires a failed gate or no live work".
- `src/application/controller/board-command.ts`: `'recover:mission'` removed
  from `BoardCommandKind` and from `UNAVAILABLE_CAPABILITIES` (size 4 → 3).
- `src/interfaces/web/transport.ts`: `'recover:mission'` removed from
  `WebBoardCommandKind`, `BOARD_COMMAND_KINDS`, and `ATTENTION_KIND_COMMANDS`.
  `BOARD_COMMAND_KINDS` is now exported so the CP-3 drift test can derive the
  expected kind set from the producer mapping instead of a copied literal.
  `WEB_TRANSPORT_VERSION` and `COMMAND_KINDS` are untouched.

Inventory beyond the three tests named in Scope — `git grep -n "recover:mission"`
and `git grep -nE "'recover'"` over `src` and `test` found only the board
vocabulary plus `src/interfaces/cli/runtime.ts` (the `px recover` CLI command
name, out of scope and unchanged). Widening `active` availability also changed
three further tests that pinned the old "active mission is never runnable"
rule; each was updated to the new rule rather than weakened:

- `test/domain-projections.test.ts`: `"board command projection offers active
  only as a resume, never as a self-transition with live work"` (renamed) now
  asserts the stranded mission is enabled with label `restart ▸` and that an
  active mission holding a live current-work fact stays disabled.
- `test/board-projections.test.ts`: the attention-queue ordering test now
  expects the third active card to be queued as stranded at rank 3 with kind
  `active:execute`.
- `src/application/consumer-domain-requirements.ts`: the `ui-board-card`
  citation line moved 331 → 328 after the deleted availability entry;
  `test/domain-consumer-requirements.test.ts` verifies that anchor.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 no `recover:mission` and no board `'recover'` left | `git grep -n "recover:mission" -- src web test` (only the repro test's negative assertion), `git grep -nE "'recover'" -- src/application/projections src/interfaces/web src/application/controller` returns no matches | PASS |
| SC2 stranded mission advertises `active:execute` and an enabled `active` command targeting lane `active` | `"stranded active mission snapshot validates and advertises active:execute"` in `test/task-2518-board-action-vocabulary-repro.test.ts`; `"attention orphaned-active mission surfaces active resume item"` in `test/attention-orphaned-active-observable.test.ts` | PASS |
| SC3 JSON-round-tripped stranded snapshot validates, attention action `state: 'enabled'` | `npm test -- test/task-2518-board-action-vocabulary-repro.test.ts` (green; red at parent `6e3f30cdefeedcdafb885661e6fa1445a0bc20f0`, see `missions/task-2518/CP-1.md`) | PASS |
| SC6 gate-failed `resume ▸` and findings `findings ↩` labels intact; live-work mission stays ineligible and quiet | `test/board-readers.test.ts` (`"BoardProjectionBuilder queues a gate-failed mission behind its runnable resume"`), `"attention active mission with live work stays quiet"` in `test/attention-orphaned-active-observable.test.ts`, `"board command projection offers active only as a resume, never as a self-transition with live work"` in `test/domain-projections.test.ts` | PASS |
| SC7 static analysis gate | `./scripts/verify-local.sh static-analysis` exits 0 (ESLint, tsc, test-hygiene, test typecheck) | PASS |
| Full unit suite green | `npm test` — 2622 tests, 0 failures | PASS |

Next action: CP 3 — add the all-lanes drift test (SC4) and the `BoardController` `active:execute` dispatch check (SC5) to `test/task-2518-board-action-vocabulary-repro.test.ts`, then run `./scripts/verify-local.sh all`.
