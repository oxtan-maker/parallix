# Mission: static evidence check must accept bare repo paths with spaces (task-2451)

## Goal
Widen the handoff/static-review evidence validator `evidenceCellHasVerifiableReference`
in `src/adapters/review/review-static-evidence.ts` so it accepts a **bare repo path
with no `:line` suffix and whose filename contains spaces** as a valid verifiable
reference, guarded by an on-disk existence check.

Specifically the current `barePathPattern` regex
`/(?:^|[\s(`])((?:\/|\.\/)?[\w ./-]+\.[\w-]+)/g` is missing the capturing group that
exposes the candidate path, so `barePathMatch[1]` is `undefined` and the subsequent
`.trim()` throws. Restore the capturing group so `barePathMatch[1]` resolves to the
path-like token, then verify each space-separated suffix resolves to a real file on
disk before returning `true`.

## Why Now
The `:line`-qualified path pattern `[\w./-]+\.[\w-]+` disallows spaces, and any path
with no command prefix and no `:line` falls through to "no verifiable reference".
Follow-up task files are named like
`backlog/tasks/task-2437.01 - design-fidelity-audit-vs-reference.md`, so a checkpoint
that cites such a file by bare path was blocked from handoff (TASK-2437). This is a
DELIBERATE widening, not a regression to revert: the check still requires the cited
path to exist on disk, so it cannot be satisfied by prose or placeholders.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: handoff blocked on legitimate space-containing repo paths; single
  validator function is the one place every evidence cell routes through.

## Scope
- Edit only `src/adapters/review/review-static-evidence.ts`: fix the capturing group
  on `barePathPattern` so `barePathMatch[1]` holds the candidate path-like token.
- Keep the existing "drop leading words until the rest resolves on disk" loop that
  tolerates filenames with spaces.
- Add regression tests to `test/review-static-evidence.test.ts`:
  - `accepts a bare repo path whose file exists (may contain spaces)`
  - `accepts a bare repo path without a :line suffix`
  - plus a negative case proving bare prose (`TBD`, `All tests pass`) still returns
    `false` because no file with an extension exists on disk.
- Align `test/board-readers.test.ts` and `test/web-board-interaction.test.ts` with
  the current main baseline when needed for the required verification gate.
- Run `./scripts/verify-local.sh all` and the unit test file.

## Out of Scope
- Do not alter the `:line` regex, the ADR, quoted-test-name, test-file, or command
  prefixes — only the bare-path branch.
- Do not change any other validator, formatter, or caller of
  `evidenceCellHasVerifiableReference` / `findUnverifiableGoalCheckRow`.
- Do not change the on-disk existence requirement or the "requires an extension"
  guard.
- Do not touch source outside `src/adapters/review/review-static-evidence.ts` and
  `test/review-static-evidence.test.ts`.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion is falsifiable; no
> subjective adjectives or vague quantifiers.

- At `test/review-static-evidence.test.ts`, the test
  `"accepts a bare repo path whose file exists (may contain spaces)"` passes and
  `"accepts a bare repo path without a :line suffix"` passes (green via
  `npm test -- test/review-static-evidence.test.ts`).
- The negative case passes: a cell containing only bare prose words with no
  extension-bearing file on disk returns `false` from
  `evidenceCellHasVerifiableReference` (no throw, no false positive).
- The full existing suite in `test/review-static-evidence.test.ts` still passes
  unchanged (no regression to the `:line`, ADR, quoted-name, test-file, or command
  branches).
- `./scripts/verify-local.sh all` completes with no static-analysis failures.
- The validator change is contained to one function; any additional test changes are
  limited to `test/review-static-evidence.test.ts`, `test/board-readers.test.ts`, and
  `test/web-board-interaction.test.ts`.

## Risks and Assumptions
- The bare-path matcher is greedy over spaces; a filename with spaces can swallow
  preceding prose. The existing "drop leading words until the rest resolves" loop
  mitigates this — assume it remains the guard, do not replace with a stricter
  regex that reintroduces the space rejection.
- Requiring an extension is what keeps prose from matching; assume this invariant
  stays. Narrowing the grammar must not drop the filesystem check.
- Assume the regression tests create their own temp mission dir + cited file (as the
  existing `performStaticReview` tests do) so they run against a real on-disk path.

## Checkpoints
- CP 1: Author the regression tests in `test/review-static-evidence.test.ts` that
  capture the space-containing bare path, the no-`:line` bare path, and the negative
  prose case (red at parent commit if the capturing group is broken, green once fixed).
- CP 2: Fix the capturing group on `barePathPattern` in
  `src/adapters/review/review-static-evidence.ts`.
- CP 3: Run the unit test file and `./scripts/verify-local.sh all`; confirm green.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `npm test -- test/review-static-evidence.test.ts` ``, `` `./scripts/verify-local.sh all` ``, or `` `git diff --name-only <primary-branch>..HEAD` ``
  2. **Test names** — e.g., `"accepts a bare repo path whose file exists (may contain spaces)"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/review-static-evidence.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0039` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above. Raw `ls` of a temp dir alone is not enough — pair it with the test name or `npm test` command that proves the path resolves.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Bare path with spaces is accepted | `test/review-static-evidence.test.ts`, `"accepts a bare repo path whose file exists (may contain spaces)"` | PASS |
| Bare path without :line is accepted | `npm test -- test/review-static-evidence.test.ts` | PASS |
| Prose still rejected | `test/review-static-evidence.test.ts`, negative case returns `false` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- `src/` outside `src/adapters/review/review-static-evidence.ts`
- Any file other than `test/review-static-evidence.test.ts`,
  `test/board-readers.test.ts`, and `test/web-board-interaction.test.ts` under
  `test/`
- Source files, config, docs, and backlog files (beyond the allowed edit to the
  backlog task labels/content) must not be modified.

## Stop Rules
- Do not transition the task to `ready`; the harness does that after a clean draft.
