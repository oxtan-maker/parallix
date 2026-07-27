# CP-3 — Options and decision

## Summary

Filled `## Decision` in
`docs/adr/0052-task-catalog-authority-and-board-authorship.md`: the three-option
comparison table, the selected authority with its cutover gates, the ten
operational-concern rows, the dual-write rejection with the four conditions on
the one permitted compatibility write, the client-neutral authoring rule, the
version-control answer, and `## Consequences`.

**Selected: Option B — after a gated cutover, SQLite is the sole write authority
for the task catalog, and Markdown under `backlog/` becomes a generated,
committed, read-only export** (`docs/adr/0052-…:253-273`). This does not
contradict ADR 0044, so the mission's first stop rule did not fire: ADR 0044
already states the SQLite direction as decided
(`docs/adr/0044-workflow-distribution-model.md:164-167`), and ADR 0052 localizes
its cutover rule to task records. Option A (Git Markdown authority) is rejected
because its reconciliation cost is already being paid in hand-written merge code
and its integrity story is "no validation" — with two corrupt records in the
live catalog to show for it. Option C (append-only event log) is rejected for
this cycle as a second modelling paradigm ahead of an unshipped migration, and
stays available as a table shape inside the SQLite boundary.

The CP-2 measurements are fed into the decision rather than asserted
(`docs/adr/0052-…:191-223`): 240/240 well-formed records round trip byte for
byte; field-level comparison alone silently passed while dropping folded block
scalars, so the import/export gate is specified as byte identity, not known-field
comparison; and the two corrupt records set the "repair before import" condition
that became an acceptance criterion of the import follow-up.

Restricted areas held: ADR 0044 and ADR 0051 received a cross-reference only, no
rewrite of their decisions and no dated-history clause, consistent with the
repository's compact-ADR practice.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Criterion 3 — comparison table with one row per option, scored against the same named criteria columns | `docs/adr/0052-task-catalog-authority-and-board-authorship.md:237` (header row), `:239` (Option A), `:240` (Option B), `:241` (Option C) | PASS |
| Criterion 4 — exactly one authority option selected | `docs/adr/0052-task-catalog-authority-and-board-authorship.md:255` ("**Option B: … SQLite is the sole write authority**") | PASS |
| Criterion 4 — offline, as its own labelled row | `docs/adr/0052-task-catalog-authority-and-board-authorship.md:279` | PASS |
| Criterion 4 — multi-repository identity | `docs/adr/0052-task-catalog-authority-and-board-authorship.md:284` | PASS |
| Criterion 4 — concurrent writers | `docs/adr/0052-task-catalog-authority-and-board-authorship.md:292`, `src/application/controller/board-command.ts:49` | PASS |
| Criterion 4 — merge/conflict handling | `docs/adr/0052-task-catalog-authority-and-board-authorship.md:298` | PASS |
| Criterion 4 — backup | `docs/adr/0052-task-catalog-authority-and-board-authorship.md:304` | PASS |
| Criterion 4 — corruption recovery | `docs/adr/0052-task-catalog-authority-and-board-authorship.md:308` | PASS |
| Criterion 4 — downgrade | `docs/adr/0052-task-catalog-authority-and-board-authorship.md:315` | PASS |
| Criterion 4 — import/export | `docs/adr/0052-task-catalog-authority-and-board-authorship.md:320`, `"round trip is lossless across every task record in backlog/tasks, backlog/completed, and backlog/archive/tasks"` | PASS |
| Criterion 4 — human inspection | `docs/adr/0052-task-catalog-authority-and-board-authorship.md:327` | PASS |
| Criterion 4 — automation access | `docs/adr/0052-task-catalog-authority-and-board-authorship.md:331` | PASS |
| Criterion 5 — dual-write rejected as a steady state, and the one permitted compatibility write defines all four of reconciliation rule, telemetry signal, removal gate, bounded lifetime | `docs/adr/0052-task-catalog-authority-and-board-authorship.md:336` (rejection), `:351` (reconciliation rule), `:355` (telemetry signal), `:360` (removal gate), `:364` (bounded lifetime) | PASS |
| Criterion 6 — authoring rule stated client-neutrally, names the application port, forbids direct SQL and direct filesystem writes, does not bind only the TUI or web board | `docs/adr/0052-task-catalog-authority-and-board-authorship.md:370-388`, `src/application/controller/board-command.ts:78`, `src/application/controller/board-command.ts:93` | PASS |
| Criterion 7 — yes/no answer plus reason in one sentence about Git version control and review | `docs/adr/0052-task-catalog-authority-and-board-authorship.md:392` ("**Yes** — … because the generated Markdown export is committed to the repository") | PASS |
| CP-2 measurements fed into the decision rather than asserted | `docs/adr/0052-task-catalog-authority-and-board-authorship.md:191-223`, `test/task-2284-catalog-round-trip.test.ts` | PASS |
| Stop rule not triggered — decision aligns with ADR 0044 rather than requiring its rewrite | `ADR 0044`, `docs/adr/0044-workflow-distribution-model.md:164-167` | PASS |

Next action: commit the follow-up task files
`backlog/tasks/task-2315 - Implement-byte-faithful-task-record-import-and-export-for-the-SQLite-task-catalog.md`
and `backlog/tasks/task-2316 - Cut-over-task-catalog-authority-to-SQLite-and-retire-Markdown-write-paths.md`
together with the `docs/adr/index.md` entry and the 0044/0051 cross-references,
then run `./scripts/verify-local.sh all`.
