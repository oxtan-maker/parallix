# CP-2 — Fix mechanism and unattributed paths

## Summary of work done
Documenting the fix and the paths that correctly stay unattributed.

### Root cause
`PUBLISHED_PHASES` in `src/application/review-command-use-case.ts` maps
`start`, `continue`, `submit`, `submitReview`, and `consumeArtifacts` to
published phases. Every nested `px review <slug> --start` / `--submit` /
`--consume-artifacts` that the review loop's own agents run is therefore a
**separate process under a new operationId** that publishes its own
`running({agent: null})` bracket. Before the fix, `resolveOperation`
(`src/application/projections/current-work.ts`) let any `running` event
supersede the standing one, so the nested null-family fact shadowed the outer
`px review --continue` loop's family-carrying fact, and the nested `ended` then
cleared the mission's live work entirely.

### The fix
`resolveOperation` now takes the reconcile options and, when a `running` event
arrives from a **different process** (`standing.processId !== event.processId`)
that is observed **alive** (`isProcessAlive(...) === true`), does not supersede
the standing fact. A nested sub-operation bracket must not win over the still
running outer review. The terminal `ended` of that nested operation is then
rejected by the existing `sameOperation` guard (different operationId), so the
outer family-carrying fact survives. `processAlive` returns false when there is
no process to check or the probe is omitted, so a newer fact from a different
process still supersedes a provably-not-alive standing fact — preserving the
existing dead/degraded behaviour.

The change touches only the reconciliation seam. No board-strip presentation,
agent-family configuration, or process-liveness semantics changed; the
`isProcessAlive` probe and the "no process-name inference" out-of-scope rule
are respected.

### Unattributed paths (corrected)
`ReviewCommandUseCase.run` brackets only the operations whose name is in
`PUBLISHED_PHASES`: `start`, `continue`, `submit`, `submitReview`,
`consumeArtifacts`. Operations **not** in `PUBLISHED_PHASES` — `status`,
`verify`, `comment`, `push`, `close`, `createEvent`, `importLegacy`,
`backfillReview`, `reconcileReview`, and the `--consume-artifacts`-less
one-shot maintenance flags — bypass the bracket and publish no current-work
fact, so they stay unattributed. Non-agent operations (for example `px draft`
and `px active` execute/integrate/handoff paths) publish no agent-launch fact,
so they stay `family unknown`. This is the opposite of the earlier, incorrect
checkpoint claim that `--submit` was not published; `--submit` **is** published,
and that is precisely what produced the defect.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| A live `px review --continue` recording process whose review loop runs a Parallix-launched agent contributes that family, even across a nested `px review --start`/`--submit`/`--consume-artifacts` bracket. | `test/task-2416-review-family-repro.test.ts`, test `TASK-2416 repro: a nested px review --start must not shadow the outer review family` drives the full nested sequence through `CurrentWorkRecorder` + `reviewLoopPublisher` + `reconcileCurrentWork` + `ConcreteAgentReadAdapter.loadRunningSessions` and asserts `family: 'claude'` both mid-round and after the nested `ended`. | PASS |
| Live non-agent work stays `family unknown`; a dead recording process stays blank. | `test/task-2416-review-family-repro.test.ts`, the two remaining guards assert `family: null` for a live non-agent `agent: null` fact and for a dead recording process. | PASS |
| The fix is confined to the reconciliation seam; no presentation/family-config/liveness change. | `src/application/projections/current-work.ts` `resolveOperation`/`processAlive` only; `isProcessAlive` probe untouched. | PASS |

## Next action
Commit and proceed to CP-3: run the repository gate and record the evidence.
