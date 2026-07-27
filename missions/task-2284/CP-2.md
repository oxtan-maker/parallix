# CP-2 — Round-trip proof

## Summary

Built the mission-local round-trip harness
(`test/helpers/task-2284-catalog-round-trip.ts`) and its test
(`test/task-2284-catalog-round-trip.test.ts`), covering success criteria 8 and 9.
The harness parses a task Markdown file into a candidate canonical record
(`parseTaskRecord`, `test/helpers/task-2284-catalog-round-trip.ts:173`),
re-serializes it (`serializeTaskRecord`, `:218`), and diffs the re-parsed record
field by field (`diffTaskRecords`, `:238`; `roundTrip`, `:273`). It is read-only:
it takes a string and returns a string, and never writes a file.

Per the mission's stop rule, the harness does **not** import or modify
`src/platform/runtime/lib/tools/backlog.ts` — that module has no record type to
reuse, only single-field regex readers and in-place patchers, and it is a
Restricted Area. The parsing shapes accepted here mirror the spellings that
module accepts, and that choice is recorded in the harness header comment
(`test/helpers/task-2284-catalog-round-trip.ts:1-10`).

### Two findings that changed the harness

**Symmetric loss nearly produced a false pass.** The first implementation
compared `parse(x)` against `parse(serialize(parse(x)))` and reported zero
differences for all 242 stored records — while silently dropping every YAML
folded block scalar (`title: >-` and its continuation lines). A value the parser
never captures is absent from both sides of the comparison, so field equality
cannot see it. This is exactly the risk named in the mission's Risks section.
The fix was twofold: model block scalars and per-item raw spelling
(`test/helpers/task-2284-catalog-round-trip.ts:17-32`), and assert **byte
identity** of the re-serialization, not only field equality
(`test/task-2284-catalog-round-trip.test.ts:172`,
`test/task-2284-catalog-round-trip.test.ts:212-216`). Byte identity went from
170/242 records to 240/240 after the fix.

**Two stored records are corrupt and today's readers accept them silently.**

- `backlog/completed/task-1373 - TASK-1374-Mission-10-Tools-module-backlog-forgejo-gatekeeper-redgreen-sessions-setup-review.md`
  contains unresolved Git conflict markers *inside its frontmatter*, with two
  competing `status`/`assignee`/`labels` blocks (`status: done, assignee:
  [custom]` above `=======`, `status: backlog, assignee: []` below). Because
  `getTaskStatus` takes the first `^status:` regex match
  (`src/platform/runtime/lib/tools/backlog.ts:285-288`), the record reads as
  `done` and the conflict is invisible.
- `backlog/completed/task-1385 - Enforce-pre-review-exact-tree-verification-and-auto-bounce-on-failure.md`
  has `updated_date` indented under `created_date`, so no `^updated_date:`
  reader can ever see it (`src/platform/runtime/lib/tools/backlog.ts:846`).

Both files are in a Restricted Area, so they are pinned as known-corrupt with
their reasons rather than repaired
(`test/task-2284-catalog-round-trip.test.ts:199-212`), and a dedicated test
asserts the harness still detects them. These two records are direct evidence for
CP 3: unvalidated text authority has already admitted corruption that no gate
catches.

Measured result: 240 of 240 well-formed stored records round trip with zero field
differences and byte-identical re-serialization; 2 of 242 are corrupt at rest.

Source files were untouched — `git status --porcelain backlog/` produces no
output, and the test additionally re-reads each source file after the run and
asserts byte equality (`test/task-2284-catalog-round-trip.test.ts:177-180`).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Criterion 8 — harness exists under `test/` | `test/helpers/task-2284-catalog-round-trip.ts:173`, `test/helpers/task-2284-catalog-round-trip.ts:218`, `test/helpers/task-2284-catalog-round-trip.ts:273` | PASS |
| Criterion 8 — every named frontmatter key preserved (`id`, `title`, `status`, `assignee`, `created_date`, `updated_date`, `labels`, `dependencies`, `references`, `priority`) | `test/task-2284-catalog-round-trip.test.ts:102-107`, `"round trip preserves every named frontmatter key, including unknown extension keys"` | PASS |
| Criterion 8 — at least one unknown extension key not consumed by `src/platform/runtime/lib/tools/backlog.ts` | `test/task-2284-catalog-round-trip.test.ts:110-111` (`source`, `x_operator_channel`), `"round trip preserves every named frontmatter key, including unknown extension keys"` | PASS |
| Criterion 8 — `SECTION:DESCRIPTION` body preserved | `test/task-2284-catalog-round-trip.test.ts:144-146`, `"round trip preserves the SECTION:DESCRIPTION body and every AC and DOD item with its checked state and index"` | PASS |
| Criterion 8 — every `AC:` item with checked state and `#n` index preserved | `test/task-2284-catalog-round-trip.test.ts:148-152`, `"round trip preserves the SECTION:DESCRIPTION body and every AC and DOD item with its checked state and index"` | PASS |
| Criterion 8 — every `DOD:` item preserved | `test/task-2284-catalog-round-trip.test.ts:153-156`, `"round trip preserves the SECTION:DESCRIPTION body and every AC and DOD item with its checked state and index"` | PASS |
| Criterion 9 — three real files (one `backlog/tasks/`, one `backlog/completed/`, plus this mission's task file) copied to a temp directory, zero field differences | `test/task-2284-catalog-round-trip.test.ts:159-181`, `"round trip reports zero field differences for real task records copied from all three stores"` | PASS |
| Criterion 9 — source task files unmodified by the test run | `git status --porcelain backlog/` (no output), `test/task-2284-catalog-round-trip.test.ts:177-180` | PASS |
| Silent-loss risk closed (unknown-field / block-scalar loss cannot pass) | `test/task-2284-catalog-round-trip.test.ts:212-216`, `"round trip is lossless across every task record in backlog/tasks, backlog/completed, and backlog/archive/tasks"` (asserts byte identity, not only field equality) | PASS |
| Corrupt stored records detected and pinned, not repaired | `test/task-2284-catalog-round-trip.test.ts:228`, `"the harness detects the stored task records whose frontmatter is corrupt"` | PASS |
| Harness does not modify Restricted Areas | `test/helpers/task-2284-catalog-round-trip.ts:5-8` (no import of `src/platform/runtime/lib/tools/backlog.ts`); `git status --porcelain` lists no `src/` path | PASS |
| Test suite green | `npm test -- test/task-2284-catalog-round-trip.test.ts` — 5 pass, 0 fail | PASS |
| Static analysis green on the CP-2 tree | `./scripts/verify-local.sh static-analysis` — ESLint, tsc, test-hygiene, test typecheck all PASS | PASS |

Next action: fill `## Decision` in
`docs/adr/0052-task-catalog-authority-and-board-authorship.md` — the option
comparison table, the selected authority, and the ten operational-concern rows,
feeding in the CP-2 measurement (240/240 field-lossless, 2/242 corrupt at rest).
