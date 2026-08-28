# Mission: Create an ADR for the web implementation of px ui (task-2422)

## Goal
Author one compact Architecture Decision Record that decides **how the px web
board controller is implemented**, following the structure and tone of the
existing ADRs in `docs/adr/`. The ADR must name the chosen approach, justify it
against the ADR 0051 hexagonal boundary, and constrain any later implementation
mission so it cannot violate the fail-closed, single-authority, and
compatibility rules that ADR 0051/0048/0053 already set.

## Why Now
ADR 0051 established a UI-neutral, hexagonal application boundary and explicitly
left the web transport as a "possible local web board" future client without a
decision. A board design now exists at `/tmp/Parallix Kanban Board Controller
Web.zip` (HTML/JS mockups for `Parallix Board.dc.html`, `Parallix Board
GPU.dc.html`, `support.js`) showing the intended operator experience: a kanban
board with a Flow panel (cumulative-flow chart, median cycle time per state,
bottleneck read), a ranked "NEEDS YOU NEXT" queue with `run ▸` commands,
Refined/Backlog/Active/Review/Integrate/Shipped columns, and a command/event
log. No framework, hosting, or transport decision has been recorded yet, so the
next web implementation mission would have no recorded authority. This mission
produces that decision record before any code is written.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: ADR 0051 leaves the web transport un-decided; a board design
  exists in the zip; a recorded decision removes hallucination surface from the
  next implementation mission.

## Scope
- Research the current architecture and ADR set: read `docs/adr/0051`,
  `docs/adr/0044`, `docs/adr/0048`, `docs/adr/0053`, and skim
  `docs/adr/index.md` and `docs/tui-board.md` to match the house template and
  cite the invariants the web decision must respect.
- Inspect the design in `/tmp/Parallix Kanban Board Controller Web.zip` and
  extract only the operator-experience facts the ADR needs (views, panels,
  board actions), never the mockup's component/state model as product
  architecture.
- Do web research on the minimal set of framework/hosting options for a local,
  zero-runtime-dependency Node project and record why the chosen option beats
  the rejected ones.
- Write one ADR under `docs/adr/` using the existing ADR heading structure
  (`Status`, `Context`, `Decision drivers and evidence`, `Decision`,
  `Consequences`, `Implementation and verification gates`,
  `Reconsideration triggers`), keeping body text under 500 words.
- Place the ADR behind the ADR 0051 boundary: the web board is an inbound
  adapter that submits application commands and reads projections; it never
  writes task state, launches processes, or touches the filesystem directly.

## Out of Scope
- Any implementation of the web board (no server, no components, no routes).
- Installing, bundling, or importing a new web framework or dependency.
- Changing persistence authority (ADR 0053), the CLI command layer, or the
  Ink TUI.
- Building the cumulative-flow chart, cycle-time chart, or any rendering.
- Publishing, hosting, multi-user auth, or remote access decisions.

## Success Criteria
> Falsifiability rule (ADR 0039 Part 2): each criterion below is falsifiable and
> contains no unmetriced subjective adjectives.

1. An ADR file exists at `docs/adr/` with a numeric filename higher than
   `0051` (e.g. `docs/adr/0052-...md`) and a `# ADR 00XX: <title>` H1.
2. ADR body word count is strictly under 500 words (excludes the H1, section
   headings, and the decision matrix table cells).
3. ADR contains the standard sections: `Status`, `Context`, `Decision drivers
   and evidence`, `Decision`, `Consequences`, `Implementation and verification
   gates`, `Reconsideration triggers`.
4. ADR explicitly cross-references ADR 0051, ADR 0044, ADR 0048, and ADR 0053
   and states the web board as an inbound adapter that submits commands and
   reads projections.
5. ADR records the chosen framework/hosting option and a rejection of at least
   two named alternatives with the reason each fails.
6. ADR states that no new runtime dependency is introduced and that any web
   tooling stays under devDependencies, consistent with ADR 0044's
   zero-dependency posture.
7. ADR lists at least one reconsideration trigger tied to a security,
   hosting, or persistence decision that belongs to a later mission.
8. `./scripts/verify-local.sh all` passes on the final tree with captured output.
9. The draft is presented to the user for review before the mission closes.

## Risks and Assumptions
- Assumption: the zip mockups represent desired operator attention/interaction,
  not a component or state-model spec. If they are only throwaway prototypes,
  the ADR must not adopt their internal structure.
- Risk: over-long ADR. Mitigated by the <500-word cap and the checkpoint word
  count check.
- Risk: hallucinating a framework the repo cannot build. Mitigated by requiring
  the option to work with the existing zero-runtime-dependency, esbuild-bundled
  Node project and devDependencies only.
- Assumption: the web board never needs to be a separate authority; task
  authority stays with the Markdown/Git `transitionTask` path until ADR 0053.
- Risk: the chosen approach is later found infeasible; the reconsideration
  triggers and the "Implementation and verification gates" section scope a
  small, reversible follow-up rather than a rewrite.

## Checkpoints
- CP 1: Research — read the relevant ADRs and skim `docs/tui-board.md`; extract
  the board's operator-experience facts from the zip and list the candidate
  framework/hosting options with pros/cons.
- CP 2: Draft — author the ADR under `docs/adr/` in the house template, under
  500 words, with a decision matrix and reconsideration triggers.
- CP 3: Verify — run the verification gate, capture proof, and hand off for user
  review with a Goal Check table.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `./scripts/verify-local.sh all` ``, `` `npm test -- test/...` ``, `` `node ...` ``, `` `git ...` ``, `` `px ...` ``
  2. **Test names** — must match a test name in the repo
  3. **Test file paths** — must be an existing test file under `test/`
  4. **ADR references** — e.g., `ADR 0051` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above. Concretely: a bare `` `ls docs/adr/` `` or `` `stat docs/adr/0052-*.md` `` line is NOT sufficient on its own — pair it with an ADR reference such as `ADR 0052` and a recognized command/path, e.g. `` `./scripts/verify-local.sh docs` `` cited `ADR 0052`.
- Lead with durable evidence forms Parallix verifies today: exact ADR references (`ADR 0051`, `ADR 0044`, `ADR 0048`, `ADR 0053`), recognized repo commands/paths (backticked `` `npm ...` ``, `` `node ...` ``, `` `git ...` ``, `` `px ...` ``, `` `./scripts/verify-local.sh ...` ``), and test file paths. Mention file:line only parenthetically and sparingly because line numbers rot.
- A non-generic `Next action:` line at the bottom.

Author the ADR first (CP 2 deliverable). Then in CP-2.md and CP-3.md, open a
`## Goal Check` section and fill the `| Criterion | Evidence | Status |` table
using the accepted references above. Example rows:

| Criterion | Evidence | Status |
|---|---|---|
| ADR exists under `docs/adr/` with numeric id > 0051 | `docs/adr/0052-...md`, `ADR 0052`; verified with `` `./scripts/verify-local.sh all` `` | PASS |
| Body under 500 words | ADR 0052 word count measured by `` `node -e '...'` `` on `docs/adr/0052-...md` | PASS |
| Cross-references ADR 0051/0044/0048/0053 | `ADR 0051`, `ADR 0044`, `ADR 0048`, `ADR 0053` cited in `docs/adr/0052-...md` | PASS |
| Verification gate passed | `` `./scripts/verify-local.sh all` `` output captured | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify any source under `src/`, `test/`, `scripts/`, `lib/`, or
  `docs/` except to add the new ADR file under `docs/adr/`.
- Do not touch the backlog task's `assignee` field or move/rename/delete the
  backlog task file.
- Do not run the integration, mutation-gate, or review phases; the only gate
  is `./scripts/verify-local.sh all`.
- Do not install or import dependencies outside `package.json` devDependencies.

## Stop Rules
- Stop before writing any web board implementation code.
- Stop if the ADR would exceed 500 words of body text; cut prose, not the
  decision or the decision matrix.
- Stop if `./scripts/verify-local.sh all` fails; fix the ADR or stop and report.
- Stop after handing the ADR to the user for review; do not transition the task
  yourself — the harness transitions it to `ready` on a clean draft.
