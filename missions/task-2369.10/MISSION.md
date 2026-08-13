# Mission: Split mission importer parsing (task-2369.10)

## Goal

Extract the Markdown-frontmatter, goal-check, checkpoint-review, mission-file,
assignee-normalization, JSON-normalization, and truncation parsing helpers from
the SQLite mission importer into a dedicated parsing module. Keep the importer
as the orchestration class that delegates to those helpers, with unchanged
imported mission data and review decisions.

## Why Now

`mission-importer.ts` currently combines SQLite import orchestration with
parsing and normalization rules across 1,712 lines. That makes the rules hard
to test without constructing the importer class and makes future importer
changes risk altering unrelated parsing behavior. A focused module boundary
will make these pure parsing rules independently testable and bring the
importer below its accepted size limit.

## Refinement Signals

- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: separate 18 named parsing and normalization helpers from
  `mission-importer.ts`; preserve importer behavior through delegation; add
  independent focused tests; reduce the importer below 1,100 lines

## Scope

- Create `src/adapters/sqlite/mission-import-parsing.ts` containing standalone
  implementations of `parseFrontmatter`, `extractTaskId`, `buildCandidate`,
  `parseGoalCheckTable`, `extractNextAction`, `readMissionReview`,
  `reviewFromState`, `decisionFromPhase`, `requiredAgentFamily`,
  `checkpointOrder`, `readCheckpointFiles`, `readMdFiles`, `findMissionDir`,
  `nonNegativeCount`, `parseAssigneeValue`, `normalizeAssignee`,
  `canonicalJson`, and `truncate`.
- Change `src/adapters/sqlite/mission-importer.ts` so the importer class
  delegates each listed responsibility to the parsing module.
- Preserve existing parsing inputs, return shapes, error handling,
  normalization rules, checkpoint ordering, review-state interpretation, and
  filesystem search behavior for the listed helpers.
- Add focused automated tests that invoke the extracted parsing functions
  without constructing the mission importer class, covering valid frontmatter,
  task-ID extraction, goal-check table extraction, next-action extraction,
  review reading/state decisions, checkpoint ordering/file discovery, assignee
  parsing/normalization, canonical JSON, count clamping, and truncation.

## Out of Scope

- Changing the mission import schema, SQLite persistence, import lifecycle, or
  the meaning of imported mission/review fields.
- Changing mission Markdown, frontmatter, goal-check table, checkpoint, or
  review-file formats.
- Renaming any public importer API or moving non-parsing database orchestration
  out of `mission-importer.ts`.
- Refactoring unrelated SQLite adapters, mission workflow code, or backlog
  metadata handling.

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: `src/adapters/sqlite/mission-import-parsing.ts` exports standalone
  functions for exactly these extracted responsibilities: frontmatter parsing,
  task-ID extraction, candidate construction, goal-check-table parsing,
  next-action extraction, mission-review reading, review-state conversion,
  phase-decision conversion, required-agent-family selection, checkpoint
  ordering, checkpoint-file reading, Markdown-file reading, mission-directory
  discovery, non-negative-count handling, assignee-value parsing, assignee
  normalization, canonical JSON generation, and truncation.
- SC2: `src/adapters/sqlite/mission-importer.ts` delegates every responsibility
  listed in SC1 to the parsing module and contains fewer than 1,100 physical
  lines.
- SC3: For the existing supported mission inputs, the delegated importer
  preserves frontmatter/task ID/candidate fields, goal-check criteria and
  statuses, next action, review state/decision/agent family, checkpoint order,
  discovered Markdown and checkpoint files, assignee values, canonical JSON,
  non-negative counts, and truncation output.
- SC4: Focused automated tests import and execute the parsing module without
  instantiating the importer class, and cover each of the 18 responsibilities
  named in SC1, including at least one malformed or absent-input case where the
  prior helper defines fallback behavior.
- SC5: `./scripts/verify-local.sh static-analysis` and
  `./scripts/verify-local.sh all` complete successfully on the final tree.

## Risks and Assumptions

- Risk: helpers may rely on class-local state or private methods. Mitigation:
  make dependencies explicit function parameters or parsing-module imports and
  retain the current caller-owned orchestration state in the importer.
- Risk: changing exports or import direction can introduce circular module
  dependencies. Mitigation: keep the new module limited to parsing,
  normalization, and filesystem-reading helpers; do not import the importer
  from it.
- Risk: Markdown edge cases may be encoded only in existing importer tests.
  Mitigation: preserve existing cases and add direct parsing-module coverage
  before deleting the corresponding class-local implementations.
- Assumption: the 18 helpers named in the backlog are internal responsibilities
  whose existing callers can use a module function without changing public API
  contracts.

## Checkpoints

- CP 1: Map each of the 18 listed helper responsibilities to its current
  importer inputs, outputs, dependent state, and existing behavioral coverage;
  record the intended parsing-module API and identify any dependency that must
  remain in the importer.
- CP 2: Extract the 18 helpers to `mission-import-parsing.ts`, convert the
  importer to delegates, and add direct parsing-module tests for the complete
  responsibility list and its defined fallback cases.
- CP 3: Confirm the importer remains below 1,100 lines, run static analysis
  and the complete local verifier, then document final criterion-by-criterion
  evidence.

### Checkpoint Documentation Requirements

Every checkpoint document (CP-N.md) MUST include:
- A concise summary of work done for that checkpoint.
- The exact heading `## Goal Check`.
- The exact 3-column pipe-delimited table header `| Criterion | Evidence | Status |`.
- At least one evidence row for every success criterion using durable,
  verifiable references Parallix recognizes today: exact test names, ADR
  references, test file paths, and recognized repository commands or paths
  such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. File:line
  references are accepted when needed but discouraged because line numbers rot.
- Raw `stat`/`ls` output or generic prose alone is not enough. If shell output
  is useful, pair it with an accepted reference above.
- A non-generic `Next action:` line at the bottom that names the next mapping,
  extraction, test, or verification action.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Extracted parsing responsibilities are directly covered | `test/mission-import-parsing.test.ts`, exact parsing-module test names | PASS |
| Importer delegates and meets the line limit | `src/adapters/sqlite/mission-importer.ts`, `git diff --check` | PASS |
| Verification completed | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas

- Do not alter the SQLite schema, migrations, database writes, or persistence
  transaction boundaries.
- Do not change the externally observable import contract: mission field
  values, review state/decision semantics, checkpoint ordering, assignee
  normalization, and malformed-input fallback behavior must remain stable.
- Do not change mission workflow phase rules, agent-family policy, or backlog
  assignee ownership semantics while extracting parsing helpers.
- Do not modify files outside the importer, the new parsing module, and their
  directly relevant focused tests unless required to preserve existing module
  typing or test harness behavior.

## Stop Rules

- Stop and request direction if preserving a listed helper requires changing
  the SQLite schema, migrations, or persisted mission/review data shape.
- Stop and request direction if any helper is a public API whose extraction
  requires a consumer-facing rename or behavior change.
- Stop and request direction if direct testability requires changing mission
  Markdown, checkpoint, review, or frontmatter formats.
- Stop and request direction if reducing the importer below 1,100 lines
  requires extracting database orchestration or unrelated importer behavior.
