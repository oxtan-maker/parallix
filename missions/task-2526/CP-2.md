# CP 2 — Shared-boundary correction in `parseTaskFrontmatterValue`

## Summary
Root cause: `parseTaskFrontmatterValue` (`src/adapters/backlog/task-file-io.ts`) matched only the first line of a frontmatter scalar with `^title:\s*([^\r\n]+)`. A mission description serialized as a YAML folded block scalar (`>-`) yields just the `>-` marker, which flows `ConcreteMissionReadAdapter.buildRecord` → `projectMissionCard` → `toWebBoardSnapshot` and renders verbatim on the web board.

Implemented the smallest shared-boundary correction in the same function: when the value is a YAML block-scalar header (`>-`, `|`, with optional chomping/indentation indicator), collect the indented continuation lines and fold them — folded (`>`) scalars collapse to a single line of descriptive text, literal (`|`) scalars preserve line breaks. Case-insensitive key match and first-match semantics are preserved; absent/empty scalars still return `null`. This is the single reader every backlog field routes through, so the correction is shared by all web/TUI projections (no per-caller patch).

Also hardened the regression test to consume the shared `emptyMetrics` fixture instead of an inline build.

## Goal Check
| Criterion | Evidence | Status |
|---|---|---|
| Folded description renders descriptive text, not `>-` | `test/task-2526-web-summary-repro.test.ts`, `"web mission summary renders folded YAML description text"` passes after fix | PASS |
| Ordinary single-line description unchanged | `test/task-2526-web-summary-repro.test.ts`, `"web mission summary preserves an ordinary single-line description"` passes | PASS |
| Shared reader corrected at the boundary | `src/adapters/backlog/task-file-io.ts` `parseTaskFrontmatterValue` folds `>-`/`|` block scalars | PASS |
| No new regressions across suite | `./scripts/verify-local.sh all` exit 0, 2631 pass / 0 fail | PASS |

Next action: run the required gate once more for durable evidence and write CP 3 (final checkpoint with Goal Check citing the green gate and test names).
