# Mission: Retire the completed Mission compatibility importer (task-2405)

## Goal
Remove `MissionCompatibilityImporter` and the importer-specific parser, tests, and provenance-schema ownership after verifying the TASK-2322 operator-database cutover, while retaining the shared import history required by the blocklist and statistics importers.

## Why Now
TASK-2322's compatibility window is complete. Keeping the retired importer leaves obsolete migration behavior and an unclear provenance-schema owner in the supported database path.

## Refinement Signals
- Predicted NEL bucket: Small (0–80) / Medium (81–235) / Large (235+)
- Confidence: High
- Selection note: activate as-is
- Main drivers: completed TASK-2322 cutover; removal of obsolete compatibility code; explicit preservation of shared importer history

## Scope
- Confirm every supported operator database has completed the TASK-2322 cutover.
- Trace and remove `MissionCompatibilityImporter`, its parser, and importer-specific tests when they have no remaining caller.
- Remove or explicitly reassign the importer's migration and provenance-schema ownership.
- Preserve the import-history behavior and schema used by the blocklist and statistics importers.
- Add or update focused SQLite migration coverage that opens and migrates an existing operator database without the retired importer.

## Out of Scope
- Changing blocklist or statistics importer behavior beyond work required to retain their existing shared import history.
- Redesigning the import-history schema or adding new provenance fields.
- Migrating unsupported or externally managed databases.
- Reopening TASK-2322 compatibility work or adding a replacement compatibility importer.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- `MissionCompatibilityImporter` has no production definition, production caller, parser, or dedicated test remaining in the repository.
- The provenance migration/schema formerly owned only by `MissionCompatibilityImporter` is removed, or its continuing owner is explicitly the blocklist or statistics importer; their shared import-history schema and reads remain available.
- A focused SQLite migration test opens an existing operator-database fixture at the pre-retirement schema state, runs the supported migration path, and verifies the database remains usable without `MissionCompatibilityImporter`.
- `./scripts/verify-local.sh all` completes successfully on the final mission tree.

## Risks and Assumptions
- Risk: a provenance table or migration that appears importer-specific is still read by the blocklist or statistics importer. Mitigation: trace all production and test callers before deletion and retain shared history ownership.
- Risk: fresh-database tests can miss upgrades from deployed schemas. Assumption: a representative existing operator-database fixture can exercise the supported SQLite migration path.
- Assumption: TASK-2322 completion means no supported operator database requires Mission compatibility import data.

## Checkpoints
- CP 1: Map `MissionCompatibilityImporter` production and test callers, parser dependencies, migrations, provenance tables, and the blocklist/statistics import-history consumers; record the retained owner before editing.
- CP 2: Remove the retired importer and only its exclusive parser, tests, and schema/migration ownership; retain or explicitly reassign shared import history.
- CP 3: Add focused SQLite existing-database migration coverage, run the repository gate, and document criterion evidence.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include a work summary and lead its evidence with durable forms Parallix verifies today: exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. File:line references are accepted when needed but discouraged because line numbers rot.

Use the exact heading `## Goal Check`, followed by this exact 3-column table header:

| Criterion | Evidence | Status |
|---|---|---|

Include one evidence row for every success criterion. Raw `stat`/`ls` output or generic prose alone is not enough: pair shell output with an accepted command, path, exact test name, or ADR reference. End with a concrete `Next action:` line.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not change blocklist or statistics importer semantics except to preserve their current shared import-history dependency.
- Do not delete or rewrite operator-database data outside the supported SQLite migration path and its test fixtures.
- Do not add a new compatibility layer, importer framework, or provenance-schema redesign.

## Stop Rules
- Stop before deletion if any supported production or test flow still calls `MissionCompatibilityImporter`; identify the caller and require an explicit cutover decision.
- Stop if the provenance schema has an unclassified consumer outside the blocklist and statistics importers; establish ownership before changing it.
- Stop if existing operator databases cannot be migrated and opened in focused SQLite coverage without data loss or a supported migration path.
