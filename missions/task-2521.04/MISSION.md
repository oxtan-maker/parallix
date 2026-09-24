# Mission: Import legacy Backlog records as Missions and give Mission dependencies a home (task-2521.04)

## Goal

Make `px import-legacy` correct under the Mission contract rule that
TASK-2521.03 introduced, pin every imported Mission's trace to recoverable
source history, and record Mission dependencies as Mission-to-Mission
references on the existing Mission aggregate.

## Why Now

TASK-2521.03 is integrated. The Mission aggregate is the only self-hosted task
record, and `refine` now refuses a Mission without a recorded contract (brief,
scope, success criteria, checkpoint plan, gate, predicted NEL bucket, and a
reproduction test for a bug mission). The importer on this branch predates that
rule: it drives legacy `refined`/`active` records through `refine`/`activate`,
and those transitions now fail. Five importer tests fail on the rebased tree
for exactly that reason.

TASK-2521.03 also dropped `dependencies` from the Mission, leaving predecessor
references with no home. TASK-2521.06 needs both pieces to classify legacy
material, and TASK-2521.07 removes the legacy files. So the imported trace has
to stay recoverable after that.

## Refinement Signals

- Predicted NEL bucket: Medium (81–235)

## Scope

- **Importer lane rule.** Import legacy `backlog` records as backlog Missions
  through `MissionIntakeService`. For a legacy `refined`, `active`, `review`,
  `integration` or `done` record with no existing Mission, report it and name
  why ("needs a recorded contract", or "needs checkpoint and review evidence").
  Do not import it. Records that are already materialized keep today's
  behaviour.
- **Recoverable trace.** Record the source path and the commit it was read at
  in the imported Mission's `ExternalTaskRef` locator (for example
  `backlog/tasks/<file>.md@<sha>`). The locator is not an identity: moving a file
  or changing the commit must not read as a conflict on re-import.
- **Mission dependencies.**
  - Model them as an ordered, distinct list of Mission ids on the Mission
    aggregate, persisted in their own table through a forward migration.
  - Add and remove them with `px depends add|remove --on <slug>`, following
    the conventions TASK-2521.03 set (`--slug` or worktree inference,
    `--expected-version`, JSON result, `--help`).
  - Reject self-references and ids that are not a Mission.
  - Report them in `px status` and `px status --json`.
- **Importer dependency mapping.** Map the legacy `dependencies` key (for
  example `TASK-2521.01`) onto Mission dependencies once the referenced Mission
  exists. Report each reference that does not resolve instead of dropping it.
  Stop listing `dependencies` as unrepresented.
- Update the importer and board-path tests to the new lane rule, and cover the
  dependency operations, including stale-write rejection.

## Out of Scope

- Any rule that consumes dependencies: blocking, activation order, scheduling,
  or board ordering.
- Importing description, acceptance criteria, definition of done, priority or
  ordinal. TASK-2521.06 classifies those; the commit-pinned trace keeps them
  recoverable.
- Inventing or importing a Mission contract for legacy `refined`/`active`
  records.
- A task table, task port, task-provider setting, task CLI or task status enum.
- Running the importer against the real repository, or deleting legacy files.

## Success Criteria

- A dry run over legacy `backlog`, `refined` and `done` fixtures writes no Mission row and reports each record in its correct category.
- A real import creates a backlog Mission for a legacy `backlog` record and does not import a legacy `refined` or `active` record, reporting it as needing a recorded contract.
- Re-running an unchanged import creates nothing and reports every imported record as already materialized, including after the source file moves or the pinned commit changes.
- An imported Mission's `ExternalTaskRef` locator names the source path and the commit it was read at.
- Duplicate, malformed and conflicting legacy records leave existing Mission rows unchanged.
- `px depends add` and `px depends remove` change a Mission's dependencies, and reject a stale `--expected-version`, a self-reference and an id that is not a Mission.
- `px status` and `px status --json` report a Mission's recorded dependencies.
- The importer records a resolvable legacy `dependencies` reference as a Mission dependency, and reports an unresolvable one.
- No lifecycle, activation or scheduling rule reads Mission dependencies.

## Risks and Assumptions

- Legacy `refined`/`active` records without a Mission should be rare, since
  work that ran through Parallix already has one. The dry-run report shows how
  many there are; TASK-2521.06 decides what happens to them.
- A legacy `dependencies` reference may point at a record that is itself not
  imported (for example a `done` record). Reporting it keeps the reference
  visible to TASK-2521.06 without inventing a Mission for it.

## Checkpoints

- CP-1: Apply the importer lane rule and the commit-pinned trace; bring the
  importer and board-path tests up to date and green.
- CP-2: Add Mission dependencies: domain value, migration, store round-trip,
  `px depends add|remove`, and `px status` / `px status --json` output.
- CP-3: Map legacy `dependencies` in the importer, and report unresolved
  references.
- CP-4: Run the gates, update the graph, and record evidence for every success
  criterion.

## Gates

- [ ] `./scripts/verify-local.sh static-analysis`
- [ ] `./scripts/verify-local.sh all`

## Restricted Areas

- Do not change `requireDraftedContract` or any other lifecycle rule to let the
  importer through.
- Do not copy legacy task text into the database.
- Do not write, move or delete legacy task files.

## Stop Rules

- Stop if importing a legacy record would require a contract, evidence or
  review state that does not exist.
- Stop if dependency references need an identity that is not a Mission id.
