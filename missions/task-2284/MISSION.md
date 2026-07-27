# Mission: Decide future task catalog authority and board authorship migration (task-2284)

## Goal
Produce a dedicated, evidence-cited ADR (`docs/adr/0052-task-catalog-authority-and-board-authorship.md`) that decides where canonical task authority lives — Git-tracked Markdown under `backlog/tasks/`, `backlog/completed/`, `backlog/archive/`; SQLite with export; or an append-only event log with materialized views — and decides whether an operator board becomes a task-*authoring* surface, stated client-neutrally so it binds the Ink TUI (TASK-2307) and any future web client (TASK-2283) equally. The decision is backed by a lossless dry-run round-trip harness plus tests that prove a candidate serialization preserves every field of today's Markdown records, and by follow-up backlog tasks that carry compatibility and rollback gates. No production task record, no `backlog/config.yml` setting, and no runtime authority changes in this mission.

## Why Now
ADR 0044 already declares SQLite the "eventual mutable domain authority" and forbids "files and SQLite as competing mutable authorities" (`docs/adr/0044-workflow-distribution-model.md:20`, `:118`), while ADR 0051 records that task Markdown remains authoritative today (`docs/adr/0051-ui-neutral-application-boundary.md:41-48`). That contradiction is currently resolved nowhere: the cutover rule is implied inside a distribution ADR rather than owned by a task-authority decision. TASK-2307 (Ink TUI wave 5, guarded command dispatch) is now `done` in `backlog/completed/`, so the repository finally has a proven read *and* guarded-command operator surface over `src/application/controller/board-command.ts` — the missing evidence this decision was waiting on. TASK-2283 (web board) is unprioritized, so gating the authority decision on it would stall ADR 0044's persistence direction indefinitely. Deciding now also unblocks TASK-2301 (SQLite migration tooling) and TASK-2295, which would otherwise design schema for a catalog whose authority is undecided.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: the ADR itself and the inventory are documentation (excluded from NEL); the code+test cost is the dry-run round-trip harness (parse → canonical record → re-serialize → byte/field compare) plus its fixture-driven test covering frontmatter, description, acceptance criteria, dependencies, references, priority, and unknown extension fields. Existing frontmatter handling in `src/platform/runtime/lib/tools/backlog.ts` is reused rather than reimplemented, which keeps this in the Medium band; no adapter, schema, or migration code is written.

## Scope
- Author `docs/adr/0052-task-catalog-authority-and-board-authorship.md` and add its one-line entry to `docs/adr/index.md`.
- Inventory current task-catalog behavior in the ADR's Context, each claim cited with `file:line` or a test name: file resolution across the three stores (`src/platform/runtime/lib/tools/backlog.ts:24-138`), integrity and duplicate handling (`:180-279`), status read/write (`:280-329`), completion/archival (`:330-365`), assignee/implementer/label writes (`:824-1131`), local vs. integration-branch transitions and mission-worktree reconciliation (`:526-823`), integrate-time dirty-path overlap on `backlog/tasks/` and `backlog/completed/` (`src/platform/runtime/lib/commands/integrate.ts:1465-1500`), task ID allocation, and the optional-legacy status of `backlog.md` per `backlog/config.yml`.
- Compare at least three authority options — Git Markdown authority, SQLite authority with Markdown export, append-only event authority with materialized views — against a fixed criteria matrix.
- Decide one option and specify its behavior for: offline operation, multi-repository identity, concurrent writers, merge/conflict handling, backup, corruption recovery, downgrade to a prior parallix version, import/export, human inspection, and automation (`px`, `--json`) access.
- State and justify whether task content remains version-controlled and reviewable in Git.
- Reject dual-write as a steady state; if any temporary compatibility write is permitted, define its reconciliation rule, telemetry signal, removal gate, and bounded lifetime.
- State the client-neutral authoring rule: board clients mutate tasks only through the selected application port (`src/application/controller/board-command.ts` `BoardCommandDispatcher` and capability rules), never direct SQL or direct filesystem writes.
- Build the dry-run round-trip harness (read-only; operates on fixtures and on copies of real task files in a temp directory) plus its test under `test/`.
- Create follow-up backlog tasks for the chosen implementation path, each with compatibility and rollback gates, using IDs verified free against current `main`.
- Add cross-reference lines in `docs/adr/0044-workflow-distribution-model.md` and `docs/adr/0051-ui-neutral-application-boundary.md` pointing at ADR 0052 as the owner of the task-authority decision.

## Out of Scope
- Any change to the runtime authority: no writes to `backlog/config.yml`, no new SQLite tables, migrations, or repositories under `src/adapters/sqlite/`, no changes to how `transitionTask`/`transitionTaskOnIntegrationBranch` persist state.
- Implementing an importer/exporter as a shipped `px` command or wiring it into any command path; the harness is mission-local proof only.
- Deleting, renaming, moving, or demoting any file under `backlog/tasks/`, `backlog/completed/`, or `backlog/archive/` (other than creating new follow-up task files).
- Implementing the web board (TASK-2283) or any new TUI surface.
- Re-opening the SQLite driver/migration-library question owned by TASK-2301, or the operator-state model owned by TASK-2295.
- Rewriting ADR 0044's runtime, bundling, or SEA distribution decisions; only its task-authority cross-reference line may change.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

1. `docs/adr/0052-task-catalog-authority-and-board-authorship.md` exists with `Status:`, `Date:`, `Related:`, `## Context`, `## Decision`, `## Consequences` sections, and `docs/adr/index.md` contains exactly one bullet naming that path.
2. The ADR Context inventories all nine behaviors — task creation, ID allocation, status transitions, main-branch (integration-branch) writes, archival/completion, Git review exposure, portability, recovery, and the optional status of `backlog.md` — and every one of the nine carries at least one `file:line` citation or named repository test; each cited path exists and each cited line number is within that file's length.
3. The ADR contains a comparison table with one row per option covering at minimum Git Markdown authority, SQLite authority with export, and append-only event authority with materialized views, scored against the same named criteria columns.
4. The ADR's Decision section names exactly one selected authority option and specifies behavior for all ten operational concerns: offline, multi-repository identity, concurrent writers, merge/conflict handling, backup, corruption recovery, downgrade, import/export, human inspection, automation access. Each concern appears as its own labelled subsection or table row.
5. The ADR states in its Decision section that dual-write is rejected as a steady state, and either states that no compatibility write is permitted, or defines for the permitted compatibility write all four of: reconciliation rule, telemetry signal, removal gate, bounded lifetime.
6. The ADR states the authoring rule client-neutrally — naming the application port rather than a specific client — and explicitly forbids direct SQL and direct filesystem task writes from any board client; the rule text names `src/application/controller/board-command.ts` and does not name the TUI or the web board as the only bound client.
7. The ADR states, in a sentence containing both a yes/no answer and a reason, whether task content remains version-controlled and Git-reviewable under the decision.
8. A round-trip harness exists under `src/` or `test/` and a test file `test/task-2284-catalog-round-trip.test.ts` asserts that parsing then re-serializing a task record preserves, field by field: every frontmatter key (including `id`, `title`, `status`, `assignee`, `created_date`, `updated_date`, `labels`, `dependencies`, `references`, `priority`), the `SECTION:DESCRIPTION` body, every `AC:` checkbox item with its checked state and `#n` index, every `DOD:` item, and at least one unknown extension frontmatter key not consumed by `src/platform/runtime/lib/tools/backlog.ts`.
9. The round-trip test runs against at least three real task files copied into a temporary directory — one from `backlog/tasks/`, one from `backlog/completed/`, and this mission's own `backlog/tasks/task-2284 - Decide-future-task-catalog-authority-and-board-authorship-migration.md` — and asserts zero field differences; `git status --porcelain backlog/` reports no modification of those source files after the test run.
10. At least one new follow-up backlog task file exists under `backlog/tasks/` for the chosen implementation path, and every follow-up created by this mission contains an acceptance criterion naming a compatibility check and an acceptance criterion naming a rollback path; each new ID is absent from `backlog/tasks/`, `backlog/completed/`, and `backlog/archive/` on current `main`.
11. `git diff --name-only` for the mission contains no path under `src/adapters/sqlite/migrations/`, no `backlog/config.yml`, and no deletion or rename of any pre-existing file under `backlog/`.
12. `docs/adr/0044-workflow-distribution-model.md` and `docs/adr/0051-ui-neutral-application-boundary.md` each contain a line referencing ADR 0052 as the owner of the task-catalog authority decision.
13. `./scripts/verify-local.sh docs`, `./scripts/verify-local.sh static-analysis`, and `./scripts/verify-local.sh all` exit 0 on the final tree.

## Risks and Assumptions
- **Risk: decision drift into implementation.** The round-trip harness is proof, not a product; if it starts acquiring CLI flags or adapter wiring, the mission has left scope. Mitigation: criterion 11 plus the Restricted Areas list.
- **Risk: contradicting ADR 0044.** ADR 0044 already asserts SQLite as eventual authority. If the evidence supports keeping Git Markdown authoritative, ADR 0052 must say so explicitly and amend 0044's cross-reference rather than leaving two ADRs asserting different owners. Per repository practice, keep 0044 edited in place and compact — do not append a dated-history or "Superseded" narrative.
- **Risk: follow-up task ID collision.** Task IDs picked from this worktree's fork point can collide with IDs created on `main` since branching. Mitigation: before writing any follow-up file, re-check the candidate ID against `main` (`git ls-tree -r --name-only origin/main -- backlog/`), not just the local worktree.
- **Risk: unknown-field loss is silent.** A round trip that only checks known keys will pass while dropping extension frontmatter. Criterion 8 requires an explicitly unknown key in the fixture.
- **Assumption:** TASK-2307 is satisfied as the dependency — it is `done` at `backlog/completed/task-2307 - Ink-TUI-wave-5-guarded-actions-confirmation-cancellation-and-progress-operation-log.md`, so no further UI work is required before deciding.
- **Assumption:** `backlog.md` is an optional legacy aggregate, not the canonical catalog (`docs/adr/0051-ui-neutral-application-boundary.md:45-47`); the ADR need not preserve writes to it.
- **Assumption:** the capability-gated dispatcher in `src/application/controller/board-command.ts` (`INTEGRATED_CAPABILITIES`, `unavailableCapability`) is the port the authoring rule should name; if the implementer finds a more canonical port under `src/application/ports/`, name that one and cite why.

## Checkpoints
- **CP 1 — Inventory.** Read and cite the current catalog behavior: `src/platform/runtime/lib/tools/backlog.ts` (resolution, integrity, status, completion, labels, assignee/implementer, both transition paths), `src/platform/runtime/lib/commands/integrate.ts:1465-1500`, `backlog/config.yml`, and the existing tests (`test/backlog.test.ts`, `test/backlog_gate.test.ts`, `test/backlog_reorder_completed_duplicate.test.ts`). Output: the ADR skeleton with a complete, citation-backed `## Context`. No decision text yet.
- **CP 2 — Round-trip proof.** Build the harness and `test/task-2284-catalog-round-trip.test.ts` covering criteria 8 and 9, including the unknown-extension-key case and the three real-file copies in a temp directory. Confirm the source task files are untouched.
- **CP 3 — Options and decision.** Fill the comparison table (criterion 3), select one authority, and write the ten operational-concern subsections, the dual-write rejection, the client-neutral authoring rule, and the version-control answer (criteria 4–7). Feed the CP 2 measurements into the portability/import-export rows rather than asserting them.
- **CP 4 — Follow-ups and closure.** Create the follow-up backlog task(s) with compatibility and rollback acceptance criteria and main-verified IDs, add the `docs/adr/index.md` entry and the 0044/0051 cross-references, then run all three gates.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section — use that exact heading, spelled exactly `## Goal Check`
- A 3-column pipe-delimited markdown table with the exact header `| Criterion | Evidence | Status |`
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `docs/adr/0052-task-catalog-authority-and-board-authorship.md:41` or `src/platform/runtime/lib/tools/backlog.ts:685` (must point to an existing file and a line that exists in it)
  2. **Test names** — e.g., `"round trip preserves unknown frontmatter extension keys"` (must match a test name actually registered in the repo)
  3. **Test file paths** — e.g., `test/task-2284-catalog-round-trip.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0044`, `ADR 0051` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `npm test -- test/task-2284-catalog-round-trip.test.ts` ``, `` `./scripts/verify-local.sh docs` ``, `` `git ls-tree -r --name-only origin/main -- backlog/` ``
- For this mission specifically: cite the ADR by `file:line` for each of criteria 2–7, cite `test/task-2284-catalog-round-trip.test.ts` plus a named test for criteria 8–9, cite the follow-up task file path for criterion 10, and cite the gate command for criterion 13.
- Raw `stat`/`ls` output or generic prose is NOT sufficient evidence on its own — a row that says only "the ADR now covers offline behavior" or that pastes `ls docs/adr/` will be treated as unverified. Pair any shell output with one of the five accepted references above (for example, `ls` output alongside `docs/adr/0052-...md:118`).
- A non-generic `Next action:` line at the bottom (name the next file or command, not "continue the mission")

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| ADR exists with required sections and index entry | `docs/adr/0052-task-catalog-authority-and-board-authorship.md:1`, `docs/adr/index.md:22` | PASS |
| Round trip preserves unknown extension frontmatter keys | `test/task-2284-catalog-round-trip.test.ts`, `"round trip preserves unknown frontmatter extension keys"` | PASS |
| Dual-write rejected as steady state | `docs/adr/0052-task-catalog-authority-and-board-authorship.md:154`, `ADR 0044` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh docs`
- [ ] `./scripts/verify-local.sh static-analysis`
- [ ] `./scripts/verify-local.sh all`

## Restricted Areas
- `backlog/config.yml` — read only.
- `src/adapters/sqlite/**` — read only; no new migrations, repositories, or schema files.
- `src/platform/runtime/lib/tools/backlog.ts`, `src/platform/runtime/lib/commands/integrate.ts` — read only; the mission cites them, it does not change them.
- Existing files under `backlog/tasks/`, `backlog/completed/`, `backlog/archive/` — no deletion, rename, move, or content edit, except this mission's own `backlog/tasks/task-2284 - Decide-future-task-catalog-authority-and-board-authorship-migration.md` (labels/status only, never the `assignee` field) and newly created follow-up task files.
- `docs/adr/0044-workflow-distribution-model.md`, `docs/adr/0051-ui-neutral-application-boundary.md` — cross-reference line only; no rewrite of their decisions or accumulated history sections.
- `prompts/`, `workflow.config.json`, `scripts/` — untouched.

## Stop Rules
- Stop and ask if the evidence gathered in CP 1 makes the selected authority contradict ADR 0044's SQLite direction in a way that requires rewriting more of ADR 0044 than a cross-reference line.
- Stop if implementing the round-trip harness requires changing `src/platform/runtime/lib/tools/backlog.ts` or any file in Restricted Areas — extract or duplicate the parsing logic mission-locally instead, and record that choice in the checkpoint.
- Stop if any real file under `backlog/tasks/`, `backlog/completed/`, or `backlog/archive/` shows as modified or deleted in `git status --porcelain` other than this task file and new follow-up files.
- Stop if the mission's code+test diff exceeds 235 NEL (the Medium bucket ceiling); report the overrun rather than continuing to expand the harness.
- Stop if a follow-up task ID candidate already exists on `origin/main`; re-derive from `main` before writing.
- Stop if a gate fails for a reason outside this mission's diff (baseline red); report the failing test name and the parent commit rather than repairing unrelated production code.
