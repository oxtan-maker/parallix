# CP-2: Register every audited call site in the executable inventory

## Summary

Completed the inventory registration half of the mission. Taking the audit from
CP-1 (eleven retired-path writers and the application/interface mission-document
call sites) and refining it against the current tree, I registered both sets in
`test/fixtures/durable-state-inventory.ts` as two new exported allowlists that
guards 1 and 2 consult instead of a hand-maintained pattern list.

Refinement against the live tree (the inventory is the source of truth, not
CP-1's prose list):

- Scanned `src/application` and `src/interfaces` for real (non-comment,
  non-JSDoc) code that resolves or persists through `missions/`, `MISSION.md`,
  or `backlog/{tasks,completed,archive}`, including the existing resolver helpers.
  Eight files carry such code:
  `src/application/handoff-command-use-case.ts` (mission-document evidence),
  `src/application/integrate/preflight.ts` (mission-document evidence), and
  `src/application/integrate/preflight-checkout.ts` (Git-topology overlap
  paths), `integrate/context.ts`, `rebase-workflow.ts`, and the three relevant
  `ports/*` declarations. The other files CP-1 named (e.g. `mission-checkpoint-service.ts`,
  `consumer-domain-requirements.ts`, the `ports/*` signatures, `draft-command-
  use-case.ts`, `projections/bug-frequency.ts`) reference these paths only in
  comments, JSDoc, or `resolveTaskFile` external-intake calls, which are not
  Mission-persistence resolutions and are not flagged by guard 2.
- Registered the eleven retired-path writers from CP-1 in
  `RETIRED_WORKFLOW_PATH_WRITERS` with a classification and ADR authority per
  entry.

New exports added to `test/fixtures/durable-state-inventory.ts`:

- `RETIRED_WORKFLOW_PATH_WRITERS` (`RetiredWorkflowPathWriterEntry[]`) — the
  eleven legitimate writers, each with `pathPatterns`, `classification`, and
  `authority`.
- `MISSION_DOCUMENT_CALL_SITES` (`MissionDocumentCallSiteEntry[]`) — the three
  application/interface files that carry real-code references or resolver use, each with a
  `purpose` and `classification`.
- Supporting types `RetiredWorkflowPathWriterClass` and `MissionDocumentCallSiteClass`.

No `src/` file, behavior, storage model, migration, or domain transition was
changed. Only data/type additions to the test fixture.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 — every audited call site registered with evidence | `RETIRED_WORKFLOW_PATH_WRITERS` (11 entries) and `MISSION_DOCUMENT_CALL_SITES` (8 entries) in `test/fixtures/durable-state-inventory.ts`, each carrying classification + ADR authority | PASS |
| Inventory additions are type-clean | `./scripts/verify-local.sh static-analysis` → `[2/4] Running npm run typecheck... PASS` and `[4/4] Running test typecheck... PASS` | PASS |
| No existing test regressed by the inventory edit | `npm test` → `pass 2641 fail 0` | PASS |
| SC4 — no prose inventory/index/manifest added | Only `test/fixtures/durable-state-inventory.ts` (executable fixture) and `missions/task-2521.01/CP-2.md` added; no new `docs/*.md` | PASS |
| SC5 — no `src/` behavior/storage change | Diff is confined to `test/fixtures/durable-state-inventory.ts` (data/type) + `CP-2.md` | PASS |

Next action: CP-3 — add guard 1, the executable anti-regression test that fails
when a new normal-runtime write targets a retired workflow-path pattern in an
unregistered file.
