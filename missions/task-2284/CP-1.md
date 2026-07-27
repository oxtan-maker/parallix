# CP-1 — Inventory

## Summary

Read the current task-catalog implementation end to end and authored
`docs/adr/0052-task-catalog-authority-and-board-authorship.md` with its header
block (`Status:`, `Date:`, `Related:`) and a complete, citation-backed
`## Context`. `## Decision` and `## Consequences` exist as placeholders for CP 3;
no decision text was written yet, per the checkpoint contract.

The Context inventories all nine behaviors required by success criterion 2, each
with a `file:line` citation or a named repository test:

1. **Task creation** — no single path: Backlog.md adapter defaults
   (`backlog/config.yml:2-3`), `px draft` writing literal frontmatter lines and
   committing (`src/platform/runtime/lib/commands/draft.ts:653-685`), and the
   gatekeeper instructing hand-authorship
   (`src/platform/runtime/lib/tools/gatekeeper.ts:81`).
2. **ID allocation** — no allocator in-repo; ids come from the external adapter
   parameterized by `backlog/config.yml:13,17`, synthetic drafts use a content
   hash (`src/platform/runtime/lib/commands/draft.ts:31-38`), and identity is
   asserted twice (filename + frontmatter), which is why `id-mismatch` exists.
3. **Status transitions** — regex read/write with no schema validation
   (`src/platform/runtime/lib/tools/backlog.ts:280-323`).
4. **Integration-branch writes** — authoritative write lands on the resolved
   state root, mission rebase is deferred while dirty, conflicts get a
   hand-written field-aware merge
   (`src/platform/runtime/lib/tools/backlog.ts:584-590,685-705,776-792,618-673`).
   Also found: SQLite lane-event recording is *already* in the transition path
   as a non-authoritative observer
   (`src/platform/runtime/lib/tools/backlog.ts:712-758`) — material evidence for
   CP 3.
5. **Archival / completion** — completion is a `renameSync` between directories;
   archival has no code path at all
   (`src/platform/runtime/lib/tools/backlog.ts:330-356`). Concrete defect found:
   `backlog/archive/` holds 12 loose `.md` files beside its `tasks/`
   subdirectory, and only `backlog/archive/tasks/` is reachable by
   `resolveTaskStorage`
   (`src/platform/runtime/lib/core/product-config.ts:393-401`) — those 12 records
   are invisible to every reader today.
6. **Git review exposure** — every mutation is a commit
   (`src/platform/runtime/lib/tools/backlog.ts:408-438`), at the cost of the
   integrate-time dirty-overlap failure
   (`src/platform/runtime/lib/commands/integrate.ts:1489-1493`).
7. **Portability** — storage dirs are configurable
   (`src/platform/runtime/lib/core/product-config.ts:393-450`), but the parser is
   hand-written regex accepting only three YAML spellings
   (`src/platform/runtime/lib/tools/backlog.ts:366-399,862-885,914-948`).
8. **Recovery** — detection plus deletion only, pinned by named tests; malformed
   frontmatter degrades silently to `null`/`[]`
   (`src/platform/runtime/lib/tools/backlog.ts:296,884`).
9. **Optional `backlog.md`** — absent from this repository; the catalog is the
   three directories (`docs/adr/0051-ui-neutral-application-boundary.md:44-45`).

Restricted areas were respected: `src/platform/runtime/lib/tools/backlog.ts`,
`src/platform/runtime/lib/commands/integrate.ts`, and `backlog/config.yml` were
read only. No stop rule fired — the inventory does not yet force a decision that
contradicts ADR 0044.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| ADR file exists with `Status:`, `Date:`, `Related:`, `## Context`, `## Decision`, `## Consequences` | `docs/adr/0052-task-catalog-authority-and-board-authorship.md:1`, `docs/adr/0052-task-catalog-authority-and-board-authorship.md:3`, `docs/adr/0052-task-catalog-authority-and-board-authorship.md:7`, `docs/adr/0052-task-catalog-authority-and-board-authorship.md:191`, `docs/adr/0052-task-catalog-authority-and-board-authorship.md:195` | PASS |
| Criterion 2 — Context inventories task creation with citation | `docs/adr/0052-task-catalog-authority-and-board-authorship.md:29`, `src/platform/runtime/lib/commands/draft.ts:653` | PASS |
| Criterion 2 — ID allocation inventoried with citation | `docs/adr/0052-task-catalog-authority-and-board-authorship.md:46`, `src/platform/runtime/lib/commands/draft.ts:31` | PASS |
| Criterion 2 — status transitions inventoried with citation | `docs/adr/0052-task-catalog-authority-and-board-authorship.md:66`, `src/platform/runtime/lib/tools/backlog.ts:300` | PASS |
| Criterion 2 — integration-branch writes inventoried with citation | `docs/adr/0052-task-catalog-authority-and-board-authorship.md:79`, `src/platform/runtime/lib/tools/backlog.ts:685` | PASS |
| Criterion 2 — archival/completion inventoried with citation | `docs/adr/0052-task-catalog-authority-and-board-authorship.md:101`, `src/platform/runtime/lib/tools/backlog.ts:330` | PASS |
| Criterion 2 — Git review exposure inventoried with citation | `docs/adr/0052-task-catalog-authority-and-board-authorship.md:118`, `src/platform/runtime/lib/commands/integrate.ts:1489` | PASS |
| Criterion 2 — portability inventoried with citation | `docs/adr/0052-task-catalog-authority-and-board-authorship.md:130`, `src/platform/runtime/lib/core/product-config.ts:393` | PASS |
| Criterion 2 — recovery inventoried with named tests | `docs/adr/0052-task-catalog-authority-and-board-authorship.md:147`, `"pruneStaleBacklogDuplicates removes the stale copy and clears the gate"`, `test/backlog_reorder_completed_duplicate.test.ts:74`, `"Backlog integrity check passes"` | PASS |
| Criterion 2 — optional `backlog.md` status inventoried with citation | `docs/adr/0052-task-catalog-authority-and-board-authorship.md:169`, `ADR 0051` | PASS |
| Every cited path exists and every cited line is in range | `src/platform/runtime/lib/tools/backlog.ts:1173`, `src/platform/runtime/lib/commands/draft.ts:1062`, `src/platform/runtime/lib/core/product-config.ts:541`, `docs/adr/0044-workflow-distribution-model.md:295`, `docs/adr/0051-ui-neutral-application-boundary.md:523` (file lengths exceed every cited line) | PASS |
| Restricted areas unmodified in CP 1 | `git status --porcelain` shows no entry for `src/platform/runtime/lib/tools/backlog.ts`, `src/platform/runtime/lib/commands/integrate.ts`, or `backlog/config.yml` | PASS |
| No decision text written yet (CP 1 boundary) | `docs/adr/0052-task-catalog-authority-and-board-authorship.md:191` (`## Decision` holds only a `<!-- CP 3 -->` marker) | PASS |

Next action: create `test/helpers/task-2284-catalog-round-trip.ts` and
`test/task-2284-catalog-round-trip.test.ts`, then run
`npm test -- test/task-2284-catalog-round-trip.test.ts`.
