# ADR 0052: Task catalog authority and board authorship

Status: Accepted; cutover requires the forward-migration gates named below
Date: 2026-07-27
Related: ADR 0037 (workflow coordination), ADR 0044 (workflow distribution model), ADR 0048 (fail-closed harness), ADR 0051 (UI-neutral application boundary), TASK-2284, TASK-2307, TASK-2301, TASK-2295

## Context

ADR 0044 declares SQLite the "eventual mutable domain authority" and forbids
leaving "files and SQLite as competing mutable authorities"
(`docs/adr/0044-workflow-distribution-model.md:20-21`,
`docs/adr/0044-workflow-distribution-model.md:118-129`). ADR 0051 records that
task Markdown is authoritative *today*
(`docs/adr/0051-ui-neutral-application-boundary.md:38-48`). Neither ADR owns the
task-catalog authority decision itself: 0044 states a direction inside a
distribution decision, and 0051 states a snapshot. This ADR owns that decision
and the rule for who may author a task record.

The decision became answerable when TASK-2307 landed a guarded operator command
surface over the shared application port
(`backlog/completed/task-2307 - Ink-TUI-wave-5-guarded-actions-confirmation-cancellation-and-progress-operation-log.md`,
`src/application/controller/board-command.ts:78-95`). That does **not** mean the
board is already the task-authoring surface. In fact `draft:create` is still an
explicitly unavailable capability
(`src/application/controller/board-command.ts:102`). The current creation story
still starts in CLI draft intake, not in a board command.

The inventory below is the evidence base. Every claim carries a `file:line`
citation or a named repository test.

### 1. Task creation

There is no single creation path. Human/agent tasks are created as Markdown
files under `backlog/tasks/` through the Backlog.md task adapter, whose defaults
live in `backlog/config.yml:2-3` (`default_status: "backlog"`, the six-value
`statuses` list). The repository's own creation path is `px draft`, and that
path already supports more than "pick an existing task file":

- a normal `task-####` slug resolves an existing task record;
- a directory path is accepted and becomes a synthetic draft target
  (`src/platform/runtime/lib/commands/draft.ts:63-77`);
- a free-text string is accepted and becomes a synthetic draft target
  (`src/platform/runtime/lib/commands/draft.ts:79-88`).

When no canonical task file exists, `px draft` can bootstrap one synthetic task
file and commit it in one step
(`src/platform/runtime/lib/commands/draft.ts:633-685`). Before any
draft is accepted, `px draft` runs the integrity gate and refuses to proceed on a
stale `backlog/tasks/` copy of a completed task
(`src/platform/runtime/lib/commands/draft.ts:211-216`). The important
architectural point is that **draft intake already accepts backlog-backed input,
directory input, and free-text input**. Any future authority model must preserve
that ingress flexibility instead of replacing it with "board-only authoring."

### 2. ID allocation

No numeric allocator exists in this repository. Sequential `TASK-nnnn` ids come
from the external Backlog.md adapter, parameterized only by
`backlog/config.yml:13` (`zero_padded_ids: 3`) and `backlog/config.yml:17`
(`task_prefix: "task"`). Allocation is therefore "scan the three stores in this
checkout for the next free number", which is why an id picked from a stale fork
point can collide with an id created on `main` in the meantime. Synthetic drafts
sidestep the counter entirely with a content hash
(`src/platform/runtime/lib/commands/draft.ts:31-38`). Identity is asserted in two
places at once — the filename prefix
(`src/platform/runtime/lib/tools/backlog.ts:169-173`) and the frontmatter `id:`
line — and the integrity check exists precisely because those two can disagree
(`src/platform/runtime/lib/tools/backlog.ts:215-226`, issue type `id-mismatch`).
Resolution tolerates that ambiguity with a layered fallback: filename prefix
scan, exact frontmatter-id match, base-id match for suffixed slugs, then a
higher-priority-directory preference
(`src/platform/runtime/lib/tools/backlog.ts:52-132`), covered by the resolution
assertions in `test/backlog.test.ts`.

### 3. Status transitions

Status is read by regex from either YAML frontmatter or a rendered `Status:`
line (`src/platform/runtime/lib/tools/backlog.ts:280-297`) and written by
regex-replacing those same lines in place
(`src/platform/runtime/lib/tools/backlog.ts:300-323`). There is no parse →
mutate → re-serialize step and no schema validation: `setTaskStatus` will happily
write any string, including one outside `backlog/config.yml:3`. A transition
bundles assignee enforcement, the status write, and a `git commit` into one
operation (`src/platform/runtime/lib/tools/backlog.ts:526-578`), and rejects
suffixed slugs to avoid committing to the wrong file
(`src/platform/runtime/lib/tools/backlog.ts:539-545`).

### 4. Integration-branch (main-branch) writes

The authoritative write does not happen in the mission worktree. The durable
state root is resolved first — the recorded feature base, else the current
non-mission checkout (`src/platform/runtime/lib/tools/backlog.ts:584-590`) — and
the transition is applied and committed there
(`src/platform/runtime/lib/tools/backlog.ts:685-705`). Only afterwards is the
mission worktree rebased forward, and that rebase is deliberately deferred while
the worktree is dirty so it cannot race an agent's uncommitted work
(`src/platform/runtime/lib/tools/backlog.ts:776-792`). Rebase conflicts confined
to mission-owned artifacts are auto-reconciled with a field-aware merge:
descriptive metadata from the mission commit, `status` and `assignee` from the
integration branch (`src/platform/runtime/lib/tools/backlog.ts:618-626`,
`src/platform/runtime/lib/tools/backlog.ts:641-673`). This is a hand-written,
field-level three-way merge over Markdown, not Git's line merge.

A SQLite lane-transition row is already recorded alongside every accepted
transition, through a dynamic import whose failure is swallowed so recording can
never block the authoritative write
(`src/platform/runtime/lib/tools/backlog.ts:712-758`). SQLite is therefore
already present in the transition path as a *non-authoritative observer*.

### 5. Archival and completion

Completion sets `status: done` and then `fs.renameSync` the file from
`backlog/tasks/` into `backlog/completed/`
(`src/platform/runtime/lib/tools/backlog.ts:330-356`). Authority is thus encoded
in a file's *directory*, not in a field: `resolveTaskFile` ranks
`tasks/` → `completed/` → `archive/tasks/`
(`src/platform/runtime/lib/tools/backlog.ts:26-31`), and a `tasks/` copy that
shadows a completed or archived record is an integrity defect, not a state
(`src/platform/runtime/lib/tools/backlog.ts:237-247`). Archival has no code path
at all — it is a manual move. The consequence is visible in this repository:
`backlog/archive/` holds twelve loose `.md` files beside its `tasks/`
subdirectory, and only `backlog/archive/tasks/` is reachable by
`resolveTaskStorage`
(`src/platform/runtime/lib/core/product-config.ts:393-401`). Those twelve records
are already invisible to every reader.

### 6. Git review exposure

Every task mutation is a Git commit against a working tree
(`src/platform/runtime/lib/tools/backlog.ts:408-438`), pinned to the caller's
`rootDir` because all worktrees share one object store
(`src/platform/runtime/lib/tools/backlog.ts:416-419`). Task history is therefore
reviewable with ordinary `git log` / `git diff`, and task edits ride the same PR
as code. The cost is coupling: `px integrate` treats *any* dirty path under
`backlog/tasks/` or `backlog/completed/` as an overlap failure, because closeout
mutates files beyond the current mission's own slug
(`src/platform/runtime/lib/commands/integrate.ts:1489-1493`).

### 7. Portability

The catalog is plain files, so `git clone` is a complete backup and any editor is
a valid client. Storage location is already configurable per repository —
string or object form, with `tasksDir`, `completedDir`, and `archiveTasksDir`
independently overridable
(`src/platform/runtime/lib/core/product-config.ts:393-450`). Nothing in the
runtime requires this repository's layout. The parser, however, is not portable
in the same sense: assignee, label, and status handling are hand-written regexes
that accept inline-array, block-sequence, and bare-scalar spellings and normalize
to inline arrays on write
(`src/platform/runtime/lib/tools/backlog.ts:366-399`,
`src/platform/runtime/lib/tools/backlog.ts:862-885`,
`src/platform/runtime/lib/tools/backlog.ts:914-948`). Any YAML feature outside
those shapes — anchors, multi-line block scalars, nested maps — is not supported
by the current readers.

### 8. Recovery

Recovery is detection plus deletion. `checkBacklogIntegrity` reports
`id-mismatch` and `duplicate-completed` issues across the three stores
(`src/platform/runtime/lib/tools/backlog.ts:180-250`), and
`pruneStaleBacklogDuplicates` repairs the second class by removing the stale
`backlog/tasks/` copy, treating the completed/archive copy as canonical
(`src/platform/runtime/lib/tools/backlog.ts:259-277`). Both behaviors are pinned
by tests: `"checkBacklogIntegrity flags a reorder-recreated backlog copy of a completed task"`,
`"checkBacklogIntegrity also flags a tasks/ copy that duplicates an archived task"`,
and `"pruneStaleBacklogDuplicates removes the stale copy and clears the gate"`
(`test/backlog_reorder_completed_duplicate.test.ts:42`,
`test/backlog_reorder_completed_duplicate.test.ts:55`,
`test/backlog_reorder_completed_duplicate.test.ts:74`), with the repository-wide
gate asserted by `"Backlog integrity check passes"`
(`test/backlog_gate.test.ts:6`). There is no corruption model beyond this: a
malformed frontmatter block degrades silently, because every reader returns
`null` or `[]` when its regex misses
(`src/platform/runtime/lib/tools/backlog.ts:296`,
`src/platform/runtime/lib/tools/backlog.ts:884`). The recovery tool of record is
`git checkout`.

### 9. Optional status of `backlog.md`

`backlog.md` is an optional legacy aggregate, not the canonical catalog
(`docs/adr/0051-ui-neutral-application-boundary.md:44-45`). This repository does
not contain one: the catalog is `backlog/tasks/` (26 files),
`backlog/completed/` (183 files), and `backlog/archive/tasks/` (33 files), and
`backlog/config.yml` configures the adapter without ever naming an aggregate
file. No decision here needs to preserve writes to it.

### What the inventory establishes

- Authority is currently expressed as **file location plus regex-patched text**,
  with no record type, no schema, and no serializer.
- A field-aware merge, a duplicate-detection gate, and a pruner already exist to
  compensate for that — the reconciliation cost of file authority is already
  being paid (`src/platform/runtime/lib/tools/backlog.ts:618-673`,
  `src/platform/runtime/lib/tools/backlog.ts:180-277`).
- SQLite is already in the transition path as a non-authoritative observer
  (`src/platform/runtime/lib/tools/backlog.ts:712-758`).
- Git review exposure and single-file portability are real, load-bearing
  properties, not incidental ones.

### Measured round-trip evidence

TASK-2284 built a read-only harness that parses a task record, re-serializes it,
and diffs the result field by field
(`test/helpers/task-2284-catalog-round-trip.ts:173`,
`test/helpers/task-2284-catalog-round-trip.ts:218`,
`test/helpers/task-2284-catalog-round-trip.ts:238`), exercised by
`test/task-2284-catalog-round-trip.test.ts`. Three measurements inform the
options below and are cited again in the operational rows:

1. **Migration is lossless in principle.** 240 of 240 well-formed stored records
   — across `backlog/tasks/`, `backlog/completed/`, and `backlog/archive/tasks/`
   — re-serialize with zero field differences *and* byte for byte, including
   YAML folded block scalars, block sequences, inline arrays, quoted scalars,
   and frontmatter keys no reader consumes
   (`"round trip is lossless across every task record in backlog/tasks, backlog/completed, and backlog/archive/tasks"`).
2. **Field-level comparison alone is not proof.** The harness's first version
   reported zero differences for all 242 records while silently dropping every
   folded block scalar: a value the parser never captures is missing from both
   sides of the diff. Only byte-identity assertion exposed it
   (`test/task-2284-catalog-round-trip.test.ts:212-216`). Any migration gate that
   compares "the fields we know about" will over-report success.
3. **Two of 242 stored records are already corrupt at rest, and no gate catches
   them.** `backlog/completed/task-1373 - …-setup-review.md` carries unresolved
   Git conflict markers *inside its frontmatter*, with `status: done` above the
   `=======` line and `status: backlog` below it; `getTaskStatus` takes the first
   regex match (`src/platform/runtime/lib/tools/backlog.ts:285-288`), so the
   record silently reads as done.
   `backlog/completed/task-1385 - Enforce-pre-review-….md` has `updated_date`
   indented under `created_date`, where no `^updated_date:` reader can see it
   (`src/platform/runtime/lib/tools/backlog.ts:846`). Both are pinned by
   `"the harness detects the stored task records whose frontmatter is corrupt"`.

## Decision

### Options compared

Criteria, applied identically to every option. **Concurrency** — safety when two
writers touch one record. **Merge cost** — machinery needed to reconcile
divergent writes. **Integrity** — whether a malformed record is rejected at write
time. **Offline** — operation with no network. **Multi-repo** — stable identity
across checkouts. **Git review** — task edits visible in a diff. **Human edit** —
correcting a record with an editor alone. **Recovery** — restoring a damaged
record. **Migration risk** — cost of adopting the option from today's state.
**ADR 0044 fit** — agreement with the decided persistence direction.

| Option | Concurrency | Merge cost | Integrity | Offline | Multi-repo | Git review | Human edit | Recovery | Migration risk | ADR 0044 fit |
|---|---|---|---|---|---|---|---|---|---|---|
| **A. Git Markdown authority** (status quo, formalized) | Last-writer-wins per file; no record-level locking | High and already paid: field-aware three-way merge, duplicate gate, pruner (`src/platform/runtime/lib/tools/backlog.ts:618-673`, `:180-277`) | None — any string is writable (`:300-323`); 2/242 records corrupt at rest | Complete; files need nothing | Weak — identity is a filename plus a frontmatter line that can disagree (`:215-226`) | Native; task edits ride the mission PR | Native; any editor is a client | `git checkout`; no structural repair | None | Contradicts `docs/adr/0044-workflow-distribution-model.md:118-129` |
| **B. SQLite authority after draft/import materialization** (selected) | Single writer per repository database; transactional record updates | Low — one authority, no reconciliation path (`docs/adr/0044-workflow-distribution-model.md:154-157`) | Schema-enforced at write time; corrupt records cannot be stored | Complete; the database is local-first (`docs/adr/0044-workflow-distribution-model.md:112-114`) | Strong — repository-scoped rows carry stable repository identity (`src/platform/runtime/lib/tools/backlog.ts:743-745`) | Task history moves from Git-edited task files to SQLite-backed workflow evidence and migration logs | Not directly after materialization; human edits happen before import or through supported commands | Schema validation, backup/restore of the database, and re-import from source intent for unfinished migration windows | Moderate; bounded by the round-trip evidence above | Direct implementation of it |
| **C. Append-only event log with materialized views** | Strong — appends never conflict; views are derived | Low for writes, but adds view-rebuild and event-versioning machinery | Enforced on the event schema, plus a projection contract | Complete | Strong | Only via a projection | Not directly; a correction is a new compensating event | Rebuild views from the log; the log itself is the backup | High — a second modelling paradigm on top of an unbuilt migration | Compatible in spirit, but 0044 names SQLite tables, not an event store |

Option A is rejected: it formalizes a model whose reconciliation cost is already
being paid in hand-written merge code, whose integrity story is "no validation"
with two corrupt records to show for it, and which contradicts a decided ADR.
Option C is rejected for this decision cycle: its concurrency and audit benefits
are real, but it adds a second modelling paradigm before the first migration has
shipped, and nothing in the inventory shows a need for event-sourced task
history that a lane-event table cannot serve — that table already exists
(`src/platform/runtime/lib/tools/backlog.ts:712-758`). Option C stays available
inside the SQLite boundary as a table shape, not as a competing authority.

### Selected authority

**Option B: SQLite becomes the sole write authority for a mission/task record
immediately after draft intake materializes that record.** Draft intake remains
multi-source: an operator may start from an existing backlog task, from optional
legacy `backlog.md`-managed task material, from a custom file or directory, or
from a free-text string. Once that intake has been normalized into the
repository's canonical task/mission record, subsequent lifecycle state belongs
to SQLite, not to task Markdown.

This ADR therefore draws the authority seam at **materialization time**, not at
"which surface did the operator type into?" The board is one possible client for
already-materialized records; it is not a prerequisite for creating them, and it
is not the exclusive source of mission intent.

Until the cutover gates below pass, task Markdown remains the authority for the
existing catalog and draft bootstrap flow. This ADR does not change runtime
behavior on its own.

**Cutover gates.** All three must pass before any read or write switches:

1. A lossless forward import of every existing record in all three stores into
   SQLite, verified by the byte-identity check — not field comparison alone —
   established by `test/task-2284-catalog-round-trip.test.ts`.
2. Backup and restore of the database demonstrated on a populated repository.
3. Draft intake proves all supported ingress modes still materialize usable
   canonical records: existing task-file input, synthetic directory input, and
   synthetic free-text input.

### Operational concerns

Each concern is binding on the post-cutover design.

- **Offline.** No task operation may require a network. The database is local to
  the operator's machine and repository
  (`docs/adr/0044-workflow-distribution-model.md:112-114`); Forgejo remains a
  pull-request projection and never task authority
  (`docs/adr/0044-workflow-distribution-model.md:128-129`).
- **Intent ingress remains plural.** Intake is not reduced to a board form or a
  single file format. The supported ingress modes proven by `resolveDraftTarget`
  — existing task slug, directory input, and free-text input
  (`src/platform/runtime/lib/commands/draft.ts:41-88`) — remain valid at the
  authority boundary. Optional legacy `backlog.md`-style task management may
  continue to feed the import path where a repository still uses it.
- **Multi-repository identity.** A task is identified by (repository identity,
  task id). Repository identity is derived from the repository, as the existing
  lane-event write already does
  (`src/platform/runtime/lib/tools/backlog.ts:743-745`), not from a working
  directory path. The id must be unique per repository and must not be re-derived
  from a filename, which removes the filename/frontmatter disagreement class
  (`src/platform/runtime/lib/tools/backlog.ts:215-226`) and the "next free number
  from a stale fork point" collision class.
- **Concurrent writers.** One database per repository, one transaction per record
  mutation, and an expected-status precondition on every mutating command — the
  contract `staleConflict` already expresses
  (`src/application/controller/board-command.ts:49-51`). A mutation whose
  observed status differs from the requested precondition fails; it does not
  overwrite.
- **Merge and conflict handling.** There is no merge path for task records after
  cutover, because there is only one writer of record. The field-aware Markdown
  merge (`src/platform/runtime/lib/tools/backlog.ts:618-626`) and the
  mission-rebase reconciliation (`:641-673`) are retired for task records at
  cutover, not carried forward.
- **Backup.** A backup is a consistent copy of the repository database. During
  the migration window the original Markdown task files remain a source-import
  fallback, but post-cutover the supported recovery path is restoring the
  database, not regenerating a second authoritative task store.
- **Corruption recovery.** Schema validation rejects a malformed record at write
  time, which is the property Option A lacks and which the two corrupt records
  above demonstrate the cost of. Recovery order is: restore from backup; else
  re-import from the last trustworthy source task material while migration is
  still incomplete. Integrity checking moves from "scan three directories for
  duplicate ids" (`src/platform/runtime/lib/tools/backlog.ts:180-250`) to a
  uniqueness constraint.
- **Downgrade.** Supporting old parallix versions after cutover is **not** a
  decision requirement. This migration is forward-only. The product may choose
  to carry temporary compatibility tooling during implementation, but the ADR
  does not require a downgrade path and does not block cutover on rehearsing one.
- **Import only, not export.** Import from existing task material into SQLite is
  required, and that import must preserve the stored record exactly enough to
  avoid semantic loss. A persistent export path from SQLite back into canonical
  Markdown is **not** required. The round-trip harness remains useful migration
  evidence because it proves the repository can parse what it already stores, but
  cutover does not depend on shipping Markdown export as a steady-state feature.
- **Human inspection.** `px` and future clients must render tasks from SQLite.
  Human-readable task files may remain as historical source material or migration
  evidence, but post-cutover they are not required to stay in lockstep with
  mutable workflow state.
- **Automation access.** Every automation path — `px` commands and their `--json`
  output — reads and writes through the application port named below. No
  automation may open the database file directly as its public contract. The CLI remains
  the automation surface (`docs/adr/0051-ui-neutral-application-boundary.md:50-58`).

### Dual-write is rejected as a steady state

Parallix must not maintain task Markdown and SQLite as two writable authorities
with a synchronization path between them, in either direction, at any point after
cutover. This restates and localizes
`docs/adr/0044-workflow-distribution-model.md:154-157` for the task catalog.
If an implementation temporarily emits diagnostic or archival Markdown during the
migration, that output is non-authoritative and must never be read back as
mutable state.

One temporary compatibility write is permitted — the **pre-cutover shadow
import**, in which the migration writes records into SQLite while Markdown
remains authoritative, so the import can be validated against live traffic. It is
permitted only with all four of the following:

1. **Reconciliation rule.** Markdown wins unconditionally. The shadow database is
   truncated and rebuilt from the Markdown tree whenever the two disagree; a
   disagreement is never resolved in the database's favor and never propagates
   back to Markdown.
2. **Telemetry signal.** Every shadow write records a comparison outcome
   (`match`, `divergent`, `import-failed`) with the task id and the differing
   field names, using the same recorder path as the existing lane-event write
   (`src/platform/runtime/lib/tools/backlog.ts:712-758`). A non-`match` outcome
   is a gate failure, not a warning.
3. **Removal gate.** The shadow path is deleted in the same change that performs
   the cutover. Cutover is permitted only after the three cutover gates pass and
   the shadow telemetry reports zero non-`match` outcomes across a full pass over
   all three stores.
4. **Bounded lifetime.** The shadow path exists for at most the two consecutive
   missions that implement import and cutover (the follow-ups created by
   TASK-2284). If cutover has not happened by the end of the second, the shadow
   path is removed and the migration restarts from the evidence, rather than
   living on as a synchronization path.

### Authoring rule (client-neutral)

The client-neutral rule applies **after** a record has been materialized. It does
not erase or replace the existing draft-intake sources.

Any client that authors or edits a task record — terminal, browser, editor
plugin, or a client not yet written — mutates it **only** through the
application's board command port,
`src/application/controller/board-command.ts`: a typed `BoardCommandRequest`
dispatched through `BoardCommandDispatcher`
(`src/application/controller/board-command.ts:78-83`), subject to the capability
registry (`INTEGRATED_CAPABILITIES`, `unavailableReason`,
`src/application/controller/board-command.ts:93-116`) and to the stale-status
precondition (`staleConflict`, `:49-51`). A command that is not an integrated
capability is rejected, not executed with a degraded path
(`unavailableCapability`, `:45-47`).

No board client may issue SQL against the task database directly. No client may
re-open file authority by writing task Markdown as if it were the mutable source
of truth after cutover. This rule binds every client equally; it is not
satisfied by one client obeying it while another writes directly.

### Task content and reviewability

Mission intent remains inspectable and reviewable, but not necessarily as a
live, Git-mutated Markdown task file after cutover. Review moves to the
materialized SQLite record, the mission artifacts, and the workflow evidence the
CLI already captures. Preserving a Git-diffable Markdown projection for every
post-cutover mutation is not a decision requirement.

## Consequences

- The contradiction between ADR 0044 and ADR 0051 is resolved and owned here:
  ADR 0044's authority direction stands, ADR 0051 described the pre-cutover
  state, and both now cross-reference this ADR for the task catalog.
- The existing multi-source draft intake is preserved. `px draft` may continue to
  start from backlog task material, directory input, or free-text input rather
  than forcing operators through a board-first task creation flow.
- TASK-2301 (SQLite migration tooling) and TASK-2295 (operator state model) can
  design schema against a decided authority instead of an open question.
- Hand-written reconciliation machinery for task records — the field-aware merge,
  the duplicate-completed gate, and the pruner
  (`src/platform/runtime/lib/tools/backlog.ts:618-673`,
  `src/platform/runtime/lib/tools/backlog.ts:180-277`) — becomes deletable at
  cutover. That is a removal of code, not an addition.
- Direct human editing of a task file stops being an authoritative act after the
  import boundary. Operators who want a task file as input can still start there,
  but once the record is materialized they must use supported commands.
- The two corrupt records identified above must be repaired before import, or
  they will fail the cutover gate for the entire repository. Repairing them is
  not in TASK-2284's scope; it is an acceptance criterion of the import follow-up.
- Until cutover, nothing changes. A reader of this ADR must not treat it as
  license to write task state into SQLite: the shadow import is validation-only,
  and Markdown remains authoritative until all three cutover gates pass.
- The round-trip harness is mission evidence, not a shipped surface. The
  follow-up that implements import owns the production implementation and
  may reuse the harness's record model, but the harness itself acquires no CLI
  flag and no command wiring.
